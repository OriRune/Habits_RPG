import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../useGameStore';
import { selectTownPerks } from '../selectors';
import { freshTown, townPerks, queueBuild, canPlace, type TownProject } from '@/engine/town';
import { TOWN_BUILDINGS } from '@/content/townBuildings';
import { toISODate, _setNow, _resetNow, addDays } from '@/engine/date';
import { MAX_ENERGY, maxEnergyFor } from '../shared';
import { merchantOffers } from '@/engine/dungeon';
import { strikeSweetHalf } from '@/engine/crafting/forge';
import { sightRadiusFor, MINE_SIGHT_RADIUS } from '@/engine/mining';
import { dungeonStamina } from '@/engine/crawl';
import { useToastStore } from '@/store/useToastStore';

// Homestead labor pipeline (plan3 item 10.2 / M2, BAL-22). Labor accrues on the live
// habit-completion path with its own marker, day-capped at 24, and claws back on uncomplete.
const get = () => useGameStore.getState();

beforeEach(() => {
  get().resetGame();
  useToastStore.setState({ toasts: [] });
});

function addHabit(difficulty: 'easy' | 'normal' | 'hard' | 'epic'): string {
  get().addHabit({ name: 'H', stat: 'ST', type: 'binary', frequency: 'daily', difficulty });
  const habits = get().habits;
  return habits[habits.length - 1].id;
}

describe('Homestead labor pipeline (M2)', () => {
  it('grants difficulty-scaled labor once per habit per day; a second habit also grants', () => {
    const easy = addHabit('easy');
    get().completeHabit(easy);
    expect(get().town.laborBank).toBe(1); // easy → 1

    const hard = addHabit('hard');
    get().completeHabit(hard); // second, distinct habit still grants
    expect(get().town.laborBank).toBe(5); // 1 + 4

    get().completeHabit(easy); // same habit again same day → no-op (already logged)
    expect(get().town.laborBank).toBe(5);
  });

  it('grants no labor for a backdated completion', () => {
    _setNow(() => new Date(2025, 5, 10));
    const id = addHabit('epic');
    const yesterday = addDays(toISODate(), -1);
    get().completeHabit(id, undefined, yesterday);
    expect(get().town.laborBank).toBe(0);
    expect(get().town.laborToday).toBe(0);
    _resetNow();
  });

  it('claws back labor on uncomplete (bank drains, clamped ≥ 0) and does not re-mint on same-day re-complete', () => {
    const id = addHabit('normal'); // labor 2
    get().completeHabit(id);
    expect(get().town.laborBank).toBe(2);

    get().uncompleteHabit(id);
    expect(get().town.laborBank).toBe(0); // drained bank-first, clamped

    get().completeHabit(id); // same-day re-complete — marker survived, must NOT re-mint
    expect(get().town.laborBank).toBe(0);
  });

  it('still grants labor on a day the energy bar is capped (markers independent)', () => {
    useGameStore.setState({ character: { ...get().character, energy: MAX_ENERGY } });
    const id = addHabit('hard');
    get().completeHabit(id);
    expect(get().character.energy).toBe(MAX_ENERGY); // energy grant swallowed at cap
    expect(get().town.laborBank).toBe(4); // labor still accrues
  });

  it('honours the daily cap: only the remainder credits, and the cap toast fires when swallowed whole', () => {
    // Seed labor 1 point below the cap for today.
    useGameStore.setState({
      town: { ...freshTown(), laborISO: toISODate(), laborToday: 23 },
    });
    const epic = addHabit('epic'); // wants 6 labor
    get().completeHabit(epic);
    expect(get().town.laborToday).toBe(24); // clamped at TOWN_LABOR_DAILY_CAP
    expect(get().town.laborBank).toBe(1); // only the 1-point remainder credited

    // Now fully at cap: a fresh completion grants nothing → "town cap reached" copy.
    const easy = addHabit('easy');
    get().completeHabit(easy);
    expect(get().town.laborBank).toBe(1);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.text).toContain('town cap reached');
  });

  it('settles a queued project when the completion finishes it: building appears at tier 1 and the perk goes live', () => {
    const project: TownProject = {
      id: 'p1', kind: 'build', key: 'watchtower', r: 0, c: 0, rot: 0,
      laborNeed: 1, laborApplied: 0,
    };
    useGameStore.setState({ town: { ...freshTown(), queue: [project] } });
    expect(selectTownPerks(get()).sightBonus).toBe(0); // dormant while queued

    const id = addHabit('normal'); // 2 labor drains into the 1-need project → settles
    get().completeHabit(id);

    const town = get().town;
    expect(town.queue).toHaveLength(0);
    expect(town.buildings.some((b) => b.key === 'watchtower' && b.tier === 1)).toBe(true);
    expect(selectTownPerks(get()).sightBonus).toBe(1); // perk live

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.text === '🏗️ Watchtower complete!')).toBe(true);
  });
});

