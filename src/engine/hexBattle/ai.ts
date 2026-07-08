// Hex Tactics — enemy AI: archetype scoring & movement, the enemy phase (move/attack/guard/etc.),
// overwatch reactions, and the intent telegraph. Damage math routes through the shared combat rolls.
import type { RNG } from '../combat';
import { variance } from '../combat';
import type { EnemyMove } from '../bosses';
import type { StatusKey } from '../spells';
import { type Hex, hexDistance, hexEquals } from '../hex';
import {
  type AIArchetype,
  type EnemyIntent,
  type EnemyUnit,
  type HexBattleState,
  type PlayerUnit,
  EFFECT_STAGGER_MS,
  HOLDER_LEASH,
  MAX_ELEVATION,
  MOVE_ANIM_MS,
  applyUnitStatus,
  blessFlat,
  coverAt,
  effectPusher,
  elevationAt,
  hasStatus,
  heightDamageMult,
  heightRangeBonus,
  livingHeroes,
  lungePending,
  moveBudgetFor,
  nearestHero,
  pressingKiter,
  tileAt,
  weakenFactor,
} from './state';
import { hasLineOfSight, reachableCosts } from './geometry';
import { resolvePlayerStrike } from './combat';
import { checkOutcome } from './turns';

/** Weighted-random move selection — mirrors the dungeon combat engine's pickEnemyMove. */
function pickMove(moveset: EnemyMove[] | undefined, rng: RNG): EnemyMove | null {
  if (!moveset || moveset.length === 0) return null;
  const total = moveset.reduce((a, m) => a + (m.weight ?? 1), 0);
  let r = rng() * total;
  for (const m of moveset) {
    r -= m.weight ?? 1;
    if (r < 0) return m;
  }
  return moveset[moveset.length - 1];
}

function mostLikelyMove(moveset: EnemyMove[]): EnemyMove | null {
  if (moveset.length === 0) return null;
  return moveset.reduce((best, m) => ((m.weight ?? 1) > (best.weight ?? 1) ? m : best), moveset[0]);
}

// --- Archetype-scored AI movement ---------------------------------------------------------------

// AIArchetype is defined in ./state (it is a field on the EnemyUnit shape) and re-exported here
// so `@/engine/hexBattle` still surfaces it as a public name.
export type { AIArchetype } from './state';

/** Visual and descriptive metadata for each AI archetype. Used by the overlay for ring colors,
 *  legend chips, and hover/intent tooltips. */
export const ARCHETYPE_INFO: Record<AIArchetype, { label: string; blurb: string; color: string }> = {
  charger: { label: 'Charger', blurb: 'Closes fast, ignores danger', color: '#ef4444' },
  kiter:   { label: 'Kiter',   blurb: 'Stays at range, seeks high ground', color: '#38bdf8' },
  holder:  { label: 'Holder',  blurb: 'Digs in, guards its position', color: '#f59e0b' },
  flanker: { label: 'Flanker', blurb: 'Circles to a new angle', color: '#a855f7' },
};

export function archetypeFor(templateId: string): AIArchetype {
  switch (templateId) {
    case 'dire_wolf': case 'goblin': case 'ghoul': case 'ice_elemental':
    case 'frost_troll': case 'ice_wolf': return 'charger';
    case 'wisp': case 'frost_revenant': case 'draugr_mage': case 'goblin_shaman': case 'ice_wisp': return 'kiter';
    case 'stone_sentry': case 'thornling': case 'corrupt_huorn': return 'holder';
    case 'skeleton': case 'giant_spider': return 'flanker';
    default: return 'charger';
  }
}

