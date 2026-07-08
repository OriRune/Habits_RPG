# The Homestead — Town-Builder Development Plan

## 1. Context & Goal

The gold economy goes post-scarce in under a week (BAL-05: ~2,030g of reachable one-time sinks against 300–900g/day mid-game faucets), and the Phase 4 close-out recorded an accepted gap in plan3's deferred table: **no repeatable ≥500g pure-gold sink exists** — the "repeatable scaling sink, best fit for 'always something to want'" option was weighed and deferred. Separately, `stone` and `wood` are *doubly dead* materials: defined in `src/content/materials.ts:25-26` with **no source and no sink**, and the Forge (Phase 8) consumes the BAL-16 dead-end list but adds no scaling gold pit.

**The Homestead** is an isometric town the player builds on a square grid — a persistent home base, not a run. Placing or upgrading a building charges gold + materials up front (the sink); construction then completes via **labor earned from live habit completions**, so the daily habit loop literally raises the town. Land deeds (district expansion) are the pure-gold ≥500g repeatable-scaling targets. Completed buildings grant light, strictly non-resource perks at existing engine seams.

This amends plan3's non-goal "no new minigame except the Forge" on the same grounds the Forge was sanctioned: it exists to serve the economy, not to add content for its own sake.

### Locked design decisions

| Decision | Choice |
|---|---|
| Purpose | Long-term repeatable sink for gold + materials; deeds are the ≥500g pure-gold targets (BAL-05 deferred row) |
| Perks | Light, non-resource QoL/boosts only. Buildings **never** produce gold, materials, or energy |
| Pacing | Habit-driven **labor** (difficulty-scaled, daily-capped). No wall-clock timers. No energy cost to enter |
| Multiplayer | Solo v1; read-only party visits in a later phase (forward-compat baked in now — see §7) |
| Art | Procedural in-house SVG (layered shapes/gradients, palette-aware). No image assets |
| Customization | Building tiers (visual growth + prestige), free relocation, decor, paths, district deeds |
| Platform | Touch-first. This mode is **not** real-time and is NOT gated by Phase 9's coarse-pointer check |
| Cost timing | Gold + materials charged at **queue time** (escrow) — no free plot reservation; cancel/refund rules stay trivial |
| Demolish | Refunds 50% of cumulative tier materials, **0% gold** (the sink stays sunk). The Keep cannot be demolished |
| Entry point | 4th Explore hub card ("The Homestead") — the mobile bottom bar is already full |

### Open questions (defaults apply if not answered before M4)

1. **Labor bank cap?** *(Default: 200 — enough to pre-fund a mid-size building, not a district; overflow is lost with a HUD hint "bank full — start a project".)*
2. **Paths in v1?** *(Default: one cobble-path decor entry ships in M4 as plain ground overlay; auto-connecting visuals land in M6.)*
3. **Decor caps?** *(Default: 60 decor total, 10 per type — save-size and render-budget guard.)*
4. **Mode name** *(Default: "The Homestead"; the arc reads homestead → hamlet → village → town as districts unlock.)*

---

## 2. Data Model

### 2.1 Persisted state

Compact by construction: ids + coords + counters only. A maxed town (~20 buildings, 60 decor, 2 queued projects) serializes to ≈3.5 KB — negligible in the localStorage save and the cloud CAS envelope. `town` is **persistent** state (like `economySlice` records): it is NOT added to `TRANSIENT_KEYS` in `src/net/cloudSave.ts` and must ride the cloud blob.

```ts
// src/engine/town.ts — pure module, no React/store imports
export interface TownBuilding {
  id: string;           // uid() — stable handle; the only key future party-visit payloads need
  key: string;          // catalog key in TOWN_BUILDINGS
  r: number; c: number; // anchor cell (top-left of footprint)
  tier: number;         // 1..maxTier (completed tier)
  rot?: 0 | 1;          // mirror variant, only when def.rotatable
}

export interface TownDecor {
  key: string; r: number; c: number;
  v?: number;           // visual-variant seed (0..3), rolled at placement
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
```

- `GameState` (`src/store/shared.ts`) gains `town: TownState`.
- `Habit` gains optional `lastLaborGrantISO?: string` — the same once-per-day marker idiom as `lastEnergyGrantISO`; absent ⇒ never granted, zero backfill.
- **Never persisted** (always derived): cell occupancy, prestige, active perks.

### 2.2 Content catalog — `src/content/townBuildings.ts` + `townDecor.ts`