// TOWN-04: the clawback must remove EXACTLY what the completion credited — recomputing
// laborFor(difficulty) at uncomplete time desyncs under the day cap and difficulty edits.
describe('exact-amount labor clawback (TOWN-04)', () => {
  it('uncomplete at the day cap claws back only what was credited', () => {
    useGameStore.setState({
      town: { ...freshTown(), laborISO: toISODate(), laborToday: 23, laborBank: 10 },
    });
    const epic = addHabit('epic'); // wants 6, but only 1 fits under the cap
    get().completeHabit(epic);
    expect(get().town.laborBank).toBe(11);

    get().uncompleteHabit(epic);
    expect(get().town.laborBank).toBe(10);  // exactly the 1 credited — never the nominal 6
    expect(get().town.laborToday).toBe(23); // cap headroom restored exactly
  });

  it('a difficulty edit between complete and uncomplete cannot change the clawback', () => {
    const easy = addHabit('easy'); // credits 1
    get().completeHabit(easy);
    expect(get().town.laborBank).toBe(1);
    get().updateHabit(easy, { difficulty: 'epic' });
    get().uncompleteHabit(easy);
    expect(get().town.laborBank).toBe(0); // clawed exactly the 1 granted — no theft from others

    const epic = addHabit('epic'); // credits 6
    get().completeHabit(epic);
    expect(get().town.laborBank).toBe(6);
    get().updateHabit(epic, { difficulty: 'easy' });
    get().uncompleteHabit(epic);
    expect(get().town.laborBank).toBe(0); // clawed all 6 — nothing kept by the downgrade trick
  });

  it('legacy completions without a stored amount fall back to the nominal rate', () => {
    const id = addHabit('normal'); // credits 2
    get().completeHabit(id);
    // Simulate a save written before lastLaborGrant existed: ISO marker only.
    useGameStore.setState({
      habits: get().habits.map((h) => (h.id === id ? { ...h, lastLaborGrant: undefined } : h)),
    });
    get().uncompleteHabit(id);
    expect(get().town.laborBank).toBe(0); // nominal 2 clawed — the pre-fix behavior, unchanged
  });

  it('the first grant after a day rollover reports the true credited amount (TOWN-11)', () => {
    _setNow(() => new Date(2025, 5, 10));
    const id = addHabit('normal'); // credits 2
    // Yesterday ended at the cap; the stale counter must not poison today's receipt.
    useGameStore.setState({ town: { ...freshTown(), laborISO: '2025-06-09', laborToday: 24 } });
    get().completeHabit(id);
    expect(get().town.laborToday).toBe(2);
    expect(get().town.laborBank).toBe(2);
    const toasts = useToastStore.getState().toasts;
    expect(toasts[toasts.length - 1]?.text).toContain('+2 🔨');
    _resetNow();
  });

  it('a grant at the full bank warns instead of over-reporting (TOWN-05)', () => {
    useGameStore.setState({ town: { ...freshTown(), laborBank: 200 } }); // TOWN_LABOR_BANK_CAP
    const epic = addHabit('epic');
    get().completeHabit(epic);
    expect(get().town.laborBank).toBe(200); // overflow lost
    const toasts = useToastStore.getState().toasts;
    const last = toasts[toasts.length - 1]?.text ?? '';
    expect(last).toContain('bank full — start a project');
    expect(last).not.toContain('🔨'); // no phantom "+6 🔨"

    get().uncompleteHabit(epic); // credited 0 → nothing to claw
    expect(get().town.laborBank).toBe(200);
  });
});

