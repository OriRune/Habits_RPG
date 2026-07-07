import { describe, it, expect } from 'vitest';
import {
  deriveCombatant,
  createBattle,
  playerAction,
  type Fighter,
  type BattleState,
  type RNG,
} from '../combat';
import { emptyStatLevels } from '../progression';
import { emptyCombatStats } from '../combatStats';
import { getWeapon, STARTER_WEAPON } from '../weapons';
import { enemyFor, ENEMIES } from '../enemies';
import { bossForLevel, NAMED_BOSSES } from '../bosses';
import { getBiome, bossFor } from '../biomes';
import { DAMAGE_STATS, type StatId } from '../stats';
import { BIOMES } from '@/content/biomes';
import type { BossDef, BossPhase } from '../bosses';

const fixed = (v: number): RNG => () => v;

/** A plausible on-level melee build: most points in Strength, some in HP/Endurance. */
function meleeFighter(charLevel: number, spread: Partial<Record<StatId, number>>): Fighter {
  const lv = { ...emptyStatLevels(), ...spread };
  return { c: deriveCombatant(lv, charLevel, emptyCombatStats()), weapon: getWeapon(STARTER_WEAPON) };
}

/**
 * Simulate a fight with a simple, realistic policy: swing while stamina allows, otherwise
 * brace to recover it. Deterministic rng (no dodges/crits) keeps the round count stable.
 */
function simulate(make: () => Fighter, foe: BossDef, maxRounds = 60, lossesBefore = 0) {
  // fixed(0.49), not 0.5: now that bosses carry movesets, the enemy's move is chosen by
  // weighted RNG. 0.49 deterministically lands on the plain `attack` (which every boss lists
  // first with weight ≥ half its total), reproducing 5.1's flat-attack tuning baseline — the
  // exact scenario these gates were tuned against — while keeping combat variance identical to
  // the old 0.5 (no dodges, ~1.0× damage). Move variety itself is covered by combat.moves.test.
  // lossesBefore feeds the anti-frustration relief so tests can model a boss re-attempted after
  // prior deaths (the exact scenario MINI-04's enterRoom relief-threading now enables).
  const R = fixed(0.49);
  let battle: BattleState = createBattle(make(), foe, { lossesBefore }, R);
  let rounds = 0;
  while (battle.status === 'active' && rounds < maxRounds) {
    const f = make();
    const action = battle.playerSta >= f.weapon.staminaCost ? { kind: 'attack' as const } : { kind: 'defend' as const };
    battle = playerAction(battle, f, action, R);
    rounds++;
  }
  return { status: battle.status, rounds, playerHp: battle.playerHp };
}