```ts
export type TownPerkId =
  | 'sight'        // Watchtower: +1 crawler sight radius (mine + forest)
  | 'stamina'      // Bathhouse: +10 crawler max stamina
  | 'haggle'       // Trading Post: 15% dungeon-merchant discount
  | 'practice'     // Training Yard: replay cleared trials (no energy, no reward)
  | 'granary'      // Granary: +2 max energy cap
  | 'mason'        // Mason's Guild: −10% labor cost on new projects
  | 'forge_focus'; // Smithy: +0.03 Forge sweet-zone width (consumed by Phase 8's forge.ts)

export interface TownTierCost { gold: number; materials: Record<string, number>; labor: number; }

export interface TownBuildingDef {
  key: string; name: string; flavor: string;
  w: number; h: number;          // footprint in cells
  maxTier: number;
  tiers: TownTierCost[];         // tiers[0] = build cost; tiers[i] = upgrade to tier i+1
  perk?: TownPerkId;             // active once tier 1 completes; flat across tiers
  prestige: number[];            // prestige granted per completed tier
  unlock?: { deed?: number; prestige?: number };
  artKey: string;
  rotatable?: boolean;
  unique: boolean;               // all v1 buildings are unique; decor is not
}

export const TOWN_DEED_COSTS = [500, 1500, 4000];   // pure gold — the BAL-05 targets
export const TOWN_DEED_PRESTIGE = [100, 200, 320];  // prestige gate per deed (M6-tuned: 40/120/260 made deed 1 reachable in ~4 days; 100 lands it ~week 2)
export const TOWN_LABOR_DAILY_CAP = 24;             // BAL-22 guard
export const TOWN_LABOR_BANK_CAP = 200;
export const TOWN_LABOR_RATE: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 4, epic: 6 };
export const TOWN_DECOR_CAP = 60;
export const TOWN_DECOR_PER_TYPE_CAP = 10;
```

**v1 building roster** (exact costs live in the catalog; the schedule below is the starting curve, tuned in M6):

| Building | Footprint | Tiers | Perk | Unlock |
|---|---|---|---|---|
| The Keep | 3×3 | I–IV | tier III: +1 project slot | none — **mandatory first project** (cheap tier I ≈ tutorial) |
| Watchtower | 1×1 | I–III | `sight` | — |
| Bathhouse | 2×2 | I–III | `stamina` | — |
| Trading Post | 2×2 | I–III | `haggle` | — |
| Training Yard | 2×3 | I–III | `practice` | — |
| Granary | 2×2 | I–III | `granary` | — |
| Mason's Guild | 2×2 | I–III | `mason` | — |
| Smithy | 2×2 | I–III | `forge_focus` | Phase 8 dependency — card reads "the forge stands cold" if Forge constants absent |
| Chapel | 2×2 | I–III | — (prestige) | prestige ≥ 80 |
| Manor | 2×3 | I–III | — (prestige) | deed ≥ 2 |

**Cost schedule (starting values):** small buildings (1×1) 150 / 500 / 1,400g; medium (2×2, 2×3) 200 / 650 / 1,800g; Keep 100 / 600 / 2,000 / 5,000g. Materials lean on `stone` + `wood` at every tier (the BAL-16 fix deepened), with band materials (`iron_bar`, `gemstone`, `frost_quartz`, `obsidian`, `amber_resin`) entering at tiers II–III so late-game drops keep a destination. Labor: ~15 / 30 / 55 per tier (Keep 20 / 45 / 80 / 120) — a 4-habit day (~12 labor) finishes a tier-I building in ~2 days, the pacing target.

**v1 decor (~10):** lamppost, well, hedge, flower bed, banner, fountain (2×2), statue, cart, tree, cobble path. Cheap-to-mid costs (10–80g + stone/wood); repeatable within the per-type cap.

**Prestige:** per-tier grants (small 10/15/25; medium 15/25/40; Keep 25/40/70/120; decor 1–3 each). `prestigeOf(town)` = sum over completed tiers + decor. Gates deeds (see `TOWN_DEED_PRESTIGE`) and the Chapel.

### 2.3 Engine API — `src/engine/town.ts` (pure, reducer-style, RNG-free, clock-free)