// M5 (10.5): the plan-mandated guard — with zero buildings every wired seam must be
// byte-identical to its pre-Homestead baseline. resetGame (beforeEach) seeds freshTown().
describe('M5 perk wiring — zero-buildings regression guard (byte-identical baselines)', () => {
  it('freshTown grants no perks, and each pure seam falls back to its baseline', () => {
    const t = freshTown();
    expect(townPerks(t)).toEqual({
      sightBonus: 0, staminaBonus: 0, merchantDiscount01: 0, trialPractice: false,
      maxEnergyBonus: 0, laborDiscount01: 0, queueSlots: 1, forgeSweetBonus: 0,
    });
    expect(maxEnergyFor({ town: t })).toBe(MAX_ENERGY);
    // Un-perked baseline pinned by a hardcoded price (not a tautological (d)===(d,0) identity):
    // floor-1 heal = 18 + 1×4 = 22g at the default no-discount arg.
    expect(merchantOffers(1).find((o) => o.kind === 'heal')?.cost).toBe(22);
    expect(strikeSweetHalf(0)).toBeCloseTo(0.1, 10);
    expect(strikeSweetHalf(10)).toBe(strikeSweetHalf(10, 0));
  });

  // TOWN-10: the two perks previously covered only by struct equality, exercised at
  // their consuming seams with zero buildings.
  it('labor-cost and queue-slot seams at zero buildings match raw catalog baselines', () => {
    const t = freshTown();
    // No Mason's Guild → laborNeed snapshots the raw catalog labor (no discount).
    const queued = queueBuild(t, TOWN_BUILDINGS['watchtower'], 0, 0, undefined, 'p1')!;
    expect(queued.queue[0].laborNeed).toBe(15); // watchtower tiers[0].labor, undiscounted
    // No Keep tier III → queueSlots baseline is 1: a second concurrent project is refused.
    expect(queueBuild(queued, TOWN_BUILDINGS['bathhouse'], 5, 5, undefined, 'p2')).toBeNull();
    expect(canPlace(queued, TOWN_BUILDINGS['bathhouse'], 5, 5)).toEqual({ ok: false, reason: 'queue_full' });
  });

  it('crawler sight + stamina at run start match the pre-Homestead baselines', () => {
    useGameStore.setState({ character: { ...get().character, energy: 10 } });
    const en = get().character.statLevels.EN;
    get().beginMining();
    const mine = get().mining!;
    expect(mine.sightBonus).toBe(0);
    expect(sightRadiusFor(mine)).toBe(MINE_SIGHT_RADIUS); // no boons, no Watchtower
    expect(mine.maxSta).toBe(dungeonStamina(en));         // no Bathhouse
  });

  it('a trial cleared today is still refused with no Training Yard', () => {
    const today = toISODate();
    get().addHabit({ name: 'DX', stat: 'DX', type: 'binary', frequency: 'daily', difficulty: 'normal' });
    get().completeHabit(get().habits[0].id);
    useGameStore.setState({
      character: { ...get().character, energy: 5 },
      trialsClearedOn: { ...get().trialsClearedOn, lockpicking: today },
    });
    expect(get().beginTrial('lockpicking')).toEqual({ ok: false, reason: 'cleared' });
    expect(get().character.energy).toBe(5); // refused before any charge
  });
});
