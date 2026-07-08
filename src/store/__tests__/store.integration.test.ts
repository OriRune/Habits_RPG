import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore, totalXp, withCharacterDefaults, type DungeonRun } from '../useGameStore';
import { STAT_IDS, emptyStatXP } from '@/engine/stats';
import { levelForTotalXp } from '@/engine/leveling';
import { bossForLevel } from '@/engine/bosses';
import { dungeonCombatStatXp } from '@/engine/combatStats';
import { type BattleState } from '@/engine/combat';
import { type DungeonRoom, merchantOffers, combatRoomGold, bossRoomGold } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { type MineState, type MineTile } from '@/engine/mining';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import { STA_REGEN_MS, MP_REGEN_MS, BOON_CONSOLATION_HEAL, BOON_CONSOLATION_GOLD, dungeonStamina } from '@/engine/crawl';
import { BOONS } from '@/content/boons';
import { type ForestState, type ForestTile, FOREST_WINDUP_MS } from '@/engine/forest';
import { getEncounter, startEncounter } from '@/engine/encounters';
import { toISODate, weekKey, _setNow, _resetNow, addDays } from '@/engine/date';
import { MAX_ENERGY, maxEnergyFor, fighterFor, MINE_DAILY_BONUS_FLOORS } from '../shared';
import type { HexBattleState, HeroOpts } from '@/engine/hexBattle';
import { selectHabitBonusInfo } from '../selectors';
import { BASE_STAT_LEVEL } from '@/engine/progression';
import { freshEarningsLedger } from '@/engine/balance';
import { completionRatio, COMPLETION_CAP, UNCAPPED_RATIO_CAP, habitGold, computeXp } from '@/engine/xp';
import { statCompletedWithin } from '@/engine/habits';
import { trialReward } from '@/engine/trials/trials';
import { useToastStore } from '@/store/useToastStore';
import { resetRunRng } from '../runRng';

/** A trivial single-path floor map for tests: one room per layer, linked in sequence. */
function linearMap(rooms: DungeonRoom[]): FloorMap {
  const nodes: FloorMap['nodes'] = {};
  const layers: string[][] = [];
  rooms.forEach((room, i) => {
    const id = `n${i}_0`;
    nodes[id] = { id, layer: i, room, to: i < rooms.length - 1 ? [`n${i + 1}_0`] : [] };
    layers.push([id]);
  });
  return { nodes, layers };
}

function makeRun(over: Partial<DungeonRun> & { rooms?: DungeonRoom[] }): DungeonRun {
  const { rooms, ...rest } = over;
  const map = rest.map ?? linearMap(rooms ?? [{ type: 'combat' }]);
  const firstId = map.layers[0][0];
  return {
    depth: 1,
    biomeKey: 'catacombs',
    map,
    nodeId: firstId, // "inside" the first room by default
    choices: [],
    path: [firstId],
    hp: 100,
    maxHp: 100,
    mp: 30,
    maxMp: 30,
    sta: 10,
    maxSta: 10,
    bankedReward: {},
    floorReward: {},
    encounter: null,
    roomLoot: null,
    battle: null,
    atCheckpoint: false,
    status: 'active',
    cleared: false,
    relics: [],
    pendingBoon: null,
    merchant: null,
    ...rest,
  };
}

const get = () => useGameStore.getState();

beforeEach(() => {
  get().resetGame();
  // Reset module-scope mine/forest RNG globals so state cannot leak between test cases.
  resetRunRng();
});

describe('withCharacterDefaults (persist merge guard)', () => {
  it('backfills statLevels/statXpAtLastLevel for a pre-rework saved character', () => {
    // A v6-style character with no statLevels would crash the Attributes panel.
    const legacy = { level: 4, statXp: emptyStatXP(), gold: 50, energy: 3, classId: null, mood: 'steady' } as never;
    const c = withCharacterDefaults(legacy);
    expect(c.statLevels).toBeDefined();
    for (const s of STAT_IDS) expect(c.statLevels[s]).toBeGreaterThanOrEqual(1);
    expect(c.statXpAtLastLevel).toBeDefined();
    expect(c.level).toBe(4); // existing fields preserved
    expect(c.gold).toBe(50);
  });

  it('preserves an already-migrated character unchanged', () => {
    const c = withCharacterDefaults(get().character);
    expect(c.statLevels).toEqual(get().character.statLevels);
  });

  it('backfills focus: false on a habit loaded from a pre-v24 save that lacked the focus field', () => {
    // Simulate a habit serialised before v24 — no `focus` property.
    const legacyHabit = {
      id: 'legacy', name: 'Old Habit', stat: 'ST' as const, type: 'binary' as const,
      frequency: 'daily' as const, difficulty: 'normal' as const, status: 'active' as const,
      streak: 0, log: {}, createdISO: '2025-01-01',
      // `focus` intentionally absent — mirrors a real old save
    };
    useGameStore.setState({ habits: [legacyHabit as never] });
    get().normalizeHabits();
    expect(get().habits[0].focus).toBe(false);
  });
});

describe('createCharacter (onboarding)', () => {
  it('seeds name, starting stat levels, weapon and signature spell, and flips created', () => {
    useGameStore.setState({ created: false });
    get().createCharacter({
      name: '  Mira  ',
      allocations: { ST: 2, WI: 1 },
      weaponKey: 'short_bow',
      spellKey: 'firebolt',
    });
    const s = get();
    expect(s.created).toBe(true);
    expect(s.character.name).toBe('Mira'); // trimmed
    expect(s.character.statLevels.ST).toBe(3); // base 1 + 2
    expect(s.character.statLevels.WI).toBe(2);
    expect(s.character.statLevels.AG).toBe(1); // untouched -> base
    expect(s.equippedWeapon).toBe('short_bow');
    expect(s.ownedWeapons).toEqual(['short_bow']);
    expect(s.knownSpells).toContain('firebolt');
    expect(s.knownSpells).toEqual(expect.arrayContaining(['sparks', 'mend'])); // safety net kept
  });

  it('defaults a blank name to Adventurer and tolerates an empty spell pick', () => {
    get().createCharacter({ name: '   ', allocations: {}, weaponKey: 'worn_sword', spellKey: '' });
    expect(get().character.name).toBe('Adventurer');
    expect(get().knownSpells).toEqual(['sparks', 'mend']);
  });

  it('resetGame returns the player to onboarding', () => {
    get().createCharacter({ name: 'X', allocations: {}, weaponKey: 'worn_sword', spellKey: 'bless' });
    expect(get().created).toBe(true);
    get().resetGame();
    expect(get().created).toBe(false);
    expect(get().character.name).toBe('Adventurer');
  });

  it('a fresh store has hasSeenWelcome === false', () => {
    expect(get().hasSeenWelcome).toBe(false);
  });

  it('dismissWelcome flips hasSeenWelcome to true', () => {
    expect(get().hasSeenWelcome).toBe(false);
    get().dismissWelcome();
    expect(get().hasSeenWelcome).toBe(true);
  });

  it('resetGame resets hasSeenWelcome to false', () => {
    get().dismissWelcome();
    expect(get().hasSeenWelcome).toBe(true);
    get().resetGame();
    expect(get().hasSeenWelcome).toBe(false);
  });

  it('a fresh store has reminderCardDismissed === false', () => {
    expect(get().reminderCardDismissed).toBe(false);
  });

  it('dismissReminderCard flips reminderCardDismissed to true; resetGame clears it', () => {
    get().dismissReminderCard();
    expect(get().reminderCardDismissed).toBe(true);
    get().resetGame();
    expect(get().reminderCardDismissed).toBe(false);
  });

  it('addHabit seeds starter habits before createCharacter completes', () => {
    get().addHabit({ name: 'Walk 10 minutes', stat: 'AG', type: 'binary', frequency: 'daily', difficulty: 'easy' });
    get().addHabit({ name: 'Stretch', stat: 'AG', type: 'binary', frequency: 'daily', difficulty: 'easy' });
    expect(get().habits.length).toBe(2);
    get().createCharacter({ name: 'Seeded', allocations: {}, weaponKey: 'worn_sword', spellKey: '' });
    // habits survive createCharacter; created flips
    expect(get().created).toBe(true);
    expect(get().habits.length).toBe(2);
  });
});

describe('completeHabit', () => {
  it('grants XP to the habit stat, energy, and logs the completion', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);

    expect(get().character.statXp.KN).toBe(20);
    expect(get().character.energy).toBe(1);
    expect(get().habits[0].streak).toBe(1);
    // Earnings ledger: habit completion is recorded.
    expect(get().earnings.xp.habit).toBe(20);
    expect(get().earnings.count.habit).toBe(1);
    expect(get().earnings.energyEarned).toBe(1);
  });

  it('records energy earned in energyLog for today', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().completeHabit(get().habits[0].id);
    // Key via the engine date seam (local date, like the store) — NOT new Date().toISOString()
    // (UTC), which diverges from the store's key past the local/UTC midnight boundary.
    const today = toISODate();
    expect(get().energyLog[today]?.earned).toBe(1);
  });

  it('scales granted habit XP with character level (BAL-01)', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    // Bump to L10 → base 20 × (1 + 0.15×9) = 47. Guards the habitsSlice level seam, not just computeXp.
    useGameStore.setState({ character: { ...get().character, level: 10 } });
    get().completeHabit(get().habits[0].id);
    expect(get().character.statXp.KN).toBe(47);
    expect(get().earnings.xp.habit).toBe(47);
  });

  it('reverses earnings ledger on uncomplete', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);
    const xpAfterComplete = get().earnings.xp.habit;
    get().uncompleteHabit(id);
    expect(get().earnings.xp.habit).toBe(0);
    expect(get().earnings.count.habit).toBe(0);
    expect(get().earnings.energyEarned).toBe(0);
    void xpAfterComplete; // used above
  });

  it('cannot be completed twice in one day', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);
    get().completeHabit(id);
    expect(get().character.statXp.KN).toBe(20);
  });

  it('scales quantity habit XP by completion', () => {
    get().addHabit({ name: 'Run', stat: 'EN', type: 'quantity', target: 20, frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id, 10); // 50%
    expect(get().character.statXp.EN).toBe(10);
  });

  it('auto-levels (no trial) and grants stat points crossing the level-2 threshold', () => {
    // 5 epic habits = 250 XP > 100 needed for level 2 (< 383 for level 3).
    for (let i = 0; i < 5; i++) {
      get().addHabit({ name: `H${i}`, stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'epic' });
    }
    for (const h of get().habits) get().completeHabit(h.id);

    expect(get().character.level).toBe(2); // auto-leveled (below the boss gate)
    expect(get().pendingLevelUp).toBeNull(); // no trial needed yet
    expect(get().character.statLevels.ST).toBeGreaterThan(1); // points landed on the trained stat
  });

  it('queues a Level-Up Trial when reaching the boss-gate level (5)', () => {
    // ~1800 XP > 1703 cumulative for level 5; auto-levels 2→4 then gates at 5.
    for (let i = 0; i < 36; i++) {
      get().addHabit({ name: `H${i}`, stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'epic' });
    }
    for (const h of get().habits) get().completeHabit(h.id);

    expect(get().character.level).toBe(4); // auto up to 4
    expect(get().pendingLevelUp).toBe(5); // trial required to reach 5
  });
});

describe('level-up trial resolution', () => {
  it('winning commits the level and grants boss rewards', () => {
    useGameStore.setState({ pendingLevelUp: 2 });
    const wonBattle = {
      bossId: 'x',
      bossName: 'Trial',
      bossMaxHp: 100,
      bossHp: 0,
      bossAttack: 5,
      bossDefense: 0,
      enemyWard: 0,
      attackSchool: 'physical' as const,
      weakTo: [],
      resistTo: [],
      phases: [],
      phaseIndex: 0,
      relief: 0,
      hpDefeated: 0,
      bossMaxMp: 0,
      bossMp: 0,
      bossMaxSta: 0,
      bossSta: 0,
      playerMaxHp: 60,
      playerHp: 40,
      playerMaxMp: 20,
      playerMp: 10,
      playerMaxSta: 8,
      playerSta: 8,
      playerStatuses: [],
      enemyStatuses: [],
      defending: false,
      buffs: {},
      log: [],
      status: 'won' as const,
      consumedItems: [],
      pendingRunes: [],
      enemyIntent: null,
      enemyGuardBonus: 0,
      enemyEnrageBonus: 0,
    } satisfies BattleState;
    useGameStore.setState({ battle: wonBattle });
    const goldBefore = get().character.gold;

    get().dismissBattle();

    expect(get().character.level).toBe(2);
    expect(get().pendingLevelUp).toBeNull();
    expect(get().character.gold).toBeGreaterThan(goldBefore); // generic boss gold reward
  });

  it('losing records a loss and keeps the level pending', () => {
    useGameStore.setState({ pendingLevelUp: 2 });
    useGameStore.setState({
      battle: { status: 'lost' } as BattleState,
    });
    get().dismissBattle();

    expect(get().character.level).toBe(1);
    expect(get().pendingLevelUp).toBe(2);
    expect(get().bossLosses[2]).toBe(1);
  });

  it('unlocks the Sorcerer class at level 10 with Knowledge+Dexterity highest', () => {
    const statXp = emptyStatXP();
    statXp.KN = 3000;
    statXp.DX = 2000;
    useGameStore.setState({
      character: { ...get().character, level: 9, statXp, classId: null },
      pendingLevelUp: 10,
      battle: { status: 'won' } as BattleState,
    });
    get().dismissBattle();

    expect(get().character.level).toBe(10);
    expect(get().character.classId).toBe('Sorcerer');
    expect(get().codex).toContain('Sorcerer');
  });
});

