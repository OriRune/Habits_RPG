import { describe, it, expect } from 'vitest';
import {
  freshTown,
  laborFor,
  gridSizeFor,
  inUnlockedLand,
  occupancy,
  canPlace,
  footprintDims,
  prestigeOf,
  buildingPrestigeOf,
  decorAdjacencyBonus,
  deedCost,
  deedPrestigeGate,
  townPerks,
  queueBuild,
  queueUpgrade,
  cancelProject,
  applyLabor,
  clawBackLabor,
  settleProjects,
  demolish,
  moveBuilding,
  canMoveBuilding,
  placeDecor,
  canPlaceDecor,
  type TownState,
  type TownBuilding,
} from '../town';
import { TOWN_BUILDINGS } from '@/content/townBuildings';
import { TOWN_DECOR } from '@/content/townDecor';

const WATCHTOWER = TOWN_BUILDINGS['watchtower']; // 1×1, perk sight, labor 15/30/55
const BATHHOUSE = TOWN_BUILDINGS['bathhouse'];   // 2×2, perk stamina
const CHAPEL = TOWN_BUILDINGS['chapel'];         // 2×2, unlock prestige >= 80
const MANOR = TOWN_BUILDINGS['manor'];           // 2×3, unlock deed >= 2

/** Seed a town with explicit overrides for reducer-level tests. */
function town(overrides: Partial<TownState> = {}): TownState {
  return { ...freshTown(), ...overrides };
}

const bld = (o: Partial<TownBuilding> & Pick<TownBuilding, 'id' | 'key' | 'r' | 'c' | 'tier'>): TownBuilding => o;

describe('deed helpers', () => {
  it('gridSizeFor is 14/18/21/24 square, clamped', () => {
    expect(gridSizeFor(0)).toEqual({ rows: 14, cols: 14 });
    expect(gridSizeFor(1)).toEqual({ rows: 18, cols: 18 });
    expect(gridSizeFor(2)).toEqual({ rows: 21, cols: 21 });
    expect(gridSizeFor(3)).toEqual({ rows: 24, cols: 24 });
    expect(gridSizeFor(4)).toEqual({ rows: 24, cols: 24 });
    expect(gridSizeFor(-1)).toEqual({ rows: 14, cols: 14 });
  });

  it('inUnlockedLand tracks the deed square', () => {
    expect(inUnlockedLand(0, 13, 13)).toBe(true);
    expect(inUnlockedLand(0, 14, 0)).toBe(false);
    expect(inUnlockedLand(1, 14, 14)).toBe(true);
  });

  it('laborFor maps difficulty to the labor rate', () => {
    expect(laborFor('easy')).toBe(1);
    expect(laborFor('normal')).toBe(2);
    expect(laborFor('hard')).toBe(4);
    expect(laborFor('epic')).toBe(6);
  });
});

