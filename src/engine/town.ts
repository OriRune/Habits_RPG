// ============================================================================
//  THE HOMESTEAD — pure town-builder engine (reducer-style, RNG-free, clock-free).
// ============================================================================
//
//  A persistent home base the player builds on a square grid. Placing/upgrading a
//  building charges gold + materials up front (the sink, applied by the slice);
//  construction completes via habit-earned LABOR. Deeds expand the buildable land.
//  Completed buildings grant light, non-resource perks (see TownPerks).
//
//  This module is pure: no React/store/net imports, no clock (todayISO is passed
//  in), no RNG (decor variant `v` and building/project ids are passed in by the
//  slice). It reads the content catalog (TOWN_BUILDINGS / TOWN_DECOR) the same
//  allowed direction engine/mining.ts reads content/mining.ts. Cell occupancy,
//  prestige, and active perks are always DERIVED — never persisted.
// ============================================================================
import { type Difficulty } from '@/engine/xp';
import {
  TOWN_BUILDINGS,
  KEEP_KEY,
  TOWN_LABOR_RATE,
  TOWN_LABOR_DAILY_CAP,
  TOWN_LABOR_BANK_CAP,
  TOWN_DECOR_CAP,
  TOWN_DECOR_PER_TYPE_CAP,
  TOWN_DEED_COSTS,
  TOWN_DEED_PRESTIGE,
  TOWN_CHARTER_PRESTIGE,
  TOWN_CHARTER_COST_MULT,
  TOWN_CHARTER_GATE_STEP,
  type TownBuildingDef,
} from '@/content/townBuildings';
import { TOWN_DECOR, type TownDecorDef } from '@/content/townDecor';

// ---------------------------------------------------------------------------
// Persisted state (see docs/homestead-development-plan.md §2.1)
// ---------------------------------------------------------------------------

export interface TownBuilding {
  id: string;           // stable handle (uid() from the slice)
  key: string;          // catalog key in TOWN_BUILDINGS
  r: number; c: number; // anchor cell (top-left of footprint)
  tier: number;         // 1..maxTier (completed tier)
  rot?: 0 | 1;          // mirror variant, only when def.rotatable
}

export interface TownDecor {
  key: string; r: number; c: number;
  v?: number;           // visual-variant seed (0..3), rolled at placement by the slice
}

export interface TownProject {
  id: string;
  kind: 'build' | 'upgrade';
  key: string;              // building key
  buildingId?: string;      // upgrade target
  r?: number; c?: number; rot?: 0 | 1;  // build placement — footprint is reserved while queued
  laborNeed: number;        // snapshotted at queue time (Mason's Guild discount applies here)
  laborApplied: number;
}

/**
 * PARTY-VISIT FORWARD-COMPAT FREEZE (plan3 10.6 / M6). The future read-only party-visit
 * payload is `TownState` verbatim — `v: 1` ships now as its shape marker, so a later version
 * bumps `v` and migrates rather than reshaping. Two invariants the visit feature relies on:
 *   1. v1 must NOT broadcast town state — there is no net reference to this module today,
 *      and none may be added until the visit protocol lands (source-scan guarded in
 *      layering.test.ts; town.test.ts guards the payload's JSON round-trip).
 *   2. The renderer must read ONLY this payload — never character/gear/wallet state — because a
 *      visitor won't have the host's character. `TownCanvas` already takes town as its sole prop.
 * `TownState` must therefore stay a plain, JSON-serializable bag of ids/coords/counters with no
 * functions or class instances (round-trip guarded in town.test.ts).
 */
export interface TownState {
  v: 1;                 // payload shape version for the future party-visit feature
  deeds: number;        // 0..3 districts purchased (pure gold)
  buildings: TownBuilding[];
  decor: TownDecor[];
  laborBank: number;    // clamped to TOWN_LABOR_BANK_CAP
  queue: TownProject[]; // length ≤ queueSlots (1; 2 with Keep tier III)
  laborISO: string;     // ISO day laborToday refers to
  laborToday: number;   // labor earned today (TOWN_LABOR_DAILY_CAP guard)
}