describe('challenges', () => {
  it('progresses a quantity challenge and grants its reward on claim', () => {
    get().startChallenge('scholars_week');
    get().addHabit({ name: 'Read', stat: 'KN', type: 'quantity', target: 100, frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id, 100); // meets the 100-page goal

    expect(get().challenges[0].status).toBe('completed');
    const knBefore = get().character.statXp.KN;
    get().claimChallenge(0);

    expect(get().challenges[0].status).toBe('claimed');
    expect(get().character.statXp.KN).toBe(knBefore + 150); // reward XP
    expect(get().inventory['focus_potion']).toBe(1); // reward item
  });

  it('a streak challenge progresses via recompute on completion', () => {
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().createCustomChallenge({ name: 'Zen', kind: 'streak', goal: 3, durationDays: 7 });
    const customId = get().customChallenges[0].id;
    get().startChallenge(customId);
    get().completeHabit(get().habits[0].id);
    expect(get().challenges[0].def.kind).toBe('streak');
    expect(get().challenges[0].progress).toBe(1); // one day so far
  });
});

describe('custom challenges & weekly loop', () => {
  it('creates a custom challenge with an auto-suggested reward', () => {
    get().createCustomChallenge({ name: 'My Trial', kind: 'count', stat: 'ST', goal: 5, durationDays: 7 });
    const def = get().customChallenges[0];
    expect(def.custom).toBe(true);
    expect(def.reward.gold).toBeGreaterThan(0);
    expect(def.reward.statXp?.ST).toBeGreaterThan(0);
  });

  it('honors an in-bounds manual reward override', () => {
    get().createCustomChallenge(
      { name: 'Override', kind: 'count', goal: 5, durationDays: 7, stat: 'ST' },
      { gold: 100, statXp: { ST: 200 } },
    );
    // 100 ∈ [20,300], 200 ∈ [30,400] → passed through unchanged.
    expect(get().customChallenges[0].reward).toEqual({ gold: 100, statXp: { ST: 200 } });
  });

  it('clamps an out-of-bounds reward override so one habit tap cannot mint arbitrary value (HABIT-01)', () => {
    get().createCustomChallenge(
      // A trivial count-1 / 1-day challenge with a 999999 reward — completes off a single log.
      { name: 'Exploit', kind: 'count', goal: 1, durationDays: 1, stat: 'ST' },
      { gold: 999999, statXp: { ST: 999999 } },
    );
    const reward = get().customChallenges[0].reward;
    expect(reward.gold).toBe(300); // clamped to the suggestReward ceiling
    expect(reward.statXp).toEqual({ ST: 400 }); // clamped to the stat-XP ceiling
  });

  it('starts a custom challenge from the combined pool', () => {
    get().createCustomChallenge({ name: 'Run It', kind: 'count', goal: 3, durationDays: 7 });
    const id = get().customChallenges[0].id;
    get().startChallenge(id);
    expect(get().challenges.some((c) => c.def.id === id && c.status === 'active')).toBe(true);
  });

  it('deletes a custom challenge', () => {
    get().createCustomChallenge({ name: 'Doomed', kind: 'count', goal: 3, durationDays: 7 });
    const id = get().customChallenges[0].id;
    get().deleteCustomChallenge(id);
    expect(get().customChallenges).toHaveLength(0);
  });

  it('freezes a rival goal from last week at start', () => {
    get().startChallenge('rival_week');
    const rival = get().challenges.find((c) => c.def.kind === 'rival');
    expect(rival).toBeDefined();
    expect(rival!.def.goal).toBeGreaterThanOrEqual(1);
  });

  it('surfaces a weekly report only when the week changes', () => {
    expect(get().pendingReport).toBeNull();
    get().checkWeeklyRollover(); // same week → no-op
    expect(get().pendingReport).toBeNull();

    useGameStore.setState({ lastWeekKey: '2000-01-02' }); // a Sunday far in the past
    get().checkWeeklyRollover();
    expect(get().pendingReport).not.toBeNull();
    expect(get().lastWeekKey).toBe(weekKey(toISODate()));

    get().dismissWeeklyReport();
    expect(get().pendingReport).toBeNull();
  });
});

describe('shop & streak freeze', () => {
  it('buys an item with gold', () => {
    useGameStore.setState({ character: { ...get().character, gold: 100 } });
    get().buyItem('streak_freeze');
    expect(get().inventory['streak_freeze']).toBe(1);
    expect(get().character.gold).toBe(20); // 100 - 80
  });

  it('does not buy when gold is insufficient', () => {
    get().buyItem('streak_freeze');
    expect(get().inventory['streak_freeze']).toBeUndefined();
  });

  it('consumes a streak freeze to protect a live streak', () => {
    const day1 = new Date(2025, 3, 1); // 2025-04-01 — build a streak
    const day2 = new Date(2025, 3, 2); // 2025-04-02 — freeze (not yet done today)
    _setNow(() => day1);
    useGameStore.setState({ inventory: { streak_freeze: 1 } });
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id); // live streak 1
    _setNow(() => day2);
    get().useStreakFreeze(id);
    expect(get().inventory['streak_freeze']).toBe(0);
    expect(get().habits[0].lastCompletedISO).toBeDefined();
    _resetNow();
  });

  it('refuses to consume a streak freeze when the live streak is already 0 (HABIT-02)', () => {
    _setNow(() => new Date(2025, 4, 10)); // 2025-05-10
    useGameStore.setState({ inventory: { streak_freeze: 1 } });
    get().addHabit({ name: 'Run', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    // Fresh habit, no completions → live streak 0 → freeze must refuse (don't protect a dead streak).
    get().useStreakFreeze(id);
    expect(get().inventory['streak_freeze']).toBe(1); // item NOT consumed
    _resetNow();
  });

  it('recovery elixir bridges a missed day and restores the streak (HABIT-15)', () => {
    const day1 = new Date(2025, 5, 1); // 2025-06-01
    const day2 = new Date(2025, 5, 2); // 2025-06-02
    // day3 (2025-06-03) missed — no freeze
    const day4 = new Date(2025, 5, 4); // 2025-06-04

    _setNow(() => day1);
    useGameStore.setState({ inventory: { recovery_elixir: 1 } });
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);

    _setNow(() => day2);
    get().completeHabit(id, undefined, toISODate(day2));

    _setNow(() => day4);
    get().completeHabit(id, undefined, toISODate(day4));
    expect(get().habits[0].streak).toBe(1); // broke — day3 missed

    // Repair the missed day3 retroactively → day1+day2+day4 count, day3 frozen bridges.
    get().useRecoveryElixir(id);
    expect(get().inventory['recovery_elixir']).toBe(0);
    expect(get().habits[0].streak).toBe(3);
    _resetNow();
  });

  it('recovery elixir is not consumed when there is no missed day to repair (HABIT-15)', () => {
    const day1 = new Date(2025, 6, 1); // 2025-07-01
    const day2 = new Date(2025, 6, 2); // 2025-07-02

    _setNow(() => day1);
    useGameStore.setState({ inventory: { recovery_elixir: 1 } });
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);

    _setNow(() => day2);
    get().completeHabit(id, undefined, toISODate(day2));
    // No gap in the schedule → nothing to repair.
    get().useRecoveryElixir(id);
    expect(get().inventory['recovery_elixir']).toBe(1); // item NOT consumed
    _resetNow();
  });

  /** Seed `habit` with completed days for the `n` days immediately before `today` (today left pending). */
  function seedPriorStreak(id: string, todayISO: string, n: number) {
    const log: Record<string, { xp: number }> = {};
    for (let i = 1; i <= n; i++) log[addDays(todayISO, -i)] = { xp: 20 };
    // Backdate createdISO before the earliest seeded day, or currentStreak's
    // `cursor >= createdISO` guard would stop before counting the streak.
    useGameStore.setState({
      habits: get().habits.map((h) =>
        h.id === id ? { ...h, log, createdISO: addDays(todayISO, -n) } : h,
      ),
    });
  }

  it('grants a milestone reward (Streak Freeze + gold) when a streak reaches 30 (HABIT-13)', () => {
    const today = new Date(2025, 7, 30); // 2025-08-30
    _setNow(() => today);
    useGameStore.setState({ inventory: {}, character: { ...get().character, gold: 0 } });
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    seedPriorStreak(id, toISODate(today), 29); // 29-day streak ending yesterday
    get().completeHabit(id); // today → streak 30 (a milestone)
    expect(get().habits[0].streak).toBe(30);
    expect(get().inventory['streak_freeze']).toBe(1); // milestone grants a free freeze
    expect(get().character.gold).toBe(habitGold('normal') + 100); // base + milestone bonus
    _resetNow();
  });

  it('grants NO milestone reward when the new streak is not 7/30/100 (HABIT-13)', () => {
    const today = new Date(2025, 8, 10); // 2025-09-10
    _setNow(() => today);
    useGameStore.setState({ inventory: {}, character: { ...get().character, gold: 0 } });
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    seedPriorStreak(id, toISODate(today), 5); // → streak 6 after today, not a milestone
    get().completeHabit(id);
    expect(get().habits[0].streak).toBe(6);
    expect(get().inventory['streak_freeze']).toBeUndefined(); // no freeze
    expect(get().character.gold).toBe(habitGold('normal')); // base gold only, no bonus
    _resetNow();
  });

  it('does not fire a milestone for a backdated completion (HABIT-13)', () => {
    const today = new Date(2025, 9, 20); // 2025-10-20
    _setNow(() => today);
    useGameStore.setState({ inventory: {}, character: { ...get().character, gold: 0 } });
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    // 6 days before yesterday logged; yesterday is the gap we backfill → the *reference* streak
    // would compute to 7, but a backdated fill must not celebrate.
    const yest = addDays(toISODate(today), -1);
    const log: Record<string, { xp: number }> = {};
    for (let i = 2; i <= 7; i++) log[addDays(toISODate(today), -i)] = { xp: 20 };
    useGameStore.setState({
      habits: get().habits.map((h) =>
        h.id === id ? { ...h, log, createdISO: addDays(toISODate(today), -8) } : h,
      ),
    });
    get().completeHabit(id, undefined, yest); // backdated fill of yesterday (reference streak = 7)
    expect(get().inventory['streak_freeze']).toBeUndefined(); // no milestone on a backdate
    // Base gold is still granted, but the 7-day milestone's +25g must NOT be — proves the isToday gate.
    expect(get().character.gold).toBe(habitGold('normal'));
    _resetNow();
  });

  it('does NOT grant a milestone for a times_per_week habit (week-counted streak) (HABIT-13)', () => {
    const today = new Date(2025, 10, 12); // 2025-11-12
    _setNow(() => today);
    useGameStore.setState({ inventory: {}, character: { ...get().character, gold: 0 } });
    get().addHabit({
      name: 'Gym', stat: 'ST', type: 'binary', frequency: 'times_per_week', timesPerWeek: 1, difficulty: 'normal',
    });
    const id = get().habits[0].id;
    const t = toISODate(today);
    const log: Record<string, { xp: number }> = {};
    for (let w = 1; w <= 6; w++) log[addDays(t, -7 * w)] = { xp: 20 }; // one completion in each prior week
    useGameStore.setState({
      habits: get().habits.map((h) => (h.id === id ? { ...h, log, createdISO: addDays(t, -49) } : h)),
    });
    get().completeHabit(id); // this week met → currentStreak = 7 weeks
    expect(get().habits[0].streak).toBe(7);
    // Week-counted streaks are excluded from milestones (no "7-day" reward, no farmable re-grant).
    expect(get().character.gold).toBe(habitGold('normal')); // base only, no +25 milestone
    _resetNow();
  });

  it('pushes a reward-receipt toast with the actual granted values on a same-day completion (HABIT-06)', () => {
    _setNow(() => new Date(2025, 3, 12)); // 2025-04-12
    useGameStore.setState({ inventory: {}, character: { ...get().character, gold: 0 } });
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);
    const xp = computeXp({ difficulty: 'normal', type: 'binary' });
    const gold = habitGold('normal');
    const toasts = useToastStore.getState().toasts;
    // A normal habit also grants +2 Homestead labor (M2), appended to the receipt.
    expect(toasts[toasts.length - 1]?.text).toBe(`+${xp} XP · +${gold}g · +1⚡ · +2 🔨`);
    _resetNow();
  });

  it('receipt toast notes no energy was granted on a backdated completion (BAL-21)', () => {
    const today = new Date(2025, 3, 20); // 2025-04-20
    _setNow(() => today);
    useGameStore.setState({ inventory: {}, character: { ...get().character, gold: 0 } });
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    const yest = addDays(toISODate(today), -1);
    useGameStore.setState({
      habits: get().habits.map((h) => (h.id === id ? { ...h, createdISO: addDays(toISODate(today), -5) } : h)),
    });
    get().completeHabit(id, undefined, yest); // backdated fill → no energy
    const xp = computeXp({ difficulty: 'normal', type: 'binary' });
    const gold = habitGold('normal');
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.text).toBe(`+${xp} XP · +${gold}g · logged late — no energy`);
    _resetNow();
  });

  it('does not mint energy on complete→spend→uncomplete→re-complete (HABIT-04)', () => {
    _setNow(() => new Date(2025, 5, 10)); // 2025-06-10
    useGameStore.setState({ inventory: {}, character: { ...get().character, energy: 0 } });
    get().addHabit({ name: 'Run', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id); // +1 energy → 1 (marker stamped on the habit)
    expect(get().character.energy).toBe(1);
    useGameStore.setState({ character: { ...get().character, energy: 0 } }); // spend it elsewhere
    get().uncompleteHabit(id); // refund skipped at 0, but the marker survives the entry delete
    expect(get().character.energy).toBe(0);
    get().completeHabit(id); // same-day re-completion must NOT grant a fresh +1
    expect(get().character.energy).toBe(0); // leak closed
    _resetNow();
  });

  it('does not deduct phantom energy when uncompleting a completion made at MAX_ENERGY (HABIT-16)', () => {
    _setNow(() => new Date(2025, 5, 11)); // 2025-06-11
    useGameStore.setState({ inventory: {}, character: { ...get().character, energy: MAX_ENERGY } });
    get().addHabit({ name: 'Row', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id); // at cap → the +1 is clamped away, so no grant marker is set
    expect(get().character.energy).toBe(MAX_ENERGY);
    get().uncompleteHabit(id); // must NOT deduct energy that was never effectively granted
    expect(get().character.energy).toBe(MAX_ENERGY);
    _resetNow();
  });

  it('claws back a streak milestone on uncomplete and does not re-mint on same-day re-complete (3.4 deferred)', () => {
    const today = new Date(2025, 6, 30); // 2025-07-30
    _setNow(() => today);
    useGameStore.setState({ inventory: {}, character: { ...get().character, gold: 0 } });
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    seedPriorStreak(id, toISODate(today), 29); // today → streak 30, a milestone
    get().completeHabit(id);
    expect(get().character.gold).toBe(habitGold('normal') + 100); // base + milestone
    expect(get().inventory['streak_freeze']).toBe(1);
    // Uncomplete reverses BOTH the base gold and the off-ledger milestone gold + freeze.
    get().uncompleteHabit(id);
    expect(get().character.gold).toBe(0);
    expect(get().inventory['streak_freeze'] ?? 0).toBe(0);
    // Re-complete the same day: base gold returns, but the milestone must NOT re-mint (marker).
    get().completeHabit(id);
    expect(get().character.gold).toBe(habitGold('normal'));
    expect(get().inventory['streak_freeze'] ?? 0).toBe(0);
    _resetNow();
  });

  it('does not consume item when habit is already logged today', () => {
    // Use local-time constructor (not ISO string) so toISODate() returns the correct day
    // regardless of the runner's UTC offset.
    _setNow(() => new Date(2025, 0, 1)); // 2025-01-01
    useGameStore.setState({ inventory: { streak_freeze: 1 } });
    get().addHabit({ name: 'Run', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id); // already completed today
    get().useStreakFreeze(id); // should be a no-op
    expect(get().inventory['streak_freeze']).toBe(1); // item NOT consumed
    _resetNow();
  });

  it('streak freeze preserves streak across a missed day without inflating the count', () => {
    const day1 = new Date(2025, 1, 1);  // 2025-02-01
    const day2 = new Date(2025, 1, 2);  // 2025-02-02
    const day3 = new Date(2025, 1, 3);  // 2025-02-03 — missed, freeze applied
    const day4 = new Date(2025, 1, 4);  // 2025-02-04

    // Day 1 — complete
    _setNow(() => day1);
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    useGameStore.setState({ inventory: { streak_freeze: 2 } });
    const id = get().habits[0].id;
    get().completeHabit(id);
    expect(get().habits[0].streak).toBe(1);

    // Day 2 — complete → streak 2
    _setNow(() => day2);
    get().completeHabit(id, undefined, toISODate(day2));
    expect(get().habits[0].streak).toBe(2);

    // Day 3 — miss it, apply freeze → streak should stay 2 (not increment)
    _setNow(() => day3);
    get().useStreakFreeze(id);
    expect(get().inventory['streak_freeze']).toBe(1); // item consumed
    expect(get().habits[0].streak).toBe(2); // preserved but NOT incremented

    // Day 4 — complete → streak should be 3
    _setNow(() => day4);
    get().completeHabit(id, undefined, toISODate(day4));
    expect(get().habits[0].streak).toBe(3);

    _resetNow();
  });

  it('streak breaks without a freeze when a day is missed', () => {
    const day1 = new Date(2025, 2, 1);  // 2025-03-01
    const day2 = new Date(2025, 2, 2);  // 2025-03-02
    // day3 (2025-03-03) deliberately skipped, no freeze
    const day4 = new Date(2025, 2, 4);  // 2025-03-04

    _setNow(() => day1);
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);

    _setNow(() => day2);
    get().completeHabit(id, undefined, toISODate(day2));
    expect(get().habits[0].streak).toBe(2);

    // Skip day3 (no freeze). Complete day4 — streak resets to 1.
    _setNow(() => day4);
    get().completeHabit(id, undefined, toISODate(day4));
    expect(get().habits[0].streak).toBe(1);

    _resetNow();
  });
});

