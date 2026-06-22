import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useGameStore, totalXp, withCharacterDefaults, type DungeonRun } from '../useGameStore';
import { STAT_IDS, emptyStatXP } from '@/engine/stats';
import { levelForTotalXp } from '@/engine/leveling';
import { bossForLevel } from '@/engine/bosses';
import { type BattleState } from '@/engine/combat';
import { type DungeonRoom, merchantOffers } from '@/engine/dungeon';
import { type FloorMap } from '@/engine/dungeonMap';
import { type MineState, type MineTile } from '@/engine/mining';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import { STA_REGEN_MS, MP_REGEN_MS } from '@/engine/crawl';
import { type ForestState, type ForestTile, FOREST_WINDUP_MS } from '@/engine/forest';
import { getEncounter, startEncounter } from '@/engine/encounters';
import { toISODate, weekKey, _setNow, _resetNow, addDays } from '@/engine/date';
import { MAX_ENERGY } from '../shared';
import { completionRatio, COMPLETION_CAP, UNCAPPED_RATIO_CAP } from '@/engine/xp';
import { statCompletedWithin } from '@/engine/habits';

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
});

describe('completeHabit', () => {
  it('grants XP to the habit stat, energy, and logs the completion', () => {
    get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().completeHabit(id);

    expect(get().character.statXp.KN).toBe(20);
    expect(get().character.energy).toBe(1);
    expect(get().habits[0].streak).toBe(1);
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

  it('honors a manual reward override', () => {
    get().createCustomChallenge({ name: 'Override', kind: 'count', goal: 5, durationDays: 7 }, { gold: 12 });
    expect(get().customChallenges[0].reward).toEqual({ gold: 12 });
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

  it('consumes a streak freeze to protect a habit', () => {
    useGameStore.setState({ inventory: { streak_freeze: 1 } });
    get().addHabit({ name: 'Meditate', stat: 'WI', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const id = get().habits[0].id;
    get().useStreakFreeze(id);
    expect(get().inventory['streak_freeze']).toBe(0);
    expect(get().habits[0].lastCompletedISO).toBeDefined();
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
    expect(run.bankedReward.gold).toBe(20); // floor loot locked in
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
  });

  it('rest: healing restores HP; fortify offers a boon', () => {
    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'rest' }, { type: 'combat' }], hp: 40, maxHp: 100 }) });
    get().dungeonRest('heal');
    expect(get().dungeon!.hp).toBe(80); // +40% of max

    useGameStore.setState({ dungeon: makeRun({ rooms: [{ type: 'rest' }, { type: 'combat' }] }) });
    get().dungeonRest('fortify');
    expect(get().dungeon!.pendingBoon).not.toBeNull();
  });

  it('fleeing keeps all gathered loot; defeat forfeits most of the floor', () => {
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
    expect(get().dungeon!.bankedReward.gold).toBe(100); // clean escape keeps it all

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
  });

  it('beginMining has no level gate — a fresh level-1 character can enter', () => {
    // Level limit removed: only energy (and the unlimitedEnergy bypass) gates entry now.
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    get().beginMining();
    expect(get().mining).not.toBeNull();
  });

  it('mineStrike breaks the faced ore vein and accrues the haul', () => {
    const tiles = makeMine().tiles;
    tiles[2][3] = { kind: 'ore', oreKey: 'rubble', durability: 1 };
    useGameStore.setState({ mining: makeMine({ tiles }) });
    get().mineStrike();
    expect(get().mining!.tiles[2][3].kind).toBe('floor');
    expect(get().mining!.haul.gold ?? 0).toBeGreaterThan(0);
  });

  it('endMining banks the haul into the economy and records the deepest floor', () => {
    useGameStore.setState({ mining: makeMine({ haul: { gold: 50, materials: { iron_bar: 3 } }, deepest: 4 }) });
    const goldBefore = get().character.gold;
    const ironBefore = get().materials.iron_bar ?? 0;
    get().endMining();
    expect(get().mining).toBeNull();
    expect(get().character.gold).toBe(goldBefore + 50);
    expect(get().materials.iron_bar).toBe(ironBefore + 3);
    expect(get().deepestMineFloor).toBe(4);
    expect(get().character.statXp.ST).toBeGreaterThan(0); // labour trickle
  });

  it('mineTick flips to ended on death; endMining then banks the haul', () => {
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

  it('persists at version 24', () => {
    expect(useGameStore.persist.getOptions().version).toBe(24);
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

  it('forestAct gathers a faced node into the haul', () => {
    const tiles = makeForest().tiles;
    tiles[2][3] = { kind: 'node', nodeKey: 'flower_bush' };
    useGameStore.setState({ forest: makeForest({ tiles }) });
    get().forestAct();
    expect(get().forest!.tiles[2][3].kind).toBe('trail');
    expect(get().forest!.haul.materials?.herbs ?? 0).toBeGreaterThan(0);
  });

  it('beginForestBanking shows the summary, and endForest banks the full haul', () => {
    useGameStore.setState({ forest: makeForest({ haul: { gold: 20, materials: { herbs: 3 } }, deepest: 3 }) });
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
    tiles: [], monsters: [], runes: [], lastHitAtMs: -1000, pickaxePower: 1,
    killsThisFloor: 0, ringOfFire: null, ringNextHitMs: {}, playerStatuses: [],
    lastSpellMs: -1000, nextRuneId: 1, lastDashMs: -2000, dashCooldownMs: 2000,
    moveIntervalMs: 150, agLevel: 0, activeBoons: [], pendingBoonChoice: null,
    weapon: getWeapon(STARTER_WEAPON), knownSpells: [],
  } as never;
}

describe('Skill Trials — energy cost (Stage 3.1)', () => {
  // Use repeatMinigames: true to bypass the stat gate (§4.4) — these tests focus on
  // energy mechanics only; the stat gate is tested separately in Stage 4.4 tests.

  it('deducts 1 energy on completeTrial', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    get().completeTrial('lockpicking', 1);
    expect(get().character.energy).toBe(4);
  });

  it('completeTrial is a no-op when energy is 0', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    const xpBefore = totalXp(get().character.statXp);
    get().completeTrial('rooftop_chase', 1);
    expect(totalXp(get().character.statXp)).toBe(xpBefore);
    expect(get().character.energy).toBe(0);
  });

  it('ignores energy cost when unlimitedEnergy is on', () => {
    useGameStore.setState({
      character: { ...get().character, energy: 0 },
      settings: { ...get().settings, unlimitedEnergy: true, repeatMinigames: true },
    });
    const xpBefore = totalXp(get().character.statXp);
    get().completeTrial('armory_break', 1);
    expect(totalXp(get().character.statXp)).toBeGreaterThan(xpBefore);
    expect(get().character.energy).toBe(0); // not touched when free
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

  it('mining gold is multiplied by habitBonus', () => {
    // Inject bonus directly, then run a mine with a known haul and check gold delta.
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
  afterEach(() => _resetNow());

  it('completeTrial is blocked when no habit of that stat was logged in the last 7 days', () => {
    // No habits at all → lockpicking (DX) is blocked.
    useGameStore.setState({ character: { ...get().character, energy: 5 } });
    const xpBefore = totalXp(get().character.statXp);
    get().completeTrial('lockpicking', 1);
    expect(totalXp(get().character.statXp)).toBe(xpBefore); // no-op
  });

  it('completeTrial succeeds after completing a same-stat habit today', () => {
    // Add a DX habit and complete it today.
    get().addHabit({ name: 'DX work', stat: 'DX', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().completeHabit(get().habits[0].id);
    useGameStore.setState({ character: { ...get().character, energy: 5 } });
    const xpBefore = totalXp(get().character.statXp);
    get().completeTrial('lockpicking', 1); // lockpicking = DX stat
    expect(totalXp(get().character.statXp)).toBeGreaterThan(xpBefore);
  });

  it('completeTrial is blocked when the only same-stat completion is 8 days old', () => {
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
    const xpBefore = totalXp(get().character.statXp);
    get().completeTrial('lockpicking', 1);
    expect(totalXp(get().character.statXp)).toBe(xpBefore); // outside window → blocked
  });

  it('repeatMinigames bypasses the stat gate (dev bypass)', () => {
    // No habits at all, but repeatMinigames is on — trial should succeed.
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      settings: { ...get().settings, repeatMinigames: true },
    });
    const xpBefore = totalXp(get().character.statXp);
    get().completeTrial('lockpicking', 1);
    expect(totalXp(get().character.statXp)).toBeGreaterThan(xpBefore);
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
    expect(get().character.gold).toBe(80); // 200 - 120
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