// Perk magnitudes scale with the building's tier (perkValues[tier-1] in the catalog —
// TOWN-03): every upgrade buys a real effect, not just prestige.
export interface TownPerks {
  sightBonus: number;         // 0 | 1..2   (Watchtower tier)
  staminaBonus: number;       // 0 | 5..15  (Bathhouse tier)
  merchantDiscount01: number; // 0 | 0.05..0.15 (Trading Post tier)
  trialPractice: boolean;
  maxEnergyBonus: number;     // 0 | 1..3   (Granary tier)
  laborDiscount01: number;    // 0 | 0.05..0.15 (Mason tier; applied to laborNeed at queue time — snapshotted)
  queueSlots: number;         // 1 | 2      (Keep tier ≥ III)
  forgeSweetBonus: number;    // 0 | 0.02..0.04 (Smithy tier; consumed by the Forge)
}

/** Placement failure reasons — see canPlace. `deed` and `prestige` are distinct unlock gates (TOWN-20). */
export type PlaceReason = 'bounds' | 'occupied' | 'locked' | 'unique' | 'deed' | 'prestige' | 'queue_full';

/** Decor placement failure reasons — see canPlaceDecor. */
export type DecorPlaceReason = 'bounds' | 'occupied' | 'locked' | 'decor_cap' | 'type_cap';

/** Relocation failure reasons — see canMoveBuilding. `busy` = a queued upgrade targets it. */
export type MoveReason = 'bounds' | 'occupied' | 'locked' | 'missing' | 'busy';

// The buildable square grows with deeds; the absolute grid is the deed-3 square.
const GRID_SIZES = [14, 18, 21, 24];
const MAX_GRID = GRID_SIZES[GRID_SIZES.length - 1];

// ---------------------------------------------------------------------------
// Fresh state + trivial derivations
// ---------------------------------------------------------------------------

export function freshTown(): TownState {
  return {
    v: 1,
    deeds: 0,
    buildings: [],
    decor: [],
    laborBank: 0,
    queue: [],
    laborISO: '',
    laborToday: 0,
  };
}

export function laborFor(difficulty: Difficulty): number {
  return TOWN_LABOR_RATE[difficulty];
}

export function gridSizeFor(deeds: number): { rows: number; cols: number } {
  const size = GRID_SIZES[Math.max(0, Math.min(GRID_SIZES.length - 1, deeds))];
  return { rows: size, cols: size };
}

/** A single cell is unlocked when it lies inside the current deed square (top-left origin). */
export function inUnlockedLand(deeds: number, r: number, c: number): boolean {
  const { rows, cols } = gridSizeFor(deeds);
  return r >= 0 && c >= 0 && r < rows && c < cols;
}

// ---------------------------------------------------------------------------
// Footprint / occupancy helpers
// ---------------------------------------------------------------------------

/**
 * Effective footprint of a (possibly rotated) building. `rot: 1` is rendered as a mirror
 * about the anchor's base point, which in the diamond projection lands the art on the
 * TRANSPOSED footprint (offset (dr,dc) → (dc,dr)) — so the logical footprint must swap
 * w/h to match. Every footprint-derived check and overlay must go through this helper.
 */
export function footprintDims(def: { w: number; h: number }, rot?: 0 | 1): { w: number; h: number } {
  return rot === 1 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

function footprintCells(r: number, c: number, w: number, h: number): string[] {
  const cells: string[] = [];
  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) cells.push(`${r + dr},${c + dc}`);
  }
  return cells;
}

function buildingDef(key: string): TownBuildingDef | undefined { return TOWN_BUILDINGS[key]; }
function decorDef(key: string): TownDecorDef | undefined { return TOWN_DECOR[key]; }

/**
 * Every occupied cell — completed buildings, reserved queued-build footprints, and decor.
 * `excludeBuildingId` drops one building's cells (used by moveBuilding so a building can be
 * relocated over its own footprint).
 */