describe('creative mode (developer settings)', () => {
  it('updateSettings flips a flag', () => {
    expect(get().settings.invincible).toBe(false);
    get().updateSettings({ invincible: true });
    expect(get().settings.invincible).toBe(true);
  });

  it('unlimited gold buys for free without spending', () => {
    useGameStore.setState({
      character: { ...get().character, gold: 0 },
      settings: { ...get().settings, unlimitedGold: true },
    });
    get().buyItem('streak_freeze');
    expect(get().inventory['streak_freeze']).toBe(1);
    expect(get().character.gold).toBe(0); // never went negative
  });

  it('unlimited energy enters a dungeon for free', () => {
    useGameStore.setState({
      character: { ...get().character, level: 3, energy: 0 },
      settings: { ...get().settings, unlimitedEnergy: true },
    });
    get().startDungeon();
    expect(get().dungeon).not.toBeNull();
    expect(get().character.energy).toBe(0); // no deduction
  });

  it('invincibility keeps the player at full HP and prevents a loss', () => {
    useGameStore.setState({ pendingLevelUp: 2, settings: { ...get().settings, invincible: true } });
    get().startBattle();
    expect(get().battle).not.toBeNull();
    // Drop the player to the brink, then act — the top-up should restore full HP.
    useGameStore.setState({ battle: { ...get().battle!, playerHp: 1 } });
    get().battleAction({ kind: 'defend' });
    const b = get().battle!;
    expect(b.playerHp).toBe(b.playerMaxHp);
    expect(b.status).not.toBe('lost');
  });
});

describe('dungeon expeditions', () => {
  it('requires 3 energy to enter', () => {
    useGameStore.setState({ character: { ...get().character, level: 3, energy: 2 } });
    get().startDungeon();
    expect(get().dungeon).toBeNull();
  });

  it('spends energy and starts a descent at depth 1', () => {
    useGameStore.setState({ character: { ...get().character, level: 3, energy: 5 } });
    get().startDungeon();
    const run = get().dungeon!;
    expect(run).not.toBeNull();
    expect(get().character.energy).toBe(2); // 5 - 3
    expect(run.depth).toBe(1);
    expect(run.choices.length).toBeGreaterThan(0); // entry rooms to choose from
    expect(run.nodeId).toBeNull(); // start at a path choice, not inside a room
    expect(run.status).toBe('active');
  });

  it('dungeonChoosePath enters a chosen next room on the floor map', () => {
    const run = makeRun({ rooms: [{ type: 'combat' }, { type: 'treasure' }] });
    // Simulate having resolved the first room and being at the branching choice.
    useGameStore.setState({ dungeon: { ...run, nodeId: null, choices: ['n1_0'], path: ['n0_0'] } });
    get().dungeonChoosePath('n1_0');
    const d = get().dungeon!;
    expect(d.nodeId).toBe('n1_0');
    expect(d.path).toContain('n1_0');
    expect(d.roomLoot).not.toBeNull(); // treasure room loots on entry
  });

  it('dungeonChoosePath ignores a node that is not on offer', () => {
    const run = makeRun({ rooms: [{ type: 'combat' }, { type: 'treasure' }] });
    useGameStore.setState({ dungeon: { ...run, nodeId: null, choices: ['n1_0'], path: ['n0_0'] } });
    get().dungeonChoosePath('bogus');
    expect(get().dungeon!.nodeId).toBeNull();
  });

  it('treasure: an already-owned weapon drop rerolls into gold instead of vanishing (MINI-39)', () => {
    const run = makeRun({ rooms: [{ type: 'combat' }, { type: 'treasure' }], depth: 3 });
    useGameStore.setState({
      ownedWeapons: ['worn_sword', 'iron_mace', 'short_bow'], // owns both droppable weapons
      dungeon: { ...run, nodeId: null, choices: ['n1_0'], path: ['n0_0'] },
    });
    // Math.random=0 forces resolveTreasure to roll a weapon drop → iron_mace (WEAPON_DROPS[0]).
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0);
    get().dungeonChoosePath('n1_0');
    const loot = get().dungeon!.roomLoot!;
    rng.mockRestore();
    expect(loot.weapons ?? []).toHaveLength(0); // owned weapon didn't survive as dead loot
    // base gold (60 + depth*10 = 90) + reroll (30 + 5*depth = 45) = 135
    expect(loot.gold).toBe(135);
  });

  it('an encounter choice advances the encounter and may accrue floor loot', () => {
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'encounter', key: 'sealed_door' }],
        encounter: startEncounter(getEncounter('sealed_door')!),
      }),
    });
    get().dungeonEncounterChoose(0);
    const run = get().dungeon!;
    expect(run.encounter!.nodeId).not.toBe('door'); // moved off the opening node
    expect(run.hp).toBeLessThanOrEqual(run.maxHp);
  });

  it('a won combat room carries HP/Stamina forward and trains a combat stat', () => {
    get().resetGame();
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'combat' }, { type: 'encounter', key: 'sealed_door' }],
        hp: 80,
        battle: {
          status: 'won',
          playerHp: 42,
          playerMp: 12,
          playerSta: 5,
          bossMaxHp: 50,
          attackSchool: 'physical',
        } as BattleState,
      }),
    });
    get().dungeonAdvance();
    const run = get().dungeon!;
    expect(run.nodeId).toBeNull(); // resolved the room → now choosing the next path
    expect(run.choices).toContain('n1_0'); // the encounter room is offered next
    expect(run.hp).toBe(42);
    expect(run.sta).toBe(5);
    expect(run.battle).toBeNull();
    expect(get().combatStats.defenseXp).toBeGreaterThan(0); // physical foe trains Defense
    expect(get().character.statXp.ST).toBeGreaterThan(0); // win grants the attack-stat XP
    expect(get().character.statXp.HP).toBeGreaterThan(0); // ...and HP for enduring the fight
    expect(run.floorReward.gold).toBe(combatRoomGold(1)); // plain combat win pays depth-scaled gold (MINI-05)
  });

  it('is gated until the dungeon unlock level (3)', () => {
    get().resetGame(); // level 1
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    get().startDungeon();
    expect(get().dungeon).toBeNull(); // locked at level 1

    useGameStore.setState({ character: { ...get().character, level: 3, energy: 10 } });
    get().startDungeon();
    expect(get().dungeon).not.toBeNull(); // unlocked at level 3
  });

  it('passing a dungeon stat check grants stat XP toward leveling', () => {
    get().resetGame();
    const rng = vi.spyOn(Math, 'random').mockReturnValue(0); // force the check to succeed
    const def = getEncounter('sealed_door')!;
    useGameStore.setState({
      dungeon: makeRun({ rooms: [{ type: 'encounter', key: 'sealed_door' }], encounter: startEncounter(def) }),
    });
    const before = get().character.statXp.KN;
    get().dungeonEncounterChoose(0); // "Decipher the runes (Knowledge)" — a KN check
    expect(get().character.statXp.KN).toBe(before + 10);
    rng.mockRestore();
  });

  it('clearing a floor reaches a checkpoint with wounds carried (attrition)', () => {
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'combat' }],
        hp: 30,
        maxHp: 100,
        floorReward: { gold: 20 },
        battle: {
          status: 'won',
          playerHp: 18,
          playerMp: 4,
          playerSta: 2,
          bossMaxHp: 50,
          attackSchool: 'physical',
        } as BattleState,
      }),
    });
    get().dungeonAdvance();
    const run = get().dungeon!;
    expect(run.atCheckpoint).toBe(true);
    expect(run.status).toBe('active');
    expect(run.bankedReward.gold).toBe(20 + combatRoomGold(1)); // floor loot (incl. combat-win gold) locked in
    expect(run.hp).toBe(18); // HP carries over — no free full heal
    expect(run.pendingBoon).toBeNull(); // the boon now comes from Press On, not floor clear
  });

  it('chooseBoon adds a relic, clears the offer, and a +maxHp boon raises run maxHp', () => {
    get().resetGame();
    useGameStore.setState({ character: { ...get().character, level: 3, energy: 5 } });
    get().startDungeon();
    const before = get().dungeon!.maxHp;
    useGameStore.setState({ dungeon: { ...get().dungeon!, pendingBoon: ['vital_charm'] } });
    get().chooseBoon('vital_charm');
    const run = get().dungeon!;
    expect(run.relics).toContain('vital_charm');
    expect(run.pendingBoon).toBeNull();
    expect(run.maxHp).toBe(before + 15); // +15 max HP relic
    expect(run.hp).toBe(get().dungeon!.maxHp); // gained HP granted (started at full)
  });

  it('chooseBoon ignores a relic that was not offered', () => {
    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'combat' }], relics: [], pendingBoon: ['ember_sigil'] }) });
    get().chooseBoon('titan_grip'); // not in the offer
    expect(get().dungeon!.relics).toHaveLength(0);
    expect(get().dungeon!.pendingBoon).toEqual(['ember_sigil']);
  });

  it('shrine: praying succeeds (boon) or fails (curse) by the roll', () => {
    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'shrine' }, { type: 'combat' }] }) });
    const win = vi.spyOn(Math, 'random').mockReturnValue(0); // 0 < success chance
    get().dungeonShrine('pray');
    expect(get().dungeon!.pendingBoon).not.toBeNull();
    win.mockRestore();

    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'shrine' }, { type: 'combat' }] }) });
    const lose = vi.spyOn(Math, 'random').mockReturnValue(0.99); // misses → curse
    get().dungeonShrine('pray');
    expect(get().dungeon!.relics).toHaveLength(1);
    lose.mockRestore();
  });

  it('shrine: praying reads Wisdom only — high Charisma no longer carries the roll (BAL-07)', () => {
    // WI 0, CH 30, roll 0.5. New WI-only chance = clamp(0.3 + (0-6)*0.07) = 0.15 → 0.5 fails → curse.
    // Under the old max(WI,CH), power would be 30 → chance 0.95 → 0.5 would have blessed. Non-vacuous.
    useGameStore.setState({
      character: { ...get().character, statLevels: { ...get().character.statLevels, WI: 0, CH: 30 } },
      dungeon: makeRun({ rooms: [{ type: 'shrine' }, { type: 'combat' }] }),
    });
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    get().dungeonShrine('pray');
    expect(get().dungeon!.pendingBoon).toBeNull(); // CH couldn't save the roll
    expect(get().dungeon!.relics).toHaveLength(1); // cursed instead
    roll.mockRestore();
  });

  it('shrine: a run-buff (relic) WI bonus now carries the pray check (MINI-27)', () => {
    // Character WI 0 + a +20 WI run-buff, roll 0.5. Raw WI=0 → chance 0.15 → fails → curse (old bug).
    // With the run-buff folded in (WI=20) → chance 0.95 → succeeds → boon. Non-vacuous.
    useGameStore.setState({
      character: { ...get().character, statLevels: { ...get().character.statLevels, WI: 0 } },
      dungeon: makeRun({ rooms: [{ type: 'shrine' }, { type: 'combat' }], runBuff: { WI: 20 } }),
    });
    const roll = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    get().dungeonShrine('pray');
    expect(get().dungeon!.pendingBoon).not.toBeNull(); // the run-buff carried the roll
    roll.mockRestore();
  });

  it('shrine: offering blood costs HP and guarantees a boon', () => {
    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'shrine' }, { type: 'combat' }], hp: 100, maxHp: 100 }) });
    get().dungeonShrine('offer');
    const d = get().dungeon!;
    expect(d.hp).toBe(75); // -25% HP
    expect(d.pendingBoon).not.toBeNull();
    expect(d.choices).toContain('n1_0'); // advanced to the next path choice
  });

  it('merchant: buying deducts gold and grants a potion; leaving advances', () => {
    get().resetGame();
    useGameStore.setState({
      character: { ...get().character, gold: 100 },
      dungeon: makeRun({ rooms: [{ type: 'merchant' }, { type: 'combat' }], merchant: merchantOffers(1) }),
    });
    const potionOffer = merchantOffers(1).find((o) => o.kind === 'potion')!;
    get().dungeonBuy('potion');
    expect(get().character.gold).toBe(100 - potionOffer.cost);
    expect(get().inventory['healing_potion']).toBe(1);
    get().dungeonLeaveRoom();
    expect(get().dungeon!.choices).toContain('n1_0');
  });

  it('elite: winning grants a guaranteed boon and bonus floor gold', () => {
    get().resetGame();
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'elite' }, { type: 'combat' }],
        battle: { status: 'won', playerHp: 30, playerMp: 5, playerSta: 3, bossMaxHp: 60, attackSchool: 'physical' } as BattleState,
      }),
    });
    get().dungeonAdvance();
    const d = get().dungeon!;
    expect(d.pendingBoon).not.toBeNull();
    expect(d.floorReward.gold ?? 0).toBeGreaterThan(0);
    // ARCH-09: the elite-win branch must carry the earnedXp accrued from the fight forward.
    // The pre-fix `...run` spread rebuilt workingRun from the pre-battle snapshot, dropping the
    // earnedXp set one line earlier (so it landed as undefined, forfeiting the dungeon XP).
    const { atkShare, hpShare } = dungeonCombatStatXp(60); // bossMaxHp above; no multi-phase hpDefeated
    expect(d.earnedXp).toBe(atkShare + hpShare);
  });

  it('boss: winning pays the boss gold bounty, credits every phase, and clears its loss counter (MINI-04/29)', () => {
    get().resetGame();
    useGameStore.setState({
      dungeonBossLosses: { bone_tyrant_d1: 2 }, // prior attempts had earned relief
      dungeon: makeRun({
        rooms: [{ type: 'boss' }, { type: 'combat' }],
        battle: { status: 'won', bossId: 'bone_tyrant_d1', playerHp: 30, playerMp: 5, playerSta: 3, bossMaxHp: 60, hpDefeated: 120, attackSchool: 'physical' } as BattleState,
      }),
    });
    get().dungeonAdvance();
    const d = get().dungeon!;
    expect(d.floorReward.gold).toBe(bossRoomGold(1)); // marquee boss payout, not combatRoomGold
    expect(d.damageDealt).toBe(120); // whole two-phase fight (hpDefeated), not just the last form's 60
    expect(get().dungeonBossLosses['bone_tyrant_d1']).toBe(0); // relief tally reset on victory
  });

  it('boss: losing tallies a loss so the retry earns anti-frustration relief', () => {
    get().resetGame();
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'boss' }, { type: 'combat' }],
        battle: { status: 'lost', bossId: 'bone_tyrant_d1', playerHp: 0, playerMp: 0, playerSta: 0, bossMaxHp: 60, attackSchool: 'physical' } as BattleState,
      }),
    });
    get().dungeonAdvance();
    expect(get().dungeonBossLosses['bone_tyrant_d1']).toBe(1);
  });

  it('rest: healing restores HP; fortify offers a boon', () => {
    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'rest' }, { type: 'combat' }], hp: 40, maxHp: 100 }) });
    get().dungeonRest('heal');
    expect(get().dungeon!.hp).toBe(80); // +40% of max

    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'rest' }, { type: 'combat' }] }) });
    get().dungeonRest('fortify');
    expect(get().dungeon!.pendingBoon).not.toBeNull();
  });

  it('fleeing keeps most gathered loot (0.6); defeat forfeits most of the floor', () => {
    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'combat' }],
        floorReward: { gold: 100 },
        battle: { status: 'fled', playerHp: 25 } as BattleState,
      }),
    });
    get().dungeonAdvance();
    expect(get().dungeon!.status).toBe('ended');
    expect(get().dungeon!.cleared).toBe(false);
    expect(get().dungeon!.bankedReward.gold).toBe(60); // retreat keeps 0.6 of gathered loot (MINI-30)

    useGameStore.setState({
      dungeon: makeRun({
        rooms: [{ type: 'combat' }],
        floorReward: { gold: 100 },
        battle: { status: 'lost', playerHp: 0 } as BattleState,
      }),
    });
    get().dungeonAdvance();
    expect(get().dungeon!.status).toBe('ended');
    expect(get().dungeon!.bankedReward.gold).toBe(25); // 25% kept on defeat
  });

  it('banking at a checkpoint ends the run as cleared', () => {
    useGameStore.setState({
      dungeon: makeRun({ rooms: [{ type: 'combat' }], atCheckpoint: true, bankedReward: { gold: 50 } }),
    });
    get().dungeonBank();
    expect(get().dungeon!.status).toBe('ended');
    expect(get().dungeon!.cleared).toBe(true);
  });

  it('descending from a checkpoint builds a deeper floor and records the depth', () => {
    get().resetGame();
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      dungeon: makeRun({ rooms: [{ type: 'combat' }], atCheckpoint: true, depth: 1, hp: 30, maxHp: 100 }),
    });
    get().dungeonDescend('pressOn');
    const run = get().dungeon!;
    expect(run.depth).toBe(2);
    expect(run.atCheckpoint).toBe(false);
    expect(run.status).toBe('active');
    expect(run.nodeId).toBeNull(); // new floor starts at a path choice
    expect(run.choices.length).toBeGreaterThan(0);
    expect(run.hp).toBe(30); // Press On keeps your wounds
    expect(run.pendingBoon).not.toBeNull(); // ...and grants a boon
    expect(get().deepestFloor).toBe(2); // record updated
    expect(get().character.energy).toBe(5); // descending to floor ≤3 is free (BAL-13)
  });

  it('descending past floor 3 charges 1 energy, unless unlimited (BAL-13)', () => {
    get().resetGame();
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      dungeon: makeRun({ rooms: [{ type: 'combat' }], atCheckpoint: true, depth: 3, hp: 30, maxHp: 100 }),
    });
    get().dungeonDescend('pressOn'); // depth 3 → 4 (past floor 3)
    expect(get().dungeon!.depth).toBe(4);
    expect(get().character.energy).toBe(4); // charged 1 energy

    // Unlimited energy bypasses the charge.
    get().resetGame();
    useGameStore.setState({
      settings: { ...get().settings, unlimitedEnergy: true },
      character: { ...get().character, energy: 5 },
      dungeon: makeRun({ rooms: [{ type: 'combat' }], atCheckpoint: true, depth: 3, hp: 30, maxHp: 100 }),
    });
    get().dungeonDescend('pressOn');
    expect(get().dungeon!.depth).toBe(4);
    expect(get().character.energy).toBe(5); // no deduction with unlimitedEnergy
  });

  it('resting at a checkpoint heals but grants no boon', () => {
    useGameStore.setState({
      dungeon: makeRun({ rooms: [{ type: 'combat' }], atCheckpoint: true, depth: 1, hp: 30, maxHp: 100, pendingBoon: null }),
    });
    get().dungeonDescend('rest');
    const run = get().dungeon!;
    expect(run.hp).toBe(70); // +40% of max
    expect(run.pendingBoon).toBeNull();
  });

  it('collect grants banked gold + materials but no XP, and clears the run', () => {
    const xpBefore = { ...get().character.statXp };
    useGameStore.setState({
      character: { ...get().character, gold: 10 },
      dungeon: makeRun({
        rooms: [{ type: 'treasure' }],
        status: 'ended',
        cleared: true,
        bankedReward: { gold: 100, materials: { iron_bar: 2, leather: 1 } },
      }),
    });
    get().collectDungeon();
    expect(get().character.gold).toBe(110);
    expect(get().materials).toEqual({ iron_bar: 2, leather: 1 });
    expect(get().character.statXp).toEqual(xpBefore); // dungeons grant no XP
    expect(get().character.level).toBe(1);
    expect(get().dungeon).toBeNull();
  });

  it('does not collect while a run is still active', () => {
    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'combat' }] }) });
    get().collectDungeon();
    expect(get().dungeon).not.toBeNull();
  });
});

