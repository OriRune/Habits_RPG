// Hex Tactics — player actions and their previews: select / move / attack / hold / cast, plus the
// shared strike resolver and the push mechanic. These mutate a cloned HexBattleState and hand off to
// the turn/outcome plumbing in ./turns.
import type { RNG } from '../combat';
import {
  attackRoll, spellDamageRoll, spellHealAmount, illusionBoost,
  DMG_VARIANCE_MIN, DMG_VARIANCE_MAX, WEAK_MULT, RESIST_MULT, EXHAUSTED_MULT,
} from '../combat';
import { getSpell, SCHOOL_STAT } from '../spells';
import { type Hex, hexDistance, hexEquals, hexKey } from '../hex';
import {
  type AttackPreview,
  type EnemyUnit,
  type HexBattleState,
  type PlayerUnit,
  type SelectedAction,
  EFFECT_STAGGER_MS,
  HAZARD_DMG,
  applyUnitStatus,
  climbFor,
  clone,
  coverAt,
  effectPusher,
  elevationAt,
  enemyAt,
  hasStatus,
  heightDamageMult,
  tileAt,
  weakenFactor,
} from './state';
import { computeTargetable, reachableCosts, recomputeHighlights } from './geometry';
import { checkOutcome, endPlayerTurn } from './turns';

// --- Attack / spell preview (pure, no RNG consumed, no state mutation) --------------------------

/** Pre-commit damage estimate for a weapon attack. Returns null if the attack isn't legal. */
export function previewPlayerAttack(state: HexBattleState, target: Hex): AttackPreview | null {
  if (state.player.hasActed || state.turn !== 'player' || state.status !== 'active') return null;
  const enemy = enemyAt(state, target);
  if (!enemy) return null;
  const p = state.player;
  const weapon = p.weapon ?? state.weapon;
  const pz = elevationAt(state, p.hex);
  const dz = pz - elevationAt(state, enemy.hex);
  const hMult = heightDamageMult(dz);
  const ranged = !!weapon.ranged;
  const basePower = (ranged ? p.rangedPower : p.meleePower) * hMult * weakenFactor(p);
  const coverBonus = coverAt(state, enemy.hex);
  const mitigation = enemy.defense + coverBonus + enemy.guardBonus;
  const base = basePower + weapon.bonus;
  const weak = enemy.weakTo.includes(weapon.attackStat);
  const resist = enemy.resistTo.includes(weapon.attackStat);
  const weakMult = weak ? WEAK_MULT : resist ? RESIST_MULT : 1;
  // Mirror attackRoll exactly: an under-stamina swing lands at half power. A preview that omits
  // this can flag LETHAL on a hit that won't kill — precisely when the player is resource-starved.
  const exhausted = p.sta < weapon.staminaCost;
  const staMult = exhausted ? EXHAUSTED_MULT : 1;
  const minDmg = Math.max(1, Math.round(base * DMG_VARIANCE_MIN * weakMult * staMult) - mitigation);
  return {
    min: minDmg,
    max: Math.max(1, Math.round(base * DMG_VARIANCE_MAX * weakMult * staMult) - mitigation),
    dz, heightMult: hMult, mitigation, coverBonus, guardBonus: enemy.guardBonus,
    lethal: minDmg >= enemy.hp, weak, resist, exhausted,
  };
}