```ts
export function freshTown(): TownState;
export function laborFor(difficulty: Difficulty): number;
export function gridSizeFor(deeds: number): { rows: number; cols: number };   // 14 / 18 / 21 / 24 square
export function inUnlockedLand(deeds: number, r: number, c: number): boolean;
export function occupancy(town: TownState): Set<string>;   // "r,c" keys: buildings + reserved queue footprints + decor
export function canPlace(town: TownState, def: TownBuildingDef, r: number, c: number, rot?: 0 | 1):
  { ok: true } | { ok: false; reason: 'bounds' | 'occupied' | 'locked' | 'unique' | 'prestige' | 'queue_full' };
export function prestigeOf(town: TownState): number;       // DERIVED — never persisted
export function townPerks(town: TownState): TownPerks;     // from COMPLETED buildings only (queued ≠ perk)
export function queueBuild(town, def, r, c, rot, id): TownState | null;   // null = invalid; slice charges cost first
export function queueUpgrade(town, buildingId, id): TownState | null;
export function cancelProject(town, projectId): { town: TownState; refundMaterials: Record<string, number> };
export function applyLabor(town, amount, todayISO): TownState;   // day cap + bank cap + drain into queue[0..slots)
export function clawBackLabor(town, amount, todayISO): TownState; // undo path: bank first, then least-progressed project, all clamped ≥0
export function settleProjects(town): { town: TownState; completed: TownProject[] };
export function demolish(town, buildingId): { town: TownState; refundMaterials: Record<string, number> };
export function moveBuilding(town, buildingId, r, c, rot?): TownState | null; // free; blocked while a project targets it
export function placeDecor(town, def, r, c, v): TownState | null;
export function removeDecor(town, r, c): { town: TownState; refundMaterials: Record<string, number> };
```

```ts
export interface TownPerks {
  sightBonus: number;         // 0 | 1
  staminaBonus: number;       // 0 | 10
  merchantDiscount01: number; // 0 | 0.15
  trialPractice: boolean;
  maxEnergyBonus: number;     // 0 | 2
  laborDiscount01: number;    // 0 | 0.10  (applied to laborNeed at queue time — snapshotted)
  queueSlots: number;         // 1 | 2     (Keep tier ≥ III)
  forgeSweetBonus: number;    // 0 | 0.03  (consumed by Phase 8's strikeSweetHalf/heatBandWidth)
}
```

The engine takes `todayISO` as a parameter wherever the calendar matters — the clock stays behind `engine/date.ts::now()` at the slice layer, per the server-time seam.

### 2.4 Slice API — `src/store/slices/townSlice.ts`

Modeled on `craft()` (`src/store/slices/economySlice.ts:161-181`): validate → subtract `Record<matId, qty>` + gold → write partial. All actions `set((s) => …)`, all respect `s.settings.unlimitedGold`.

```ts
export interface TownSlice {
  town: TownState;
  townQueueBuild: (key: string, r: number, c: number, rot?: 0 | 1) => void; // charge + escrow, then drain laborBank
  townQueueUpgrade: (buildingId: string) => void;
  townCancelProject: (projectId: string) => void;  // 100% materials back, 0% gold, applied labor forfeited
  townBuyDeed: () => void;                         // TOWN_DEED_COSTS[deeds], prestige-gated
  townPlaceDecor: (key: string, r: number, c: number) => void;
  townRemoveDecor: (r: number, c: number) => void; // 50% materials, matching demolish
  townDemolish: (buildingId: string) => void;
  townMoveBuilding: (buildingId: string, r: number, c: number, rot?: 0 | 1) => void;
}
```

Selectors (`src/store/selectors.ts`): `selectTownPerks` (reference-cached on `s.town`), `selectTownPrestige`.

### 2.5 Persist migration — `src/store/useGameStore.ts`

- Bump `version` 32 → **33**. Comment-block entry: *"v33: The Homestead — new top-level `town` (`freshTown()` on existing saves) + optional Habit field `lastLaborGrantISO` (absent ⇒ not yet granted, no backfill — v29 idiom). Crawler snapshot fields `sightBonus`/`staminaBonus` ride the existing run-clear (`mining: null`, `forest: null` already in migrate)."*
- `migrate()`: `town: p.town ?? freshTown()`.
- `merge()`: `town: { ...freshTown(), ...(p.town ?? {}) }` — nested-default idiom so fields added in later versions backfill.
- `TRANSIENT_KEYS` (`src/net/cloudSave.ts`): **unchanged** — town must persist to cloud.

---

## 3. Mechanics

### 3.1 Labor pipeline