describe('developer testing tools', () => {
  it('devSetLevel jumps the level with consistent XP and no queued trial', () => {
    get().resetGame();
    get().devSetLevel(10);
    expect(get().character.level).toBe(10);
    // XP total derives back to exactly the same level — the bar stays consistent.
    expect(levelForTotalXp(totalXp(get().character.statXp))).toBe(10);
    expect(get().pendingLevelUp).toBeNull();
  });

  it('devSetLevel(3) opens the dungeon gate', () => {
    get().resetGame();
    get().devSetLevel(3);
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    get().startDungeon();
    expect(get().dungeon).not.toBeNull();
  });

  it('devSetLevel clamps to [1, MAX_LEVEL]', () => {
    get().devSetLevel(999);
    expect(get().character.level).toBe(50);
    get().devSetLevel(0);
    expect(get().character.level).toBe(1);
  });

  it('devSetDeepestFloor records the deepest floor reached', () => {
    get().devSetDeepestFloor(8);
    expect(get().deepestFloor).toBe(8);
  });

  it('devSpawnTrial opens the matching boss fight, and winning advances the level', () => {
    get().resetGame();
    get().devSpawnTrial(5);
    expect(get().pendingLevelUp).toBe(5);
    expect(get().battle).not.toBeNull();
    expect(get().battle!.bossName).toBe(bossForLevel(5).name);

    useGameStore.setState({ battle: { ...get().battle!, status: 'won' } });
    get().dismissBattle();
    expect(get().character.level).toBe(5);
    expect(get().pendingLevelUp).toBeNull();
  });

  it('devClearClass strips an assigned class', () => {
    get().chooseClass('ST', 'DX'); // Knight
    expect(get().character.classId).toBe('Knight');
    get().devClearClass();
    expect(get().character.classId).toBeNull();
  });

  it('devSetLevel synthesizes statLevels — stat levels rise above base after a level jump', () => {
    get().resetGame();
    // Fresh character has all stat levels at BASE_STAT_LEVEL.
    STAT_IDS.forEach((id) => {
      expect(get().character.statLevels[id]).toBe(BASE_STAT_LEVEL);
    });

    // After a level jump, stat levels must be above base (the key regression check —
    // before the fix, devSetLevel left statLevels frozen at BASE_STAT_LEVEL).
    get().devSetLevel(10);
    STAT_IDS.forEach((id) => {
      expect(get().character.statLevels[id]).toBeGreaterThan(BASE_STAT_LEVEL);
    });

    // Lv 5 jump must give lower or equal stat levels than Lv 10 (no regressions in ordering).
    get().devSetLevel(5);
    const lv5Levels = { ...get().character.statLevels };
    get().devSetLevel(10);
    STAT_IDS.forEach((id) => {
      expect(get().character.statLevels[id]).toBeGreaterThanOrEqual(lv5Levels[id]);
    });
  });

  it('resetGame clears mineTombstone and claimedPartyQuests', () => {
    useGameStore.setState({
      mineTombstone: { floor: 3, haul: { gold: 50 } },
      claimedPartyQuests: ['quest-abc'],
    });
    get().resetGame();
    expect(get().mineTombstone).toBeNull();
    expect(get().claimedPartyQuests).toEqual([]);
  });

  it('devFillEnergy sets energy to MAX_ENERGY', () => {
    get().resetGame();
    useGameStore.setState({ character: { ...get().character, energy: 0 } });
    get().devFillEnergy();
    expect(get().character.energy).toBe(MAX_ENERGY);
  });

  it('devAddGold increments gold by the given amount and ignores negatives', () => {
    get().resetGame();
    useGameStore.setState({ character: { ...get().character, gold: 200 } });
    get().devAddGold(500);
    expect(get().character.gold).toBe(700);
    get().devAddGold(-999);
    expect(get().character.gold).toBe(700); // negative amount is a no-op
  });

  it('devResetEarnings zeros the earnings ledger and energy log', () => {
    const e = get().earnings;
    useGameStore.setState({
      earnings: { ...e, xp: { ...e.xp, habit: 500 }, gold: { ...e.gold, mine: 200 } },
      energyLog: { [toISODate()]: { earned: 5, spent: 3 } },
    });
    get().devResetEarnings();
    expect(get().earnings).toEqual(freshEarningsLedger());
    expect(get().energyLog).toEqual({});
  });

  it('devForceWeeklyRollover then checkWeeklyRollover emits a weekly report', () => {
    get().resetGame();
    get().devForceWeeklyRollover();
    get().checkWeeklyRollover();
    expect(get().pendingReport).not.toBeNull();
  });
});