/** Pre-commit damage/heal estimate for a spell cast. Returns null for illusion spells (status only). */
export function previewSpell(state: HexBattleState, key: string, target: Hex | null): AttackPreview | null {
  if (state.player.hasActed || state.turn !== 'player' || state.status !== 'active') return null;
  const spell = getSpell(key);
  // Check per-hero MP; the key is provided by the caller so we skip knownSpells check here.
  if (!spell || state.player.mp < spell.mpCost) return null;

  // Positional mechanics don't produce a numeric preview — overlay shows a text hint instead.
  if (spell.mechanic === 'blink' || spell.mechanic === 'cleave' || spell.mechanic === 'push') return null;

  if (spell.school === 'support') {
    const raw = spellHealAmount(spell.power, state.player.supportSpell);
    const gained = Math.min(raw, state.player.maxHp - state.player.hp);
    return { min: gained, max: gained, dz: 0, heightMult: 1, mitigation: 0, coverBonus: 0, guardBonus: 0, lethal: false, weak: false, resist: false, isHeal: true };
  }
  if (spell.school === 'illusion' || !target) return null;

  const enemy = enemyAt(state, target);
  if (!enemy) return null;
  const p = state.player;
  const dz = elevationAt(state, p.hex) - elevationAt(state, enemy.hex);
  const hMult = heightDamageMult(dz);
  const casterPower = p.damageSpell * hMult * weakenFactor(p);
  const base = spell.power + casterPower * 1.2;
  const schoolStat = SCHOOL_STAT[spell.school];
  const weak = enemy.weakTo.includes(schoolStat) || enemy.weakTo.includes('WI');
  const resist = enemy.resistTo.includes(schoolStat) || enemy.resistTo.includes('WI');
  const weakMult = weak ? WEAK_MULT : resist ? RESIST_MULT : 1;
  const coverBonus = coverAt(state, enemy.hex);
  const mit = enemy.ward + coverBonus;
  const minDmg = Math.max(1, Math.round(base * DMG_VARIANCE_MIN * weakMult) - mit);
  return {
    min: minDmg,
    max: Math.max(1, Math.round(base * DMG_VARIANCE_MAX * weakMult) - mit),
    dz, heightMult: hMult, mitigation: mit, coverBonus, guardBonus: 0,
    lethal: minDmg >= enemy.hp, weak, resist,
  };
}

// --- Player actions -----------------------------------------------------------------------------
/** Select an action (move / attack / spell) and refresh the highlight caches. */
export function selectAction(state: HexBattleState, action: SelectedAction): HexBattleState {
  const s = clone(state);
  s.selected = action;
  recomputeHighlights(s);
  return s;
}

/** Move the player to a reachable tile. Costs movement but never the action.
 *  `heroId` is optional and identifies the acting hero in a co-op session. Omitted → s.player. */
export function movePlayer(state: HexBattleState, to: Hex, heroId?: string): HexBattleState {
  if (state.turn !== 'player' || state.status !== 'active') return state;
  const hero = heroId ? (state.players?.find((p) => p.id === heroId) ?? state.player) : state.player;
  const costs = reachableCosts(state, hero.hex, hero.movesLeft, climbFor(hero.ag));
  const dest = costs.get(hexKey(to));
  if (!dest) return state; // illegal move — ignore
  const s = clone(state);
  // Re-anchor s.player to the acting hero when heroId differs from activeHeroId.
  if (heroId && heroId !== s.activeHeroId) {
    const found = s.players?.find((p) => p.id === heroId);
    if (found) { s.activeHeroId = heroId; s.player = found; }
  }
  s.player.hex = { ...to };
  s.player.movesLeft -= dest.cost;
  s.selected = { kind: 'move' };
  recomputeHighlights(s);
  return s;
}

/**
 * Core strike resolution: compute damage, drain stamina, push effects and log onto `s`.
 * Mutates `s` directly (caller holds the clone). Does NOT set `hasActed` or call
 * `finishPlayerAction` — those are the caller's responsibility so this can be reused for
 * both normal attacks and overwatch reaction shots.
 *
 * `hero` is the acting hero unit (s.player in single-player; the relevant hero in co-op).
 */