describe('canPlace', () => {
  it('rejects out-of-bounds footprints', () => {
    expect(canPlace(town(), WATCHTOWER, -1, 0)).toEqual({ ok: false, reason: 'bounds' });
    expect(canPlace(town({ deeds: 3 }), BATHHOUSE, 23, 23)).toEqual({ ok: false, reason: 'bounds' });
  });

  it('rejects cells outside the purchased district (locked)', () => {
    // In absolute bounds (< 24) but outside the deed-0 (14×14) square.
    expect(canPlace(town(), WATCHTOWER, 14, 14)).toEqual({ ok: false, reason: 'locked' });
  });

  it('rejects overlap with a reserved queued-build footprint (occupied)', () => {
    const queued = queueBuild(town(), WATCHTOWER, 0, 0, undefined, 'p1')!;
    // Different building key at the same cell → occupied (checked before queue_full).
    expect(canPlace(queued, BATHHOUSE, 0, 0)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('rejects a second instance of a unique building', () => {
    const queued = queueBuild(town(), WATCHTOWER, 0, 0, undefined, 'p1')!;
    expect(canPlace(queued, WATCHTOWER, 5, 5)).toEqual({ ok: false, reason: 'unique' });
  });

  it('rejects a prestige-gated building below the threshold', () => {
    expect(canPlace(town(), CHAPEL, 0, 0)).toEqual({ ok: false, reason: 'prestige' });
  });

  it('rejects a deed-gated building below the deed requirement with the deed reason (TOWN-20)', () => {
    expect(canPlace(town({ deeds: 3 }), MANOR, 0, 0).ok).toBe(true);
    expect(canPlace(town(), MANOR, 0, 0)).toEqual({ ok: false, reason: 'deed' });
  });

  it('accepts a valid placement', () => {
    expect(canPlace(town(), WATCHTOWER, 3, 3)).toEqual({ ok: true });
  });
});

// TOWN-01: the rot=1 mirror render lands art on the TRANSPOSED footprint, so every
// logical footprint must swap w/h through footprintDims. These are the regression
// tests for the live repro (a 1×1 placed "inside" a rotated 2×3's art, and a refusal
// on grass the rotated building no longer occupies).
describe('rotation footprints (footprintDims)', () => {
  const YARD = TOWN_BUILDINGS['training_yard']; // 2×3, rotatable
  const rotatedYard = () =>
    town({ buildings: [bld({ id: 'y1', key: 'training_yard', r: 5, c: 6, tier: 1, rot: 1 })] });

  it('footprintDims swaps w/h only for rot=1', () => {
    expect(footprintDims(YARD, undefined)).toEqual({ w: 2, h: 3 });
    expect(footprintDims(YARD, 0)).toEqual({ w: 2, h: 3 });
    expect(footprintDims(YARD, 1)).toEqual({ w: 3, h: 2 });
  });

  it('occupancy of a rotated building covers the transposed cells and only those', () => {
    const occ = occupancy(rotatedYard());
    // transposed 3-wide × 2-tall: rows 5–6, cols 6–8
    expect(occ.has('5,8')).toBe(true);
    expect(occ.has('6,8')).toBe(true);
    // the unrotated footprint's tail rows are NOT occupied
    expect(occ.has('7,6')).toBe(false);
    expect(occ.has('7,7')).toBe(false);
  });

  it('canPlace refuses the rotated art cells and frees the unrotated tail', () => {
    const t = rotatedYard();
    expect(canPlace(t, WATCHTOWER, 5, 8)).toEqual({ ok: false, reason: 'occupied' });
    expect(canPlace(t, WATCHTOWER, 7, 6)).toEqual({ ok: true });
  });

  it('canPlace bounds-checks the rotated dimensions', () => {
    // At c=22 on the deed-3 grid a 2-wide yard fits, but rotated (3-wide) it does not.
    expect(canPlace(town({ deeds: 3 }), YARD, 0, 22, 0).ok).toBe(true);
    expect(canPlace(town({ deeds: 3 }), YARD, 0, 22, 1)).toEqual({ ok: false, reason: 'bounds' });
  });

  it('a queued rotated build reserves the transposed footprint', () => {
    const queued = queueBuild(town(), YARD, 5, 6, 1, 'p1')!;
    const occ = occupancy(queued);
    expect(occ.has('5,8')).toBe(true);
    expect(occ.has('7,6')).toBe(false);
  });

  it('moveBuilding validates against the new rot', () => {
    const t = town({ deeds: 3, buildings: [bld({ id: 'y1', key: 'training_yard', r: 0, c: 0, tier: 1 })] });
    expect(moveBuilding(t, 'y1', 0, 22, 1)).toBeNull();            // 3-wide overflows col 24
    expect(moveBuilding(t, 'y1', 0, 21, 1)).not.toBeNull();        // 21+3 = 24 fits
  });
});

describe('occupancy', () => {
  it('includes buildings, reserved queue footprints, and decor', () => {
    const t = town({
      buildings: [bld({ id: 'b1', key: 'watchtower', r: 0, c: 0, tier: 1 })],
      queue: [{ id: 'p1', kind: 'build', key: 'bathhouse', r: 2, c: 2, laborNeed: 15, laborApplied: 0 }],
      decor: [{ key: 'well', r: 10, c: 10 }],
    });
    const occ = occupancy(t);
    expect(occ.has('0,0')).toBe(true);   // building
    expect(occ.has('3,3')).toBe(true);   // bathhouse 2×2 reserved footprint
    expect(occ.has('10,10')).toBe(true); // decor
  });
});

describe('queueBuild / queueUpgrade', () => {
  it('reserves the footprint so a second build on the same cells fails', () => {
    const t = queueBuild(town(), WATCHTOWER, 0, 0, undefined, 'p1')!;
    expect(t.queue).toHaveLength(1);
    expect(queueBuild(t, BATHHOUSE, 0, 0, undefined, 'p2')).toBeNull();
  });

  it('refuses a second project at the slot cap (queue_full)', () => {
    const t = queueBuild(town(), WATCHTOWER, 0, 0, undefined, 'p1')!;
    // slots = 1 (no Keep III); a valid placement elsewhere still fails on queue_full.
    expect(queueBuild(t, BATHHOUSE, 5, 5, undefined, 'p2')).toBeNull();
  });

  it('snapshots the labor need (no Mason discount by default)', () => {
    const t = queueBuild(town(), WATCHTOWER, 0, 0, undefined, 'p1')!;
    expect(t.queue[0].laborNeed).toBe(WATCHTOWER.tiers[0].labor); // 15
  });

  it('applies the tier-scaled Mason discount at queue time (snapshotted)', () => {
    // Mason perkValues [0.05, 0.10, 0.15] (TOWN-07): the discount grows with tier.
    const at = (tier: number) =>
      queueBuild(
        town({ buildings: [bld({ id: 'm', key: 'masons_guild', r: 0, c: 0, tier })] }),
        WATCHTOWER, 5, 5, undefined, 'p1',
      )!.queue[0].laborNeed;
    expect(at(1)).toBe(Math.ceil(15 * 0.95)); // 15 — 5% rounds away on small tiers
    expect(at(2)).toBe(Math.ceil(15 * 0.9));  // 14
    expect(at(3)).toBe(Math.ceil(15 * 0.85)); // 13
  });

  it('queueUpgrade needs the building and stops at maxTier', () => {
    const t = town({ buildings: [bld({ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 3 })] });
    expect(queueUpgrade(t, 'w', 'u1')).toBeNull(); // already at maxTier 3
    expect(queueUpgrade(town(), 'missing', 'u1')).toBeNull();
  });

  it('queueUpgrade snapshots the next tier cost', () => {
    const t = town({ buildings: [bld({ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 1 })] });
    const up = queueUpgrade(t, 'w', 'u1')!;
    expect(up.queue[0]).toMatchObject({ kind: 'upgrade', buildingId: 'w', laborNeed: 30 });
  });
});

describe('applyLabor', () => {
  it('caps labor at the daily cap (25th point refused)', () => {
    const day1 = applyLabor(town(), 24, 'D1');
    expect(day1.laborBank).toBe(24);
    expect(day1.laborToday).toBe(24);
    const more = applyLabor(day1, 1, 'D1');
    expect(more.laborBank).toBe(24); // refused
    expect(more.laborToday).toBe(24);
  });

  it('resets the daily counter on a new ISO day', () => {
    const day1 = applyLabor(town(), 24, 'D1');
    const day2 = applyLabor(day1, 10, 'D2');
    expect(day2.laborToday).toBe(10);
    expect(day2.laborBank).toBe(34);
  });

  it('caps the bank and drops overflow', () => {
    const t = town({ laborBank: 190, laborISO: 'D1', laborToday: 0 });
    const out = applyLabor(t, 24, 'D2');
    expect(out.laborBank).toBe(200); // 190 + 24 = 214, clamped; 14 lost
  });

  it('drains the bank into queue[0..slots) in order (2 slots)', () => {
    const t = town({
      buildings: [bld({ id: 'keep', key: 'keep', r: 0, c: 0, tier: 3 })], // queueSlots 2
      queue: [
        { id: 'p1', kind: 'build', key: 'watchtower', r: 5, c: 5, laborNeed: 10, laborApplied: 0 },
        { id: 'p2', kind: 'build', key: 'bathhouse', r: 7, c: 7, laborNeed: 10, laborApplied: 0 },
      ],
    });
    const out = applyLabor(t, 15, 'D1');
    expect(out.queue[0].laborApplied).toBe(10); // filled first
    expect(out.queue[1].laborApplied).toBe(5);  // remainder
    expect(out.laborBank).toBe(0);
  });
});

describe('settleProjects', () => {
  it('completes a build (building appears, perk activates) and reuses the project id', () => {
    const queued = queueBuild(town(), WATCHTOWER, 5, 5, undefined, 'p1')!;
    const labored = applyLabor(queued, 15, 'D1');
    expect(townPerks(labored).sightBonus).toBe(0); // queued ≠ perk
    const { town: settled, completed } = settleProjects(labored);
    expect(completed).toHaveLength(1);
    expect(settled.buildings).toHaveLength(1);
    expect(settled.buildings[0]).toMatchObject({ id: 'p1', key: 'watchtower', tier: 1 });
    expect(settled.queue).toHaveLength(0);
    expect(townPerks(settled).sightBonus).toBe(1); // live now
  });

  it('completes an upgrade by bumping the target tier', () => {
    const t = town({ buildings: [bld({ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 1 })] });
    // laborNeed 30 exceeds the daily cap (24), so labor is applied across two days.
    let up = applyLabor(queueUpgrade(t, 'w', 'u1')!, 24, 'D1');
    up = applyLabor(up, 24, 'D2');
    const { town: settled } = settleProjects(up);
    expect(settled.buildings[0].tier).toBe(2);
  });

  it('is a no-op when nothing is complete', () => {
    const queued = queueBuild(town(), WATCHTOWER, 5, 5, undefined, 'p1')!;
    const { completed } = settleProjects(queued);
    expect(completed).toHaveLength(0);
  });
});

describe('cancelProject', () => {
  it('refunds 100% of the escrowed materials and drops the project', () => {
    const queued = queueBuild(town(), WATCHTOWER, 0, 0, undefined, 'p1')!;
    const { town: t, refundMaterials } = cancelProject(queued, 'p1');
    expect(refundMaterials).toEqual(WATCHTOWER.tiers[0].materials); // { stone: 4, wood: 4 }
    expect(t.queue).toHaveLength(0);
  });

  it('refunds the current-tier cost for an upgrade', () => {
    const t = town({ buildings: [bld({ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 1 })] });
    const up = queueUpgrade(t, 'w', 'u1')!;
    const { refundMaterials } = cancelProject(up, 'u1');
    expect(refundMaterials).toEqual(WATCHTOWER.tiers[1].materials);
  });
});

describe('clawBackLabor', () => {
  it('drains the bank first, then the least-progressed project, clamped', () => {
    const t = town({
      laborBank: 5,
      laborISO: 'D1',
      laborToday: 20,
      queue: [
        { id: 'p1', kind: 'build', key: 'watchtower', r: 5, c: 5, laborNeed: 20, laborApplied: 3 },
        { id: 'p2', kind: 'build', key: 'bathhouse', r: 7, c: 7, laborNeed: 20, laborApplied: 8 },
      ],
    });
    const out = clawBackLabor(t, 10, 'D1');
    expect(out.laborBank).toBe(0);            // 5 from bank
    expect(out.queue[0].laborApplied).toBe(0); // p1 (least progressed) drained 3 → clamped
    expect(out.queue[1].laborApplied).toBe(6); // p2 gives the remaining 2
    expect(out.laborToday).toBe(10);           // decremented so the day cap refills
  });

  it('never drops below zero', () => {
    const t = town({ laborBank: 1, laborToday: 1, laborISO: 'D1' });
    const out = clawBackLabor(t, 100, 'D1');
    expect(out.laborBank).toBe(0);
    expect(out.laborToday).toBe(0);
  });
});

describe('demolish', () => {
  it('refunds 50% of cumulative tier materials (floored), 0% gold', () => {
    const t = town({ buildings: [bld({ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 2 })] });
    // cumulative tiers 1..2: stone 4+8=12, wood 4+6=10, iron_bar 2 → 50%: 6 / 5 / 1
    const { town: after, refundMaterials } = demolish(t, 'w');
    expect(refundMaterials).toEqual({ stone: 6, wood: 5, iron_bar: 1 });
    expect(after.buildings).toHaveLength(0);
  });

  it('never demolishes the Keep', () => {
    const t = town({ buildings: [bld({ id: 'k', key: 'keep', r: 0, c: 0, tier: 1 })] });
    const { town: after, refundMaterials } = demolish(t, 'k');
    expect(after).toBe(t); // unchanged
    expect(refundMaterials).toEqual({});
  });

  // TOWN-02: demolishing the target of a queued upgrade would orphan the project
  // (invisible, uncancellable, queue-slot lock) — it must no-op like the Keep guard.
  it('never demolishes a building a queued upgrade targets', () => {
    const base = town({ buildings: [bld({ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 1 })] });
    const withUpgrade = queueUpgrade(base, 'w', 'u1')!;
    const { town: after, refundMaterials } = demolish(withUpgrade, 'w');
    expect(after).toBe(withUpgrade); // unchanged — building and project both intact
    expect(refundMaterials).toEqual({});
  });
});

describe('moveBuilding', () => {
  it('relocates freely but is blocked while a project targets it', () => {
    const base = town({ buildings: [bld({ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 1 })] });
    const moved = moveBuilding(base, 'w', 5, 5)!;
    expect(moved.buildings[0]).toMatchObject({ r: 5, c: 5 });
    const withUpgrade = queueUpgrade(base, 'w', 'u1')!;
    expect(moveBuilding(withUpgrade, 'w', 8, 8)).toBeNull();
  });
});

describe('placeDecor / canPlaceDecor', () => {
  it('enforces the per-type cap', () => {
    let t = town();
    for (let i = 0; i < 10; i++) t = placeDecor(t, TOWN_DECOR['tree'], i, 0, 0)!;
    expect(t.decor).toHaveLength(10);
    expect(placeDecor(t, TOWN_DECOR['tree'], 11, 0, 0)).toBeNull(); // 11th tree refused
    expect(canPlaceDecor(t, TOWN_DECOR['tree'], 11, 0)).toEqual({ ok: false, reason: 'type_cap' });
  });

  it('enforces the global 60-prop cap (TOWN-10)', () => {
    // 6 types × 10 each = 60 props fills the global cap without tripping any per-type cap.
    let t = town();
    const types = ['tree', 'hedge', 'lamppost', 'flower_bed', 'banner', 'cobble_path'];
    types.forEach((key, ti) => {
      for (let i = 0; i < 10; i++) t = placeDecor(t, TOWN_DECOR[key], ti * 2, i, 0)!;
    });
    expect(t.decor).toHaveLength(60);
    // A 7th type is refused on the GLOBAL cap, not its (untouched) per-type cap.
    expect(canPlaceDecor(t, TOWN_DECOR['well'], 13, 0)).toEqual({ ok: false, reason: 'decor_cap' });
    expect(placeDecor(t, TOWN_DECOR['well'], 13, 0, 0)).toBeNull();
  });

  it('reports footprint reasons: bounds, locked, occupied', () => {
    const t = town({ decor: [{ key: 'well', r: 5, c: 5 }] });
    expect(canPlaceDecor(t, TOWN_DECOR['tree'], -1, 0)).toEqual({ ok: false, reason: 'bounds' });
    expect(canPlaceDecor(t, TOWN_DECOR['tree'], 14, 14)).toEqual({ ok: false, reason: 'locked' });
    expect(canPlaceDecor(t, TOWN_DECOR['tree'], 5, 5)).toEqual({ ok: false, reason: 'occupied' });
    expect(canPlaceDecor(t, TOWN_DECOR['tree'], 3, 3)).toEqual({ ok: true });
  });
});

describe('canMoveBuilding', () => {
  it('reports missing / busy / occupied and accepts a valid move', () => {
    const base = town({
      buildings: [
        bld({ id: 'w', key: 'watchtower', r: 0, c: 0, tier: 1 }),
        bld({ id: 'b', key: 'bathhouse', r: 5, c: 5, tier: 1 }),
      ],
    });
    expect(canMoveBuilding(base, 'nope', 2, 2)).toEqual({ ok: false, reason: 'missing' });
    expect(canMoveBuilding(base, 'w', 5, 5)).toEqual({ ok: false, reason: 'occupied' });
    expect(canMoveBuilding(base, 'w', 2, 2)).toEqual({ ok: true });
    const withUpgrade = queueUpgrade(base, 'w', 'u1')!;
    expect(canMoveBuilding(withUpgrade, 'w', 2, 2)).toEqual({ ok: false, reason: 'busy' });
  });
});

describe('prestigeOf / townPerks', () => {
  it('sums completed building tiers plus decor', () => {
    const t = town({
      buildings: [bld({ id: 'k', key: 'keep', r: 0, c: 0, tier: 2 })], // 25 + 40
      decor: [{ key: 'lamppost', r: 5, c: 5 }],                        // +1
    });
    expect(prestigeOf(t)).toBe(66);
  });

  it('derives queueSlots from Keep tier and perks from completed buildings only', () => {
    const t = town({
      buildings: [
        bld({ id: 'k', key: 'keep', r: 0, c: 0, tier: 3 }),
        bld({ id: 'w', key: 'watchtower', r: 4, c: 0, tier: 1 }),
      ],
    });
    const perks = townPerks(t);
    expect(perks.queueSlots).toBe(2);
    expect(perks.sightBonus).toBe(1);
  });

  // TOWN-03: perk magnitudes scale with tier (perkValues) — every upgrade buys effect.
  it('perk magnitudes follow perkValues by tier', () => {
    const at = (key: string, tier: number) =>
      townPerks(town({ buildings: [bld({ id: 'b', key, r: 0, c: 0, tier })] }));
    expect(at('watchtower', 1).sightBonus).toBe(1);
    expect(at('watchtower', 3).sightBonus).toBe(2);
    expect(at('bathhouse', 1).staminaBonus).toBe(5);
    expect(at('bathhouse', 2).staminaBonus).toBe(10);
    expect(at('bathhouse', 3).staminaBonus).toBe(15);
    expect(at('trading_post', 3).merchantDiscount01).toBeCloseTo(0.15, 10);
    expect(at('granary', 2).maxEnergyBonus).toBe(2);
    expect(at('smithy', 3).forgeSweetBonus).toBeCloseTo(0.04, 10);
    expect(at('training_yard', 1).trialPractice).toBe(true); // boolean perk — no scaling
  });

  // TOWN-08: decor beside a completed building earns +1 prestige — placement matters.
  it('prestigeOf grants +1 adjacency prestige per building-adjacent decor prop', () => {
    const keep = bld({ id: 'k', key: 'keep', r: 0, c: 0, tier: 1 }); // 25, covers rows/cols 0–2
    const beside = town({ buildings: [keep], decor: [{ key: 'lamppost', r: 3, c: 0 }] });   // touches row 2
    const apart = town({ buildings: [keep], decor: [{ key: 'lamppost', r: 10, c: 10 }] });
    expect(prestigeOf(beside)).toBe(25 + 1 + 1); // building + decor + adjacency
    expect(prestigeOf(apart)).toBe(25 + 1);
    expect(decorAdjacencyBonus(beside, 3, 0)).toBe(1);
    expect(decorAdjacencyBonus(apart, 10, 10)).toBe(0);
  });

  // TOWN-17: deed gates read building prestige only — decor never buys land.
  it('buildingPrestigeOf excludes decor, adjacency, and charters', () => {
    const t = town({
      deeds: 4, // one charter commissioned
      buildings: [bld({ id: 'k', key: 'keep', r: 0, c: 0, tier: 2 })], // 25 + 40
      decor: [{ key: 'statue', r: 3, c: 0 }], // +3, adjacent → +1
    });
    expect(buildingPrestigeOf(t)).toBe(65);
    expect(prestigeOf(t)).toBe(65 + 3 + 1 + 40); // + decor + adjacency + charter
  });
});

// TOWN-06: past the three land districts the deed sink continues as open-ended charters.
describe('deedCost / deedPrestigeGate', () => {
  it('land deeds follow the frozen tables, charters escalate without end', () => {
    expect([deedCost(0), deedCost(1), deedCost(2)]).toEqual([500, 1500, 4000]);
    expect([deedCost(3), deedCost(4), deedCost(5)]).toEqual([8000, 16000, 32000]);
    expect([deedPrestigeGate(0), deedPrestigeGate(1), deedPrestigeGate(2)]).toEqual([100, 200, 320]);
    expect([deedPrestigeGate(3), deedPrestigeGate(4)]).toEqual([440, 560]);
  });

  it('the grid never grows past the deed-3 square', () => {
    expect(gridSizeFor(5)).toEqual({ rows: 24, cols: 24 }); // charters grant no land
  });
});

// Party-visit forward-compat freeze (plan3 10.6 / M6): the future read-only visit payload is
// TownState verbatim, so it must stay a plain JSON-serializable bag (ids/coords/counters) with
// no functions or class instances. See the doc block above the TownState interface.
describe('party-visit payload freeze (M6)', () => {
  it('a fully-populated TownState round-trips losslessly through JSON', () => {
    const t = town({
      v: 1,
      deeds: 2,
      buildings: [
        bld({ id: 'k', key: 'keep', r: 0, c: 0, tier: 3, rot: 0 }),
        bld({ id: 'w', key: 'watchtower', r: 4, c: 0, tier: 2 }),
      ],
      decor: [{ key: 'well', r: 5, c: 5, v: 2 }, { key: 'tree', r: 6, c: 6 }],
      laborBank: 42,
      queue: [{ id: 'p1', kind: 'build', key: 'bathhouse', r: 8, c: 8, rot: 0, laborNeed: 15, laborApplied: 7 }],
      laborISO: '2026-07-07',
      laborToday: 12,
    });
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });

  it('holds no function/instance values (visitors get a data blob, never behaviour)', () => {
    const t = freshTown();
    const hasNonPlain = (val: unknown): boolean => {
      if (typeof val === 'function') return true;
      if (val && typeof val === 'object') {
        if (val.constructor !== Object && val.constructor !== Array) return true;
        return Object.values(val).some(hasNonPlain);
      }
      return false;
    };
    expect(hasNonPlain(t)).toBe(false);
  });
});