describe('deep mine', () => {
  /** A small hand-built cavern with the player centred and facing right. */
  function makeMine(over: Partial<MineState> = {}): MineState {
    const rows = 5;
    const cols = 5;
    const tiles: MineTile[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: MineTile[] = [];
      for (let c = 0; c < cols; c++) {
        const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
        row.push(border ? { kind: 'bedrock' } : { kind: 'floor' });
      }
      tiles.push(row);
    }
    return {
      floor: 1, rows, cols, tiles,
      player: { r: 2, c: 2, facing: 'right' },
      hp: 50, maxHp: 50,
      sta: 55, maxSta: 55,
      mp: 8, maxMp: 8,
      staNextRegenMs: STA_REGEN_MS,
      mpNextRegenMs: MP_REGEN_MS,
      meleePower: 5, rangedPower: 3,
      damageSpell: 2, supportSpell: 2, illusionPower: 1,
      defense: 0, ward: 0,
      weapon: getWeapon(STARTER_WEAPON),
      knownSpells: [],
      pickaxePower: 1,
      monsters: [], haul: {}, status: 'active', lastHitAtMs: -1000, deepest: 1, killsThisFloor: 0,
      score: 0,
      runes: [], ringOfFire: null, ringNextHitMs: {}, playerStatuses: [],
      lastSpellMs: -1000, nextRuneId: 1,
      // Phase 1 fields
      lastDashMs: -2000, dashCooldownMs: 2000, moveIntervalMs: 150, agLevel: 0,
      // Phase 5 fields
      activeBoons: [], pendingBoonChoice: null,
      ...over,
    };
  }

  it('beginMining starts a run and charges energy once the gate is met', () => {
    get().devSetLevel(5);
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    get().beginMining();
    expect(get().mining).not.toBeNull();
    expect(get().mining!.floor).toBe(1);
    expect(get().character.energy).toBe(8); // MINE_ENERGY_COST = 2
    // Earnings ledger: energySpent bumped on entry.
    expect(get().earnings.energySpent).toBe(2);
  });

  it('beginMining has no level gate — a fresh level-1 character can enter', () => {
    // Level limit removed: only energy (and the unlimitedEnergy bypass) gates entry now.
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    get().beginMining();
    expect(get().mining).not.toBeNull();
  });

  it('beginMining with an explicit co-op seed replaces a leftover orphan run (MP-12)', () => {
    // A persisted/solo run left on state before the join must not survive: keeping it
    // would merge a stale map against the shared co-op seed.
    useGameStore.setState({ mining: makeMine({ floor: 5 }), character: { ...get().character, energy: 10 } });
    const stale = get().mining;
    get().beginMining(4242); // co-op join passes the shared seed
    expect(get().mining).not.toBe(stale);
    expect(get().mining!.floor).toBe(1); // rebuilt from the shared seed, not the stale floor 5
  });

  it('beginMining without a seed keeps an in-progress solo run (re-entry)', () => {
    const existing = makeMine({ floor: 3 });
    useGameStore.setState({ mining: existing });
    get().beginMining();
    expect(get().mining).toBe(existing);
  });

  it('beginMining with a co-op seed but no energy clears the orphan so auto-leave fires (MP-12)', () => {
    useGameStore.setState({
      mining: makeMine({ floor: 5 }),
      character: { ...get().character, energy: 0 },
      settings: { ...get().settings, unlimitedEnergy: false },
    });
    get().beginMining(4242);
    expect(get().mining).toBeNull();
  });

  it('mineStrike breaks the faced ore vein and accrues the haul', () => {
    const tiles = makeMine().tiles;
    tiles[2][3] = { kind: 'ore', oreKey: 'rubble', durability: 1 };
    useGameStore.setState({ mining: makeMine({ tiles }) });
    get().mineStrike();
    expect(get().mining!.tiles[2][3].kind).toBe('floor');
    expect(get().mining!.haul.gold ?? 0).toBeGreaterThan(0);
  });

  it('endMining on the entrance (safe tile) banks the full haul and records the deepest floor', () => {
    // BAL-12: full 1.0 payout requires standing on the entrance when end-banking.
    // Daily first-descent bonus (3.8) exhausted so this test isolates BAL-12's split.
    useGameStore.setState({ mineDailyBonus: { date: toISODate(), floorsUsed: MINE_DAILY_BONUS_FLOORS } });
    const tiles = makeMine().tiles;
    tiles[2][2] = { kind: 'entrance' };
    useGameStore.setState({ mining: makeMine({ tiles, haul: { gold: 50, materials: { iron_bar: 3 } }, deepest: 4 }) });
    const goldBefore = get().character.gold;
    const ironBefore = get().materials.iron_bar ?? 0;
    get().endMining();
    expect(get().mining).toBeNull();
    expect(get().character.gold).toBe(goldBefore + 50);
    expect(get().materials.iron_bar).toBe(ironBefore + 3);
    expect(get().deepestMineFloor).toBe(4);
    expect(get().character.statXp.ST).toBeGreaterThan(0); // labour trickle
    // Earnings ledger: mine source records the committed XP and gold.
    expect(get().earnings.xp.mine).toBeGreaterThan(0);
    expect(get().earnings.gold.mine).toBe(50);
    expect(get().earnings.count.mine).toBe(1);
  });

  it('endMining off a safe tile keeps only MINE_STASH_KEEP of the haul (BAL-12)', () => {
    // Default player stands on a floor tile (not the entrance) → 0.8 payout, pricing the
    // risk of not trekking back to the entrance for a full-value bank.
    // Daily first-descent bonus (3.8) exhausted so this test isolates BAL-12's split.
    useGameStore.setState({ mineDailyBonus: { date: toISODate(), floorsUsed: MINE_DAILY_BONUS_FLOORS } });
    useGameStore.setState({ mining: makeMine({ haul: { gold: 50, materials: { iron_bar: 3 } }, deepest: 4 }) });
    const goldBefore = get().character.gold;
    const ironBefore = get().materials.iron_bar ?? 0;
    get().endMining();
    expect(get().mining).toBeNull();
    expect(get().character.gold).toBe(goldBefore + 40); // floor(50 * 0.8)
    expect(get().materials.iron_bar).toBe(ironBefore + 2); // floor(3 * 0.8)
  });

  it('beginMining (solo) starts at the deepest cleared guardian band; co-op stays at floor 1 (BAL-25)', () => {
    useGameStore.setState({ character: { ...get().character, energy: 10 }, deepestMineFloor: 8 });
    get().beginMining(); // solo → past the floor-7 guardian
    expect(get().mining!.floor).toBe(7);
    // Co-op passes an explicit startFloor of 1 (see net/coop/session.ts beginRun) → shared map.
    useGameStore.setState({ mining: null, character: { ...get().character, energy: 10 } });
    get().beginMining(4242, 1);
    expect(get().mining!.floor).toBe(1);
  });

  it('mineTick flips to ended on death; endMining then banks the haul', () => {
    // Daily first-descent bonus (3.8) exhausted so this test isolates MINE_DEATH_KEEP's split.
    useGameStore.setState({ mineDailyBonus: { date: toISODate(), floorsUsed: MINE_DAILY_BONUS_FLOORS } });
    useGameStore.setState({
      mining: makeMine({
        hp: 3,
        haul: { gold: 12 },
        deepest: 2,
        monsters: [{ id: 'a', key: 'cave_slug', r: 2, c: 3, hp: 6, maxHp: 6, readyAtMs: 999999 }],
      }),
    });
    const goldBefore = get().character.gold;
    get().mineTick(1000); // cave_slug touchDamage 4 > 3 hp → run ends (death screen), not yet committed
    expect(get().mining).not.toBeNull();
    expect(get().mining!.status).toBe('ended');
    expect(get().character.gold).toBe(goldBefore); // nothing banked until the player leaves
    get().endMining();
    expect(get().mining).toBeNull();
    // Death now forfeits half the haul (MINE_DEATH_KEEP = 0.5), so 12 gold → 6 kept.
    expect(get().character.gold).toBe(goldBefore + 6);
    expect(get().deepestMineFloor).toBe(2);
  });

  it('persists at version 36', () => {
    expect(useGameStore.persist.getOptions().version).toBe(36);
  });

  describe('3.8: daily first-descent bonus', () => {
    it('applies MINE_DAILY_BONUS_MULT to gold when the daily budget is fresh', () => {
      const tiles = makeMine().tiles;
      tiles[2][2] = { kind: 'entrance' };
      useGameStore.setState({ mining: makeMine({ tiles, haul: { gold: 100 }, deepest: 3 }) });
      const goldBefore = get().character.gold;
      get().endMining();
      expect(get().character.gold).toBe(goldBefore + 150); // 100 * 1.5
      expect(get().mineDailyBonus).toEqual({ date: toISODate(), floorsUsed: 3 });
    });

    it('stops applying once the day\'s floor budget is exhausted', () => {
      useGameStore.setState({ mineDailyBonus: { date: toISODate(), floorsUsed: MINE_DAILY_BONUS_FLOORS } });
      const tiles = makeMine().tiles;
      tiles[2][2] = { kind: 'entrance' };
      useGameStore.setState({ mining: makeMine({ tiles, haul: { gold: 100 }, deepest: 3 }) });
      const goldBefore = get().character.gold;
      get().endMining();
      expect(get().character.gold).toBe(goldBefore + 100); // no bonus — budget spent
    });

    it('resets the budget on a new calendar day', () => {
      useGameStore.setState({ mineDailyBonus: { date: '2000-01-01', floorsUsed: MINE_DAILY_BONUS_FLOORS } });
      const tiles = makeMine().tiles;
      tiles[2][2] = { kind: 'entrance' };
      useGameStore.setState({ mining: makeMine({ tiles, haul: { gold: 100 }, deepest: 2 }) });
      const goldBefore = get().character.gold;
      get().endMining();
      expect(get().character.gold).toBe(goldBefore + 150); // stale date → fresh budget
      expect(get().mineDailyBonus).toEqual({ date: toISODate(), floorsUsed: 2 });
    });
  });

  it('coopApplyWorld drops a stale/duplicate world slice (t guard)', () => {
    useGameStore.setState({ mining: makeMine() });
    // First slice: accepted (high-water mark starts at -Infinity).
    get().coopApplyWorld({ floor: 1, monsters: [], t: 100 });
    const miningAfterFirst = get().mining;
    expect(miningAfterFirst).not.toBeNull();

    // Second slice with a lower t: dropped — mining reference must not change.
    get().coopApplyWorld({ floor: 1, monsters: [], t: 50 });
    expect(get().mining).toBe(miningAfterFirst);

    // Third slice with a higher t: accepted — reference advances.
    get().coopApplyWorld({ floor: 1, monsters: [], t: 200 });
    expect(get().mining).not.toBe(miningAfterFirst);
  });

  it('coopApplyWorld accepts a slice with no t (back-compat)', () => {
    useGameStore.setState({ mining: makeMine() });
    get().coopApplyWorld({ floor: 1, monsters: [] }); // no t field
    expect(get().mining).not.toBeNull();
  });

  it('boon cache pickup with exhausted pool grants a consolation instead of a zero-option choosing (MINI-01)', () => {
    const allMineBoons = Object.values(BOONS)
      .filter((b) => b.game === 'mine' || b.game === 'both')
      .map((b) => b.key);
    const tiles = makeMine().tiles;
    tiles[2][2] = { kind: 'boon' }; // player stands here; Strike triggers the pickup
    useGameStore.setState({ mining: makeMine({ tiles, hp: 20, activeBoons: allMineBoons }) });
    get().mineStrike();
    const mine = get().mining!;
    expect(mine.tiles[2][2].kind).toBe('floor'); // cache still consumed
    expect(mine.status).toBe('active');           // no soft-lock
    expect(mine.pendingBoonChoice).toBeNull();
    expect(mine.hp).toBe(20 + BOON_CONSOLATION_HEAL);
    expect(mine.haul.gold ?? 0).toBe(BOON_CONSOLATION_GOLD);
  });

  it('5.2: mineStrike on a tombstone merges the lost haul back and clears mineTombstone', () => {
    const tiles = makeMine().tiles;
    tiles[2][2] = { kind: 'tombstone' }; // player stands here (see makeMine's player: {r:2,c:2})
    useGameStore.setState({
      mining: makeMine({ tiles, haul: { gold: 10 } }),
      mineTombstone: { floor: 1, haul: { gold: 30, materials: { iron_bar: 2 } } },
    });
    get().mineStrike();
    const mine = get().mining!;
    expect(mine.tiles[2][2].kind).toBe('floor');
    expect(mine.haul.gold).toBe(40); // 10 (run) + 30 (recovered)
    expect(mine.haul.materials?.iron_bar).toBe(2);
    expect(get().mineTombstone).toBeNull();
  });

  it('5.2: mineStrike on a boon cache with room in the pool opens a 3-option choice (happy path)', () => {
    const tiles = makeMine().tiles;
    tiles[2][2] = { kind: 'boon' }; // player stands here; Strike triggers the pickup
    useGameStore.setState({ mining: makeMine({ tiles, activeBoons: [] }) });
    get().mineStrike();
    const mine = get().mining!;
    expect(mine.tiles[2][2].kind).toBe('floor'); // cache consumed
    expect(mine.status).toBe('choosing');
    expect(mine.pendingBoonChoice).not.toBeNull();
    expect(mine.pendingBoonChoice!.length).toBe(3);
  });

  it('skipMineBoon dismisses the boon panel without granting a boon', () => {
    useGameStore.setState({
      mining: makeMine({ status: 'choosing', pendingBoonChoice: ['iron_arm', 'stone_skin'] }),
    });
    get().skipMineBoon();
    expect(get().mining!.status).toBe('active');
    expect(get().mining!.pendingBoonChoice).toBeNull();
    expect(get().mining!.activeBoons).toHaveLength(0);
  });

  it('skipMineBoon is a no-op outside the choosing state', () => {
    const mine = makeMine();
    useGameStore.setState({ mining: mine });
    get().skipMineBoon();
    expect(get().mining).toBe(mine);
  });
});