export function resolvePlayerStrike(s: HexBattleState, hero: PlayerUnit, enemy: EnemyUnit, rng: RNG): void {
  const weapon = hero.weapon ?? s.weapon;
  const pz = elevationAt(s, hero.hex);
  const dz = pz - elevationAt(s, enemy.hex);
  const ranged = !!weapon.ranged;
  const rawPower = (ranged ? hero.rangedPower : hero.meleePower) * heightDamageMult(dz) * weakenFactor(hero);
  const full = hero.sta >= weapon.staminaCost;
  hero.sta = Math.max(0, hero.sta - weapon.staminaCost);
  // Blind bites the player exactly as it bites enemies (ai.ts enemyAttack): 40% whiff. The swing
  // still costs stamina — you committed to it. Without this, 5 of 16 enemy templates spend move
  // weight on an inflict that does nothing, and the ❄️/💫 badge on the hero would be a lie.
  if (hasStatus(hero, 'blind') && rng() < 0.4) {
    const push = effectPusher(s);
    push(ranged ? 'arrow' : 'melee', hero.hex, enemy.hex);
    s.effects.push({ id: s.seq++, kind: 'floater', from: enemy.hex, to: enemy.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: 'MISS', color: 'status' });
    const missName = hero.name ?? 'You';
    const missVerb = hero.name ? 'is blinded and misses' : 'are blinded and miss';
    s.log.push(`${missName} ${missVerb} ${enemy.name}!`);
    return;
  }
  const { dealt, weak, resist } = attackRoll(
    rawPower,
    weapon.bonus,
    weapon.attackStat,
    enemy.weakTo,
    enemy.resistTo,
    full,
    enemy.defense + coverAt(s, enemy.hex) + enemy.guardBonus,
    rng,
  );
  enemy.hp -= dealt;
  const push = effectPusher(s);
  push(ranged ? 'arrow' : 'melee', hero.hex, enemy.hex);
  s.effects.push({ id: s.seq++, kind: 'floater', from: enemy.hex, to: enemy.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: String(dealt), color: 'dmg-enemy' });
  const tag = weak ? ' — weak to it!' : resist ? ' — resisted' : '';
  const hz = dz > 0 ? ' (high ground)' : dz < 0 ? ' (uphill)' : '';
  const hitterName = hero.name ?? 'You';
  const hitVerb = hero.name ? 'hits' : 'hit';
  s.log.push(`${hitterName} ${hitVerb} ${enemy.name} for ${dealt}${tag}${hz}${full ? '' : ' (exhausted)'}${enemy.guardBonus > 0 ? ' (guarding)' : ''}.`);
}

/** Resolve the player's weapon attack against a targeted enemy.
 *  `heroId` is optional and identifies the acting hero in a co-op session. Omitted → s.player. */
export function playerAttack(state: HexBattleState, target: Hex, rng: RNG = Math.random, heroId?: string): HexBattleState {
  const heroToCheck = heroId ? (state.players?.find((p) => p.id === heroId) ?? state.player) : state.player;
  if (state.turn !== 'player' || state.status !== 'active' || heroToCheck.hasActed) return state;
  // MP-13: validate targetability against the acting hero, not the host's anchored
  // hero. computeTargetable only reads s.player, so shallow-swap it for the check;
  // state's own reference is preserved on the no-op path below.
  const anchored = heroToCheck === state.player ? state : { ...state, player: heroToCheck };
  if (!computeTargetable(anchored, { kind: 'attack' }).some((h) => hexEquals(h, target))) return state;
  const s = clone(state);
  // Re-anchor s.player to the acting hero when heroId differs from activeHeroId.
  if (heroId && heroId !== s.activeHeroId) {
    const found = s.players?.find((p) => p.id === heroId);
    if (found) { s.activeHeroId = heroId; s.player = found; }
  }
  const enemy = enemyAt(s, target)!;
  resolvePlayerStrike(s, s.player, enemy, rng);
  s.player.hasActed = true;
  finishPlayerAction(s);
  return s;
}

/**
 * Hold action: arm a one-shot overwatch reaction and end the player's turn.
 * If an enemy moves into weapon reach during the enemy phase, the reaction fires automatically —
 * one shot only, then the stance clears. Move-then-Hold is allowed; attack-then-Hold is not.
 * An unused stance expires at the start of the next player turn.
 *
 * `heroId` is optional and identifies the acting hero in a co-op session. Omitted → s.player.
 */
export function holdOverwatch(state: HexBattleState, rng: RNG = Math.random, heroId?: string): HexBattleState {
  // Guard check before cloning (preserve reference equality on no-op).
  const heroToCheck = heroId ? (state.players?.find((p) => p.id === heroId) ?? state.player) : state.player;
  if (state.turn !== 'player' || state.status !== 'active' || heroToCheck.hasActed) return state;
  const s = clone(state);
  const hero = heroId ? (s.players?.find((p) => p.id === heroId) ?? s.player) : s.player;
  hero.overwatch = true;
  hero.hasActed = true;
  const label = hero.name ?? 'You';
  const verb = hero.name ? 'takes' : 'take';
  s.log.push(`${label} ${verb} an overwatch stance, ready to fire on the first enemy that enters range.`);
  return endPlayerTurn(s, rng, heroId);
}

/** Resolve a spell cast. `target` is required for damage/illusion spells, ignored for support.
 *  `heroId` is optional and identifies the acting hero in a co-op session. Omitted → s.player. */