export function occupancy(town: TownState, excludeBuildingId?: string): Set<string> {
  const set = new Set<string>();
  for (const b of town.buildings) {
    if (b.id === excludeBuildingId) continue;
    const def = buildingDef(b.key);
    if (!def) continue;
    const { w, h } = footprintDims(def, b.rot);
    for (const cell of footprintCells(b.r, b.c, w, h)) set.add(cell);
  }
  for (const p of town.queue) {
    if (p.kind !== 'build' || p.r === undefined || p.c === undefined) continue;
    const def = buildingDef(p.key);
    if (!def) continue;
    const { w, h } = footprintDims(def, p.rot);
    for (const cell of footprintCells(p.r, p.c, w, h)) set.add(cell);
  }
  for (const d of town.decor) {
    const def = decorDef(d.key);
    if (!def) continue;
    for (const cell of footprintCells(d.r, d.c, def.w, def.h)) set.add(cell);
  }
  return set;
}

function footprintInBounds(r: number, c: number, w: number, h: number): boolean {
  return r >= 0 && c >= 0 && r + h <= MAX_GRID && c + w <= MAX_GRID;
}

function footprintUnlocked(deeds: number, r: number, c: number, w: number, h: number): boolean {
  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) {
      if (!inUnlockedLand(deeds, r + dr, c + dc)) return false;
    }
  }
  return true;
}

function overlaps(occ: Set<string>, r: number, c: number, w: number, h: number): boolean {
  return footprintCells(r, c, w, h).some((cell) => occ.has(cell));
}

// ---------------------------------------------------------------------------
// Prestige + perks (always derived)
// ---------------------------------------------------------------------------

/**
 * Prestige from completed buildings only — the labor-paced share. Deed/charter gates read
 * THIS (not total prestige), so zero-labor decor spam can't buy land (TOWN-17); decor
 * prestige still counts toward building unlocks (Chapel) and the displayed total.
 */
export function buildingPrestigeOf(town: TownState): number {
  let total = 0;
  for (const b of town.buildings) {
    const def = buildingDef(b.key);
    if (!def) continue;
    for (let t = 0; t < b.tier; t++) total += def.prestige[t] ?? 0;
  }
  return total;
}

/** Every cell covered by a completed building (footprintDims-aware). */
function buildingCells(town: TownState): Set<string> {
  const set = new Set<string>();
  for (const b of town.buildings) {
    const def = buildingDef(b.key);
    if (!def) continue;
    const { w, h } = footprintDims(def, b.rot);
    for (const cell of footprintCells(b.r, b.c, w, h)) set.add(cell);
  }
  return set;
}

/**
 * +1 prestige when the decor prop at (r, c) sits orthogonally adjacent to (or touching)
 * a completed building (TOWN-08) — placement becomes a light puzzle: props clustered
 * around the town's structures are worth more than props scattered on empty grass.
 */
export function decorAdjacencyBonus(town: TownState, r: number, c: number): number {
  const d = town.decor.find((x) => x.r === r && x.c === c);
  const def = d ? decorDef(d.key) : undefined;
  if (!d || !def) return 0;
  return decorAdjacent(buildingCells(town), d.r, d.c, def.w, def.h) ? 1 : 0;
}

function decorAdjacent(cells: Set<string>, r: number, c: number, w: number, h: number): boolean {
  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (
        cells.has(`${rr - 1},${cc}`) || cells.has(`${rr + 1},${cc}`) ||
        cells.has(`${rr},${cc - 1}`) || cells.has(`${rr},${cc + 1}`)
      ) return true;
    }
  }
  return false;
}

/** Total prestige: buildings + decor (+1 per building-adjacent prop) + commissioned charters. */
export function prestigeOf(town: TownState): number {
  let total = buildingPrestigeOf(town);
  const cells = buildingCells(town);
  for (const d of town.decor) {
    const def = decorDef(d.key);
    if (!def) continue;
    total += def.prestige;
    if (decorAdjacent(cells, d.r, d.c, def.w, def.h)) total += 1;
  }
  total += Math.max(0, town.deeds - TOWN_DEED_COSTS.length) * TOWN_CHARTER_PRESTIGE;
  return total;
}

