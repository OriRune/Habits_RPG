// Hex Tactics — turn sequencing and outcome resolution: endPlayerTurn drives the enemy phase,
// DoT/hazard decay, objective evaluation and hero restore; checkOutcome decides win/loss and
// finalises match-end objectives.
import type { RNG } from '../combat';
import { type Hex, hexDistance, hexEquals, hexKey } from '../hex';
import {
  type HexBattleState,
  type UnitStatus,
  HAZARD_DMG,
  MP_REGEN_PER_TURN,
  STA_REGEN_PER_TURN,
  WAVE_BATCH,
  WAVE_EVERY_TURNS,
  clone,
  hasStatus,
  livingHeroes,
  moveTilesFor,
  nearestHero,
  occupiedKeys,
  tileAt,
} from './state';
import { computeEnemyThreat, recomputeHighlights } from './geometry';
import { enemyTurn, planEnemyIntents } from './ai';

/**
 * End one hero's turn. In single-player (or when all heroes have ended), immediately runs the
 * enemy phase and restores all heroes. In co-op with multiple living heroes, marks the hero
 * as done and returns early — the enemy phase waits until all remaining heroes have ended.
 *
 * `heroId` identifies the acting hero in a co-op session. Omitted → s.player.
 */
export function endPlayerTurn(state: HexBattleState, rng: RNG = Math.random, heroId?: string): HexBattleState {
  if (state.turn !== 'player' || state.status !== 'active') return state;
  // Guard: don't re-end the same hero's turn (idempotent, reference-equal no-op).
  const heroToCheck = heroId ? (state.players?.find((p) => p.id === heroId) ?? state.player) : state.player;
  if (heroToCheck.endedTurn) return state;

  const s = clone(state);
  const hero = heroId ? (s.players?.find((p) => p.id === heroId) ?? s.player) : s.player;
  hero.endedTurn = true;

  // Apply DoT / hazard to this hero for their turn.
  applyDoTAndDecay(s, hero, hero.name ?? 'You', !hero.name);
  checkOutcome(s);
  if (s.status !== 'active') {
    s.reachable = [];
    s.targetable = [];
    return s;
  }

  // Multi-hero: if other living heroes haven't ended yet, hold the enemy phase.
  const multiHero = s.players && s.players.length > 1;
  if (multiHero && livingHeroes(s).some((p) => !p.endedTurn)) {
    // Clear this hero's highlights only; the board stays interactive for the other hero.
    s.reachable = [];
    s.targetable = [];
    return s;
  }

  // All heroes done (or single-player) — run the enemy phase.
  s.turn = 'enemy';
  enemyTurn(s, rng);
  if (s.status !== 'active') {
    s.reachable = [];
    s.targetable = [];
    return s;
  }

  // End-of-phase DoT ticks for enemies.
  for (const e of s.enemies) applyDoTAndDecay(s, e, e.name, false);
  checkOutcome(s);
  if (s.status !== 'active') {
    s.reachable = [];
    s.targetable = [];
    return s;
  }

  // --- Objective evaluations (after the enemy phase, before handing control back) ---------------
  if (s.objective && !s.objective.complete && !s.objective.failed) {
    const obj = s.objective;
    if (obj.kind === 'beacon' && obj.beaconHex) {
      const enemyOnBeacon = s.enemies.some((e) => hexEquals(e.hex, obj.beaconHex!));
      if (enemyOnBeacon) {
        obj.progress = 0; // streak broken
        obj.beaconBroken = true; // MINI-24: a contested beacon no longer completes for free on a win
      } else {
        obj.progress++;
        if (obj.progress >= obj.target) obj.complete = true;
      }
    } else if (obj.kind === 'flawless') {
      // Fail if ANY living hero dropped below the HP% threshold.
      for (const h of livingHeroes(s)) {
        const pct = (h.hp / h.maxHp) * 100;
        if (pct < obj.target) {
          obj.failed = true;
          break;
        } else {
          obj.progress = Math.min(obj.progress, pct);
        }
      }
    }
    else if (obj.kind === 'swift' && s.turnCount >= obj.target) {
      // The just-completed turn was the last one inside the budget and the board isn't clear —
      // the earliest possible win is now turn target+1, so the objective is already missed.
      // (A win DURING the budget resolves through checkOutcome before this runs.)
      obj.failed = true;
      s.log.push(`Swift Strike missed — the turn budget of ${obj.target} is spent.`);
    }
    // A swift win inside the budget is finalised in checkOutcome when the match ends.
  }

  // Restore ALL heroes: fresh movement, action, stamina + mana regen, clear endedTurn.
  const allHeroes = (s.players && s.players.length > 0) ? s.players : [s.player];
  for (const h of allHeroes) {
    h.movesLeft = moveTilesFor(h.ag);
    h.hasActed = false;
    h.overwatch = false; // expire any unused stance
    h.endedTurn = false;
    h.sta = Math.min(h.maxSta, h.sta + STA_REGEN_PER_TURN);
    h.mp = Math.min(h.maxMp, h.mp + MP_REGEN_PER_TURN);
    // Dev invincibility: "HP, mana, and stamina stay full" — literal top-up each turn.
    if (s.invincible) { h.hp = h.maxHp; h.mp = h.maxMp; h.sta = h.maxSta; }
    // Freeze bites heroes exactly as it bites enemies (enemyTurn skips a frozen enemy's act):
    // a frozen hero loses the coming turn's movement AND action. Enemy freezes are 1-turn, so
    // this is one skipped turn, not a chain-lock; the status decays at this hero's end of turn.
    if (h.hp > 0 && hasStatus(h, 'freeze')) {
      h.movesLeft = 0;
      h.hasActed = true;
      s.log.push(`${h.name ?? 'You'} ${h.name ? 'is' : 'are'} frozen solid — this turn is lost.`);
    }
  }

  s.turnCount++;

  // Reinforcement waves (audit D6): rosters above WAVE_CAP trickle in from the board's far
  // edge every WAVE_EVERY_TURNS player turns — sustained pressure without the quadratic burst
  // of 6-8 simultaneous foes against a one-action hero. An emptied board always pulls the next
  // wave immediately so the match never idles on a foe-less field.
  if (s.reinforcements && s.reinforcements.length > 0
      && (s.enemies.length === 0 || s.turnCount % WAVE_EVERY_TURNS === 1)) {
    spawnReinforcements(s);
  }

  s.turn = 'player';
  s.selected = null;
  recomputeHighlights(s);
  // Compute intent/threat for the upcoming turn so the UI can telegraph enemy plans.
  s.threatHexes = computeEnemyThreat(s);
  s.intentPlan = planEnemyIntents(s);
  return s;
}