**Grant — `habitsSlice.ts` `completeHabit`:** beside the energy grant (`habitsSlice.ts:186-197`), compute `grantLabor = isToday && habit.lastLaborGrantISO !== day`. Labor uses its **own marker**, not the energy marker: energy is additionally gated by `energy < maxEnergyFor(s)`, and labor must not silently stop on a full-energy day. When granted, set `updated.lastLaborGrantISO = day` and, in the `next` construction (after the energy block at `:266-272`):

```ts
if (grantLabor) {
  const { town, completed } = settleProjects(applyLabor(next.town, laborFor(habit.difficulty), today));
  next.town = town;
  // `completed` → post-commit celebration toast (milestone-toast pattern, habitsSlice.ts:307-317)
}
```

The receipt toast gains a `+N 🔨` part when labor actually banked; a day-capped grant shows "town cap reached" instead (mirrors the "logged late — no energy" copy).

**Undo — `uncompleteHabit`:** mirror the energy-refund block (`:374-379`):

```ts
if (day === today && habit.lastLaborGrantISO === day) {
  next.town = clawBackLabor(next.town, laborFor(habit.difficulty), today);
}
```

Claw-back drains `laborBank` first, then the least-progressed active project, clamping everything at 0 and decrementing `laborToday`. Labor that already **completed** a project is an accepted, clamped leak — the same philosophy as the milestone claw-back (`:383-394`). The marker is intentionally NOT cleared (HABIT-04 idiom: same-day re-complete cannot re-mint).

**Guards:** `TOWN_LABOR_DAILY_CAP = 24` inside `applyLabor` via `laborISO`/`laborToday`. This is the BAL-22 mirror: 24 trivial habits pay the same labor as 6 epic ones, and breadth beyond that pays nothing. Backdated completions grant no labor (live-only, like energy).

**Labor is not a resource.** It never passes through `applyReward`, never appears in the earnings ledger, and no `'town'` `EarningSource` is added — the town only spends.

### 3.2 Isometric renderer

**`src/components/town/iso.ts`** — pure square-grid projection, sibling of `src/components/tactics/iso.ts` (which proved the SVG-polygon extrusion approach):

```ts
export const TOWN_TILE_W = 64;                    // diamond width (px in viewBox units)
export const TOWN_VSQUASH = 0.5;                  // classic 2:1 diamonds
export const TOWN_TILE_H = TOWN_TILE_W * TOWN_VSQUASH;

export function base(r: number, c: number): Pt;   // { x: (c-r)*W/2, y: (c+r)*H/2 } — ground centre
export function diamondCorners(w?: number, h?: number): Pt[];      // footprint outline (N/E/S/W)
export function cellFromPoint(x: number, y: number): { r: number; c: number };  // inverse projection
export function isoBounds(rows: number, cols: number, headroom: number): IsoBounds;
export function sortKey(r: number, c: number, w: number, h: number): number;
// painter order: (r+h-1)+(c+w-1), tie-break r — multi-tile-footprint safe
```

**Scene — `src/components/town/TownCanvas.tsx`:** one `<svg viewBox>` sized by `isoBounds(gridSizeFor(deeds))`, four layers:

1. **ground** — every cell a `<polygon>` diamond (two-step lightness checker; locked districts desaturated behind a dashed deed boundary; cobble paths render here). `React.memo` keyed on `deeds` + path set — static during pan/zoom.
2. **highlight** — hover/selection ring, ghost-placement footprint tinted by `canPlace` (emerald = valid, ember = invalid).
3. **objects** — buildings, decor, and construction sites, flat-sorted ascending `sortKey` (~80 entries; footprints never overlap, so paint order alone gives correct occlusion). Each entry: `<g transform={translate(base(r,c))}>{art}</g>`; `rot === 1` mirrors with `scale(-1,1)`. Queued builds render a **scaffold** (timber frame + progress ring showing `laborApplied/laborNeed`) — the visibly under-construction town is the daily-return hook.
4. **fx** — completion sparkle, selected-building glow (skipped under `prefers-reduced-motion`).

**Procedural art — `src/components/town/townArt.tsx`:** a primitive kit — `isoBox(w, d, h)` (top rhombus + left/right parallelogram faces, lift ≈ `0.47 × TOWN_TILE_W` per height unit, matching the tactics silhouette language), `roofGable`, `roofHip`, `awning`, `banner`, `chimney`, `windowRow` — all `<polygon>`/`<path>` with soft `<linearGradient>` fills. Per-`artKey` composer functions `(tier, variant) => ReactNode`; tier growth is **additive layers** (tier I = base volume + flat roof; II = extra story + gable + trim; III = gilding, banners, gold accents), so no bespoke per-tier art is needed beyond parameters.