function computeFlankBonus(s: HexBattleState, self: EnemyUnit, candidate: Hex): number {
  const others = s.enemies.filter((e) => e.hp > 0 && e.id !== self.id);
  if (others.length === 0) return 0;
  // Each enemy independently flanks its nearest hero.
  const targetHex = nearestHero(s, candidate).hex;
  const dq = targetHex.q - candidate.q;
  const dr = targetHex.r - candidate.r;
  const len = Math.sqrt(dq * dq + dr * dr);
  if (len === 0) return 0;
  let avgQ = 0, avgR = 0;
  for (const o of others) {
    const ox = targetHex.q - o.hex.q;
    const oy = targetHex.r - o.hex.r;
    const ol = Math.sqrt(ox * ox + oy * oy);
    if (ol > 0) { avgQ += ox / ol; avgR += oy / ol; }
  }
  const al = Math.sqrt(avgQ * avgQ + avgR * avgR);
  if (al === 0) return 0;
  const dot = (dq / len) * (avgQ / al) + (dr / len) * (avgR / al);
  return (1 - dot) / 2;
}

function scoreMoveTile(s: HexBattleState, enemy: EnemyUnit, candidate: Hex, arch: AIArchetype): number {
  // Each enemy scores against its nearest hero from the candidate position.
  const targetHex = nearestHero(s, candidate).hex;
  const dist = hexDistance(candidate, targetHex);
  const elevGain = elevationAt(s, candidate) - elevationAt(s, enemy.hex);
  const terrain = tileAt(s, candidate)?.terrain;
  if (terrain === 'hazard') return -1000;
  const coverBonus = terrain === 'cover' ? 1 : 0;

  switch (arch) {
    case 'charger':
      return -dist * 3 + elevGain * 1.5 + coverBonus;
    case 'kiter': {
      const preferred = Math.max(1, enemy.range);
      const tooClose = dist < 2 ? -25 : 0;
      return -Math.abs(dist - preferred) * 4 + elevGain * 3 + tooClose + coverBonus;
    }
    case 'holder': {
      // Leash (audit D3): dig-in scoring is strictly anti-approach (moving k tiles nets −2k),
      // which made distant holders inert HP piles — free kills for any ranged build. Beyond
      // HOLDER_LEASH of the nearest hero the holder lumbers toward the fight like a slow
      // charger, reverting to holding ground once inside the leash.
      if (hexDistance(enemy.hex, nearestHero(s, enemy.hex).hex) > HOLDER_LEASH) {
        return -dist * 2 + elevGain * 1 + coverBonus;
      }
      const distFromSelf = hexDistance(candidate, enemy.hex);
      return -dist * 1 - distFromSelf * 3 + elevGain * 1;
    }
    case 'flanker': {
      const flank = computeFlankBonus(s, enemy, candidate);
      return -dist * 2 + flank * 5 + elevGain * 1 + coverBonus;
    }
  }
}

export function bestMoveFor(s: HexBattleState, enemy: EnemyUnit, moveTiles = enemy.moveTiles): Hex {
  // A kiter kept out of attack reach for KITER_PRESS_TURNS abandons ring-keeping and scores
  // like a charger for this activation (audit D4) — the shared pressingKiter() gate keeps
  // enemyAct and the intent planner telling the same story.
  const arch = pressingKiter(enemy) ? 'charger' : enemy.aiArchetype;
  // Kiters always evaluate movement (they want optimal range, not just "any range").
  if (arch !== 'kiter' && enemyInRange(s, enemy)) return enemy.hex;
  const costs = reachableCosts(s, enemy.hex, moveTiles, enemy.climb);
  let best = enemy.hex;
  let bestScore = scoreMoveTile(s, enemy, enemy.hex, arch);
  for (const { hex } of costs.values()) {
    const sc = scoreMoveTile(s, enemy, hex, arch);
    if (sc > bestScore) { bestScore = sc; best = hex; }
  }
  return best;
}

export function climbForEnemy(archetype: string | undefined, tier: number): number {
  const base = archetype === 'beast' || archetype === 'elemental' ? 2 : 1;
  return Math.min(MAX_ELEVATION, base + Math.floor(tier / 10));
}

