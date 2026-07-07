# The Forge — Crafting Minigame Development Plan

## 1. Context & Goal

Crafting is the only core activity in HabitsRPG with **no interactivity and no stat tie**. Today `craft(recipeKey)` (`src/store/slices/economySlice.ts:123`) is a single deterministic click: validate `canCraft`, subtract materials + optional gold, drop a fixed-stat item into `ownedGear`/`ownedWeapons`. Every other minigame is an interactive, `score01`-scored loop.

**The Forge** turns crafting into a two-phase hammering minigame whose performance sets the **quality tier** of the produced item, scaling its stats. It fills the clearest content gap and gives **DX** ("Precision, craft, accuracy") and **ST** ("Power, force") a meaningful role in crafting — without touching the proven economy/recipe plumbing more than necessary.

### Locked design decisions

| Decision | Choice |
|---|---|
| Risk model | **Crude tier, no loss** — materials/gold are never wasted; a poor run yields a sub-baseline *Crude* item. |
| Mechanic depth | **Two-phase**: stoke heat (bellows) → strike (timed hammer) while heat decays. |
| Stat influence | **DX + ST** — DX widens the strike sweet-zone; ST powers each strike (fewer strikes needed). |
| Quality spread | **Crude ×0.85 / Normal ×1.0 / Fine ×1.15 / Masterwork ×1.3** (4 bands: 1 penalty + 3 positive). |
| Gating | None beyond the existing material + gold cost (no energy/daily gate). |

### Open questions (defaults apply if not answered before M3)

