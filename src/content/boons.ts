// ============================================================================
//  BOON CONTENT — In-run power-ups for the Deep Mine and Wild Forest crawlers.
// ============================================================================
//
//  A boon is a permanent per-run buff awarded when the player walks onto a boon
//  cache tile or kills a band-gate guardian.  Boons are stored as string keys on
//  run state (`activeBoons: string[]`); effects are resolved at each hook point
//  by the engine's pure reducers (`boon*Mult`/`boon*Bonus`/`rollBoonChoices` in
//  `@/engine/crawl`) — this file is data only (ARCH-11).
//
//  All multiplier boons stack multiplicatively; additive boons stack additively.
//  `game` gates which crawler can offer the boon ('mine', 'forest', or 'both').
// ============================================================================

import type { CrawlBoon } from '@/engine/crawl';

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