export function playerCastSpell(
  state: HexBattleState,
  spellKey: string,
  target: Hex | null,
  rng: RNG = Math.random,
  heroId?: string,
): HexBattleState {
  // Guard check before cloning (preserve reference equality on no-op).
  const heroToCheck = heroId ? (state.players?.find((p) => p.id === heroId) ?? state.player) : state.player;
  if (state.turn !== 'player' || state.status !== 'active' || heroToCheck.hasActed) return state;
  const heroSpells = heroToCheck.knownSpells ?? state.knownSpells;
  if (!heroSpells.includes(spellKey)) return state;
  const spell = getSpell(spellKey);
  if (!spell || heroToCheck.mp < spell.mpCost) return state;

  // MP-13: targetability must validate against the acting hero, not the host's
  // anchored hero (shallow-swap for the check only; preserves state reference on no-op).
  const anchored = heroToCheck === state.player ? state : { ...state, player: heroToCheck };
  // Cleave and blink are self-targeting (no enemy hex needed); push targets an enemy like illusion.
  const needsTarget = spell.school !== 'support' && spell.mechanic !== 'cleave';
  if (needsTarget && (!target || !computeTargetable(anchored, { kind: 'spell', spellKey }).some((h) => hexEquals(h, target!)))) {
    return state;
  }
  // Blink requires a valid destination tile even though it is school:support.
  if (spell.mechanic === 'blink' && (!target || !computeTargetable(anchored, { kind: 'spell', spellKey }).some((h) => hexEquals(h, target!)))) {
    return state;
  }

  const s = clone(state);
  // After cloning, find the acting hero in the cloned state.
  const hero = heroId ? (s.players?.find((p) => p.id === heroId) ?? s.player) : s.player;
  const heroWeapon = hero.weapon ?? s.weapon;
  hero.mp -= spell.mpCost;
  const schoolStat = SCHOOL_STAT[spell.school];
  const push = effectPusher(s);

  // --- Tactics positional mechanics (handled before school branching) ---
  if (spell.mechanic === 'blink') {
    push(`spell:${spell.key}`, hero.hex, target!);
    hero.hex = { ...target! };
    hero.movesLeft = 0;
    const blinkLabel = hero.name ?? 'You';
    const blinkVerb = hero.name ? 'blinks' : 'blink';
    s.log.push(`${blinkLabel} ${blinkVerb} to a nearby position.`);
    hero.hasActed = true;
    finishPlayerAction(s);
    return s;
  }
  if (spell.mechanic === 'cleave') {
    const adjacent = s.enemies.filter((e) => e.hp > 0 && hexDistance(hero.hex, e.hex) === 1);
    if (adjacent.length === 0) {
      s.log.push(`Cleave — no adjacent targets.`);
    } else {
      for (const e of adjacent) {
        const rawPower = hero.meleePower * weakenFactor(hero);
        const { dealt, weak } = attackRoll(rawPower, spell.power, heroWeapon.attackStat, e.weakTo, e.resistTo, true, e.defense + coverAt(s, e.hex), rng);
        e.hp -= dealt;
        push('melee', hero.hex, e.hex);
        s.effects.push({ id: s.seq++, kind: 'floater', from: e.hex, to: e.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: String(dealt), color: 'dmg-enemy' });
        s.log.push(`Cleave hits ${e.name} for ${dealt}${weak ? ' (weak!)' : ''}.`);
      }
    }
    hero.hasActed = true;
    finishPlayerAction(s);
    return s;
  }
  if (spell.mechanic === 'push') {
    const enemy = enemyAt(s, target!);
    if (!enemy) return state;
    const dir = computePushDir(hero.hex, enemy.hex);
    push(`spell:${spell.key}`, hero.hex, enemy.hex);
    // BAL-08: push is the CH payoff its tooltip advertises — Charisma hurls the foe farther
    // (and thus more likely into a wall/hazard for the bonus damage).
    const landing = applyPush(s, enemy, dir, 2 + Math.floor(hero.illusionPower / 8));
    const landTerrain = tileAt(s, landing)?.terrain;
    if (landTerrain === 'hazard') {
      const bonus = HAZARD_DMG * 2;
      enemy.hp -= bonus;
      s.effects.push({ id: s.seq++, kind: 'floater', from: landing, to: landing, startedAtMs: EFFECT_STAGGER_MS * 2, durationMs: 900, label: String(bonus), color: 'dmg-enemy' });
      s.log.push(`${spell.name} hurls ${enemy.name} into a hazard for ${bonus} bonus damage!`);
    } else {
      s.log.push(`${spell.name} flings ${enemy.name} back!`);
    }
    hero.hasActed = true;
    finishPlayerAction(s);
    return s;
  }

  if (spell.school === 'damage') {
    const enemy = enemyAt(s, target!)!;
    const dz = elevationAt(s, hero.hex) - elevationAt(s, enemy.hex);
    const power = hero.damageSpell * heightDamageMult(dz) * weakenFactor(hero);
    const { dealt, weak, resist } = spellDamageRoll(
      spell.power,
      power,
      schoolStat,
      enemy.weakTo,
      enemy.resistTo,
      enemy.ward + coverAt(s, enemy.hex),
      rng,
    );
    enemy.hp -= dealt;
    if (spell.status) applyUnitStatus(enemy.statuses, { ...spell.status });
    push(`spell:${spell.key}`, hero.hex, enemy.hex);
    s.effects.push({ id: s.seq++, kind: 'floater', from: enemy.hex, to: enemy.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: String(dealt), color: 'dmg-enemy' });
    const tag = weak ? ' — super effective!' : resist ? ' — resisted' : '';
    s.log.push(`${spell.name} sears ${enemy.name} for ${dealt}${tag}.`);
  } else if (spell.school === 'support') {
    if (spell.power > 0) {
      const heal = spellHealAmount(spell.power, hero.supportSpell);
      const gained = Math.min(heal, hero.maxHp - hero.hp);
      hero.hp += gained;
      s.effects.push({ id: s.seq++, kind: 'floater', from: hero.hex, to: hero.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: `+${gained}`, color: 'heal' });
      s.log.push(`${spell.name} restores ${gained} HP.`);
    }
    if (spell.status) {
      applyUnitStatus(hero.statuses, { ...spell.status });
      s.log.push(`${spell.name} wraps ${hero.name ? hero.name : 'you'} in a protective ward.`);
    }
    push(`spell:${spell.key}`, hero.hex, hero.hex);
  } else {
    // illusion — debuff a foe, duration boosted by Charisma (mirrors combat.ts)
    const enemy = enemyAt(s, target!)!;
    if (spell.status) {
      const boosted = illusionBoost(spell.status, hero.illusionPower);
      applyUnitStatus(enemy.statuses, boosted);
    }
    push(`spell:${spell.key}`, hero.hex, enemy.hex);
    s.log.push(`${spell.name} bewilders ${enemy.name}.`);
  }

  hero.hasActed = true;
  finishPlayerAction(s);
  return s;
}