function enemyTurn(s: HexBattleState, rng: RNG): void {
  const push = effectPusher(s);
  for (const enemy of s.enemies) {
    if (enemy.hp <= 0) continue;
    if (hasStatus(enemy, 'freeze')) {
      s.log.push(`${enemy.name} is frozen and cannot act.`);
      continue;
    }
    // Snapshot position before this enemy acts so the overlay can hold the sprite here
    // until the 'move' effect fires, producing a sequential slide animation per enemy.
    enemy.prevHex = { ...enemy.hex };
    enemyAct(s, enemy, rng, push);
    checkOutcome(s);
    if (s.status !== 'active') return;

    // Overwatch reactions: any living hero with overwatch armed fires once against the first
    // enemy that ends its move within weapon reach — OR, for melee weapons, the first enemy
    // that breaks away from adjacency (attack of opportunity, audit D10: kiters/holders never
    // step INTO a sword's reach, so melee overwatch otherwise punished nothing that matters).
    for (const hero of livingHeroes(s)) {
      if (!hero.overwatch || enemy.hp <= 0) continue;
      const heroWeapon = hero.weapon ?? s.weapon;
      const fledMelee = !heroWeapon.ranged
        && !!enemy.prevHex
        && hexDistance(hero.hex, enemy.prevHex) === 1
        && hexDistance(hero.hex, enemy.hex) > 1;
      if (!inAttackReachFor(s, hero, enemy.hex) && !fledMelee) continue;
      const heroVerb = hero.name ? `${hero.name} snaps` : 'You snap';
      s.log.push(fledMelee
        ? `Overwatch! ${heroVerb} a parting strike as ${enemy.name} breaks away.`
        : `Overwatch! ${heroVerb} a reaction shot at ${enemy.name}.`);
      resolvePlayerStrike(s, hero, enemy, rng);
      hero.overwatch = false;
      checkOutcome(s);
      if (s.status !== 'active') return;
    }
  }
}

/**
 * Returns true if `enemyHex` is within `hero`'s weapon reach from their current position,
 * accounting for height bonus and line-of-sight (ranged weapons only). Bypasses `hasActed`
 * so it can be used during the enemy phase for overwatch reactions.
 */
function inAttackReachFor(s: HexBattleState, hero: PlayerUnit, enemyHex: Hex): boolean {
  const weapon = hero.weapon ?? s.weapon;
  const p = hero.hex;
  const pz = elevationAt(s, p);
  if (weapon.ranged) {
    const range = weapon.range ?? 1;
    const dz = pz - elevationAt(s, enemyHex);
    return hexDistance(p, enemyHex) <= range + heightRangeBonus(dz) && hasLineOfSight(s, p, enemyHex);
  }
  return hexDistance(p, enemyHex) === 1;
}

/** Range at which `enemy` can strike its nearest hero, accounting for height (ranged foes only). */
function enemyEffectiveRange(s: HexBattleState, enemy: EnemyUnit, target?: PlayerUnit): number {
  if (enemy.range <= 1) return 1;
  const t = target ?? nearestHero(s, enemy.hex);
  const dz = elevationAt(s, enemy.hex) - elevationAt(s, t.hex);
  return enemy.range + heightRangeBonus(dz);
}

function enemyInRange(s: HexBattleState, enemy: EnemyUnit): boolean {
  const target = nearestHero(s, enemy.hex);
  const dist = hexDistance(enemy.hex, target.hex);
  if (dist > enemyEffectiveRange(s, enemy, target)) return false;
  return enemy.range <= 1 || hasLineOfSight(s, enemy.hex, target.hex);
}