// ---------------------------------------------------------------------------
// Deeds & charters (TOWN-06) — the open-ended pure-gold sink
// ---------------------------------------------------------------------------

/**
 * Gold cost of the next deed when `deeds` are already owned. The first three are the
 * land districts (TOWN_DEED_COSTS); every deed past those is a land-free "town charter"
 * at a doubling cost (8,000 / 16,000 / …) — the repeatable end-state sink.
 */
export function deedCost(deeds: number): number {
  if (deeds < TOWN_DEED_COSTS.length) return TOWN_DEED_COSTS[deeds];
  const last = TOWN_DEED_COSTS[TOWN_DEED_COSTS.length - 1];
  return last * TOWN_CHARTER_COST_MULT ** (deeds - TOWN_DEED_COSTS.length + 1);
}

/** Building-prestige gate for the next deed/charter when `deeds` are already owned. */
export function deedPrestigeGate(deeds: number): number {
  if (deeds < TOWN_DEED_PRESTIGE.length) return TOWN_DEED_PRESTIGE[deeds];
  const last = TOWN_DEED_PRESTIGE[TOWN_DEED_PRESTIGE.length - 1];
  return last + TOWN_CHARTER_GATE_STEP * (deeds - TOWN_DEED_PRESTIGE.length + 1);
}

/** A building's current perk magnitude — perkValues indexed by completed tier, clamped. */
function perkValueAt(def: TownBuildingDef, tier: number): number {
  if (!def.perkValues || def.perkValues.length === 0) return 0;
  return def.perkValues[Math.max(0, Math.min(tier, def.perkValues.length) - 1)];
}

/** Perks come from COMPLETED buildings only — a queued project grants nothing until it settles. */
export function townPerks(town: TownState): TownPerks {
  const perks: TownPerks = {
    sightBonus: 0,
    staminaBonus: 0,
    merchantDiscount01: 0,
    trialPractice: false,
    maxEnergyBonus: 0,
    laborDiscount01: 0,
    queueSlots: 1,
    forgeSweetBonus: 0,
  };
  for (const b of town.buildings) {
    const def = buildingDef(b.key);
    if (!def) continue;
    const v = perkValueAt(def, b.tier);
    switch (def.perk) {
      case 'sight': perks.sightBonus = v; break;
      case 'stamina': perks.staminaBonus = v; break;
      case 'haggle': perks.merchantDiscount01 = v; break;
      case 'practice': perks.trialPractice = true; break;
      case 'granary': perks.maxEnergyBonus = v; break;
      case 'mason': perks.laborDiscount01 = v; break;
      case 'forge_focus': perks.forgeSweetBonus = v; break;
    }
    if (b.key === KEEP_KEY && b.tier >= 3) perks.queueSlots = 2;
  }
  return perks;
}

// ---------------------------------------------------------------------------
// Placement validation
// ---------------------------------------------------------------------------

/**
 * Can `def` be placed at (r, c)? Reasons, in check order: bounds → locked → occupied
 * → unique → deed/prestige (distinct unlock gates) → queue_full. A reserved queued-build
 * footprint counts as occupied, so a second build on the same cells is refused.
 */
export function canPlace(
  town: TownState,
  def: TownBuildingDef,
  r: number,
  c: number,
  rot?: 0 | 1,
): { ok: true } | { ok: false; reason: PlaceReason } {
  const { w, h } = footprintDims(def, rot);
  if (!footprintInBounds(r, c, w, h)) return { ok: false, reason: 'bounds' };
  if (!footprintUnlocked(town.deeds, r, c, w, h)) return { ok: false, reason: 'locked' };
  if (overlaps(occupancy(town), r, c, w, h)) return { ok: false, reason: 'occupied' };
  if (def.unique && hasBuildingOrProject(town, def.key)) return { ok: false, reason: 'unique' };
  if (def.unlock?.deed !== undefined && town.deeds < def.unlock.deed) return { ok: false, reason: 'deed' };
  if (def.unlock?.prestige !== undefined && prestigeOf(town) < def.unlock.prestige) return { ok: false, reason: 'prestige' };
  if (town.queue.length >= townPerks(town).queueSlots) return { ok: false, reason: 'queue_full' };
  return { ok: true };
}

