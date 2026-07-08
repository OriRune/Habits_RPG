/**
 * Fixture tests for the persist migrate/merge chain (ARCH-08) — the
 * highest-blast-radius previously-untested code in the project: a regression
 * here corrupts every veteran save on the next version bump, and cloud blobs
 * reuse the same envelope so the damage syncs.
 *
 * Seam: `migrate`/`merge` are inline options to persist(), but zustand exposes
 * them via `store.persist.getOptions()` — no production change needed.
 *
 * Note: `migrate` deliberately ignores the version argument — it is a single
 * unconditional, idempotent backfill gated by field presence, applied on every
 * version mismatch. The "vN-era" fixtures below reconstruct what saves of that
 * age actually lacked, so each historical transform is exercised.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameStore, type GameState } from '../useGameStore';
import { emptyStatXP } from '@/engine/stats';
import { statLevelsFromXp } from '@/engine/progression';
import { emptyTrialsClearedOn, emptyBestTrialScore } from '@/engine/trials/trials';
import { freshEarningsLedger } from '@/engine/balance';
import { freshTown } from '@/engine/town';

function getPersistFns() {
  // The polyfilled localStorage hydrates synchronously during createGameStore(),
  // so clear first to keep the instance pristine (same discipline as resetGame.test.ts).
  localStorage.clear();
  const store = createGameStore();
  const opts = store.persist.getOptions();
  return { migrate: opts.migrate!, merge: opts.merge!, store };
}

describe('persist migrate (ARCH-08)', () => {
  beforeEach(() => localStorage.clear());

  it('v3-era save: habit log backfilled from lastCompletedISO; runs never survive; created forced', () => {
    const { migrate } = getPersistFns();
    const fixture = {
      habits: [
        {
          id: 'h1',
          name: 'Run',
          stat: 'ST',
          difficulty: 'medium',
          streak: 3,
          lastCompletedISO: '2024-01-05',
          // v3-era: no log, no status, no focus
        },
      ],
      // an in-progress run persisted by an old build
      mining: { floor: 7, hp: 12 },
      battle: { round: 2 },
    };

    const out = migrate(fixture, 3) as GameState;

    expect(out.habits[0].log['2024-01-05']).toEqual({ xp: 0 });
    expect(out.habits[0].status).toBe('active');
    expect(out.habits[0].focus).toBe(false);
    // No in-progress run survives migration, ever.
    expect(out.mining).toBeNull();
    expect(out.battle).toBeNull();
    expect(out.dungeon).toBeNull();
    expect(out.forest).toBeNull();
    expect(out.arena).toBeNull();
    expect(out.tactics).toBeNull();
    // A save that made it into storage belongs to a created character.
    expect(out.created).toBe(true);
    expect(out.hasSeenWelcome).toBe(true);
    // No character in the envelope → left undefined here; merge's
    // withCharacterDefaults rebuilds it on the way in.
    expect(out.character).toBeUndefined();
  });

  it('v6-era save: material renames summed, challenge kind backfilled from metric, stat rework defaults', () => {
    const { migrate } = getPersistFns();
    const statXp = { ...emptyStatXP(), ST: 50, EN: 10 };
    const fixture = {
      materials: { iron: 3, cloth: 2, herb: 1, essence: 4, iron_bar: 1 },
      challenges: [
        {
          id: 'c1',
          status: 'active',
          startISO: '2024-02-01',
          def: { id: 'd1', name: 'Streak it', metric: 'streak', goal: 5, durationDays: 7 },
        },
        {
          id: 'c2',
          status: 'active',
          startISO: '2024-02-02',
          def: { id: 'd2', name: 'Modern', kind: 'count', goal: 3, durationDays: 7 },
        },
      ],
      character: { name: 'Vet', level: 4, statXp, gold: 50, energy: 3 },
    };

    const out = migrate(fixture, 6) as GameState;

    // Renamed keys merge additively into their new names (iron 3 + iron_bar 1).
    expect(out.materials).toEqual({ iron_bar: 4, cloth_roll: 2, herbs: 1, crystals: 4 });
    expect(out.challenges[0].def.kind).toBe('streak');
    expect(out.challenges[1].def.kind).toBe('count'); // already-modern def untouched
    expect(out.character!.statLevels).toEqual(statLevelsFromXp(statXp));
    expect(out.character!.statXpAtLastLevel).toEqual(statXp);
    // Untransformed character fields ride through.
    expect(out.character!.gold).toBe(50);
  });

  it('v24-era save: v25–v27 top-level defaults appear; existing habit fields are preserved', () => {
    const { migrate } = getPersistFns();
    const fixture = {
      created: false, // forced true regardless
      hasSeenWelcome: false,
      habits: [
        {
          id: 'h1',
          name: 'Meditate',
          stat: 'WI',
          difficulty: 'easy',
          streak: 10,
          status: 'retired',
          log: { '2024-03-01': { xp: 10 } },
          // v24-era: no focus yet
        },
      ],
      // missing: trialsClearedOn, bestTrialScore, dungeonHistory,
      // claimedPartyQuests, earnings, energyLog, mineTombstone
    };

    const out = migrate(fixture, 24) as GameState;

    expect(out.created).toBe(true);
    expect(out.hasSeenWelcome).toBe(true);
    expect(out.habits[0].focus).toBe(false);
    expect(out.habits[0].status).toBe('retired'); // existing status preserved
    expect(out.habits[0].log).toEqual({ '2024-03-01': { xp: 10 } });
    expect(out.trialsClearedOn).toEqual(emptyTrialsClearedOn());
    expect(out.bestTrialScore).toEqual(emptyBestTrialScore());
    expect(out.dungeonHistory).toEqual([]);
    expect(out.claimedPartyQuests).toEqual([]);
    expect(out.earnings).toEqual(freshEarningsLedger());
    expect(out.energyLog).toEqual({});
    expect(out.mineTombstone).toBeNull();
    expect(out.reminderCardDismissed).toBe(false); // v28 default
  });

  it('populated modern save rides through unchanged — backfills must never overwrite real data', () => {
    // The corruption class ARCH-08 cites: a backfill that re-derives instead of
    // preserving (e.g. statLevels from statXp) would silently wipe veterans'
    // level-up allocations on the next version bump.
    const { migrate } = getPersistFns();
    const statXp = { ...emptyStatXP(), ST: 50, EN: 10 };
    const allocatedLevels = { ...emptyStatXP(), ST: 9, EN: 2, HP: 4 }; // player-allocated
    const xpAtLastLevel = { ...emptyStatXP(), ST: 30 };
    // Guard the fixture itself: allocations must differ from the derived curve,
    // or the re-derive mutation this test exists to kill would be invisible.
    expect(allocatedLevels).not.toEqual(statLevelsFromXp(statXp));

    const trialsClearedOn = { ...emptyTrialsClearedOn(), st_trial: '2026-07-01' };
    const bestTrialScore = { ...emptyBestTrialScore(), st_trial: 0.8 };
    const earnings = { ...freshEarningsLedger(), energyEarned: 12 };
    const tombstone = { floor: 6, haul: { gold: 30, items: ['ore'] } };
    const fixture = {
      habits: [],
      character: { name: 'Vet', level: 8, statXp, statLevels: allocatedLevels, statXpAtLastLevel: xpAtLastLevel, gold: 500, energy: 4 },
      challenges: [
        {
          id: 'c1',
          status: 'active',
          startISO: '2026-06-01',
          // neither kind nor metric → falls back to 'count'
          def: { id: 'd1', name: 'Ancient', goal: 2, durationDays: 7 },
        },
      ],
      trialsClearedOn,
      bestTrialScore,
      dungeonHistory: [{ depth: 4 }],
      claimedPartyQuests: ['q1'],
      earnings,
      energyLog: { '2026-07-05': 3 },
      mineTombstone: tombstone,
    };

    const out = migrate(fixture, 27) as GameState;

    expect(out.character!.statLevels).toEqual(allocatedLevels);
    expect(out.character!.statXpAtLastLevel).toEqual(xpAtLastLevel);
    // v30: the trickle sub-ledger backfills to zero on a save that predates it (BAL-09).
    expect(out.character!.statXpTrickle).toEqual(emptyStatXP());
    expect(out.character!.statXpTrickleAtLastLevel).toEqual(emptyStatXP());
    expect(out.challenges[0].def.kind).toBe('count');
    expect(out.trialsClearedOn).toEqual(trialsClearedOn);
    expect(out.bestTrialScore).toEqual(bestTrialScore);
    expect(out.dungeonHistory).toEqual([{ depth: 4 }]);
    expect(out.claimedPartyQuests).toEqual(['q1']);
    expect(out.earnings).toEqual(earnings);
    expect(out.energyLog).toEqual({ '2026-07-05': 3 });
    expect(out.mineTombstone).toEqual(tombstone);
  });

  it('v33-era save (pre-Homestead): town backfills to freshTown(); a populated town rides through', () => {
    const { migrate } = getPersistFns();

    // Pre-v34 envelope: no `town` key at all.
    const out = migrate({ habits: [] }, 33) as GameState;
    expect(out.town).toEqual(freshTown());

    // A modern save's town must never be reset by re-migration (idempotency for v34).
    const town = {
      ...freshTown(),
      deeds: 2,
      laborBank: 55,
      buildings: [{ id: 'b1', key: 'keep', r: 3, c: 3, tier: 2 }],
    };
    const out2 = migrate({ habits: [], town: JSON.parse(JSON.stringify(town)) }, 34) as GameState;
    expect(out2.town).toEqual(town);
  });

  it('is idempotent — running an already-migrated save through again changes nothing', () => {
    // migrate runs on EVERY version mismatch, so a double application must be
    // a no-op or veteran saves would drift on each bump.
    const { migrate } = getPersistFns();
    const fixture = {
      materials: { iron: 3, herb: 1 },
      habits: [
        { id: 'h1', name: 'Run', stat: 'ST', difficulty: 'medium', streak: 1, lastCompletedISO: '2024-01-05' },
      ],
      character: { name: 'Vet', level: 4, statXp: { ...emptyStatXP(), ST: 50 }, gold: 50, energy: 3 },
    };

    const once = migrate(fixture, 6) as GameState;
    const twice = migrate(JSON.parse(JSON.stringify(once)), 27) as GameState;

    expect(JSON.parse(JSON.stringify(twice))).toEqual(JSON.parse(JSON.stringify(once)));
  });
});

describe('persist merge (ARCH-08)', () => {
  beforeEach(() => localStorage.clear());

  const RUN_KEYS = ['battle', 'dungeon', 'mining', 'forest', 'arena', 'tactics'] as const;

  it('a live in-memory run beats the stale persisted snapshot for every run field', () => {
    const { merge, store } = getPersistFns();
    const live = Object.fromEntries(RUN_KEYS.map((k) => [k, { live: true, key: k }]));
    const stale = Object.fromEntries(RUN_KEYS.map((k) => [k, { live: false, key: k }]));
    const current = { ...store.getState(), ...live } as GameState;
    const persisted = {
      ...stale, // stale snapshot (e.g. cloud CAS-conflict re-pull)
      character: { name: 'FromCloud', level: 9 },
    };

    const out = merge(persisted, current) as GameState;

    for (const k of RUN_KEYS) {
      expect(out[k]).toBe(live[k]); // same reference — live run preserved
    }
    // Non-run fields still adopt the persisted snapshot…
    expect(out.character.name).toBe('FromCloud');
    expect(out.character.level).toBe(9);
    // …with character defaults backfilled for fields the snapshot lacks.
    expect(out.character.statLevels).toBeDefined();
    expect(out.character.energy).toBeDefined();
  });

  it('cold boot (no live run) adopts the persisted run object', () => {
    const { merge, store } = getPersistFns();
    const current = store.getState(); // fresh store: all transient runs null
    const persistedMining = { floor: 2, hp: 3 } as unknown as GameState['mining'];

    const out = merge({ mining: persistedMining }, current) as GameState;

    // Not the same reference — the run is adopted via the timestamp rebase.
    expect(out.mining).toMatchObject({ floor: 2, hp: 3 });
    expect(out.battle).toBeNull();
  });

  it('rebases a persisted mine run\'s rAF timestamps so a reload does not stall it (MINI-02)', () => {
    const { merge, store } = getPersistFns();
    const current = store.getState();
    // Timestamps from a previous session's uptime (~83 minutes) — far ahead of
    // the fresh session's rAF clock, which restarts near 0 on reload.
    const persistedMining = {
      floor: 3,
      hp: 20,
      staNextRegenMs: 5_000_000,
      mpNextRegenMs: 5_000_000,
      lastSpellMs: 4_999_500,
      lastDashMs: 4_998_000,
      lastHitAtMs: 4_999_900,
      runes: [{ id: 1, r: 2, c: 2, kind: 'fire', power: 3, expiresAtMs: 5_020_000 }],
      ringOfFire: { expiresAtMs: 5_005_000, dmg: 2 },
      ringNextHitMs: { a: 5_000_400 },
      playerStatuses: [{ key: 'bless', magnitude: 1, expiresAtMs: 5_009_000 }],
      monsters: [
        {
          id: 'a', key: 'cave_slug', r: 1, c: 1, hp: 5, maxHp: 5,
          readyAtMs: 5_000_200, frozenUntilMs: 5_000_300,
          poisonDmg: 2, poisonNextTickMs: 5_000_150, poisonExpiresMs: 5_003_000,
        },
      ],
    } as unknown as GameState['mining'];

    const out = merge({ mining: persistedMining }, current) as GameState;
    const run = out.mining!;

    // Cooldowns/regen are ready immediately on the new clock…
    expect(run.staNextRegenMs).toBe(0);
    expect(run.mpNextRegenMs).toBe(0);
    expect(run.lastSpellMs).toBeLessThanOrEqual(0);
    expect(run.lastDashMs).toBeLessThanOrEqual(0);
    expect(run.lastHitAtMs).toBeLessThanOrEqual(0);
    // …transient timed effects expire rather than persisting for ~83 minutes…
    expect(run.runes).toEqual([]);
    expect(run.ringOfFire).toBeNull();
    expect(run.ringNextHitMs).toEqual({});
    expect(run.playerStatuses).toEqual([]);
    // …and monsters act on the new clock instead of being frozen/poisoned until it catches up.
    expect(run.monsters[0].readyAtMs).toBe(0);
    expect(run.monsters[0].frozenUntilMs).toBeUndefined();
    expect(run.monsters[0].poisonDmg).toBeUndefined();
    expect(run.monsters[0].poisonExpiresMs).toBeUndefined();
    // Non-timestamp fields are untouched.
    expect(run.floor).toBe(3);
    expect(run.hp).toBe(20);
    expect(run.monsters[0].hp).toBe(5);
  });

  it('rebases a persisted forest run — including windups and the shot tracer', () => {
    const { merge, store } = getPersistFns();
    const current = store.getState();
    const persistedForest = {
      stage: 2,
      hp: 30,
      staNextRegenMs: 5_000_000,
      lastShot: { fromR: 3, fromC: 3, toR: 3, toC: 5, at: 4_999_900 },
      beasts: [
        {
          id: 'b', key: 'wild_boar', r: 1, c: 1, hp: 10, maxHp: 10, asleep: false,
          readyAtMs: 5_000_200, windupUntilMs: 5_000_100, frozenUntilMs: 5_000_300,
        },
      ],
    } as unknown as GameState['forest'];

    const out = merge({ forest: persistedForest }, current) as GameState;
    const run = out.forest!;

    expect(run.staNextRegenMs).toBe(0);
    expect(run.lastShot).toBeNull();
    expect(run.beasts[0].readyAtMs).toBe(0);
    expect(run.beasts[0].windupUntilMs).toBeUndefined();
    expect(run.beasts[0].frozenUntilMs).toBeUndefined();
    expect(run.stage).toBe(2);
    expect(run.beasts[0].hp).toBe(10);
  });

  it('rebases a persisted arena run\'s perf-clock timestamps on adoption', () => {
    const { merge, store } = getPersistFns();
    const current = store.getState();
    const persistedArena = {
      tier: 2,
      hp: 40,
      speed: 1,
      bossFrozenUntilMs: 5_000_300,
      cooldownUntilMs: 5_000_400,
      lastTickMs: 5_000_000,
      telegraphs: [{ id: 1, kind: 'slam', tiles: [], startedAtMs: 4_999_000, firesAtMs: 5_000_600, raw: 8, school: 'physical' }],
      minions: [{ id: 1, pos: { x: 0, y: 0 }, hp: 5, maxHp: 5, attack: 2, variant: 'bat', nextMoveMs: 5_000_100, nextHitMs: 5_000_200, frozenUntilMs: 5_000_300, poisonDmg: 2, poisonNextTickMs: 5_000_150, poisonExpiresMs: 5_003_000 }],
    } as unknown as GameState['arena'];

    const out = merge({ arena: persistedArena }, current) as GameState;
    const run = out.arena!;

    expect(run.bossFrozenUntilMs).toBe(0);
    expect(run.cooldownUntilMs).toBe(0);
    expect(run.lastTickMs).toBe(0);
    expect(run.telegraphs).toEqual([]);
    expect(run.minions[0].nextMoveMs).toBe(0);
    expect(run.minions[0].frozenUntilMs).toBe(0);
    expect(run.minions[0].poisonExpiresMs).toBe(0);
    expect(run.tier).toBe(2);
    expect(run.hp).toBe(40);
    expect(run.minions[0].hp).toBe(5);
  });

  it('nested-default merges town so fields added in later versions backfill (trialsClearedOn idiom)', () => {
    const { merge, store } = getPersistFns();
    const current = store.getState();

    // A persisted town missing later-added fields (simulated by deleting one):
    const partialTown = JSON.parse(JSON.stringify({ ...freshTown(), deeds: 1, laborBank: 30 }));
    delete partialTown.laborISO;

    const out = merge({ town: partialTown }, current) as GameState;

    expect(out.town.deeds).toBe(1); // persisted values win…
    expect(out.town.laborBank).toBe(30);
    expect(out.town.laborISO).toBe(freshTown().laborISO); // …missing fields backfill
    // Absent town entirely → fresh.
    const out2 = merge({}, current) as GameState;
    expect(out2.town).toEqual(freshTown());
  });

  it('a live in-memory run is NOT rebased (rebase only applies to runs adopted from storage)', () => {
    const { merge, store } = getPersistFns();
    const liveMining = { floor: 1, staNextRegenMs: 123_456 } as unknown as GameState['mining'];
    const current = { ...store.getState(), mining: liveMining } as GameState;

    const out = merge({ mining: { floor: 9 } as unknown as GameState['mining'] }, current) as GameState;

    expect(out.mining).toBe(liveMining); // same reference — live clock still valid
  });
});