function enemyAct(s: HexBattleState, enemy: EnemyUnit, rng: RNG, push: ReturnType<typeof effectPusher>): void {
  enemy.guardBonus = 0;
  const arch = enemy.aiArchetype;
  // Chargers and flankers are the melee "close-to-engage" archetypes; give them a catch-up lunge
  // so a bow kiter can't hold them at range forever. Kiters want distance and holders hold ground,
  // so neither participates — the lunge only ever fires on a unit actively trying to close.
  const chasing = arch === 'charger' || arch === 'flanker';
  // Non-kiters attack immediately when already in range; kiters always reassess position.
  if (arch !== 'kiter' && enemyInRange(s, enemy)) {
    if (chasing) enemy.turnsOutOfReach = 0;
    enemyAttack(s, enemy, rng, push);
    return;
  }
  // A chaser kept out of reach for two turns lunges with an extra-long budget (2×+1, so it strictly
  // out-paces even a max-AG player — 2×moveTiles alone merely *ties* the top move on a medium board)
  // and keeps lunging every turn until it connects. This turn only; moveTiles is never mutated. Breaks
  // the "player speed ≥ enemy speed forever" kiting invariant. Kiters/holders are unaffected.
  // lungePending/moveBudgetFor live in ./state and are shared with the threat/intent predictors,
  // so the telegraph can never drift from what actually happens here.
  const lunge = lungePending(enemy);
  if (lunge) s.log.push(`${enemy.name} lunges forward!`);
  const bestHex = bestMoveFor(s, enemy, moveBudgetFor(enemy));
  if (!hexEquals(bestHex, enemy.hex)) {
    // Emit a 'move' effect before mutating hex — the overlay will hold the sprite at
    // prevHex until this effect fires, then slide it to bestHex (staggered per-enemy).
    push('move', enemy.hex, bestHex, MOVE_ANIM_MS, enemy.id);
    enemy.hex = { ...bestHex };
  } else {
    s.log.push(`${enemy.name} holds its ground.`);
  }
  const inRange = enemyInRange(s, enemy);
  if (inRange) enemyAttack(s, enemy, rng, push);
  // Track reach: reset only when the unit ends in range; a whiffed lunge keeps the counter
  // elevated so it presses every turn until it connects. Kiters track it too (audit D4) —
  // one kept beyond its own reach for KITER_PRESS_TURNS stops idling and closes in.
  if (chasing || arch === 'kiter') enemy.turnsOutOfReach = inRange ? 0 : (enemy.turnsOutOfReach ?? 0) + 1;
}