1. **Re-forge after Crude?** Can a Crude item be immediately re-forged, or must you gather materials to craft again from scratch? *(Default: it's made; gather materials and craft again to upgrade.)*
2. **Target craft duration?** How long should one craft take end-to-end? *(Default: ~10–12 s — a few seconds stoking + ~5 strikes.)*
3. **Best-tier badge on recipe row?** Show current best tier per recipe in the Forge list so players can chase upgrades? *(Default: yes, added in M4.)*
4. **Exempt recipes?** Any recipes that should skip the minigame and craft instantly? *(Default: all gear/weapon recipes use the Forge.)*

---

## 2. Quality Model

### Storage
Owned items are deduped string keys with fixed stats, so quality is stored **per item key** in two new persisted maps, applied at the aggregation seam rather than at the item definition level.

```
EconomySlice additions:
  gearQuality:   Record<string, number>   // item key → tier index (0-3), default {}
  weaponQuality: Record<string, number>   // item key → tier index (0-3), default {}
```

**Absent key ⇒ treated as Normal (×1.0)** so shop/loot items and all existing saves keep their current stats with no data migration.

### Tier index

| Index | Name | Multiplier | Colour | Notes |
|---|---|---|---|---|
| 0 | Crude | ×0.85 | `#8b6914` (dim gold) | Below baseline; materials still consumed |
| 1 | Normal | ×1.0 | `#c9a227` (gold) | Absent key defaults here |
| 2 | Fine | ×1.15 | `#7dd3fc` (sky) | Approaching top-end |
| 3 | Masterwork | ×1.3 | `#a78bfa` (violet) | Chase tier |

`score01 → tier`:
- `< 0.20` → Crude
- `0.20–0.40` → Normal
- `0.40–0.75` → Fine
- `≥ 0.75` → Masterwork

*(Exact cutoffs finalized in M5 based on balance playtesting.)*

### Upgrade rule
`quality[key] = Math.max(prev ?? NORMAL, tier)` — re-crafting can only **improve** a stored tier, never downgrade it.

### What the multiplier scales
- Gear: `defense`, `ward`, each value in `statBonuses` (round to nearest int).
- Weapons: `bonus`.
- **Not** scaled: `xpBonus`, `mining`/`chopping` power, `attackStat`, `staminaCost`, `ranged`, `range`. These are categorical/functional properties that quality shouldn't alter.

---

## 3. Minigame Mechanic (Two-Phase)

### Phase A — Stoke the fire (heat)

A vertical heat bar fills while the player **holds** the bellows control. A highlighted "sweet band" sits high on the bar. When the player **releases/commits**, `heat01 ∈ [0,1]` is computed as proximity to the band centre.

- DX widens the sweet band slightly (higher DX = more room for error).
- Once committed, the Phase B strike meter opens. Heat then **decays in real time** throughout Phase B — let it run out and progress locks.

### Phase B — Strike (hammer)

An oscillating needle sweeps a horizontal bar left↔right. A moving sweet-zone slides across the bar. The player taps/presses to swing the hammer; each tap scores `strikeAccuracy ∈ [0,1]` based on needle position relative to the zone.

Each accurate strike advances a **forge-progress** meter:
```
progress += strikeAccuracy × strikePower(stLevel)
```

- **DX** widens the sweet-zone.
- **ST** increases `strikePower` (so high-ST characters need fewer good strikes to fill the meter).
- Phase ends when either progress reaches 1.0 **or** heat runs out.

`strike01` blends progress fill and mean strike accuracy, so accuracy-spamming without precision can't fully max the score.

### Final score

```
score01 = clamp(0.35 × heat01 + 0.65 × strike01, 0, 1)
```

→ tier lookup → item quality stored.

*(Constants are starting values; tuned in M5.)*

---

## 4. Milestones

Build in strict order. Do not start the next milestone until the previous one's tests pass and a manual smoke-check looks correct.

---

### M1 — Quality data model & plumbing (invisible to users)

**Goal:** land the save-format and combat-pipeline changes first, behind a default that changes nothing visible. Every existing test must still pass at the end of M1.

#### Changes

**`src/engine/crafting.ts`** — add tier types and helpers:
```ts
export type CraftTier = 0 | 1 | 2 | 3;
export const CRUDE    = 0;
export const NORMAL   = 1;
export const FINE     = 2;
export const MASTERWORK = 3;

export interface CraftTierDef {
  name: string;
  mult: number;   // stat multiplier
  color: string;  // hex, for UI tinting
  glyph: string;  // emoji, for badges
}

export const CRAFT_TIERS: Record<CraftTier, CraftTierDef> = {
  0: { name: 'Crude',       mult: 0.85, color: '#8b6914', glyph: '🟤' },
  1: { name: 'Normal',      mult: 1.00, color: '#c9a227', glyph: '⬜' },
  2: { name: 'Fine',        mult: 1.15, color: '#7dd3fc', glyph: '🔵' },
  3: { name: 'Masterwork',  mult: 1.30, color: '#a78bfa', glyph: '💜' },
};

export function tierMultiplier(tier: number): number {
  return CRAFT_TIERS[(tier as CraftTier) ?? NORMAL]?.mult ?? 1.0;
}

export function scoreToTier(score01: number): CraftTier {
  if (score01 >= 0.75) return MASTERWORK;
  if (score01 >= 0.40) return FINE;
  if (score01 >= 0.20) return NORMAL;
  return CRUDE;
}

export function tierLabel(tier: number): string {
  return CRAFT_TIERS[(tier as CraftTier)]?.name ?? 'Normal';
}
```

**`src/store/slices/economySlice.ts`**:
- Add `gearQuality: Record<string, number>` and `weaponQuality: Record<string, number>` to the `EconomySlice` type and `initialEconomyState`, both defaulting to `{}`.
- Change `craft(recipeKey)` to `craft(recipeKey: string, score01?: number)`. After the existing material/gold consumption, compute `tier = scoreToTier(score01 ?? 1.0)` and for gear/weapon results:
  ```ts
  const prev = kind === 'gear' ? s.gearQuality[key] : s.weaponQuality[key];
  const newTier = Math.max(prev ?? NORMAL, tier);
  next[kind === 'gear' ? 'gearQuality' : 'weaponQuality'] = {
    ...(kind === 'gear' ? s.gearQuality : s.weaponQuality),
    [key]: newTier,
  };
  ```
  Item-kind results ignore tier.

**`src/store/shared.ts`** — apply quality at the two combat seams:

1. `gearFor` (line 527) — after resolving each equipped `GearDef`, produce a quality-scaled copy:
   ```ts
   const tier = state.gearQuality[key] ?? NORMAL;
   const m = tierMultiplier(tier);
   // return a new GearDef with defense/ward/statBonuses scaled by m
   ```
   All other fields (`xpBonus`, `mining`, `chopping`, etc.) are copied as-is.

2. Add `equippedWeaponDef(state: GameState): WeaponDef`:
   ```ts
   const w = getWeapon(state.equippedWeapon);
   const m = tierMultiplier(state.weaponQuality[state.equippedWeapon] ?? NORMAL);
   return { ...w, bonus: Math.round(w.bonus * m) };
   ```
   Replace the bare `getWeapon(state.equippedWeapon)` in `fighterFor` (line 556) with `equippedWeaponDef(state)`.

3. Audit crawler snapshots: `miningSlice.ts` and `forestSlice.ts` build a snapshot at run-start that includes the weapon. Replace bare `getWeapon(...)` there with `equippedWeaponDef(s)` so quality is baked into the run snapshot. *(Note: `dungeonSlice.ts:221` only reads `attackStat` — leave it untouched.)*

**`src/store/useGameStore.ts`**:
- Bump `persist` `version` by 1.
- Add `gearQuality: {}` and `weaponQuality: {}` to the `merge` defaults object (these are persistent progress fields — do NOT add them to the transient null-list used for run state).

#### Tests for M1

- `tierMultiplier(CRUDE)` = 0.85, `tierMultiplier(NORMAL)` = 1.0, etc.
- `scoreToTier` boundaries: 0.0→Crude, 0.20→Normal, 0.40→Fine, 0.75→Masterwork.
- `equippedWeaponDef` returns a weapon with scaled `bonus`; `attackStat`/`staminaCost` unchanged.
- Quality-scaled `gearFor` produces correct `defense`/`ward`/`statBonuses` at each tier; `xpBonus` unchanged.
- `craft(recipeKey, 0.9)` stores `weaponQuality[key] = MASTERWORK`; re-craft at score 0.5 leaves it as MASTERWORK.
- `craft(recipeKey)` (no score) ⇒ stores NORMAL (×1.0 = identical to today).
- Absent key in `gearQuality` ⇒ `aggregateGear` returns the same numbers as before M1.
- `npm run test` and `npm run typecheck` fully green.

#### M1 ship state

One-click craft still works (via `craft(recipeKey)` with no `score01`), always yields Normal. Nothing is visibly different to the player. All existing balance tests pass unchanged.

---

### M2 — Forge engine (pure functions & tests)

**Goal:** the complete mathematical engine for the two-phase mechanic, fully tested, with no React or store imports.

#### New file: `src/engine/crafting/forge.ts`

Structure mirrors `src/engine/trials/armoryBreak.ts`.

```ts
// ── Constants (all exported so UI can read them) ────────────────────────────

/** Number of strikes in Phase B. */
export const FORGE_BASE_STRIKES = 5;

/** Seconds Phase B lasts at maximum heat. */
export const HEAT_DURATION_S = 8;

/** Heat rise/fall rate per second (fraction of full bar). */
export const HEAT_RISE_RATE  = 0.25;   // fills in ~4 s of holding
export const HEAT_FALL_RATE  = 0.35;   // drops faster than it rises

/** Heat band occupies [HEAT_BAND_START, HEAT_BAND_END] of the bar (0–1). */
export const HEAT_BAND_START = 0.62;
export const HEAT_BAND_WIDTH_BASE = 0.16;  // widened by DX

/** Needle oscillation period in seconds. */
export const NEEDLE_PERIOD_S = 2.0;

/** Base sweet-zone half-width (fraction of bar). */
export const SWEET_HALF_BASE = 0.10;   // widened by DX

// ── Phase A helpers ─────────────────────────────────────────────────────────

/** Width of the target heat band (wider with higher DX). */
export function heatBandWidth(dxLevel: number): number {
  return Math.min(0.40, HEAT_BAND_WIDTH_BASE + dxLevel * 0.008);
}

/** Accuracy of the Phase A commit (0–1); 1.0 at band centre, 0 outside. */
export function heatAccuracy(heatBar: number, dxLevel: number): number {
  const centre = HEAT_BAND_START + heatBandWidth(dxLevel) / 2;
  const halfW  = heatBandWidth(dxLevel) / 2;
  const dist   = Math.abs(heatBar - centre);
  if (dist > halfW) return 0;
  return 1 - dist / halfW;
}

// ── Phase B helpers ─────────────────────────────────────────────────────────

/** Half-width of the strike sweet-zone (wider with higher DX). */
export function strikeSweetHalf(dxLevel: number): number {
  return Math.min(0.35, SWEET_HALF_BASE + dxLevel * 0.006);
}

/**
 * Accuracy of a single strike (0–1).
 * needlePos and zoneCentre are both in [0,1] (fraction of the bar).
 */
export function strikeAccuracy(needlePos: number, zoneCentre: number, dxLevel: number): number {
  const half = strikeSweetHalf(dxLevel);
  const dist = Math.abs(needlePos - zoneCentre);
  if (dist > half) return 0;
  return 1 - dist / half;
}

/**
 * Contribution of a single strike to the progress meter [0,1].
 * Higher ST = more power per strike (fewer strikes needed to fill).
 */
export function strikePower(stLevel: number): number {
  // Base: fills ~1/5 of the meter per perfect strike (needs 5 perfect hits).
  // ST bonus: +1.5% per level, so ST 20 ≈ 30% bonus (needs ~3.8 perfect hits).
  return Math.min(0.40, 0.20 * (1 + stLevel * 0.015));
}

// ── Final score ──────────────────────────────────────────────────────────────

export interface ForgeResult {
  heat01: number;        // Phase A accuracy
  strikeAccuracies: number[];
  progressFilled: number;  // forge-progress bar fraction [0,1]
}

/**
 * Compute a normalized score01 from a completed forge run.
 * Blends heat accuracy, mean strike accuracy, and progress fill.
 * Low-accuracy spam can't max the score — both mean accuracy and progress matter.
 */
export function forgeScore(result: ForgeResult): number {
  const { heat01, strikeAccuracies, progressFilled } = result;
  const meanAcc = strikeAccuracies.length === 0
    ? 0
    : strikeAccuracies.reduce((a, b) => a + b, 0) / strikeAccuracies.length;
  // strike01 is the geometric blend that penalizes spam (must have both fill AND accuracy)
  const strike01 = Math.sqrt(progressFilled * meanAcc);
  return Math.max(0, Math.min(1, 0.35 * heat01 + 0.65 * strike01));
}
```

#### New file: `src/engine/crafting/__tests__/forge.test.ts`

Cover:
- `heatAccuracy`: band centre → 1.0; outside band → 0; DX widens band (wider band = same commit position scores higher).
- `strikeAccuracy`: zone centre → 1.0; edge → 0; outside → 0; DX widens (same position scores higher with more DX).
- `strikePower`: monotonically increasing with ST; at ST=0 ≈ 0.20; never exceeds 0.40.
- `forgeScore`: perfect heat + perfect strikes at max DX/ST → score01 ≥ 0.75 (Masterwork); all zeros → score01 = 0 → Crude; heat matters (same strikes, better heat → better score); spam (many low-accuracy strikes that fill progress but low mean accuracy) → penalized vs fewer accurate strikes.
- `scoreToTier` boundary tests at exactly 0.20, 0.40, 0.75.

---

### M3 — Forge minigame UI wired to craft

**Goal:** clicking "Craft" opens the interactive two-phase Forge modal; on completion the item is written to the store with its earned tier.

#### New file: `src/components/inventory/ForgeMinigame.tsx`

A full-screen modal (same fixed-inset z-50 pattern as other overlays). Structure:

```
ForgeMinigame
├── Phase A panel (shown while phaseA)
│   ├── Recipe name + material cost reminder
│   ├── Heat bar (rAF, vertical, fills on hold)
│   │   └── Sweet band highlight (position + width from heatBandWidth(DX))
│   ├── "Hold to stoke — release to lock heat" instruction
│   └── Touch/keyboard: pointerdown/up or Space
│
├── Phase B panel (shown while phaseB)
│   ├── Animated heat decay bar (dims as heat drops)
│   ├── Needle bar + moving sweet-zone (rAF)
│   ├── Forge-progress bar (fills with good strikes)
│   ├── Strike count badge
│   └── Touch/keyboard: tap / Space / any key
│
└── Result panel (shown on complete)
    ├── Item crest (Sprite)
    ├── Tier badge (name + glyph + color from CRAFT_TIERS)
    ├── Flavour line ("The metal rang true." / "A crude attempt.")
    └── "Continue" button → calls craft(recipeKey, score01), onClose()
```

Implementation notes:
- A single `useRef` rAF loop drives both phases; it reads a phase-ref (not state) to decide what to update.
- `heatBar` and `needlePos`/`zoneCentre` are refs written directly to `style.width`/`style.left` (same pattern as the charge-bar in `MineRunOverlay` to avoid 60fps React re-renders).
- `strikeAccuracies`, `progressFilled`, and `heat01` accumulate in refs; only written to React state once at phase-transition/completion.
- Reads `useGameStore(s => s.character.statLevels)` for DX and ST at mount; snapshot into refs so the loop doesn't subscribe on every frame.
- **Touch controls**: `pointerdown`/`pointerup` for Phase A hold; `pointerdown` for Phase B strike.
- Parchment/gold styling: `Panel tone="parchment"`, `text-ink`, `border-gold-deep`, `Hammer` icon from lucide-react.
- Imports `heatAccuracy`, `strikeAccuracy`, `strikePower`, `forgeScore`, `scoreToTier`, `CRAFT_TIERS` from `@/engine/crafting/forge`.
- `prefers-reduced-motion`: detect via `window.matchMedia`; if set, slow the needle oscillation and widen both bands by ×1.5.

Props: `{ recipeKey: string; onClose: () => void }`.

#### Modified: `src/components/inventory/ForgeSection.tsx`

Add local `const [forgeTarget, setForgeTarget] = useState<string | null>(null)`. Change the "Craft" button `onClick` from `() => craft(recipe.key)` to `() => setForgeTarget(recipe.key)`. Below the list, render:
```tsx
{forgeTarget && (
  <ForgeMinigame recipeKey={forgeTarget} onClose={() => setForgeTarget(null)} />
)}
```

Item-kind recipe results (none today, but the type supports them): these may still call `craft(key)` directly and skip the minigame — add a guard checking `recipe.result.kind !== 'item'`.

#### Manual verification for M3

`npm run dev` → Crafting tab → stockpile materials (dev settings: unlimitedGold) → click Craft on e.g. "Iron Mace":
1. Forge modal opens.
2. Phase A: hold bellows bar, watch it fill; release in the band → Phase B opens.
3. Phase B: tap strikes; watch forge-progress fill; heat decays.
4. Result panel shows tier (deliberately aim for all 4 outcomes across test runs).
5. Close → item appears in inventory tab with its tier label (M4 adds this, but the store writes it now).

---

### M4 — Tier display & visual feedback

**Goal:** quality is now visible everywhere items appear.

#### UI locations to update

1. **`src/components/inventory/ForgeSection.tsx`** recipe rows: after item name add the best-crafted tier badge if `gearQuality[key]` or `weaponQuality[key]` is set (and > 0). Show as a small colored chip: `Fine 🔵` / `Masterwork 💜`.

2. **`src/components/inventory/GearSection.tsx`**: on each owned gear card, prefix the name with the tier (e.g. "Fine Leather Vest") and color it by `CRAFT_TIERS[tier].color`. Show `gearBonusText` with the scaled stat numbers (already computed by `aggregateGear` — no extra work, display from the equipped/owned gear's derived values).

3. **Weapon list** (wherever ownedWeapons are displayed — check `GearSection` or a weapons panel): same prefix + tint pattern.

4. **`src/components/inventory/PaperDoll.tsx`** / equip panel: show tier badge on the equipped item slot.

5. **ForgeMinigame result panel** (already in M3 result screen): confirm tier name, glyph, and colour are shown prominently.

#### Helper function

Add `tierPrefix(name: string, tier: number | undefined): string` next to `gearBonusText` in `GearSection.tsx` — returns the prefixed name if tier exists and ≠ Normal, otherwise plain name. Coloring is done with inline style or a small wrapper using `CRAFT_TIERS[tier].color`.

---

### M5 — Balance, polish & accessibility

**Goal:** the minigame feels good at all stat levels, looks polished, and is accessible.

#### Balance tuning

- Playtest at DX 0, 5, 10, 20; ST 0, 5, 10, 20 — verify all four tiers are reachable.
- Adjust `HEAT_BAND_WIDTH_BASE`, `SWEET_HALF_BASE`, `HEAT_DURATION_S`, `strikePower` scaling to:
  - Low DX/ST (new player): Crude and Normal reachable; Fine requires some effort.
  - Mid DX/ST: Normal feels effortless; Fine is comfortable; Masterwork is achievable.
  - High DX/ST: Masterwork is consistent with good play.
- Update `FORGE_BASE_STRIKES` if needed (target ~5 for a Normal-stat player to fill the meter, 3–4 for high ST).
- Cross-check `engine/__tests__/balance.test.ts` (if it tests weapon/gear values, Normal-tier must still match the pre-M1 baseline).
- Tune tier cutoffs (`scoreToTier` boundaries) if playtest data suggests.

#### Visual polish

- Screen-shake on strike (reuse `shakeOffset` from `crawl.ts` + a local shake-state ref).
- Spark VFX on Masterwork/Fine reveal (CSS animation or a brief canvas overlay — keep it small).
- Anvil/flame scene via `getScene`/`resolveSceneImage` placeholder (adds to `scenes.ts`; real PNG can be swapped later via the art seam).
- SFX hooks (same pattern as other overlays: fire-and-forget Audio objects; no-op if audio blocked).

#### Accessibility

- `prefers-reduced-motion`: already detected in M3; in M5 expand to also slow heat decay by 50%, giving more time to react.
- Minimum band widths regardless of DX: ensure even DX=0 has enough room to hit Normal with reasonable effort (≥0.12 half-width on the strike sweet-zone).
- Clear Crude-result messaging: flavour text distinguishes Crude from Normal so players don't think the game is broken ("The tempering went poorly — a rough but serviceable piece.").
- All controls work with keyboard (Space for both phases), pointer (mobile tap/hold), and have no colour-only indicators (tiers distinguished by name + glyph + colour).

---

## 5. Critical Files

| File | Change |
|---|---|
| `src/engine/crafting.ts` | Add tier types/helpers: `CraftTier`, `CRAFT_TIERS`, `scoreToTier`, `tierMultiplier`, `tierLabel` |
| `src/engine/crafting/forge.ts` | **New** — pure two-phase mechanic: constants + scoring functions |
| `src/engine/crafting/__tests__/forge.test.ts` | **New** — full test suite for forge.ts |
| `src/store/slices/economySlice.ts` | `gearQuality`/`weaponQuality` state; `craft(key, score01?)` extended |
| `src/store/shared.ts` | Quality scaling in `gearFor`; new `equippedWeaponDef`; fix crawler snapshots |
| `src/store/useGameStore.ts` | Persist version bump; merge defaults |
| `src/components/inventory/ForgeSection.tsx` | "Craft" → open `<ForgeMinigame>`; tier badge on recipe rows |
| `src/components/inventory/ForgeMinigame.tsx` | **New** — two-phase modal UI |
| `src/components/inventory/GearSection.tsx` | Tier prefix + tint on owned gear |
| `src/components/inventory/PaperDoll.tsx` | Tier badge on equipped slots |
| `src/lib/scenes.ts` | New `forge:anvil` scene key (M5 art seam) |

---

## 6. Reuse (do not reinvent)

| Existing asset | Where to reuse it |
|---|---|
| `canCraft` / `getRecipe` + consumption loop | Unchanged in `economySlice.ts`; just extend the action |
| `armoryAccuracy` / `armoryScore` shape | Template for `forge.ts` accuracy functions |
| `scoreToStars` 0.40/0.75 thresholds (`trials.ts:109`) | Tier cutoff basis |
| `aggregateGear` (`gear.ts:53`) | Unchanged; quality is applied in `gearFor` before aggregation |
| `shakeOffset` (`crawl.ts`) | Screen-shake on hammer strikes (M5) |
| `Panel`, `Button`, `Sprite` components | ForgeMinigame layout |
| `Hammer` icon from lucide-react | Already imported in ForgeSection |
| `useSmoothCamera` rAF pattern | Template for ForgeMinigame's rAF loop (write to DOM refs directly) |

---

## 7. Edge Cases & Decisions

| Case | Behaviour |
|---|---|
| Existing saves | Absent quality entry ⇒ Normal ⇒ identical stats. Zero migration. |
| Shop / loot items | No quality entry ⇒ Normal (×1.0) everywhere. |
| Re-craft an already-upgraded item | `Math.max(existing, newTier)` — upgrade only, never downgrade. Materials are always consumed. |
| Crude result | Materials/gold spent, item is Crude. Player must craft again (spending more materials) to try for better. |
| Consumable (item-kind) recipes | Skip the minigame entirely; call `craft(key)` directly; quality maps untouched. |
| `unlimitedGold` dev setting | Bypasses gold cost as before; minigame still plays; skill still determines tier. |
| `unlimitedEnergy` dev setting | N/A — Forge has no energy cost. |
| `repeatMinigames` dev setting | N/A — Forge has no daily gate. |
| Phase B heat runs to zero | Phase B ends immediately; progress so far locks and the result is scored. Player can't get more strikes. |
| Player closes the modal mid-forge | `onClose()` without calling `craft` — no materials consumed, no item produced. The forge is cancellable before the result screen. |
| Concurrent equip during a forge run | Crafting is fully synchronous/sync-to-render; no race condition with equipping. |

---

## 8. Verification Checklist

At each milestone:
- [ ] `npm run typecheck` — no type errors.
- [ ] `npm run test` — all existing tests still green.
- [ ] New milestone-specific unit tests pass.

End-to-end (after M3+):
- [ ] Open `npm run dev` → Crafting tab → click Craft on an affordable recipe → Forge modal opens.
- [ ] Phase A: hold and release; heat bar animates; commit inside band → Phase B opens.
- [ ] Phase B: tap strikes; needle animates; sweet-zone moves; progress bar fills; heat decays.
- [ ] Deliberately bad play → Crude result shown. Deliberately good play → Masterwork.
- [ ] Close modal → item in inventory shows tier label (M4).
- [ ] Equip item → paper-doll/combat stats reflect the quality multiplier.
- [ ] Load an old save → all gear/weapons display as Normal, stats unchanged vs before The Forge.
- [ ] Re-craft a Fine item with a poor run → tier stays Fine (upgrade-only rule).
- [ ] `prefers-reduced-motion` active → needle/band slower; still fully playable.