describe('combat balance (reference fights)', () => {
  // A level-5 fighter who has trained Strength: ST 7, HP 5, EN 3.
  const lv5 = () => meleeFighter(5, { ST: 7, HP: 5, EN: 3, AG: 2 });

  it('a trained Lv5 fighter clears a depth-1 enemy and survives', () => {
    const foe = enemyFor(1, 5, ['skeleton'], fixed(0));
    const r = simulate(lv5, foe, 30);
    expect(r.status).toBe('won');
    expect(r.playerHp).toBeGreaterThan(0);
    expect(r.rounds).toBeLessThan(20);
  });

  it('a trained Lv5 fighter can win the first Level-Up Trial (Procrastination Slime)', () => {
    const r = simulate(lv5, bossForLevel(5), 50);
    expect(r.status).toBe('won');
    expect(r.playerHp).toBeGreaterThan(0);
  });

  it('the first dungeon boss still gates an underleveled (Lv1) fighter', () => {
    const tyrant = bossFor(getBiome('catacombs'), 5, 1);
    const r = simulate(() => meleeFighter(1, {}), tyrant, 60);
    expect(r.status).toBe('lost');
  });

  // MINI-04: the first biome boss (The Bone Tyrant) was a ~7×-over-curve two-phase HP wall that
  // no realistic depth-5 build could clear, paid zero loot, and never received pity relief. The
  // fix is a package — ~35% phase-HP cut + depth-scaled gold + boss-loss relief threaded through
  // enterRoom. A prepared challenger (L7, the affordable iron_mace, a deep HP pool) who has died
  // a couple of times and thus earned relief now wins within budget; it would time out or die
  // against the old HP totals. Gold + relief-threading are covered in store.integration.test.
  it('a prepared, relief-assisted build clears the first biome boss (MINI-04)', () => {
    const make = (): Fighter => ({
      c: deriveCombatant({ ...emptyStatLevels(), ST: 14, HP: 13, EN: 6 }, 7, emptyCombatStats()),
      weapon: getWeapon('iron_mace'),
    });
    const tyrant = bossFor(getBiome('catacombs'), 5, 7);
    const r = simulate(make, tyrant, 80, 4); // 4 prior losses → -20% HP relief
    expect(r.status).toBe('won');
    expect(r.playerHp).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BAL-02 — boss gates must not be rigged against a pure-melee (ST) build.
//  A focused, at-level Strength build wins its level-up gate on the first try
//  (no pity handicap). These fail on the old data, where the gates weakTo none
//  of ST and several RESIST ST.
// ─────────────────────────────────────────────────────────────────────────────
describe('BAL-02 boss gates are winnable by a pure-ST build', () => {
  // Realistic at-level focused ST builds (full HP, ~3-4 stat points per level).
  const stAt = (level: number, spread: Partial<Record<StatId, number>>) =>
    () => meleeFighter(level, spread);

  it('a pure-ST L8 build wins the Drill Sergeant Rex gate', () => {
    const r = simulate(stAt(8, { ST: 12, HP: 8, EN: 4 }), bossForLevel(8), 60);
    expect(r.status).toBe('won');
    expect(r.playerHp).toBeGreaterThan(0);
  });

  it('a pure-ST L12 build wins the Comfort Blob gate', () => {
    const r = simulate(stAt(12, { ST: 17, HP: 11, EN: 6 }), bossForLevel(12), 80);
    expect(r.status).toBe('won');
    expect(r.playerHp).toBeGreaterThan(0);
  });

  it('a pure-ST L20 build wins the Burnout Golem gate', () => {
    // A realistic geared L20 melee build: maxed ST, the iron_mace (the +6 weapon a
    // level-20 fighter can afford), and a deep HP pool for the 360-HP two-phase fight.
    const make = (): Fighter => ({
      c: deriveCombatant({ ...emptyStatLevels(), ST: 25, HP: 25, EN: 12 }, 20, emptyCombatStats()),
      weapon: getWeapon('iron_mace'),
    });
    const r = simulate(make, bossForLevel(20), 120);
    expect(r.status).toBe('won');
    expect(r.playerHp).toBeGreaterThan(0);
  });

  // Deterministic affinity guarantee (robust to any simulate tuning noise): ST is
  // no longer resisted at any of the three gates, and is a weakness where pinned.
  it('the three gates never resist ST, and expose an ST weakness where pinned', () => {
    const rex = bossForLevel(8);
    expect(rex.weakTo).toContain('ST');
    expect(rex.resistTo ?? []).not.toContain('ST');

    const blob = bossForLevel(12);
    expect(blob.resistTo ?? []).not.toContain('ST'); // was resisted; now neutral

    const golem = bossForLevel(20);
    expect(golem.phases![0].weakTo).toContain('ST');
    expect(golem.phases![0].resistTo ?? []).not.toContain('ST');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BAL-06 — affinity content lint. Only ST/DX/WI can ever carry damage (weapon
//  attackStat ∈ {ST,DX}; damage spells are WI), so every weakTo/resistTo array
//  must be a subset of DAMAGE_STATS or it is dead data.
// ─────────────────────────────────────────────────────────────────────────────
describe('BAL-06 all affinity content is a subset of DAMAGE_STATS', () => {
  const allowed = new Set<StatId>(DAMAGE_STATS);
  const checkArr = (label: string, arr: StatId[] | undefined) => {
    for (const s of arr ?? []) {
      expect(allowed.has(s), `${label} names non-damage stat ${s}`).toBe(true);
    }
  };
  const checkAffinities = (label: string, def: BossDef | BossPhase) => {
    checkArr(`${label} weakTo`, def.weakTo);
    checkArr(`${label} resistTo`, def.resistTo);
  };

  it('every named boss (all phases) is clean', () => {
    for (const [tier, boss] of Object.entries(NAMED_BOSSES)) {
      checkAffinities(`boss L${tier}`, boss);
      boss.phases?.forEach((p, i) => checkAffinities(`boss L${tier} phase ${i}`, p));
    }
  });

  it('every dungeon enemy is clean', () => {
    for (const [id, e] of Object.entries(ENEMIES)) {
      checkArr(`enemy ${id} weakTo`, e.weakTo);
      checkArr(`enemy ${id} resistTo`, e.resistTo);
    }
  });

  it('every biome boss (all phases) is clean', () => {
    for (const [key, biome] of Object.entries(BIOMES)) {
      checkAffinities(`biome ${key} boss`, biome.boss);
      biome.boss.phases?.forEach((p, i) => checkAffinities(`biome ${key} boss phase ${i}`, p));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  BAL-14 — flatten the generic boss attack past the stat-cap horizon (t>30) so
//  late gates stay winnable against the player's damage ceiling.
// ─────────────────────────────────────────────────────────────────────────────
describe('BAL-14 generic boss attack curve flattens past t=30', () => {
  // NB: t=30 itself is a NAMED boss (clockwork_tyrant), so the generic curve is only
  // observable at generic tiers. t=29 is below the horizon (unchanged); t=40/50 are past
  // it (flattened, strictly lower than the old 4+round(0.7·t)). The formula is continuous
  // at the horizon: both old and new give 25 at t=30.
  it('is unchanged below the horizon and strictly lower beyond it', () => {
    expect(bossForLevel(29).attack).toBe(24); // below horizon: matches old 4+round(0.7·29)
    expect(bossForLevel(40).attack).toBe(28); // old 4+round(0.7·40) = 32
    expect(bossForLevel(50).attack).toBe(30); // old 4+round(0.7·50) = 39
  });
});