describe('wild forest', () => {
  /** A small hand-built forest: thicket border, trail interior, player centred, fully lit. */
  function makeForest(over: Partial<ForestState> = {}): ForestState {
    const rows = 5;
    const cols = 5;
    const tiles: ForestTile[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: ForestTile[] = [];
      for (let c = 0; c < cols; c++) {
        const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
        row.push(border ? { kind: 'thicket' } : { kind: 'trail' });
      }
      tiles.push(row);
    }
    return {
      stage: 1, rows, cols, tiles,
      seen: Array.from({ length: rows }, () => new Array(cols).fill(true)),
      player: { r: 2, c: 2, facing: 'right' },
      hp: 50, maxHp: 50,
      sta: 55, maxSta: 55,
      mp: 8, maxMp: 8,
      staNextRegenMs: STA_REGEN_MS,
      mpNextRegenMs: MP_REGEN_MS,
      meleePower: 5, rangedPower: 3,
      damageSpell: 2, supportSpell: 2, illusionPower: 1,
      defense: 0, ward: 0,
      weapon: getWeapon(STARTER_WEAPON),
      knownSpells: [],
      chopPower: 1,
      beasts: [], haul: {}, status: 'active', lastHitAtMs: -1000, deepest: 1, killsThisStage: 0,
      score: 0,
      runes: [], ringOfFire: null, ringNextHitMs: {}, playerStatuses: [],
      lastSpellMs: -1000, nextRuneId: 1,
      // Phase 1 fields
      lastDashMs: -2000, dashCooldownMs: 2000, moveIntervalMs: 150, agLevel: 0,
      // Phase 5 fields
      activeBoons: [], pendingBoonChoice: null,
      ...over,
    };
  }

  it('beginForest starts a run and charges energy once the gate is met', () => {
    get().devSetLevel(5);
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    get().beginForest();
    expect(get().forest).not.toBeNull();
    expect(get().forest!.stage).toBe(1);
    expect(get().character.energy).toBe(8); // FOREST_ENERGY_COST = 2
  });

  it('beginForest has no level gate — a fresh level-1 character can enter', () => {
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    get().beginForest();
    expect(get().forest).not.toBeNull();
  });

  it('beginForest with an explicit co-op seed replaces a leftover orphan run (MP-12)', () => {
    useGameStore.setState({ forest: makeForest({ stage: 5 }), character: { ...get().character, energy: 10 } });
    const stale = get().forest;
    get().beginForest(4242);
    expect(get().forest).not.toBe(stale);
    expect(get().forest!.stage).toBe(1);
  });

  it('beginForest with a co-op seed but no energy clears the orphan (MP-12)', () => {
    useGameStore.setState({
      forest: makeForest({ stage: 5 }),
      character: { ...get().character, energy: 0 },
      settings: { ...get().settings, unlimitedEnergy: false },
    });
    get().beginForest(4242);
    expect(get().forest).toBeNull();
  });

  it('forestAct gathers a faced node into the haul', () => {
    const tiles = makeForest().tiles;
    tiles[2][3] = { kind: 'node', nodeKey: 'flower_bush' };
    useGameStore.setState({ forest: makeForest({ tiles }) });
    get().forestAct(1000);
    expect(get().forest!.tiles[2][3].kind).toBe('trail');
    expect(get().forest!.haul.materials?.herbs ?? 0).toBeGreaterThan(0);
  });

  it('beginForestBanking shows the summary, and endForest on a clearing banks the full haul', () => {
    // BAL-12: full 1.0 payout requires standing on a safe harbour (clearing/entrance).
    const tiles = makeForest().tiles;
    tiles[2][2] = { kind: 'clearing' };
    useGameStore.setState({ forest: makeForest({ tiles, haul: { gold: 20, materials: { herbs: 3 } }, deepest: 3 }) });
    get().beginForestBanking();
    expect(get().forest!.status).toBe('banking');
    const goldBefore = get().character.gold;
    const herbsBefore = get().materials.herbs ?? 0;
    get().endForest();
    expect(get().forest).toBeNull();
    expect(get().character.gold).toBe(goldBefore + 20); // full haul kept on a voluntary bank
    expect(get().materials.herbs).toBe(herbsBefore + 3);
    expect(get().deepestForestStage).toBe(3);
  });

  it('endForest off a safe tile keeps only FOREST_STASH_KEEP of the haul (BAL-12)', () => {
    // Default player stands on a trail tile (not a clearing/entrance) → 0.8 payout, so a
    // full-value end-bank beats banking wherever the run happens to end.
    useGameStore.setState({ forest: makeForest({ haul: { gold: 20, materials: { herbs: 3 } }, deepest: 3 }) });
    get().beginForestBanking();
    const goldBefore = get().character.gold;
    const herbsBefore = get().materials.herbs ?? 0;
    get().endForest();
    expect(get().forest).toBeNull();
    expect(get().character.gold).toBe(goldBefore + 16); // floor(20 * 0.8)
    expect(get().materials.herbs).toBe(herbsBefore + 2); // floor(3 * 0.8)
  });

  it('beginForest (solo) starts at the deepest cleared guardian stage; co-op stays at stage 1 (BAL-25)', () => {
    useGameStore.setState({ character: { ...get().character, energy: 10 }, deepestForestStage: 5 });
    get().beginForest(); // solo → past the stage-4 guardian
    expect(get().forest!.stage).toBe(4);
    // Co-op passes an explicit startStage of 1 (see net/coop/session.ts beginRun) → shared map.
    useGameStore.setState({ forest: null, character: { ...get().character, energy: 10 } });
    get().beginForest(4242, 1);
    expect(get().forest!.stage).toBe(1);
  });

  it('forestTick flips to ended on death without committing; endForest then forfeits half', () => {
    useGameStore.setState({
      forest: makeForest({
        hp: 3,
        haul: { gold: 10, materials: { herbs: 4 } },
        deepest: 2,
        beasts: [{ id: 'a', key: 'wild_boar', r: 2, c: 3, hp: 8, maxHp: 8, readyAtMs: 999999, asleep: false }],
      }),
    });
    const goldBefore = get().character.gold;
    // First tick: beast becomes adjacent → windup starts; no damage yet (telegraph).
    get().forestTick(1000);
    expect(get().forest!.status).toBe('active');
    // Second tick: past the windup window → fatal damage applied.
    get().forestTick(1000 + FOREST_WINDUP_MS + 50); // wild_boar touchDamage 4 > 3 hp → 'ended'
    expect(get().forest).not.toBeNull();
    expect(get().forest!.status).toBe('ended');
    expect(get().character.gold).toBe(goldBefore); // nothing banked until the player leaves

    get().endForest();
    expect(get().forest).toBeNull();
    expect(get().character.gold).toBe(goldBefore + 5); // floor(10 * 0.5) kept, the rest forfeit
    expect(get().materials.herbs ?? 0).toBe(2); // floor(4 * 0.5)
    expect(get().deepestForestStage).toBe(2);
  });

  it('coopApplyForestWorld drops a stale/duplicate world slice (t guard)', () => {
    useGameStore.setState({ forest: makeForest() });
    // First slice: accepted (WorldSliceInput uses `floor` for both mine and forest stages).
    get().coopApplyForestWorld({ floor: 1, monsters: [], t: 100 });
    const forestAfterFirst = get().forest;
    expect(forestAfterFirst).not.toBeNull();

    // Duplicate t: dropped.
    get().coopApplyForestWorld({ floor: 1, monsters: [], t: 100 });
    expect(get().forest).toBe(forestAfterFirst);

    // Higher t: accepted.
    get().coopApplyForestWorld({ floor: 1, monsters: [], t: 101 });
    expect(get().forest).not.toBe(forestAfterFirst);
  });

  it('coopApplyForestWorld accepts a slice with no t (back-compat)', () => {
    useGameStore.setState({ forest: makeForest() });
    get().coopApplyForestWorld({ floor: 1, monsters: [] }); // no t field
    expect(get().forest).not.toBeNull();
  });

  it('boon cache pickup with exhausted pool grants a consolation instead of a zero-option choosing (MINI-01)', () => {
    const allForestBoons = Object.values(BOONS)
      .filter((b) => b.game === 'forest' || b.game === 'both')
      .map((b) => b.key);
    const tiles = makeForest().tiles;
    tiles[2][3] = { kind: 'boon' }; // walking onto the cache triggers the pickup
    useGameStore.setState({ forest: makeForest({ tiles, hp: 20, activeBoons: allForestBoons }) });
    get().forestMove('right');
    const forest = get().forest!;
    expect(forest.player).toMatchObject({ r: 2, c: 3 });
    expect(forest.tiles[2][3].kind).toBe('trail'); // cache still consumed
    expect(forest.status).toBe('active');           // no soft-lock
    expect(forest.pendingBoonChoice).toBeNull();
    expect(forest.hp).toBe(20 + BOON_CONSOLATION_HEAL);
    expect(forest.haul.gold ?? 0).toBe(BOON_CONSOLATION_GOLD);
  });

  it('skipForestBoon dismisses the boon panel without granting a boon', () => {
    useGameStore.setState({
      forest: makeForest({ status: 'choosing', pendingBoonChoice: ['lantern', 'forager'] }),
    });
    get().skipForestBoon();
    expect(get().forest!.status).toBe('active');
    expect(get().forest!.pendingBoonChoice).toBeNull();
    expect(get().forest!.activeBoons).toHaveLength(0);
  });

  it('skipForestBoon is a no-op outside the choosing state', () => {
    const forest = makeForest();
    useGameStore.setState({ forest });
    get().skipForestBoon();
    expect(get().forest).toBe(forest);
  });

  describe('forestStash — mid-run haul banking at clearings', () => {
    // Note: makeForest() places the player at [r:2, c:2].

    it('banks 80% of gold into inventory and resets the run haul, run stays active', () => {
      const tiles = makeForest().tiles;
      tiles[2][2] = { kind: 'clearing' }; // player is at [2,2]
      useGameStore.setState({ forest: makeForest({ tiles, haul: { gold: 100 } }) });
      const goldBefore = get().character.gold;
      get().forestStash();
      expect(get().character.gold).toBe(goldBefore + 80); // 80% of 100
      expect(get().forest).not.toBeNull();                 // run still alive
      expect(get().forest!.status).toBe('active');
      expect(get().forest!.haul.gold ?? 0).toBe(0);       // haul reset
    });

    it('banks 80% of materials into inventory', () => {
      const tiles = makeForest().tiles;
      tiles[2][2] = { kind: 'clearing' };
      useGameStore.setState({ forest: makeForest({ tiles, haul: { materials: { herbs: 10 } } }) });
      const herbsBefore = get().materials.herbs ?? 0;
      get().forestStash();
      expect(get().materials.herbs ?? 0).toBe(herbsBefore + 8); // floor(10 * 0.8)
      expect(get().forest!.haul.materials?.herbs ?? 0).toBe(0);
    });

    it('is a no-op when the player is not on a clearing tile', () => {
      // Default makeForest() places trail at [2,2], so no tile override needed.
      useGameStore.setState({ forest: makeForest({ haul: { gold: 50 } }) });
      const goldBefore = get().character.gold;
      get().forestStash();
      expect(get().character.gold).toBe(goldBefore); // nothing banked
      expect(get().forest!.haul.gold).toBe(50);      // haul unchanged
    });

    it('is a no-op when the haul is empty', () => {
      const tiles = makeForest().tiles;
      tiles[2][2] = { kind: 'clearing' };
      useGameStore.setState({ forest: makeForest({ tiles, haul: {} }) });
      const goldBefore = get().character.gold;
      get().forestStash();
      expect(get().character.gold).toBe(goldBefore);
    });

    it('after stashing, a subsequent death only risks the post-stash remainder', () => {
      const tiles = makeForest().tiles;
      tiles[2][2] = { kind: 'clearing' };
      // Start with 100 gold — stash 80, then die; remaining 0 gold → death keeps 0.
      useGameStore.setState({
        forest: makeForest({
          tiles,
          hp: 3,
          haul: { gold: 100 },
          beasts: [{ id: 'a', key: 'wild_boar', r: 1, c: 2, hp: 8, maxHp: 8, readyAtMs: 999999, asleep: false }],
        }),
      });
      const goldBefore = get().character.gold;
      get().forestStash();
      expect(get().character.gold).toBe(goldBefore + 80); // 80 safely banked
      // Kill the player with two ticks.
      get().forestTick(1000);
      get().forestTick(1000 + FOREST_WINDUP_MS + 50);
      expect(get().forest!.status).toBe('ended');
      get().endForest();
      // The post-stash haul was 0, so death forfeits nothing extra.
      expect(get().character.gold).toBe(goldBefore + 80);
    });
  });

  describe('MINI-38: forest score folds banked gold', () => {
    // Mirrors commitMining: the forest score must include the banked gold so resource-gathering
    // builds score alongside kills. Non-vacuous — fails against the old `scoreValue: run.score`.

    it('live path: bestForestScore = run.score + banked gold (full haul on a clearing)', () => {
      const tiles = makeForest().tiles;
      tiles[2][2] = { kind: 'clearing' }; // player at [2,2] → safe bank tile → full haul kept
      useGameStore.setState({
        forest: makeForest({ tiles, score: 50, haul: { gold: 20 }, deepest: 3 }),
        bestMineScore: 0, bestForestScore: 0,
      });
      get().beginForestBanking();
      get().endForest();
      expect(get().forest).toBeNull();
      expect(get().bestForestScore).toBe(70); // 50 score + 20 banked gold (not 50)
    });

    it('death path: bestForestScore folds the KEPT (post-split) gold', () => {
      useGameStore.setState({
        forest: makeForest({
          hp: 3,
          score: 30,
          haul: { gold: 10 },
          deepest: 2,
          beasts: [{ id: 'a', key: 'wild_boar', r: 2, c: 3, hp: 8, maxHp: 8, readyAtMs: 999999, asleep: false }],
        }),
        bestMineScore: 0, bestForestScore: 0,
      });
      get().forestTick(1000);
      get().forestTick(1000 + FOREST_WINDUP_MS + 50); // wild_boar 4 dmg > 3 hp → 'ended'
      expect(get().forest!.status).toBe('ended');
      get().endForest();
      expect(get().forest).toBeNull();
      expect(get().bestForestScore).toBe(35); // 30 score + floor(10 * 0.5) kept gold (not 30)
    });
  });
});

describe('habit lifecycle', () => {
  it('completeHabit records a per-day log entry and updates streak', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);
    const h = get().habits[0];
    expect(h.log[toISODate()]).toBeDefined();
    expect(h.log[toISODate()].xp).toBe(20);
    expect(h.streak).toBe(1);
  });

  it('cannot complete a retired or suspended habit', () => {
    get().addHabit({ name: 'Run', stat: 'EN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;

    get().retireHabit(id);
    get().completeHabit(id);
    expect(Object.keys(get().habits[0].log)).toHaveLength(0);

    get().reactivateHabit(id);
    get().completeHabit(id);
    expect(Object.keys(get().habits[0].log)).toHaveLength(1);
  });

  it('suspend then normalize auto-resumes once the date has passed', () => {
    get().addHabit({ name: 'Gym', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().suspendHabit(id, '2000-01-01'); // already in the past
    expect(get().habits[0].status).toBe('suspended');
    get().normalizeHabits();
    expect(get().habits[0].status).toBe('active');
  });

  it('an uncapped quantity habit grants XP past the 150% cap', () => {
    get().addHabit({
      name: 'Running',
      stat: 'EN',
      type: 'quantity',
      target: 3,
      uncapped: true,
      frequency: 'as_needed',
      difficulty: 'normal',
    });
    const id = get().habits[0].id;
    get().completeHabit(id, 9); // 9/3 = 3.0 × 20 = 60 (capped would be 30)
    expect(get().character.statXp.EN).toBe(60);
  });
});

describe('updateHabit', () => {
  it('patches name, stat, and difficulty', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().updateHabit(id, { name: 'Read books', stat: 'WI', difficulty: 'hard' });
    const h = get().habits[0];
    expect(h.name).toBe('Read books');
    expect(h.stat).toBe('WI');
    expect(h.difficulty).toBe('hard');
  });

  it('ignores a type change — type is immutable post-creation', () => {
    get().addHabit({ name: 'Run', stat: 'EN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().updateHabit(id, { type: 'quantity' } as never);
    expect(get().habits[0].type).toBe('binary');
  });

  it('leaves existing log entries untouched', () => {
    get().addHabit({ name: 'Gym', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);
    const logBefore = { ...get().habits[0].log };

    get().updateHabit(id, { name: 'Gym (updated)', difficulty: 'epic' });

    expect(get().habits[0].log).toEqual(logBefore);
    expect(get().habits[0].name).toBe('Gym (updated)');
  });

  it('recomputes streak when frequency changes', () => {
    // Set up a "daily" habit with two completed days so streak = 2.
    const day1 = '2025-03-01';
    const day2 = '2025-03-02';
    _setNow(() => new Date(2025, 2, 1)); // March 1
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id, undefined, day1);
    _setNow(() => new Date(2025, 2, 2)); // March 2
    get().completeHabit(id, undefined, day2);
    expect(get().habits[0].streak).toBe(2);

    // Changing to 'as_needed' (no scheduled days) must produce streak 0.
    get().updateHabit(id, { frequency: 'as_needed' });
    expect(get().habits[0].streak).toBe(0);
    _resetNow();
  });
});

// ── Stage 3: Reward Balance ────────────────────────────────────────────────────

/** Minimal mine state shape — commitMining only reads haul, deepest, and score. */
function makeMinimalMine(over: { haul?: Record<string, unknown>; deepest?: number; score?: number; status?: string } = {}) {
  return {
    status: 'active', floor: 1, deepest: over.deepest ?? 0, score: over.score ?? 0,
    haul: over.haul ?? {}, player: { r: 0, c: 0 }, hp: 10, maxHp: 10,
    // Player stands on the entrance (safe tile) so end-banking pays full value (BAL-12).
    tiles: [[{ kind: 'entrance' }]], monsters: [], runes: [], lastHitAtMs: -1000, pickaxePower: 1,
    killsThisFloor: 0, ringOfFire: null, ringNextHitMs: {}, playerStatuses: [],
    lastSpellMs: -1000, nextRuneId: 1, lastDashMs: -2000, dashCooldownMs: 2000,
    moveIntervalMs: 150, agLevel: 0, activeBoons: [], pendingBoonChoice: null,
    weapon: getWeapon(STARTER_WEAPON), knownSpells: [],
  } as never;
}

describe('Skill Trials — energy cost (Stage 3.1)', () => {
  // Use repeatMinigames: true to bypass the stat gate (§4.4) — these tests focus on
  // energy mechanics only; the stat gate is tested separately in Stage 4.4 tests.
  // 6.7: energy is charged at Begin (beginTrial), not on completion.

  it('deducts 1 energy on beginTrial', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    const res = get().beginTrial('lockpicking');
    expect(res).toEqual({ ok: true });
    expect(get().character.energy).toBe(4);
  });

  it('beginTrial is a no-op when energy is 0', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    const nonceBefore = get().trialAttemptNonce;
    const res = get().beginTrial('rooftop_chase');
    expect(res).toEqual({ ok: false, reason: 'energy' });
    expect(get().character.energy).toBe(0);       // no debit
    expect(get().trialAttemptNonce).toBe(nonceBefore); // no state change at all
  });

  it('ignores energy cost when unlimitedEnergy is on', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      settings: { ...get().settings, unlimitedEnergy: true, repeatMinigames: true },
    });
    const res = get().beginTrial('armory_break');
    expect(res).toEqual({ ok: true });
    expect(get().character.energy).toBe(0); // not touched when free
  });

  it('completeTrial does not charge energy again after a successful begin (no double-charge)', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    get().beginTrial('armory_break');
    expect(get().character.energy).toBe(4); // charged once at begin
    get().completeTrial('armory_break', 1);
    expect(get().character.energy).toBe(4); // completion does not debit again
  });
});