function finishPlayerAction(s: HexBattleState): void {
  checkOutcome(s);
  if (s.status === 'active') {
    s.selected = null;
    recomputeHighlights(s);
  } else {
    s.reachable = [];
    s.targetable = [];
  }
}

// --- Push helpers -------------------------------------------------------------------------------

const HEX_DIRS: Hex[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

function computePushDir(from: Hex, to: Hex): Hex {
  const dq = to.q - from.q;
  const dr = to.r - from.r;
  let best = HEX_DIRS[0];
  let bestDot = -Infinity;
  for (const d of HEX_DIRS) {
    const dot = dq * d.q + dr * d.r;
    if (dot > bestDot) { bestDot = dot; best = d; }
  }
  return best;
}

function applyPush(s: HexBattleState, enemy: EnemyUnit, dir: Hex, tiles: number): Hex {
  let cur = { ...enemy.hex };
  for (let i = 0; i < tiles; i++) {
    const next = { q: cur.q + dir.q, r: cur.r + dir.r };
    const tile = tileAt(s, next);
    if (!tile || tile.terrain === 'blocked') {
      const dmg = HAZARD_DMG;
      enemy.hp -= dmg;
      s.effects.push({ id: s.seq++, kind: 'floater', from: cur, to: cur, startedAtMs: Math.round(EFFECT_STAGGER_MS * 1.5), durationMs: 800, label: String(dmg), color: 'dmg-enemy' });
      s.log.push(`${enemy.name} crashes into a wall for ${dmg}!`);
      break;
    }
    if (s.enemies.some((e) => e.id !== enemy.id && e.hp > 0 && hexEquals(e.hex, next))) break;
    cur = next;
    if (tile.terrain === 'hazard') break; // stop in the hazard (takes bonus damage after)
  }
  enemy.hex = { ...cur };
  return cur;
}