/** Move up to WAVE_BATCH queued units onto the board at the standable tiles farthest from the
 *  heroes. Mutates `s` (caller holds the clone). */
function spawnReinforcements(s: HexBattleState): void {
  const queue = s.reinforcements ?? [];
  const batch = queue.slice(0, WAVE_BATCH);
  if (batch.length === 0) return;
  const occupied = occupiedKeys(s);
  // Candidates: standable, unoccupied tiles, farthest from the nearest hero first.
  const candidates = Object.values(s.tiles)
    .filter((t) => t.terrain !== 'blocked' && t.terrain !== 'hazard' && t.elevation <= 1 && !occupied.has(hexKey(t.hex)))
    .sort((a, b) =>
      hexDistance(b.hex, nearestHero(s, b.hex).hex) - hexDistance(a.hex, nearestHero(s, a.hex).hex));
  const placed: typeof batch = [];
  for (const unit of batch) {
    const spot = candidates.find((t) =>
      !placed.some((p) => hexEquals(p.hex, t.hex)) && !occupied.has(hexKey(t.hex)));
    if (!spot) break; // board packed solid — try again next wave
    unit.hex = { ...spot.hex };
    unit.prevHex = { ...spot.hex };
    placed.push(unit);
    occupied.add(hexKey(spot.hex));
  }
  if (placed.length === 0) return;
  s.enemies = [...s.enemies, ...placed];
  s.reinforcements = queue.slice(placed.length);
  const names = placed.map((u) => u.name).join(', ');
  s.log.push(`Reinforcements arrive — ${names} join${placed.length === 1 ? 's' : ''} the fray!`);
}

function applyDoTAndDecay(
  s: HexBattleState,
  unit: { hex: Hex; hp: number; statuses: UnitStatus[] },
  name: string,
  isPlayer: boolean,
): void {
  // Dev invincibility shields heroes from hazard and DoT ticks (enemies still take theirs).
  const shielded = isPlayer && s.invincible;
  const tile = tileAt(s, unit.hex);
  if (tile?.terrain === 'hazard' && !shielded) {
    unit.hp -= HAZARD_DMG;
    s.log.push(`${name} ${isPlayer ? 'are' : 'is'} scorched by the hazard for ${HAZARD_DMG}.`);
  }
  for (const st of unit.statuses) {
    if ((st.key === 'burn' || st.key === 'poison') && !shielded) {
      const d = Math.max(1, Math.round(st.magnitude));
      unit.hp -= d;
      s.log.push(`${name} ${isPlayer ? 'suffer' : 'suffers'} ${d} ${st.key} damage.`);
    }
  }
  unit.statuses = unit.statuses.map((st) => ({ ...st, turns: st.turns - 1 })).filter((st) => st.turns > 0);
}

export function checkOutcome(s: HexBattleState): void {
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  // Queued reinforcements still count as an enemy force — clearing the board mid-wave isn't a win.
  if (s.enemies.length === 0 && (s.reinforcements?.length ?? 0) === 0) {
    s.status = 'won';
    // Finalise objectives that can only be evaluated at match end.
    if (s.objective && !s.objective.failed) {
      const obj = s.objective;
      if (obj.kind === 'swift') {
        obj.complete = s.turnCount <= obj.target;
        if (obj.complete) s.log.push(`Swift Strike complete — won in ${s.turnCount} turn${s.turnCount === 1 ? '' : 's'}!`);
      } else if (obj.kind === 'flawless') {
        obj.complete = !obj.failed;
        if (obj.complete) s.log.push('Unscathed! HP never dropped below 50%.');
      } else if (obj.kind === 'beacon') {
        // MINI-24: a decisive win that never ceded the beacon completes it — clearing the board
        // is the ultimate "hold", so fast, aggressive play is rewarded instead of punished.
        if (!obj.complete && !obj.beaconBroken) obj.complete = true;
        if (obj.complete) s.log.push('Beacon held! Bonus gold awarded.');
      }
    }
  } else {
    const alive = livingHeroes(s);
    if (alive.length === 0) {
      // All heroes are down — defeat.
      s.player.hp = 0;
      s.status = 'lost';
    } else if (s.player.hp <= 0) {
      // Active-hero pointer fell in co-op; redirect to the nearest living ally.
      s.player = alive[0];
      if (alive[0].id !== undefined) s.activeHeroId = alive[0].id;
    }
  }
}