describe('Skill Trials — retry integrity (MINI-11)', () => {
  it('beginTrial advances the nonce on success (and charges energy)', () => {
    useGameStore.setState({
      trialAttemptNonce: 0,
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    expect(get().beginTrial('ancient_library')).toEqual({ ok: true });
    expect(get().trialAttemptNonce).toBe(1);
    expect(get().character.energy).toBe(4);
    expect(get().beginTrial('ancient_library')).toEqual({ ok: true });
    expect(get().trialAttemptNonce).toBe(2);
    // Each Begin advances it, so a reopened deterministic trial (Library/Grove) is seeded
    // with a fresh nonce and can't replay the previous attempt's challenge.
  });

  it('completeTrial does not touch the attempt nonce (it advances on start, not finish)', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
      trialAttemptNonce: 7,
    });
    get().completeTrial('lockpicking', 1);
    expect(get().trialAttemptNonce).toBe(7);
  });
});

describe('Skill Trials — charge on start / gate honesty (6.7)', () => {
  it('begin then abandon (no completeTrial) still spends 1 energy — no free reroll', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    expect(get().beginTrial('spirit_grove')).toEqual({ ok: true });
    // Player closes the modal without finishing → no refund.
    expect(get().character.energy).toBe(4);
  });

  it('completeTrial returns true and banks on a clean run', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
      trialsClearedOn: { ...get().trialsClearedOn, lockpicking: 'not-today' },
    });
    const xpBefore = totalXp(get().character.statXp);
    const banked = get().completeTrial('lockpicking', 1);
    expect(banked).toBe(true);
    expect(totalXp(get().character.statXp)).toBeGreaterThan(xpBefore);
  });

  it('completeTrial returns false (not banked) when already cleared today', () => {
    const today = toISODate();
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      // NOTE: repeatMinigames off so the daily-clear idempotency guard is active.
      trialsClearedOn: { ...get().trialsClearedOn, lockpicking: today },
    });
    const xpBefore = totalXp(get().character.statXp);
    const banked = get().completeTrial('lockpicking', 1);
    expect(banked).toBe(false);
    expect(totalXp(get().character.statXp)).toBe(xpBefore); // no reward granted
  });

  it('beginTrial returns { ok:false, reason:"cleared" } when already cleared today', () => {
    const today = toISODate();
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      trialsClearedOn: { ...get().trialsClearedOn, lockpicking: today },
    });
    const res = get().beginTrial('lockpicking');
    expect(res).toEqual({ ok: false, reason: 'cleared' });
    expect(get().character.energy).toBe(5); // refused before charging
  });
});

describe('Skill Trials — Spirit Grove recall bias & mastery gold (MINI-16)', () => {
  it('markSpiritGroveSeen unions and dedups round ids', () => {
    useGameStore.setState({ spiritGroveSeen: [] });
    get().markSpiritGroveSeen(['sg-e1', 'sg-m1']);
    get().markSpiritGroveSeen(['sg-m1', 'sg-h1']); // sg-m1 repeats — must not duplicate
    expect([...get().spiritGroveSeen].sort()).toEqual(['sg-e1', 'sg-h1', 'sg-m1']);
  });

  it('pays a ×1.15 prestige gold bonus once the player has a perfect Spirit Grove best', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5, gold: 0 },
      settings: { ...get().settings, repeatMinigames: true },
      bestTrialScore: { ...get().bestTrialScore, spirit_grove: 1 },
    });
    const base = trialReward('WI', 0.6, get().character.level).gold ?? 0;
    get().completeTrial('spirit_grove', 0.6);
    expect(get().character.gold).toBe(Math.round(base * 1.15));
    expect(get().character.gold).not.toBe(base); // non-vacuous: the bonus actually changed the payout
  });

  it('does not apply the mastery bonus without a perfect best', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5, gold: 0 },
      settings: { ...get().settings, repeatMinigames: true },
      bestTrialScore: { ...get().bestTrialScore, spirit_grove: 0 },
    });
    const base = trialReward('WI', 0.6, get().character.level).gold ?? 0;
    get().completeTrial('spirit_grove', 0.6);
    expect(get().character.gold).toBe(base); // un-multiplied
  });

  it('does not apply the mastery bonus to a non-Grove trial even with a perfect Grove best', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5, gold: 0 },
      settings: { ...get().settings, repeatMinigames: true },
      bestTrialScore: { ...get().bestTrialScore, spirit_grove: 1, lockpicking: 1 },
    });
    const base = trialReward('DX', 0.6, get().character.level).gold ?? 0;
    get().completeTrial('lockpicking', 0.6); // lockpicking = DX; gate is strict on spirit_grove
    expect(get().character.gold).toBe(base); // un-multiplied
  });
});

describe('habit gold reward (Stage 3.3)', () => {
  it('completing a normal habit grants +2 gold and stores it on the entry', () => {
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    const goldBefore = get().character.gold;
    get().completeHabit(id);
    expect(get().character.gold).toBe(goldBefore + 2);
    const today = toISODate();
    expect(get().habits[0].log[today]?.gold).toBe(2);
  });

  it('uncompleting refunds the exact gold stored on the entry', () => {
    get().addHabit({ name: 'Epic Habit', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'epic' });
    const id = get().habits[0].id;
    const goldBefore = get().character.gold;
    get().completeHabit(id);
    expect(get().character.gold).toBe(goldBefore + 10);
    get().uncompleteHabit(id);
    expect(get().character.gold).toBe(goldBefore);
  });

  it('completing an easy habit grants 0 gold', () => {
    get().addHabit({ name: 'Quick task', stat: 'DX', type: 'binary', frequency: 'daily', difficulty: 'easy' });
    const id = get().habits[0].id;
    const goldBefore = get().character.gold;
    get().completeHabit(id);
    expect(get().character.gold).toBe(goldBefore);
  });
});