function enemyAttack(s: HexBattleState, enemy: EnemyUnit, rng: RNG, push: ReturnType<typeof effectPusher>): void {
  // Each enemy independently targets its nearest living hero.
  const target = nearestHero(s, enemy.hex);
  push(enemy.range > 1 ? 'arrow' : 'melee', enemy.hex, target.hex);
  if (hasStatus(enemy, 'blind') && rng() < 0.4) {
    s.log.push(`${enemy.name} is blinded and misses!`);
    return;
  }
  const dodgeLabel = target.name ?? 'You';
  const dodgeVerb = target.name ? 'dodges' : 'dodge';
  if (rng() < target.dodge) {
    s.log.push(`${dodgeLabel} ${dodgeVerb} ${enemy.name}'s attack!`);
    return;
  }

  const move = pickMove(enemy.moveset, rng);
  const kind = move?.kind ?? 'attack';
  const dz = elevationAt(s, enemy.hex) - elevationAt(s, target.hex);
  const hMult = heightDamageMult(dz);
  const mit = (enemy.attackSchool === 'magic' ? target.ward : target.defense) + coverAt(s, target.hex);
  const bless = blessFlat(target);

  if (kind === 'guard') {
    enemy.guardBonus = move?.bonus ?? 4;
    s.log.push(`${enemy.name} ${move?.label ?? 'braces defensively'} (+${enemy.guardBonus} defense).`);
    return;
  }

  if (kind === 'enrage') {
    const bonus = move?.bonus ?? 4;
    enemy.attack += bonus;
    s.log.push(`${enemy.name} ${move?.label ?? 'enrages'}! Attack +${bonus}.`);
    return;
  }

  const baseMult = kind === 'heavy' ? (move?.mult ?? 1.6) : 1.0;
  const hits = kind === 'multi' ? Math.max(1, move?.hits ?? 2) : 1;

  let totalDealt = 0;
  for (let i = 0; i < hits; i++) {
    let dmg = variance(enemy.attack * baseMult * hMult * weakenFactor(enemy), rng);
    dmg = Math.max(1, dmg - mit);
    dmg = Math.max(1, dmg - bless);
    totalDealt += Math.round(dmg);
  }

  // Dev invincibility (set at match start): the attack still resolves and narrates, but no HP moves.
  if (!s.invincible) {
    target.hp -= totalDealt;
    s.effects.push({ id: s.seq++, kind: 'floater', from: target.hex, to: target.hex, startedAtMs: EFFECT_STAGGER_MS + 60, durationMs: 900, label: `-${totalDealt}`, color: 'dmg-player' });
  }

  const targetLabel = target.name ?? 'you';
  if (kind === 'drain') {
    const healed = Math.round(totalDealt * (move?.drainRatio ?? 0.5));
    enemy.hp = Math.min(enemy.maxHp, enemy.hp + healed);
    s.log.push(`${enemy.name} ${move?.label ?? `drains ${targetLabel}'s life`} for ${totalDealt}${healed > 0 ? `, healing ${healed}` : ''}.`);
  } else if (kind === 'inflict') {
    if (move?.inflictKey) {
      applyUnitStatus(target.statuses, { key: move.inflictKey as StatusKey, turns: move.inflictTurns ?? 2, magnitude: move.inflictMag ?? 1 });
      s.effects.push({ id: s.seq++, kind: 'floater', from: target.hex, to: target.hex, startedAtMs: EFFECT_STAGGER_MS * 2, durationMs: 800, label: move.inflictKey, color: 'status' });
    }
    s.log.push(`${enemy.name} ${move?.label ?? `strikes ${targetLabel}`} for ${totalDealt}.`);
  } else if (kind === 'heavy') {
    s.log.push(`${enemy.name} ${move?.label ?? 'lands a heavy blow'} for ${totalDealt}!`);
  } else if (kind === 'multi' && hits > 1) {
    s.log.push(`${enemy.name} ${move?.label ?? 'attacks rapidly'} for ${totalDealt} (${hits} hits).`);
  } else {
    s.log.push(`${enemy.name} hits ${targetLabel} for ${totalDealt}.`);
  }
}

// --- Enemy intent (pure, used for UI telegraph) -------------------------------------------------

export function planEnemyIntents(state: HexBattleState): EnemyIntent[] {
  return state.enemies
    .filter((e) => e.hp > 0)
    .map((enemy) => {
      if (hasStatus(enemy, 'freeze')) {
        return { enemyId: enemy.id, moveTo: enemy.hex, willAttack: false, attackLabel: 'frozen in place', attackIcon: '❄️' };
      }
      // Predict with the same budget enemyAct will actually use — including the catch-up lunge.
      // (An in-range chaser attacks in place instead of lunging, so don't telegraph one.)
      const lunge = lungePending(enemy) && !enemyInRange(state, enemy);
      const moveTo = bestMoveFor(state, enemy, moveBudgetFor(enemy));
      // Each enemy independently targets its nearest living hero.
      const target = nearestHero(state, moveTo);
      const ez = elevationAt(state, moveTo);
      const pz = elevationAt(state, target.hex);
      const effRange = enemy.range <= 1 ? 1 : enemy.range + heightRangeBonus(ez - pz);
      const willAttack = hexDistance(moveTo, target.hex) <= effRange &&
        (enemy.range <= 1 || hasLineOfSight(state, moveTo, target.hex));
      const move = enemy.moveset ? mostLikelyMove(enemy.moveset) : null;
      return {
        enemyId: enemy.id,
        moveTo,
        willAttack,
        attackLabel: lunge ? 'lunges forward!' : (move?.label ?? 'attacks'),
        attackIcon: lunge ? '💨' : (move?.icon ?? (enemy.range > 1 ? '🏹' : '⚔️')),
        lunge,
      };
    });
}

export { enemyTurn };
