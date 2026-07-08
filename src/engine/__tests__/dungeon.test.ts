import { describe, it, expect, beforeEach } from 'vitest';
import { emptyStatXP, statPoints, statPower } from '../stats';
import { resolveTreasure, mergeReward, scaleReward, DUNGEON_ENERGY_COST, merchantOffers } from '../dungeon';
import { type RNG } from '../combat';
import { useGameStore } from '@/store/useGameStore';
import { resetRunRng } from '@/store/runRng';

const fixed = (v: number): RNG => () => v;

describe('statPoints / statPower', () => {
  it('tapers XP via sqrt (combat-stat mitigation curve)', () => {
    expect(statPoints(0)).toBe(0);
    expect(statPoints(100)).toBe(10);
    expect(statPoints(400)).toBe(20);
  });
  it('sums favored stat levels', () => {
    const lv = emptyStatXP();
    lv.DX = 20;
    lv.AG = 10;
    expect(statPower(lv, ['DX', 'AG'])).toBe(30);
  });
});

describe('dungeon constants', () => {
  it('entry costs 3 energy per design brief', () => {
    expect(DUNGEON_ENERGY_COST).toBe(3);
  });
});

describe('resolveTreasure', () => {
  it('scales gold with depth and always yields crystals', () => {
    const shallow = resolveTreasure(1, fixed(0));
    const deep = resolveTreasure(10, fixed(0));
    expect(shallow.gold!).toBeGreaterThanOrEqual(70);
    expect(deep.gold!).toBeGreaterThan(shallow.gold!);
    expect(shallow.materials?.crystals).toBeGreaterThanOrEqual(1);
  });
});

describe('mergeReward', () => {
  it('sums gold, materials, items, weapons, and gear', () => {
    const a = { gold: 50, materials: { iron_bar: 1 }, items: ['healing_potion'], weapons: ['iron_mace'] };
    const b = { gold: 30, materials: { iron_bar: 2, leather: 1 }, gear: ['leather_vest'] };
    const merged = mergeReward(a, b);
    expect(merged.gold).toBe(80);
    expect(merged.materials).toEqual({ iron_bar: 3, leather: 1 });
    expect(merged.items).toEqual(['healing_potion']);
    expect(merged.weapons).toEqual(['iron_mace']);
    expect(merged.gear).toEqual(['leather_vest']);
  });
});

describe('merchantOffers economy band', () => {
  // merchantOffers prices: heal = 18+4d, potion = 24+5d, boon = 45+9d
  // Average treasure gold = 60+10d+~20 (mid-range rng). One combat room also yields gold.
  // At each depth, the cheapest item (heal) must cost less than 2× a single treasure room's
  // minimum gold — otherwise the merchant is effectively unreachable.

  it('prices three offers that scale with depth', () => {
    const d1 = merchantOffers(1);
    expect(d1).toHaveLength(3);
    expect(d1[0].kind).toBe('heal');
    expect(d1[1].kind).toBe('potion');
    expect(d1[2].kind).toBe('boon');
    expect(d1[0].cost).toBe(22); // 18 + 4*1
    expect(d1[1].cost).toBe(29); // 24 + 5*1
    expect(d1[2].cost).toBe(54); // 45 + 9*1
  });

  it('heal stays affordable vs. minimum floor gold at depth 1', () => {
    // min treasure gold at d1 = 60 + 10 + 0 (rng=0) = 70; heal costs 22 — well within one room
    const minTreasureGold = resolveTreasure(1, () => 0).gold!;
    expect(merchantOffers(1)[0].cost).toBeLessThan(minTreasureGold);
  });

  it('heal stays affordable vs. minimum floor gold at depth 5', () => {
    // min treasure gold at d5 = 60 + 50 + 0 = 110; heal costs 38
    const minTreasureGold = resolveTreasure(5, () => 0).gold!;
    expect(merchantOffers(5)[0].cost).toBeLessThan(minTreasureGold);
  });

  it('heal stays affordable vs. minimum floor gold at depth 10', () => {
    // min treasure gold at d10 = 60 + 100 + 0 = 160; heal costs 58
    const minTreasureGold = resolveTreasure(10, () => 0).gold!;
    expect(merchantOffers(10)[0].cost).toBeLessThan(minTreasureGold);
  });

  it('boon (most expensive) requires roughly two floors of treasure to afford by depth 10', () => {
    // boon at d10 = 135; two min-treasure rooms = 320 — player can afford it
    const twoFloorMin = resolveTreasure(10, () => 0).gold! * 2;
    expect(merchantOffers(10)[2].cost).toBeLessThan(twoFloorMin);
  });

  it('prices strictly increase with depth', () => {
    const [d5, d10] = [merchantOffers(5), merchantOffers(10)];
    for (let i = 0; i < 3; i++) {
      expect(d10[i].cost).toBeGreaterThan(d5[i].cost);
    }
  });

  it('applies the Homestead haggle discount, rounding each price (10.5)', () => {
    // base d1: heal 22, potion 29, boon 54 → ×0.85 → round → 19, 25, 46.
    const d1 = merchantOffers(1, 0.15);
    expect(d1[0].cost).toBe(19);
    expect(d1[1].cost).toBe(25);
    expect(d1[2].cost).toBe(46);
  });

  it('default discount (0) is byte-identical to the un-perked prices (10.5 regression guard)', () => {
    for (const d of [1, 5, 10]) expect(merchantOffers(d, 0)).toEqual(merchantOffers(d));
  });

  it('floors a fully-discounted price at 1g (never free)', () => {
    expect(merchantOffers(1, 1)[0].cost).toBe(1);
  });
});

describe('dungeon lifecycle — store invariants', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
    resetRunRng();
  });

  it('deepestFloor starts at 0 on a fresh store', () => {
    expect(useGameStore.getState().deepestFloor).toBe(0);
  });

  it('deepestFloor remains 0 after resetGame()', () => {
    useGameStore.getState().devSetDeepestFloor(7);
    expect(useGameStore.getState().deepestFloor).toBe(7);
    useGameStore.getState().resetGame();
    expect(useGameStore.getState().deepestFloor).toBe(0);
  });

  it('dungeon is null on a fresh store', () => {
    expect(useGameStore.getState().dungeon).toBeNull();
  });

  it('dungeonHistory is empty on a fresh store', () => {
    expect(useGameStore.getState().dungeonHistory ?? []).toHaveLength(0);
  });
});

describe('scaleReward', () => {
  it('keeps a fraction of gold/materials and drops all relics', () => {
    const kept = scaleReward({ gold: 100, materials: { iron_bar: 4, leather: 1 }, items: ['x'], weapons: ['y'] }, 0.25);
    expect(kept.gold).toBe(25);
    expect(kept.materials).toEqual({ iron_bar: 1 }); // floor(4*.25)=1, floor(1*.25)=0 dropped
    expect(kept.items).toEqual([]);
    expect(kept.weapons).toEqual([]);
  });
});