function hasBuildingOrProject(town: TownState, key: string): boolean {
  return town.buildings.some((b) => b.key === key) || town.queue.some((p) => p.kind === 'build' && p.key === key);
}

// ---------------------------------------------------------------------------
// Queue / cancel
// ---------------------------------------------------------------------------

/** Snapshot the tier's labor cost, applying the Mason's Guild discount at queue time. */
function snapLaborNeed(town: TownState, rawLabor: number): number {
  return Math.ceil(rawLabor * (1 - townPerks(town).laborDiscount01));
}

/** Queue a new build. Returns null if placement is invalid; the slice charges gold+materials first. */
export function queueBuild(
  town: TownState,
  def: TownBuildingDef,
  r: number,
  c: number,
  rot: 0 | 1 | undefined,
  id: string,
): TownState | null {
  const place = canPlace(town, def, r, c, rot);
  if (!place.ok) return null;
  const project: TownProject = {
    id,
    kind: 'build',
    key: def.key,
    r, c, rot,
    laborNeed: snapLaborNeed(town, def.tiers[0].labor),
    laborApplied: 0,
  };
  return { ...town, queue: [...town.queue, project] };
}

/** Queue an upgrade of an existing building to its next tier. Returns null if invalid. */
export function queueUpgrade(town: TownState, buildingId: string, id: string): TownState | null {
  const building = town.buildings.find((b) => b.id === buildingId);
  if (!building) return null;
  const def = buildingDef(building.key);
  if (!def || building.tier >= def.maxTier) return null;
  if (town.queue.some((p) => p.buildingId === buildingId)) return null; // already queued
  if (town.queue.length >= townPerks(town).queueSlots) return null;     // queue_full
  const project: TownProject = {
    id,
    kind: 'upgrade',
    key: building.key,
    buildingId,
    laborNeed: snapLaborNeed(town, def.tiers[building.tier].labor),
    laborApplied: 0,
  };
  return { ...town, queue: [...town.queue, project] };
}

/**
 * Cancel a queued project: 100% of the escrowed materials are refunded (the tier's material
 * cost), gold stays sunk (0%), and any applied labor is forfeited.
 */
export function cancelProject(town: TownState, projectId: string): { town: TownState; refundMaterials: Record<string, number> } {
  const project = town.queue.find((p) => p.id === projectId);
  if (!project) return { town, refundMaterials: {} };
  const def = buildingDef(project.key);
  const refundMaterials: Record<string, number> = {};
  if (def) {
    // Build escrow = tiers[0]; upgrade escrow = tiers[currentTier] (a tier-T building's next-tier cost).
    const idx = project.kind === 'build'
      ? 0
      : town.buildings.find((b) => b.id === project.buildingId)?.tier ?? 0;
    const cost = def.tiers[idx];
    if (cost) for (const [mat, qty] of Object.entries(cost.materials)) refundMaterials[mat] = qty;
  }
  return { town: { ...town, queue: town.queue.filter((p) => p.id !== projectId) }, refundMaterials };
}

// ---------------------------------------------------------------------------
// Labor pipeline
// ---------------------------------------------------------------------------

/**
 * Bank `amount` new labor (day-capped by TOWN_LABOR_DAILY_CAP via laborISO/laborToday, bank-capped
 * by TOWN_LABOR_BANK_CAP — overflow is lost), then drain the bank into the active projects
 * queue[0..queueSlots) in order. Call with amount 0 to drain a pre-existing bank into a freshly
 * queued project. `todayISO` is the calendar day (injected — the engine has no clock).
 */
