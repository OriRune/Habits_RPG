// ============================================================================
//  BOON CONTENT — In-run power-ups for the Deep Mine and Wild Forest crawlers.
// ============================================================================
//
//  A boon is a permanent per-run buff awarded when the player walks onto a boon
//  cache tile or kills a band-gate guardian.  Boons are stored as string keys on
//  run state (`activeBoons: string[]`); effects are resolved at each hook point
//  by calling the pure reducers below — no closures, fully serialisable.
//
//  All multiplier boons stack multiplicatively; additive boons stack additively.
//  `game` gates which crawler can offer the boon ('mine', 'forest', or 'both').
// ============================================================================

import type { CrawlBoon } from '@/engine/crawl';
import type { RNG } from '@/engine/crawl';

export const BOONS: Record<string, CrawlBoon> = {
  swift_step: {
    key: 'swift_step', name: 'Swift Step',
    desc: 'Move 25% faster.', icon: '👟',
    game: 'both', moveMult: 1.25,
  },
  iron_arm: {
    key: 'iron_arm', name: 'Iron Arm',
    desc: '+30% weapon damage.', icon: '💪',
    game: 'both', meleeMult: 1.3,
  },
  stone_skin: {
    key: 'stone_skin', name: 'Stone Skin',
    desc: 'Take 3 less contact damage.', icon: '🪨',
    game: 'both', defenseBonus: 3,
  },
  vein_sense: {
    key: 'vein_sense', name: 'Vein Sense',
    desc: 'Double ore yield.', icon: '⛏',
    game: 'mine', yieldMult: 2,
  },
  forager: {
    key: 'forager', name: 'Forager',
    desc: 'Double gather & chop yield.', icon: '🌿',
    game: 'forest', yieldMult: 2,
  },
  quick_dash: {
    key: 'quick_dash', name: 'Quick Dash',
    desc: '30% faster dash cooldown.', icon: '💨',
    game: 'both', dashCdMult: 0.7,
  },
  overcharge: {
    key: 'overcharge', name: 'Overcharge',
    desc: 'Charge faster (1 fewer interval).', icon: '⚡',
    game: 'both', chargeReduce: 1,
  },
  vitality: {
    key: 'vitality', name: 'Vitality',
    desc: '+20 max HP, healed on pickup.', icon: '❤️',
    game: 'both', maxHpBonus: 20,
  },
  lantern: {
    key: 'lantern', name: 'Lantern',
    desc: 'See 2 tiles further in the fog.', icon: '🔦',
    // MINI-31: mine fog was pure friction with no counterplay — the mine already reads sightBonus,
    // so the lantern belongs in both crawlers (it was needlessly gated to the forest).
    game: 'both', sightBonus: 2,
  },
};

// ---------------------------------------------------------------------------
// Effect reducers — fold across activeBoons to get the combined modifier.
// ---------------------------------------------------------------------------

/** Combined weapon damage multiplier from held boons (multiplicative stack). */
export function boonMeleeMult(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.meleeMult != null ? acc * b.meleeMult : acc;
  }, 1);
}

/** Combined flat contact-damage reduction from held boons (additive stack). */
export function boonDefenseBonus(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.defenseBonus != null ? acc + b.defenseBonus : acc;
  }, 0);
}

/** Combined ore/chop/gather yield multiplier from held boons (multiplicative stack). */
export function boonYieldMult(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.yieldMult != null ? acc * b.yieldMult : acc;
  }, 1);
}

/** Combined move-speed multiplier from held boons (multiplicative stack).
 *  Applied as: `moveIntervalMs = base / boonMoveMult(keys)`. */
export function boonMoveMult(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.moveMult != null ? acc * b.moveMult : acc;
  }, 1);
}

/** Combined dash-cooldown multiplier from held boons (multiplicative stack).
 *  Applied as: `dashCooldownMs = base * boonDashCdMult(keys)`. */
export function boonDashCdMult(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.dashCdMult != null ? acc * b.dashCdMult : acc;
  }, 1);
}

/** Combined sight-radius bonus from held boons (additive stack). */
export function boonSightBonus(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.sightBonus != null ? acc + b.sightBonus : acc;
  }, 0);
}

/** Combined charge-interval reduction from held boons (additive stack).
 *  Subtracted from CHARGE_SWING_COUNT in the rAF loops. */
export function boonChargeReduce(keys: string[]): number {
  return keys.reduce((acc, k) => {
    const b = BOONS[k];
    return b?.chargeReduce != null ? acc + b.chargeReduce : acc;
  }, 0);
}

// ---------------------------------------------------------------------------
// Boon choice roller
// ---------------------------------------------------------------------------

/**
 * Pick up to 3 distinct boon options from those eligible for `game`, excluding
 * any boons the player already holds (no duplication — each key is unique).
 * Uses the injected `rng` for determinism.
 */
export function rollBoonChoices(
  game: 'mine' | 'forest',
  activeBoons: string[],
  rng: RNG,
): string[] {
  const held = new Set(activeBoons);
  const pool = Object.values(BOONS).filter(
    (b) => (b.game === 'both' || b.game === game) && !held.has(b.key),
  );
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3).map((b) => b.key);
}
