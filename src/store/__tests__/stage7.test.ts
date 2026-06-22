/**
 * Stage 7 unit tests.
 *
 * 7.2 — importHabits: merge-by-id logic + completionLog recomputation
 * 7.3 — computeQuestTotal: kind-aware party quest delta computation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useGameStore } from '../useGameStore';
import { computeQuestTotal } from '@/hooks/useParty';
import { _setNow, _resetNow } from '@/engine/date';
import type { Habit } from '@/engine/habits';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    name: 'Test',
    stat: 'KN',
    type: 'binary',
    frequency: 'daily',
    difficulty: 'normal',
    status: 'active',
    streak: 0,
    log: {},
    createdISO: '2026-06-01',
    ...over,
  };
}

function entry(xp = 20, amount?: number) {
  return amount !== undefined ? { xp, amount } : { xp };
}

// ---------------------------------------------------------------------------
// 7.2 — importHabits
// ---------------------------------------------------------------------------

describe('importHabits (7.2)', () => {
  beforeEach(() => {
    _setNow(() => new Date('2026-06-22T12:00:00Z'));
    // Reset to a fresh store state.
    useGameStore.getState().resetGame();
  });

  afterEach(() => {
    _resetNow();
  });

  it('appends new habits that do not exist in the store', () => {
    const store = useGameStore.getState();
    const newHabit = makeHabit({ id: 'new1', name: 'Run' });
    store.importHabits([newHabit]);
    const habits = useGameStore.getState().habits;
    expect(habits.some((h) => h.id === 'new1')).toBe(true);
  });

  it('replaces an existing habit with the same id', () => {
    const store = useGameStore.getState();
    store.addHabit({ name: 'Old name', stat: 'ST', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    const existingId = useGameStore.getState().habits[0].id;

    const updated = makeHabit({ id: existingId, name: 'New name' });
    store.importHabits([updated]);

    const habits = useGameStore.getState().habits;
    const found = habits.find((h) => h.id === existingId);
    expect(found?.name).toBe('New name');
    // No duplicate entries
    expect(habits.filter((h) => h.id === existingId).length).toBe(1);
  });

  it('recomputes completionLog from merged habits', () => {
    const h1 = makeHabit({
      id: 'h-a',
      log: { '2026-06-20': entry(20), '2026-06-21': entry(20) },
    });
    const h2 = makeHabit({
      id: 'h-b',
      log: { '2026-06-21': entry(20), '2026-06-22': entry(20) },
    });
    useGameStore.getState().importHabits([h1, h2]);
    const { completionLog } = useGameStore.getState();
    // 2026-06-20: only h1 → 1
    expect(completionLog['2026-06-20']).toBe(1);
    // 2026-06-21: h1 + h2 → 2
    expect(completionLog['2026-06-21']).toBe(2);
    // 2026-06-22: only h2 → 1
    expect(completionLog['2026-06-22']).toBe(1);
  });

  it('does not create duplicate habits when importing the same file twice', () => {
    const h = makeHabit({ id: 'dup', name: 'Meditation' });
    useGameStore.getState().importHabits([h]);
    useGameStore.getState().importHabits([h]);
    const habits = useGameStore.getState().habits;
    expect(habits.filter((x) => x.id === 'dup').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7.3 — computeQuestTotal (pure, no store coupling)
// ---------------------------------------------------------------------------

describe('computeQuestTotal (7.3)', () => {
  const knHabit = makeHabit({
    id: 'kn1',
    stat: 'KN',
    log: { '2026-06-20': entry(20), '2026-06-21': entry(20) },
  });
  const stHabit = makeHabit({
    id: 'st1',
    stat: 'ST',
    log: { '2026-06-21': entry(35) },
  });
  const qHabit = makeHabit({
    id: 'q1',
    stat: 'EN',
    type: 'quantity',
    log: {
      '2026-06-20': entry(15, 10),
      '2026-06-21': entry(20, 20),
    },
  });

  const habits = [knHabit, stHabit, qHabit];
  const completionLog: Record<string, number> = {
    '2026-06-20': 2,
    '2026-06-21': 3,
  };

  it('count kind: sums completionLog values', () => {
    expect(computeQuestTotal(habits, completionLog, 'count', null)).toBe(5); // 2+3
  });

  it('class kind with matching stat: counts log entries for that stat only', () => {
    // KN habit has 2 entries, ST has 1 → KN only → 2
    expect(computeQuestTotal(habits, completionLog, 'class', 'KN')).toBe(2);
    expect(computeQuestTotal(habits, completionLog, 'class', 'ST')).toBe(1);
  });

  it('class kind with no matching stat: returns 0', () => {
    expect(computeQuestTotal(habits, completionLog, 'class', 'CH')).toBe(0);
  });

  it('quantity kind: sums amount fields across all habits', () => {
    // q1 has amount 10 + 20 = 30
    expect(computeQuestTotal(habits, completionLog, 'quantity', null)).toBe(30);
  });

  it('quantity kind: treats missing amount as 0', () => {
    // binary habits have no amount — should not contribute
    const mixedHabits = [knHabit, stHabit, qHabit];
    expect(computeQuestTotal(mixedHabits, completionLog, 'quantity', null)).toBe(30);
  });

  it('falls back to count for unrecognised / null kind', () => {
    expect(computeQuestTotal(habits, completionLog, null, null)).toBe(5);
    expect(computeQuestTotal(habits, completionLog, 'streak', null)).toBe(5);
  });
});