export function applyLabor(town: TownState, amount: number, todayISO: string): TownState {
  const sameDay = town.laborISO === todayISO;
  const usedToday = sameDay ? town.laborToday : 0;
  const grantable = Math.max(0, Math.min(amount, TOWN_LABOR_DAILY_CAP - usedToday));
  const laborToday = usedToday + grantable;
  let bank = Math.min(town.laborBank + grantable, TOWN_LABOR_BANK_CAP);

  const slots = townPerks(town).queueSlots;
  const queue = town.queue.map((p) => ({ ...p }));
  for (let i = 0; i < queue.length && i < slots && bank > 0; i++) {
    const need = queue[i].laborNeed - queue[i].laborApplied;
    if (need <= 0) continue;
    const take = Math.min(bank, need);
    queue[i].laborApplied += take;
    bank -= take;
  }

  return { ...town, laborBank: bank, laborISO: todayISO, laborToday, queue };
}

/**
 * Undo path (habit un-completion): remove `amount` labor — from the bank first, then from the
 * least-progressed active project(s). Everything clamps at 0, and laborToday is decremented so the
 * day cap "refills". Labor that already completed a project is an accepted, clamped leak.
 */
export function clawBackLabor(town: TownState, amount: number, todayISO: string): TownState {
  let remaining = Math.max(0, amount);
  let bank = town.laborBank;
  const fromBank = Math.min(bank, remaining);
  bank -= fromBank;
  remaining -= fromBank;

  const queue = town.queue.map((p) => ({ ...p }));
  // least-progressed first (ascending laborApplied)
  const order = queue.map((_, i) => i).sort((a, b) => queue[a].laborApplied - queue[b].laborApplied);
  for (const i of order) {
    if (remaining <= 0) break;
    const take = Math.min(queue[i].laborApplied, remaining);
    queue[i].laborApplied -= take;
    remaining -= take;
  }

  const sameDay = town.laborISO === todayISO;
  const laborToday = sameDay ? Math.max(0, town.laborToday - Math.max(0, amount)) : town.laborToday;
  return { ...town, laborBank: bank, laborToday, queue };
}

/**
 * Settle any project whose labor is complete: a build spawns its building at tier 1 (reusing the
 * project id as the stable building id), an upgrade bumps its target building's tier. Returns the
 * removed (completed) projects so the caller can celebrate them.
 */
export function settleProjects(town: TownState): { town: TownState; completed: TownProject[] } {
  const completed = town.queue.filter((p) => p.laborApplied >= p.laborNeed);
  if (completed.length === 0) return { town, completed };

  let buildings = town.buildings.map((b) => ({ ...b }));
  for (const p of completed) {
    if (p.kind === 'build' && p.r !== undefined && p.c !== undefined) {
      buildings.push({ id: p.id, key: p.key, r: p.r, c: p.c, tier: 1, rot: p.rot });
    } else if (p.kind === 'upgrade') {
      buildings = buildings.map((b) => (b.id === p.buildingId ? { ...b, tier: b.tier + 1 } : b));
    }
  }
  const queue = town.queue.filter((p) => p.laborApplied < p.laborNeed);
  return { town: { ...town, buildings, queue }, completed };
}

// ---------------------------------------------------------------------------
// Demolish / move
// ---------------------------------------------------------------------------

/**
 * Demolish a building: refunds 50% of its CUMULATIVE tier materials (floored), 0% gold. The Keep
 * cannot be demolished, and neither can a building a queued upgrade targets — demolishing it
 * would orphan the project (queue-slot lock, labor sink, wrong cancel refund). Both no-op.
 */
export function demolish(town: TownState, buildingId: string): { town: TownState; refundMaterials: Record<string, number> } {
  const building = town.buildings.find((b) => b.id === buildingId);
  if (!building || building.key === KEEP_KEY) return { town, refundMaterials: {} };
  if (town.queue.some((p) => p.buildingId === buildingId)) return { town, refundMaterials: {} };
  const def = buildingDef(building.key);
  const cumulative: Record<string, number> = {};
  if (def) {
    for (let t = 0; t < building.tier; t++) {
      for (const [mat, qty] of Object.entries(def.tiers[t]?.materials ?? {})) {
        cumulative[mat] = (cumulative[mat] ?? 0) + qty;
      }
    }
  }
  const refundMaterials: Record<string, number> = {};
  for (const [mat, qty] of Object.entries(cumulative)) refundMaterials[mat] = Math.floor(qty * 0.5);
  return { town: { ...town, buildings: town.buildings.filter((b) => b.id !== buildingId) }, refundMaterials };
}

