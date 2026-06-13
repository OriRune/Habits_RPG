import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../useGameStore';
import { emptyStatXP } from '@/engine/stats';
import { type BattleState } from '@/engine/combat';

const get = () => useGameStore.getState();

beforeEach(() => {
  get().resetGame();
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

  it('queues a Level-Up Trial once XP crosses the level-2 threshold', () => {
    // 5 epic habits = 250 XP > 100 needed for level 2.
    for (let i = 0; i < 5; i++) {
      get().addHabit({ name: `H${i}`, stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'epic' });
    }
    for (const h of get().habits) get().completeHabit(h.id);

    expect(get().character.level).toBe(1); // not auto-leveled
    expect(get().pendingLevelUp).toBe(2); // boss queued
  });
});

describe('level-up trial resolution', () => {
  it('winning commits the level and grants boss rewards', () => {
    useGameStore.setState({ pendingLevelUp: 2 });
    const wonBattle: BattleState = {
      bossId: 'x',
      bossName: 'Trial',
      bossMaxHp: 100,
      bossHp: 0,
      bossAttack: 5,
      bossDefense: 0,
      weakTo: [],
      playerMaxHp: 60,
      playerHp: 40,
      defending: false,
      buffs: {},
      log: [],
      status: 'won',
      consumedItems: [],
    };
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
});