**Palette-awareness:** all themed fills go through Tailwind `fill-*`/`stroke-*` utilities (which resolve to `rgb(var(--c-*))`) or inline `rgb(var(--c-…))` gradient stops — the town re-skins automatically on palette and dark-mode changes. A small role map (`wall → parchment-300`, `roofA → ember`, `roofB → gold-deep`, `timber → wood-600`, `trim → gold`) keeps composers consistent; `grass`/`water`/`foliage` are fixed jewel tones (unthemed, same precedent as stat identity colors in `palettes.ts`).

**Pan/zoom:** a wrapping `<g ref={worldRef}>` whose transform is written **directly via ref** inside pointer handlers (the Mine's rAF-refs idiom — zero React re-renders per move); `{x, y, scale}` commits to state only on gesture end. One-finger drag pans, two-pointer pinch zooms (pointer map + distance ratio), wheel zooms with cursor anchoring, scale clamped 0.5–2.0. The `viewBox` stays fixed so hit geometry and the memoized ground layer stay valid.

**Hit-testing & placement UX:** native SVG pointer events — ground diamonds take `onPointerUp` (suppressed when the gesture moved > 8 px), buildings `stopPropagation`. Flow: bottom-sheet palette (`TownBuildPanel.tsx` — buildings / decor / deeds tabs, cost rows with affordability tinting, 44 px targets) → tap an entry → placement mode: tapping a cell moves the ghost; explicit **Confirm / Rotate / Cancel** buttons docked above the sheet (no tap-to-commit on touch). Selecting an existing building opens `TownBuildingCard.tsx` (tier, perk, upgrade cost, move / demolish behind a confirm dialog).

**Node budget:** 24×24 ground = 576 static polygons + ~80 objects × ~12 shapes ≈ 1.6k nodes, no rAF loop, transform-only pan — comfortable on mobile SVG. Escape hatch if a low-end phone chugs: collapse the ground layer to one `<path>` per district.

### 3.3 Perk wiring — verified seams

| Perk | Seam | Change |
|---|---|---|
| `sight` +1 | `mining.ts:324` `sightRadiusFor` (+ forest twin) | Optional `sightBonus?: number` on `MineSnapshot`/`MineState` + forest twins; `sightRadiusFor` adds `state.sightBonus ?? 0`. Set from `townPerks(s.town)` in `beginMining`/`beginForest` snapshot literals. Snapshot-at-run-start = co-op-safe. |
| `stamina` +10 | `miningSlice.ts:111` `maxSta = dungeonStamina(…)` (+ forest twin) | `+ townPerks(s.town).staminaBonus` at both call sites. |
| `haggle` 15% | `dungeon.ts:76-82` `merchantOffers(depth)`; sole caller `shared.ts:1066` `enterRoom` | `merchantOffers(depth, discount01 = 0)` with `cost: Math.max(1, Math.round(base × (1 − discount01)))`; `enterRoom` passes the perk. `dungeonBuy` reads `offer.cost` — no change. |
| `practice` | `trialsSlice.ts:52-75` `beginTrial`; `completeTrial` already early-returns on same-day clear (`:85`) before touching scores/rewards | When cleared-today AND perk: skip the `'cleared'` refusal and the energy charge, still bump `trialAttemptNonce`, return `{ ok: true, practice: true }` (extend `TrialBeginResult`). Trial hub shows a Practice badge. Reward inflation is impossible by the existing early-return. |
| `granary` +2 | `shared.ts:1222` `MAX_ENERGY = 15` | New `maxEnergyFor(s) = MAX_ENERGY + townPerks(s.town).maxEnergyBonus`; replace reads at the grant check, both clamps, the refund guard, `devFillEnergy`, and UI `x/15` displays (grep `MAX_ENERGY` at implementation time). |
| `mason` −10% | engine-internal | `laborNeed = ceil(def.labor × (1 − laborDiscount01))` at queue time — snapshotted, so demolishing the Guild later never retro-inflates live projects. |
| queue +1 | engine-internal | `queueSlots = keepTier >= 3 ? 2 : 1`; `applyLabor` fills `queue[0..slots)` in order. |
| `forge_focus` | Phase 8's `strikeSweetHalf`/`heatBandWidth` (forge plan §M2) | Consumed as `SWEET_HALF_BASE + forgeSweetBonus`. Phase ordering puts the Forge first; if order ever flips, the perk is dormant and the Smithy card reads "the forge stands cold". |

**Perk power budget:** every perk stays at or below a single boon/gear increment (+1 sight, +10 stamina, +2 energy cap, 15% merchant) so the Homestead never becomes a mandatory power ladder — it must stay a sink players *want*, not one they must grind.

---

## 4. Milestones

Build in strict order. Every milestone leaves `npm run test` and `npm run typecheck` green.

---

### M1 — Engine, catalog, slice, persistence, material sources (invisible)

**Changes**
- **New** `src/engine/town.ts` — §2.1 types, §2.3 API, `TOWN_*` constants. Pure: no clock (`todayISO` injected), no RNG, no React/store imports.
- **New** `src/content/townBuildings.ts`, `src/content/townDecor.ts` — §2.2 catalogs.
- **New** `src/store/slices/townSlice.ts` — §2.4; register in the `useGameStore.ts` slice spread; action signatures onto `GameState` in `shared.ts`.
- `src/store/useGameStore.ts` — version 33 + migrate/merge per §2.5.
- **Material sources:** `content/mining.ts` — new node `stone_lode` (floorMin 1, common weight, `material: 'stone'`, amount [1,2], mirroring the gemstone node shape); `content/forest.ts` — new node `timber_stand` (stageMin 1, `material: 'wood'`, mirroring the herbs node). Pure content — stone/wood start accruing a release before the town UI ships.

**Tests** (`src/engine/__tests__/town.test.ts` + slice/migration tests)
- `canPlace`: bounds / overlap (incl. reserved queue footprints) / locked district / unique / prestige gate.
- `queueBuild` reserves the footprint (second build on the same cells fails); `queue_full` at slot cap.
- `applyLabor`: day cap (25th point refused), bank cap, multi-project fill order; `settleProjects` tier-up and perk activation.
- `cancelProject` (100% materials) / `demolish` (50% of **cumulative** tier materials) refund math; Keep undemolishable.
- `prestigeOf` / `townPerks` derivations; deed gating (gold + prestige).
- Slice: `townQueueBuild` charges gold + materials, respects `unlimitedGold` (clone the `craft` test shape).
- Migration: v32 envelope → v33 yields `freshTown()`; nested merge backfills.

**Ship state:** nothing player-visible except stone/wood dropping in mine/forest runs.

---

### M2 — Labor pipeline (still invisible)

**Changes:** `habitsSlice.ts` grant + claw-back per §3.1 (own marker, receipt-toast `+N 🔨`, completion toast); engine `clawBackLabor`; `selectors.ts` `selectTownPerks`/`selectTownPrestige`.

**Tests**
- Complete grants difficulty-scaled labor once per habit per day; backdated completion grants none.
- Complete → uncomplete claws back bank-first-then-project, clamped; same-day re-complete does not re-mint.
- Energy-at-cap day still grants labor (markers independent).
- A completion that finishes a project settles it (building appears at tier 1, perk goes live).

**Ship state:** labor silently accrues in `laborBank` — it pre-funds early adopters' first Keep, a nice launch surprise.

---

### M3 — Iso renderer, read-only, + entry point

**Changes:** **new** `components/town/iso.ts` (+ `iso.test.ts`: projection/`cellFromPoint` round-trip, `sortKey` ordering incl. multi-tile footprints), `TownCanvas.tsx`, `townArt.tsx` (primitive kit + three placeholder composers: generic house box, Keep, scaffold), **new** `src/views/TownView.tsx`; `ExploreView.tsx` — 4th `HubCard` (`id: 'town'`, label "The Homestead", `Home` icon), with `TownView` behind `React.lazy`/`Suspense` so the SVG art stays out of the main chunk. No energy gate.

**Manual verification:** pan/pinch on a real phone; locked districts render dashed; buildings from M2 labor appear; dark mode + all premade palettes + one custom palette look coherent.

---

### M4 — Build/placement UX (the feature goes live)

**Changes:** `TownBuildPanel.tsx` (bottom-sheet palette: buildings / decor / deeds tabs, cost + prestige rows), placement mode (ghost, valid/invalid tint, Confirm / Rotate / Cancel), `TownBuildingCard.tsx` (upgrade / move / demolish + confirm dialogs), scaffold + progress ring on queued projects, deed purchase flow (district unfolds with a small transition), completion toasts, hub-card guide copy (labor from habits, deeds, demolish rules).

**Tests:** logic already engine-tested; add a `TownView` smoke render test (existing view-test pattern).

**Ship state:** the full solo loop — earn labor by logging habits, sink gold/materials, watch the town grow. If M5 ships separately, perk rows on cards read "coming online next update".

---

### M5 — Perk wiring at the live seams

**Changes:** §3.3 rows exactly (Forge row per phase ordering). Files: `engine/mining.ts`, `engine/forest.ts`, `slices/miningSlice.ts`, `slices/forestSlice.ts`, `engine/dungeon.ts`, `store/shared.ts` (`enterRoom`, `maxEnergyFor`), `slices/trialsSlice.ts` (+ `TrialBeginResult`), `slices/habitsSlice.ts` (cap reads), `devFillEnergy`, energy-display components.

**Tests:** per seam — `sightRadiusFor` with bonus; `maxSta` with bonus; `merchantOffers(d, 0.15)` prices (floor 1g); practice path (no energy charge, nonce bumps, `completeTrial` still no-ops); `maxEnergyFor` grant/clamp/refund symmetry; **regression guard: with no buildings, every seam is byte-identical to pre-M5 baselines.**

---

### M6 — Art, balance, polish, forward-compat hardening

- Full per-building composers × 3 tiers; decor variants; cobble paths auto-connect; palette QA matrix (all palettes × light/dark).
- Balance pass against real earnings-ledger gold/day: deed pacing (deed 1 ≈ week 2–3 of active play), tier-cost curve, `TOWN_LABOR_DAILY_CAP` so a 4-habit day finishes a tier-I building in ~2 days.
- Mobile QA: pinch precision, sheet reachability, `prefers-reduced-motion` (skip sparkle/glow).
- **Party-visit forward-compat freeze:** document that the future visit payload is `TownState` verbatim (`v: 1` ships now); v1 must NOT broadcast town state and must NOT reference character/gear state from the renderer (visitors won't have it).
- Update `CLAUDE.md` layer notes and `docs/INDEX.md`.

---

## 5. Critical Files

| File | Change |
|---|---|
| `src/engine/town.ts` | **New** — all town rules: placement, labor, prestige, perks, refunds |
| `src/content/townBuildings.ts`, `src/content/townDecor.ts` | **New** — catalogs + `TOWN_*` constants |
| `src/store/slices/townSlice.ts` | **New** — queue/deed/decor/demolish spend actions |
| `src/store/slices/habitsSlice.ts` | Labor grant in `completeHabit` (~:186-197, :266-272); claw-back in `uncompleteHabit` (~:374) |
| `src/store/useGameStore.ts` | Persist version 33; migrate/merge `town` defaults |
| `src/store/shared.ts` | `GameState.town` + action signatures; `maxEnergyFor`; `enterRoom` discount pass-through (:1066) |
| `src/components/town/iso.ts` | **New** — square-grid iso projection + painter-order sort |
| `src/components/town/TownCanvas.tsx`, `townArt.tsx`, `TownBuildPanel.tsx`, `TownBuildingCard.tsx` | **New** — renderer + build UX |
| `src/views/TownView.tsx`, `src/views/ExploreView.tsx` | **New** view; 4th hub card (lazy) |
| `src/engine/mining.ts`, `src/engine/forest.ts` + `miningSlice.ts`, `forestSlice.ts` | `sightBonus` snapshot field; `maxSta` bonus |
| `src/engine/dungeon.ts` | `merchantOffers(depth, discount01)` (:76) |
| `src/store/slices/trialsSlice.ts` | Practice branch in `beginTrial` (:52-75) |
| `src/content/mining.ts`, `src/content/forest.ts` | `stone_lode` / `timber_stand` source nodes |

---

## 6. Reuse (do not reinvent)

| Existing asset | Where to reuse it |
|---|---|
| `components/tactics/iso.ts` (squash/lift/bounds idiom, SVG-polygon philosophy) | Template for `town/iso.ts` — same `Pt`/`IsoBounds` shapes |
| `craft()` validate-subtract pattern (`economySlice.ts:161-181`) incl. `unlimitedGold` | `townQueueBuild` / `townBuyDeed` spend paths |
| `lastEnergyGrantISO` marker idiom (HABIT-04; `habitsSlice.ts:186-197, :374`) | `lastLaborGrantISO` grant + claw-back, marker-not-cleared rule |
| Milestone toast-after-commit pattern (`habitsSlice.ts:307-317`) | Construction-complete celebration |
| Persist v29/v30 optional-field migrations | `lastLaborGrantISO`, `town` defaults |
| Mine's rAF/ref direct-DOM writes (charge bar in `MineRunOverlay`) | Pan/zoom transform ref — no per-frame React |
| `HubGrid`/`HubCard` + `SubModeFrame` (`ExploreView.tsx`) | Town entry card + guide content |
| CSS-var palette system (`engine/palettes.ts`, Tailwind `fill-*`) | All procedural art coloring; free dark mode |
| `uid()` (`shared.ts`) | Building/project ids |
| `boonSightBonus` additive-bonus shape (`mining.ts:324`) | `sightBonus` snapshot-field style |
| `"r,c"` string-key Sets (`crawl.ts` flood fill) | Occupancy map |

---

## 7. Edge Cases & Decisions

| Case | Behaviour |
|---|---|
| Existing saves | v33 migrate: `town ?? freshTown()`; optional habit marker needs no backfill. v32 saves lose nothing. |
| Save size | Maxed town ≈ 3.5 KB; decor capped 60 global / 10 per type; queue ≤ 2. Negligible in localStorage and the cloud CAS blob. |
| Cloud sync | `town` rides the persist envelope automatically (NOT in `TRANSIENT_KEYS`). Whole-blob CAS means concurrent-device edits resolve like all other state. |
| Palette changes / custom palettes | Themed roles use shade-token pairs that differ by construction; grass/foliage fixed jewel tones. QA matrix in M6. |
| Demolish / cancel | Demolish: 50% cumulative materials, 0% gold, prestige drops automatically (derived). Cancel: 100% materials, 0% gold, applied labor forfeited. Keep undemolishable; a building targeted by a live project must cancel it first. |
| Relocation | Free for completed buildings (placement is the fun; gold stays sunk); blocked while a project targets the building. |
| Labor overflow | Bank cap 200 with "bank full" HUD hint; day cap 24 with "town cap reached" toast copy. Both clamped in `applyLabor`. |
| Undo after completion | Claw-back clamps at 0 — labor inside a completed project is an accepted leak (milestone claw-back precedent). |
| Energy-at-cap days | Labor marker is independent of the energy `< max` gate — full-energy days still build. |
| Trial practice | Safe by the existing same-day early-return in `completeTrial`; practice bumps the attempt nonce so deterministic trials redraw; no energy, no reward, best score untouched. |
| Perk staleness mid-run | Crawler perks snapshot at `begin*` like all combat stats — completing the Watchtower mid-run doesn't retro-buff; noted on the perk card. |
| Trust model | Option A friendly-trust: town state is a client-trusted save blob. Prestige is personal/motivational — no leaderboards, no competitive surface (per `docs/trust-model.md`). |
| Party visits (later phase) | Payload = `TownState` verbatim (`v: 1` field ships in v1). v1 must not broadcast town state and the renderer must not read character/gear state. |
| `unlimitedGold` dev setting | Bypasses gold (and material?) checks exactly as `craft` does today — same code path, same behaviour. |
| Renderer perf floor | Escape hatch: collapse ground to one `<path>` per district if low-end phones chug. Not v1. |

---

## 8. Verification Checklist

At each milestone:
- [ ] `npm run typecheck` — no type errors.
- [ ] `npm run test` — all existing tests still green + new milestone tests pass.

End-to-end:
- [ ] M1: a v32 save loads under v33 with an empty town; stone/wood drop in mine/forest runs.
- [ ] M2: complete/uncomplete a habit → labor bank moves symmetrically; the 25th labor point of the day is refused; receipt toast shows `+N 🔨`.
- [ ] M3: town renders, pans, and pinch-zooms on a real phone; locked districts dashed; dark mode + all palettes coherent.
- [ ] M4: full loop — queue the Keep, log habits, watch the scaffold's progress ring fill, building completes with a toast; deed 1 at 500g unlocks district 2; demolish refunds 50% materials and 0 gold.
- [ ] M5: with vs. without each building, the five seams differ by exactly the perk amount; with no buildings, behaviour is byte-identical to pre-M5; practice trials charge no energy and pay no reward.
- [ ] M6: cloud round-trip (push on device A, pull on device B) preserves the town; `resetGame` clears it; `prefers-reduced-motion` skips fx.