/**
 * Can `buildingId` relocate to (r, c) with `rot`? The single validation path for moves —
 * the ghost, the slice action, and moveBuilding itself all share it (TOWN-09).
 */
export function canMoveBuilding(
  town: TownState,
  buildingId: string,
  r: number,
  c: number,
  rot?: 0 | 1,
): { ok: true } | { ok: false; reason: MoveReason } {
  const building = town.buildings.find((b) => b.id === buildingId);
  if (!building) return { ok: false, reason: 'missing' };
  if (town.queue.some((p) => p.buildingId === buildingId)) return { ok: false, reason: 'busy' };
  const def = buildingDef(building.key);
  if (!def) return { ok: false, reason: 'missing' };
  const { w, h } = footprintDims(def, rot);
  if (!footprintInBounds(r, c, w, h)) return { ok: false, reason: 'bounds' };
  if (!footprintUnlocked(town.deeds, r, c, w, h)) return { ok: false, reason: 'locked' };
  if (overlaps(occupancy(town, buildingId), r, c, w, h)) return { ok: false, reason: 'occupied' };
  return { ok: true };
}

/** Relocate a building (free). Blocked while a project targets it; validates the new footprint. */
export function moveBuilding(town: TownState, buildingId: string, r: number, c: number, rot?: 0 | 1): TownState | null {
  if (!canMoveBuilding(town, buildingId, r, c, rot).ok) return null;
  const buildings = town.buildings.map((b) => (b.id === buildingId ? { ...b, r, c, rot } : b));
  return { ...town, buildings };
}

// ---------------------------------------------------------------------------
// Decor
// ---------------------------------------------------------------------------

/**
 * Can `def` decor be placed at (r, c)? The single validation path for decor — the ghost
 * and placeDecor share it (TOWN-09). Checks caps first (global, then per-type), then the
 * footprint (bounds → locked → occupied). Decor never rotates.
 */
export function canPlaceDecor(
  town: TownState,
  def: TownDecorDef,
  r: number,
  c: number,
): { ok: true } | { ok: false; reason: DecorPlaceReason } {
  if (town.decor.length >= TOWN_DECOR_CAP) return { ok: false, reason: 'decor_cap' };
  if (town.decor.filter((d) => d.key === def.key).length >= TOWN_DECOR_PER_TYPE_CAP) {
    return { ok: false, reason: 'type_cap' };
  }
  if (!footprintInBounds(r, c, def.w, def.h)) return { ok: false, reason: 'bounds' };
  if (!footprintUnlocked(town.deeds, r, c, def.w, def.h)) return { ok: false, reason: 'locked' };
  if (overlaps(occupancy(town), r, c, def.w, def.h)) return { ok: false, reason: 'occupied' };
  return { ok: true };
}

/** Place a decor prop (global + per-type caps, footprint validation). `v` is rolled by the slice. */
export function placeDecor(town: TownState, def: TownDecorDef, r: number, c: number, v: number): TownState | null {
  if (!canPlaceDecor(town, def, r, c).ok) return null;
  return { ...town, decor: [...town.decor, { key: def.key, r, c, v }] };
}

/** Remove the decor anchored at (r, c): refunds 50% of its materials (floored). */
export function removeDecor(town: TownState, r: number, c: number): { town: TownState; refundMaterials: Record<string, number> } {
  const idx = town.decor.findIndex((d) => d.r === r && d.c === c);
  if (idx < 0) return { town, refundMaterials: {} };
  const def = decorDef(town.decor[idx].key);
  const refundMaterials: Record<string, number> = {};
  if (def) for (const [mat, qty] of Object.entries(def.materials)) refundMaterials[mat] = Math.floor(qty * 0.5);
  const decor = town.decor.slice(0, idx).concat(town.decor.slice(idx + 1));
  return { town: { ...town, decor }, refundMaterials };
}