describe('habitBonus streak multiplier (Stage 3.4)', () => {
  it('defaults to 1.0 with no habits', () => {
    expect(get().character.habitBonus).toBe(1);
  });

  it('rises above 1.0 when ≥75% of scheduled habits have streak ≥ 3', () => {
    const d1 = '2025-01-01'; const d2 = '2025-01-02'; const d3 = '2025-01-03';

    // Create habits on d1 so createdISO = d1 — allows the streak to walk back through d1..d3.
    _setNow(() => new Date(2025, 0, 1));
    get().addHabit({ name: 'H1', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().addHabit({ name: 'H2', stat: 'EN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().addHabit({ name: 'H3', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });

    // Complete all on d1
    for (const h of get().habits) get().completeHabit(h.id, undefined, d1);

    // Advance to d2, complete all
    _setNow(() => new Date(2025, 0, 2));
    for (const h of get().habits) get().completeHabit(h.id, undefined, d2);

    // Advance to d3, complete all — streak = 3, 100% healthy → habitBonus 1.25
    _setNow(() => new Date(2025, 0, 3));
    for (const h of get().habits) get().completeHabit(h.id, undefined, d3);

    expect(get().habits.every((h) => h.streak >= 3)).toBe(true);
    expect(get().character.habitBonus).toBeGreaterThan(1);
    _resetNow();
  });

  it('selectHabitBonusInfo counts only streak-tracked habits on a healthy run', () => {
    // 4 scheduled habits (3 with streak ≥ 3) plus 1 as_needed that must be excluded from both counts.
    get().addHabit({ name: 'A', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().addHabit({ name: 'B', stat: 'EN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().addHabit({ name: 'C', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().addHabit({ name: 'D', stat: 'DX', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().addHabit({ name: 'E', stat: 'CH', type: 'binary', frequency: 'as_needed', difficulty: 'normal' });
    // Assign streaks by name (robust to insertion order): A/B/C healthy, D tracked-but-not-healthy,
    // E as_needed with a high streak that must still be ignored.
    const byName: Record<string, number> = { A: 5, B: 3, C: 4, D: 2, E: 9 };
    useGameStore.setState({
      habits: get().habits.map((h) => ({ ...h, streak: byName[h.name] })),
      character: { ...get().character, habitBonus: 1.15 },
    });
    const info = selectHabitBonusInfo(get());
    expect(info.trackedCount).toBe(4); // E (as_needed) excluded
    expect(info.healthyCount).toBe(3); // D (streak 2) below the ≥3 threshold
    expect(info.bonus).toBe(1.15);
  });

  it('mining gold is multiplied by habitBonus', () => {
    // Inject bonus directly, then run a mine with a known haul and check gold delta.
    // Daily first-descent bonus (3.8) exhausted so this test isolates habitBonus alone.
    useGameStore.setState({ mineDailyBonus: { date: toISODate(), floorsUsed: MINE_DAILY_BONUS_FLOORS } });
    useGameStore.setState({ character: { ...get().character, habitBonus: 1.25 } });
    const goldBefore = get().character.gold;
    useGameStore.setState({ mining: makeMinimalMine({ haul: { gold: 100 } }) });
    get().endMining(); // status 'active' → commitMining → applies habitBonus
    // 100 * 1.25 = 125 gold
    expect(get().character.gold).toBe(goldBefore + 125);
  });
});

describe('minigame trickle split (Stage 3.5)', () => {
  it('mining run ST + EN gains sum to trickle (not doubled)', () => {
    // deepest = 0 → trickle = CRAWLER_XP_BASE (4) → ST:2, EN:2
    const xpBefore = { ...get().character.statXp };
    useGameStore.setState({ mining: makeMinimalMine({ haul: {}, deepest: 0, score: 0 }) });
    get().endMining();
    const stGain = get().character.statXp.ST - xpBefore.ST;
    const enGain = get().character.statXp.EN - xpBefore.EN;
    expect(stGain + enGain).toBe(4); // total = CRAWLER_XP_BASE, not 8
    expect(enGain).toBe(2);          // floor(4/2), not 4 (the old doubled value)
  });
});

describe('minigame-trickle ledger (BAL-09)', () => {
  it('mining commit records its trickle into statXpTrickle, matching the statXp gain', () => {
    const trickleBefore = { ...get().character.statXpTrickle };
    const xpBefore = { ...get().character.statXp };
    useGameStore.setState({ mining: makeMinimalMine({ haul: {}, deepest: 0, score: 0 }) });
    get().endMining();
    const ch = get().character;
    // deepest 0 → trickle 4 → ST:2, EN:2; the SAME amounts must also land in the trickle sub-ledger.
    expect(ch.statXpTrickle.ST - trickleBefore.ST).toBe(ch.statXp.ST - xpBefore.ST);
    expect(ch.statXpTrickle.EN - trickleBefore.EN).toBe(ch.statXp.EN - xpBefore.EN);
    expect(ch.statXpTrickle.ST - trickleBefore.ST).toBe(2);
  });

  it('habit completion adds to statXp but NOT to the trickle ledger', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits.find((h) => h.name === 'Read')!.id;
    const xpBefore = get().character.statXp.KN;
    const trickleBefore = get().character.statXpTrickle.KN;
    get().completeHabit(id);
    expect(get().character.statXp.KN).toBeGreaterThan(xpBefore); // habit XP landed…
    expect(get().character.statXpTrickle.KN).toBe(trickleBefore); // …but is full-weight, not trickle
  });
});

// ---------------------------------------------------------------------------
// Stage 4 — Integrity and Abuse Prevention
// ---------------------------------------------------------------------------

describe('uncapped quantity XP cap at 10× (Stage 4.2)', () => {
  it('completionRatio(uncapped) caps at UNCAPPED_RATIO_CAP, not beyond', () => {
    // Sanity: capped path still tops at COMPLETION_CAP (1.5).
    expect(completionRatio(1000, 1, false)).toBe(COMPLETION_CAP);
    // Uncapped path stops at 10× regardless of how large actual is.
    expect(completionRatio(100, 1, true)).toBe(UNCAPPED_RATIO_CAP);
    expect(completionRatio(10000, 1, true)).toBe(UNCAPPED_RATIO_CAP);
    // Normal uncapped usage well under cap is still linear.
    expect(completionRatio(3, 1, true)).toBe(3);
  });

  it('completing an uncapped habit with 100× actual awards base × 10, not base × 100', () => {
    get().addHabit({
      name: 'Miles run', stat: 'EN', type: 'quantity', frequency: 'daily',
      difficulty: 'normal', target: 1, uncapped: true,
    });
    const id = get().habits[0].id;
    const xpBefore = get().character.statXp.EN;
    get().completeHabit(id, 100); // 100× target
    // normal base = 20, uncapped ratio capped at 10 → 20 * 10 = 200 (not 2000).
    expect(get().character.statXp.EN - xpBefore).toBe(200);
  });
});

describe('Homestead perks — live seams (10.5)', () => {
  it('a completed Bathhouse adds +10 crawler stamina at run start (mine + forest)', () => {
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    const en = get().character.statLevels.EN;
    // Baseline (no buildings): maxSta == dungeonStamina(EN) — starter gear adds no EN.
    get().beginMining();
    expect(get().mining!.maxSta).toBe(dungeonStamina(en));
    useGameStore.setState({ mining: null });
    get().beginForest();
    expect(get().forest!.maxSta).toBe(dungeonStamina(en));
    // Seed a completed Bathhouse (perks derive from buildings only — placement not needed).
    useGameStore.setState({
      mining: null, forest: null,
      character: { ...get().character, energy: 10 },
      town: { ...get().town, buildings: [{ id: 'bh', key: 'bathhouse', r: 0, c: 0, tier: 1 }] },
    });
    get().beginMining();
    expect(get().mining!.maxSta).toBe(dungeonStamina(en) + 10);
    useGameStore.setState({ mining: null });
    get().beginForest();
    expect(get().forest!.maxSta).toBe(dungeonStamina(en) + 10);
  });

  it('a Training Yard turns a trial cleared today into a free Practice run', () => {
    const today = toISODate();
    get().addHabit({ name: 'DX', stat: 'DX', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().completeHabit(get().habits[0].id); // same-stat completion (stat gate) + trial cleared marker below
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      trialsClearedOn: { ...get().trialsClearedOn, lockpicking: today },
      town: { ...get().town, buildings: [{ id: 'ty', key: 'training_yard', r: 0, c: 0, tier: 1 }] },
    });
    const nonceBefore = get().trialAttemptNonce;
    const res = get().beginTrial('lockpicking');
    expect(res).toEqual({ ok: true, practice: true });
    expect(get().character.energy).toBe(5);                 // free — no energy charged
    expect(get().trialAttemptNonce).toBe(nonceBefore + 1);  // nonce still bumps for a fresh draw
    // completeTrial still refuses to re-bank a same-day clear → practice pays no reward.
    expect(get().completeTrial('lockpicking', 1)).toBe(false);
  });

  it('a completed Granary raises the energy cap: grant fires at 15/16, clamp settles at 17', () => {
    get().addHabit({ name: 'ST', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    useGameStore.setState({
      character: { ...get().character, energy: MAX_ENERGY }, // 15 — the old ceiling
      town: { ...get().town, buildings: [{ id: 'gr', key: 'granary', r: 0, c: 0, tier: 1 }] },
    });
    expect(maxEnergyFor(get())).toBe(MAX_ENERGY + 2); // 17
    get().completeHabit(id);
    expect(get().character.energy).toBe(MAX_ENERGY + 1); // grant allowed at 15 → 16 (below raised cap)
  });

  it('the Granary clamp settles above-cap energy to 17, not 15', () => {
    get().addHabit({ name: 'ST', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    useGameStore.setState({
      character: { ...get().character, energy: 99 }, // above any cap
      town: { ...get().town, buildings: [{ id: 'gr', key: 'granary', r: 0, c: 0, tier: 1 }] },
    });
    get().completeHabit(id);
    expect(get().character.energy).toBe(MAX_ENERGY + 2); // clamped to 17, not 15
  });
});

describe('MAX_ENERGY clamp (Stage 4.3)', () => {
  it('energy cannot exceed MAX_ENERGY after completeHabit', () => {
    // Seed at the cap, then complete a habit — energy should stay at MAX_ENERGY, not exceed it.
    get().addHabit({ name: 'Push', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    useGameStore.setState({ character: { ...get().character, energy: MAX_ENERGY } });
    get().completeHabit(id);
    expect(get().character.energy).toBe(MAX_ENERGY); // not MAX_ENERGY + 1
  });
});

describe('stat gate on Skill Trials (Stage 4.4)', () => {
  // 6.7: the stat gate now lives on beginTrial (it charges energy after all gates pass).
  afterEach(() => _resetNow());

  it('beginTrial is blocked when no habit of that stat was logged in the last 7 days', () => {
    // No habits at all → lockpicking (DX) is blocked, and no energy is spent.
    useGameStore.setState({ character: { ...get().character, energy: 5 } });
    const res = get().beginTrial('lockpicking');
    expect(res).toEqual({ ok: false, reason: 'stat' });
    expect(get().character.energy).toBe(5); // gate refused before charging
  });

  it('beginTrial succeeds after completing a same-stat habit today', () => {
    // Add a DX habit and complete it today.
    get().addHabit({ name: 'DX work', stat: 'DX', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().completeHabit(get().habits[0].id);
    useGameStore.setState({ character: { ...get().character, energy: 5 } });
    const res = get().beginTrial('lockpicking'); // lockpicking = DX stat
    expect(res).toEqual({ ok: true });
    expect(get().character.energy).toBe(4);
  });

  it('beginTrial is blocked when the only same-stat completion is 8 days old', () => {
    const today = toISODate();
    const eightDaysAgo = addDays(today, -8); // outside the 7-day window
    get().addHabit({ name: 'DX old', stat: 'DX', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    // Manually inject a log entry that is 8 days old.
    useGameStore.setState({
      habits: get().habits.map((h) => ({
        ...h,
        log: { [eightDaysAgo]: { xp: 20 } },
        lastCompletedISO: eightDaysAgo,
      })),
      character: { ...get().character, energy: 5 },
    });
    const res = get().beginTrial('lockpicking');
    expect(res).toEqual({ ok: false, reason: 'stat' }); // outside window → blocked
    expect(get().character.energy).toBe(5);
  });

  it('completeTrial no longer stat-gates — it banks regardless of recent same-stat habits', () => {
    // No same-stat habit in the window, but completeTrial (post-play) must still bank.
    useGameStore.setState({ character: { ...get().character, energy: 5 } });
    const xpBefore = totalXp(get().character.statXp);
    const banked = get().completeTrial('lockpicking', 1);
    expect(banked).toBe(true);
    expect(totalXp(get().character.statXp)).toBeGreaterThan(xpBefore);
  });

  it('repeatMinigames bypasses the stat gate on beginTrial (dev bypass)', () => {
    // No habits at all, but repeatMinigames is on — begin should succeed.
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    expect(get().beginTrial('lockpicking')).toEqual({ ok: true });
    expect(get().character.energy).toBe(4);
  });

  it('statCompletedWithin returns true within the window and false outside', () => {
    const today = '2026-06-20';
    const habit = {
      id: 'h1', name: 'DX habit', stat: 'DX' as const, type: 'binary' as const,
      frequency: 'daily' as const, difficulty: 'normal' as const, status: 'active' as const,
      streak: 0, createdISO: '2026-01-01',
      log: { '2026-06-14': { xp: 20 } }, // 6 days ago — inside the 7-day window
      lastCompletedISO: '2026-06-14',
    };
    expect(statCompletedWithin([habit], 'DX', today, 7)).toBe(true);
    // 8 days ago → outside window.
    const old = { ...habit, log: { '2026-06-12': { xp: 20 } }, lastCompletedISO: '2026-06-12' };
    expect(statCompletedWithin([old], 'DX', today, 7)).toBe(false);
    // Wrong stat → false.
    expect(statCompletedWithin([habit], 'ST', today, 7)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stage 5 — Party and Accountability
// ---------------------------------------------------------------------------

describe('claimPartyQuestReward (Stage 5.1)', () => {
  const get = () => useGameStore.getState();

  it('credits flat gold on first claim', () => {
    useGameStore.setState({ character: { ...get().character, gold: 0 }, claimedPartyQuests: [] });
    get().claimPartyQuestReward('quest-1', 4); // reward = min(200, 50 + 40) = 90
    expect(get().character.gold).toBe(90);
    expect(get().claimedPartyQuests).toContain('quest-1');
  });

  it('is idempotent — second call with the same questId is a no-op', () => {
    useGameStore.setState({ character: { ...get().character, gold: 0 }, claimedPartyQuests: ['quest-1'] });
    get().claimPartyQuestReward('quest-1', 4);
    expect(get().character.gold).toBe(0); // gold unchanged
  });

  it('caps reward at 200 regardless of memberCount', () => {
    useGameStore.setState({ character: { ...get().character, gold: 0 }, claimedPartyQuests: [] });
    get().claimPartyQuestReward('quest-big', 50); // 50 + 500 = 550 → capped at 200
    expect(get().character.gold).toBe(200);
  });
});

describe('beginTactics tier selection (MINI-08)', () => {
  it('clamps the chosen tier to [TACTICS_UNLOCK_LEVEL, character.level]', () => {
    useGameStore.setState({
      character: { ...get().character, level: 7 },
      settings: { ...get().settings, unlimitedEnergy: true },
      tactics: null,
    });
    // Below the unlock floor (4) → clamps up.
    get().beginTactics(undefined, 2);
    expect(get().tactics!.tier).toBe(4);

    // Above the character's level → clamps down to the level.
    useGameStore.setState({ tactics: null });
    get().beginTactics(undefined, 9);
    expect(get().tactics!.tier).toBe(7);

    // A valid pick passes through unchanged.
    useGameStore.setState({ tactics: null });
    get().beginTactics(undefined, 5);
    expect(get().tactics!.tier).toBe(5);

    // Default (no pick) uses the character's level — today's behaviour.
    useGameStore.setState({ tactics: null });
    get().beginTactics();
    expect(get().tactics!.tier).toBe(7);
  });

  it('beginTacticsCoop still auto-derives tier from level (no picker)', () => {
    useGameStore.setState({ character: { ...get().character, level: 7 }, tactics: null });
    const s = get();
    const hostHero: HeroOpts = {
      fighter: fighterFor(s), ag: s.character.statLevels.AG, knownSpells: s.knownSpells, id: 'p0',
    };
    get().beginTacticsCoop({ heroes: [hostHero], seed: 7 });
    expect(get().tactics!.tier).toBe(7);
  });
});

describe('commitTactics material bundle + clone (BAL-10)', () => {
  it('a win banks the tier-scaled material bundle and clones state.materials (no aliasing)', () => {
    useGameStore.setState({
      character: { ...get().character, level: 6 },
      materials: {},
      // Minimal won run — tacticsReward only reads status/radius/tier/objective/enemies.
      tactics: { radius: 3, tier: 5, status: 'won', objective: null, enemies: [] } as unknown as HexBattleState,
    });
    const matsBefore = get().materials;
    get().endTactics();
    expect(get().tactics).toBeNull();
    // Bundle landed: qty = 1 + floor(5/4) = 2 of each.
    expect(get().materials.cloth_roll).toBe(2);
    expect(get().materials.bronze_bar).toBe(2);
    // cloneMaterials:true → applyReward mutated a fresh object, not the prior snapshot.
    expect(get().materials).not.toBe(matsBefore);
    expect(matsBefore).toEqual({}); // prior snapshot untouched (proves no in-place aliasing)
  });
});

describe('tacticsSeenFoes bestiary ledger', () => {
  it('endTactics records every fielded templateId — dead foes and prior discoveries included', () => {
    useGameStore.setState({
      character: { ...get().character, level: 6 },
      tacticsSeenFoes: ['goblin'],
      // endTactics only needs enemies[].templateId beyond what commitTactics reads.
      tactics: {
        radius: 3, tier: 5, status: 'won', objective: null,
        enemies: [
          { templateId: 'skeleton', hp: 0 },   // slain foes still count as encountered
          { templateId: 'dire_wolf', hp: 12 },
          { templateId: 'goblin', hp: 0 },     // repeat encounters don't duplicate
        ],
      } as unknown as HexBattleState,
    });
    get().endTactics();
    expect(get().tactics).toBeNull();
    expect([...get().tacticsSeenFoes].sort()).toEqual(['dire_wolf', 'goblin', 'skeleton']);
  });
});

describe('beginTacticsCoop no-op invariant (MP-10)', () => {
  it('returns the existing board unchanged when a tactics fight already exists', () => {
    // MP-10 leans on this contract: once a board exists, beginTacticsCoop is a
    // no-op (same reference), so the store subscription never re-broadcasts. The
    // Tactics host-join handler therefore resends the current state directly for a
    // rejoin/reconnect/second-guest instead of relying on a second beginTacticsCoop.
    const sentinel = { board: 'existing' } as never;
    useGameStore.setState({ tactics: sentinel });
    get().beginTacticsCoop({ heroes: [], seed: 7 });
    expect(get().tactics).toBe(sentinel); // unchanged → no mutation → no broadcast
  });
});

describe('crafting & equipment', () => {
  it('crafts gear, consuming materials and gold', () => {
    useGameStore.setState({
      materials: { iron_bar: 1, crystals: 1 },
      character: { ...get().character, gold: 30 },
    });
    get().craft('scholars_lantern'); // needs iron_bar:1, crystals:1, gold:30
    expect(get().ownedGear).toContain('scholars_lantern');
    expect(get().materials.iron_bar).toBe(0);
    expect(get().materials.crystals).toBe(0);
    expect(get().character.gold).toBe(0);
  });

  it('crafts each new late-tier recipe, consuming exact materials and gold', () => {
    useGameStore.setState({
      materials: { obsidian: 7, frost_quartz: 4, iron_bar: 2, amber_resin: 3, crystals: 2 },
      character: { ...get().character, gold: 380 },
    });

    get().craft('mithril_pickaxe'); // obsidian:4, frost_quartz:2, gold:150
    expect(get().ownedGear).toContain('mithril_pickaxe');
    expect(get().materials.obsidian).toBe(3);
    expect(get().materials.frost_quartz).toBe(2);
    expect(get().character.gold).toBe(230);

    get().craft('obsidian_plate'); // obsidian:3, frost_quartz:2, iron_bar:2, gold:130
    expect(get().ownedGear).toContain('obsidian_plate');
    expect(get().materials.obsidian).toBe(0);
    expect(get().materials.frost_quartz).toBe(0);
    expect(get().materials.iron_bar).toBe(0);
    expect(get().character.gold).toBe(100);

    get().craft('resin_trinket'); // amber_resin:3, crystals:2, gold:100
    expect(get().ownedGear).toContain('resin_trinket');
    expect(get().materials.amber_resin).toBe(0);
    expect(get().materials.crystals).toBe(0);
    expect(get().character.gold).toBe(0);
  });

  it('will not craft without enough materials', () => {
    useGameStore.setState({ materials: { leather: 1 } }); // leather_vest needs 3
    get().craft('leather_vest');
    expect(get().ownedGear).not.toContain('leather_vest');
    expect(get().materials.leather).toBe(1); // unchanged
  });

  it('equips gear into the right slot and unequips it', () => {
    useGameStore.setState({ ownedGear: ['sage_ring'] });
    get().equipGear('sage_ring');
    expect(get().equipment.trinket).toBe('sage_ring');
    get().unequipGear('trinket');
    expect(get().equipment.trinket).toBeNull();
  });

  it('will not equip unowned gear', () => {
    get().equipGear('bronze_plate');
    expect(get().equipment.armor).toBeNull();
  });

  it('buys and equips gear from the shop', () => {
    useGameStore.setState({ character: { ...get().character, gold: 200 } });
    get().buyGear('iron_pickaxe');
    expect(get().ownedGear).toContain('iron_pickaxe');
    expect(get().character.gold).toBe(0); // 200 - 200
    get().equipGear('iron_pickaxe');
    expect(get().equipment.tool).toBe('iron_pickaxe');
  });

  it('will not buy gear without enough gold, and never double-buys', () => {
    useGameStore.setState({ character: { ...get().character, gold: 50 }, ownedGear: [] });
    get().buyGear('iron_pickaxe'); // costs 200
    expect(get().ownedGear).not.toContain('iron_pickaxe');
    expect(get().character.gold).toBe(50); // unchanged

    useGameStore.setState({ character: { ...get().character, gold: 500 } });
    get().buyGear('iron_pickaxe');
    get().buyGear('iron_pickaxe'); // second buy is a no-op
    expect(get().ownedGear.filter((k) => k === 'iron_pickaxe')).toHaveLength(1);
    expect(get().character.gold).toBe(300); // charged exactly once
  });

  it('equipped gear boosts matching habit XP', () => {
    useGameStore.setState({
      ownedGear: ['scholars_lantern'],
      equipment: { armor: null, trinket: 'scholars_lantern', tool: null },
    });
    get().addHabit({ name: 'Study Spanish', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal', tag: 'Study' });
    const id = get().habits[0].id;
    get().completeHabit(id);
    expect(get().character.statXp.KN).toBe(22); // 20 × 1.10 (Scholar's Lantern, Study)
  });
});

describe('loadout: weapons & spells', () => {
  it('starts with a worn sword and the starter spells', () => {
    expect(get().equippedWeapon).toBe('worn_sword');
    expect(get().knownSpells).toEqual(['sparks', 'mend']);
    expect(get().ownedWeapons).toContain('worn_sword');
  });

  it('buys and equips a weapon', () => {
    useGameStore.setState({ character: { ...get().character, gold: 200 } });
    get().buyWeapon('short_bow');
    expect(get().ownedWeapons).toContain('short_bow');
    expect(get().character.gold).toBe(145); // 200 - 55 (BAL-15: short_bow price cut 120→55)
    get().equipWeapon('short_bow');
    expect(get().equippedWeapon).toBe('short_bow');
  });

  it('will not equip an unowned weapon', () => {
    get().equipWeapon('iron_mace');
    expect(get().equippedWeapon).toBe('worn_sword');
  });

  it('learns a spell from a spellbook, consuming it', () => {
    useGameStore.setState({ inventory: { spellbook_firebolt: 1 } });
    get().learnFromSpellbook('spellbook_firebolt');
    expect(get().knownSpells).toContain('firebolt');
    expect(get().inventory['spellbook_firebolt']).toBe(0);
  });
});
