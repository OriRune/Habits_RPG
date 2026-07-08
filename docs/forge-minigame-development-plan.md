# The Forge — Crafting Minigame Development Plan

> **Revision 2 (2026-07-07).** Redesigned after a full review against the 2026-07 audit
> (`docs/audit-2026-07/`), `docs/habits-rpg-improvement-plan3.md`, and current source.
> Headline changes vs revision 1: Phase B is now a **heat economy** with light/heavy strikes
> and re-stoking (was a pure timing test); tier stat scaling uses **guaranteed-distinct
> integers** (naive rounding collapsed tiers on small items); the upgrade rule is fixed so
> **Crude is actually storable**; and two economy features were added — a **Re-forge** gold
> sink (plan3's deferred ≥500g repeatable sink) and a **Fuel & Flux** slot consuming BAL-16's
> dead-end materials. Stale file refs corrected per plan3 item 8.1.
>
> **Revision 2.1 (2026-07-07, plan3 8.1 re-verification).** ARCH-10's store split moved the
> combat seams: `gearFor`/`fighterFor` now live in **`src/store/commit.ts`** (shared.ts only
> re-exports it). Seam refs updated throughout: gearFor `commit.ts:78`, the bare `getWeapon`
> inside fighterFor `commit.ts:136`. Also corrected: `mining`/`chopping` power are **GearDef**
> (tool-slot) fields, not WeaponDef; two bypass seams documented (mine/forest tool-power reads,
> PaperDoll's raw display aggregation).
>
> **Revision 3 (2026-07-08) — SHIPPED.** All milestones M1–M6 are implemented and green
> (85 forge engine tests + store `forgeQuality` suite + full suite passing; typecheck clean).
> M1–M5 landed as planned. During build-out the mechanic was deliberately extended past the
> plan (the "tempo/crit/quench overhaul") and §3/§6 below have been corrected to describe
> what shipped:
> - **Phase C "Quench"** — a third scored beat (one timed plunge, 0.10 of the score blend).
> - **Tempo meter** — spaced landed blows build a ×0.75–1.25 progress multiplier; mashing or
>   whiffing resets it (a second anti-mash layer on top of the √ blend).
> - **Perfect-strike crits** (acc ≥ 0.92 → ×1.25) and **forge events** (Ember Surge / Cold
>   Snap, rolled once at `initForge` from an injectable rng).
> - **Metal temperaments** — recipes forge differently by material family (crystalline =
>   fickle, metal bars = stubborn, soft goods = supple; `recipeTemperament` in `crafting.ts`,
>   `TEMPERAMENTS` in `forge.ts`).
> - **Constant retune** for the longer three-beat runs: `CHARGE_MULT` 1.9→1.7, `strikePower`
>   base 0.20→0.13 (cap 0.26), `RESTOKE_FATIGUE` 0.15→0.10, Firebrick fatigue 0.08→0.05,
>   score blend 0.35/0.65 → **0.32 heat / 0.58 strike / 0.10 quench**.
> - Also shipped beyond plan: haptics (`src/lib/haptics.ts`), adaptive heat drone, 11 SFX
>   cues (plan asked 4), living smithy scene (`src/components/inventory/forge/` — ForgeScene,
>   SmithyBackdrop, ForgeResultPanel, ForgeBoostPanel), Homestead `forge_focus` perk consumed
>   as `sweetBonus` (+0.03 strike-zone half-width).
> **Still open:** the M6 *human* playtest-tuning pass (DX×ST grid at 1/8/16/25, re-forge
> ≥500g sink feel) — flagged for Orion in plan3 item 8.3.

## 1. Context & Goal

Crafting is the only core activity in HabitsRPG with **no interactivity and no stat tie**. Today `craft(recipeKey)` (`src/store/slices/economySlice.ts:161`) is a single deterministic click: validate `canCraft`, subtract materials + optional gold, drop a fixed-stat item into `ownedGear`/`ownedWeapons`. Every other minigame is an interactive, `score01`-scored loop.

**The Forge** turns crafting into a two-phase hammering minigame whose performance sets the **quality tier** of the produced item, scaling its stats. It fills the clearest content gap and gives **DX** ("Precision, craft, accuracy") and **ST** ("Power, force") a meaningful role in crafting — without touching the proven economy/recipe plumbing more than necessary.

### Why the Forge exists (economy mandate)

Per plan3's strategic direction, *"the Forge exists to serve the economy (BAL-03/-05/-16/-17), not to add content for its own sake."* Concretely it must:

- Be the crafting **experience** for the three late-tier band recipes shipped in plan3 item 4.4 (`mithril_pickaxe`, `obsidian_plate`, `resin_trinket` — `src/content/recipes.ts:98-118`), which already consume obsidian / frost_quartz / amber_resin.
- Provide the **repeatable, scaling gold sink** deferred at the end of plan3 Phase 4 ("always something to want ≥500g") — delivered here as **Re-forge** (§5).
- Give more of BAL-16's dead-end materials a sink — delivered here as **Fuel & Flux** (§6): wood, stone, gemstone. (Pelt and game_meat stay explicitly out of scope — they are hunting materials for future cooking content, not smithing.)
- Stay a **sink, not a faucet**: the Forge grants **no gold and no XP** (avoids re-creating BAL-01/BAL-04). Its habit-loop coupling is indirect but real — every input (materials, gold) was earned through energy-gated modes, and energy comes only from habit completion.

**Sequencing (plan3):** Phase 9 (mobile) ships **before** Phase 8 (the Forge). Apply plan3 item 8.1's corrections (already folded into this revision) before building.

### Locked design decisions

| Decision | Choice |
|---|---|
| Risk model | **Crude tier, no loss** — materials/gold are never wasted; a poor run yields a sub-baseline *Crude* item. |
| Mechanic depth | **Heat economy in three beats** *(rev 3: quench added during build-out)*: stoke (bellows) → strike (hammer; light/heavy strikes, re-stoking with metal fatigue, tempo, crits, events) → quench (one timed plunge). |
| Stat influence | **DX + ST** — DX widens the strike sweet-zone and heat band; ST powers each strike (fewer strikes needed). |
| Quality spread | **Crude / Normal / Fine / Masterwork** via `scaleTierStat` — multiplier-based (×0.85 / ×1.0 / ×1.15 / ×1.3) with guaranteed-distinct integer floors (§2). |
| Gating | None beyond material + gold cost (no energy/daily gate) — acceptable *only because the Forge is a pure sink*. |

### Resolved design questions (2026-07-07, with owner)

1. **Phase B depth** → charged strikes + re-stoke inside the two-phase skeleton (not pure timing, not a single-loop rework).
2. **Re-forge** → yes: owned items can be re-forged at a gold-heavy, material-light cost (§5).
3. **Fuel & Flux** → yes: optional consumable boosts using dead-end materials, built as milestone M5.
4. **Crude on first craft** → real: a bad first craft genuinely stores Crude (upgrade rule fixed to allow it, §2).
5. Target craft duration → **~15–20 s** (was 10–12 s; re-stoking extends runs).
6. Best-tier badge on recipe rows → yes (M4).
7. Exempt recipes → all gear/weapon recipes use the Forge; item-kind recipes (none exist today) skip it.

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

The 0.40/0.75 cutoffs deliberately match `scoreToStars` (`src/engine/trials/trials.ts`) — the codebase's canonical "OK / good / great" thresholds. *(Exact cutoffs re-checked in M6 playtesting.)*

### Stat scaling: guaranteed-distinct integers

**Problem found in review:** naive `Math.round(base × mult)` collapses tiers on small items. Craftable stats run as low as 3–4 (`sage_ring` +3 WI, `leather_vest` def 4 — `src/content/gear.ts`); on a +3 trinket, Crude (2.55), Normal (3), and Fine (3.45) all round to 3. A "Fine" badge with Crude-identical stats violates the audit's **reward honesty** pillar (BAL-08/MINI-08 class of bug: UI advertises scaling that doesn't exist).

**Fix:** every scaled stat goes through one helper that rounds, then enforces per-tier integer floors so **every tier is visibly different on every item**:

```ts
/** Scale one item stat by tier, guaranteeing visibly distinct integers per tier. */
export function scaleTierStat(base: number, tier: CraftTier): number {
  if (base <= 0) return base;                 // zero/absent stats stay untouched
  const raw = Math.round(base * CRAFT_TIERS[tier].mult);
  switch (tier) {
    case CRUDE:      return Math.min(raw, Math.max(1, base - 1)); // always worse (min 1)
    case NORMAL:     return base;                                  // exact baseline
    case FINE:       return Math.max(raw, base + 1);               // always at least +1
    case MASTERWORK: return Math.max(raw, base + 2);               // always at least +2 (and > Fine)
  }
}
```

On big items the multiplier dominates (obsidian_plate def 12 → Crude 10 / Fine 14 / Masterwork 16); on small items the floors take over (sage_ring +3 WI → 2 / 3 / 4 / 5). Monotonicity Crude < Normal < Fine < Masterwork holds for every base ≥ 1 (property-tested in M6 across all craftables).

**What gets scaled:**
- Gear: `defense`, `ward`, each value in `statBonuses`.
- Weapons: `bonus`.
- **Not** scaled: gear `xpBonus` and `mining`/`chopping` power (GearDef tool-slot fields — *not* WeaponDef, as revision 2 misstated); weapon `attackStat`, `staminaCost`, `ranged`, `range`. These are categorical/functional properties that quality shouldn't alter.
- **Bypass seam (intentional):** `miningSlice.ts:116` / `forestSlice.ts:112` read tool power via a direct `getGear(toolKey)` — they never touch `gearFor`. Since tool power is explicitly unscaled, these reads stay untouched; do not "fix" them to route through the scaled path.

### Upgrade rule (fixed)

```ts
const newTier = prev === undefined ? tier : Math.max(prev, tier);
```

> **Revision-1 bug:** `Math.max(prev ?? NORMAL, tier)` made Crude unstorable — a first craft
> scoring Crude was silently promoted to Normal, so the locked risk model was unreachable.
> The absent-key default to Normal applies only at **read** time (shop/loot items); at
> **write** time the first craft stores its earned tier, Crude included.

Re-crafting can only **improve** a stored tier, never downgrade it. A run that scores at or below the current tier changes nothing (the cost is still spent — see §5 for the cheaper targeted path).

---

## 3. Minigame Mechanic (Three-Phase Heat Economy) *(§ corrected to as-shipped in rev 3)*

Design intent: the audit's recurring minigame failure is *skill-optional* play (MINI-10 mash, MINI-11 abandon-retry), and the best-liked modes (Rooftop Chase, the crawlers) all layer **resource decisions on execution**. Phase B therefore treats heat as a spendable resource with three competing verbs — light strike, heavy strike, re-stoke — instead of a bare tap-timing test.

### Phase A — Stoke the fire (heat)

A vertical heat bar fills while the player **holds** the bellows control. A highlighted "sweet band" sits high on the bar. When the player **releases/commits**, `heat01 ∈ [0,1]` is computed as proximity to the band centre.

- DX widens the sweet band slightly (higher DX = more room for error).
- Once committed, Phase B opens with heat = the committed bar level. Heat then **decays in real time** throughout Phase B — let it hit zero and the forging ends.

### Phase B — Strike (hammer + bellows)

An oscillating needle sweeps a horizontal bar left↔right; a moving sweet-zone slides across the bar. Heat decays passively the whole phase. The player juggles three verbs:

| Verb | Input | Effect |
|---|---|---|
| **Light strike** | tap hammer (release before `CHARGE_TIME_S`) | `progress += strikeAccuracy × strikePower(ST)` |
| **Heavy strike** | hold hammer ≥ `CHARGE_TIME_S`, then release | `progress += strikeAccuracy × strikePower(ST) × CHARGE_MULT` (×1.7), but the sweet-zone **shrinks up to 25% while charging**, and heat keeps draining during the hold |
| **Re-stoke** | hold bellows | heat regains at the rise rate; **can't strike while stoking**; forge-progress slowly cools (`PROGRESS_COOL_RATE`); each re-stoke session applies **metal fatigue** — max heat drops by `RESTOKE_FATIGUE` (10%) |

**Layered on the strike phase (rev 3, as shipped):**

- **Tempo meter** — landed blows spaced inside the on-beat window (`0.7–1.6 s`) build tempo; tempo multiplies progress ×0.75→×1.25. A gap under `0.55 s` (mashing) or a whiff resets it. The hammer never refuses input — a mashed strike just lands weak.
- **Perfect-strike crits** — accuracy ≥ `0.92` rings true: ×1.25 bonus progress.
- **Forge events** — a schedule rolled once at `initForge` (injectable rng; deterministic in tests): **Ember Surge** (2.5 s, zone ×1.5 wider, progress ×1.3 — strike now!) and **Cold Snap** (2 s, heat decay ×2.5 — stoke or push through).
- **Metal temperaments** — the recipe's material family sets the run's personality (`recipeTemperament`, `crafting.ts`): crystalline → **fickle** (twitchy needle, restless zone, fast heat bleed), metal bars → **stubborn** (slow needle, tight zone, harder-hitting blows), soft goods → **supple** (forgiving heat, cheap re-stokes). Different recipes *play* differently, not just cost differently.

### Phase C — Quench (finisher)

When progress reaches 1.0 the piece goes to the slack tub: a bar falls 1 → 0 (`QUENCH_FALL_RATE = 0.45`/s, ~2.2 s window) and the player taps once to plunge as it crosses the quench band (centre `0.55`, half-width `0.12` + DX + flux). One timed beat worth `0.10` of the score — a botched quench can drop a Masterwork-grade run to Fine, but never below what the strikes earned. If heat dies before progress fills, the run skips the quench and scores what was banked.

This mirrors proven mechanics: the heavy strike is the mine's charged swing translated to the anvil (`CHARGE_SWING_COUNT`/`CHARGE_DAMAGE_MULT = 2.25`, `src/engine/crawl.ts:303-306` — hold costs time and demands precision, but honestly out-performs mashing), and re-stoke-with-fatigue is the recover-verb-with-diminishing-returns pattern from Rooftop Chase's lead economy.

**Moment-to-moment decisions:** strike light and safe? risk a heavy while the zone shrinks? spend runway re-stoking (and bleed progress) to buy more strikes? The optimal line depends on remaining heat, current accuracy, and ST — there is no zero-skill dominant strategy: spam is punished by the accuracy blend (below), pure heavies by the shrunken zone, and infinite stoking by fatigue + progress cooling.

- **DX** widens the sweet-zone (and Phase A band, and the quench band). The Homestead Smithy's `forge_focus` perk adds +0.03 to the strike-zone half-width (`sweetBonus`, additive before the cap).
- **ST** increases `strikePower` (high-ST characters need fewer good strikes).
- Strike phase ends when progress reaches 1.0 (→ quench) **or** heat hits zero (→ done, quench skipped, `quench01 = 0`).

### Scoring

Each strike records `{ acc, weight }` where `weight` is its progress multiplier (1 for light, `CHARGE_MULT` for heavy). Mean accuracy is contribution-weighted:

```
meanAcc  = Σ(acc·w) / Σw
strike01 = √(progressFilled × meanAcc)      // spam can't max it: needs fill AND accuracy
score01  = clamp(0.32 × heat01 + 0.58 × strike01 + 0.10 × quench01, 0, 1)
```

→ tier lookup → item quality stored. A perfect stoke is worth 0.32 and a perfect quench 0.10, so Masterwork (≥0.75) is unreachable with a botched stoke (cap 0.68) — heat always matters — and strikes alone can't carry a run. `forgeScoreParts` exposes the three components for the result panel's breakdown.

### Constants (as shipped — `src/engine/crafting/forge.ts:21-66` is the source of truth)

```ts
export const HEAT_RISE_RATE   = 0.25;  // Phase A fill + Phase B re-stoke, per second
export const HEAT_FALL_RATE   = 0.35;  // Phase A bar drop when released, per second
export const HEAT_DECAY_RATE  = 0.125; // Phase B passive drain (8 s runway at full heat)
export const HEAT_BAND_START  = 0.62;
export const HEAT_BAND_WIDTH_BASE = 0.16;  // widened by DX
export const NEEDLE_PERIOD_S  = 2.0;
export const SWEET_HALF_BASE  = 0.10;  // widened by DX (+0.03 forge_focus perk)
export const ZONE_DRIFT_FRAC  = 0.35;  // zone drifts at 0.35× needle speed (no beat lock)
export const CHARGE_TIME_S    = 0.9;   // hammer hold to prime a heavy strike
export const CHARGE_MULT      = 1.7;   // heavy strike multiplier (rev 3: was 1.9 — tempo/crit raise a good blow's real value)
export const CHARGE_ZONE_SHRINK = 0.75; // sweet-zone half-width factor at full charge
export const RESTOKE_FATIGUE  = 0.10;  // max-heat loss per re-stoke session (rev 3: was 0.15 — longer runs mean more re-stokes)
export const PROGRESS_COOL_RATE = 0.04; // progress drain per second while stoking
// Tempo: TEMPO_SPAM_S 0.55 / window 0.7–1.6 s / GAIN 0.25 / DECAY 0.08 / mult 0.75–1.25
// Crits: CRIT_ACC 0.92 / CRIT_BONUS 1.25
// Events: EMBER 2.5 s (zone ×1.5, prog ×1.3) / SNAP 2.0 s (decay ×2.5)
// Quench: FALL_RATE 0.45 / BAND_CENTRE 0.55 / HALF_BASE 0.12
```

**Stat scaling formulas** (as shipped):

```ts
heatBandWidth(dx)          = min(0.40, 0.16 + dx * 0.008)
strikeSweetHalf(dx, perk)  = min(0.35, 0.10 + perk + dx * 0.006)   // perk = forge_focus 0 | 0.03
strikePower(st)            = min(0.26, 0.13 * (1 + st * 0.015))    // rev 3: base 0.20→0.13 (tempo/crit compensate)
```

**Tuning anchor:** stats hard-cap at **25** (`STAT_CAP`, `src/engine/progression.ts:22`), so the real ranges are band width 0.16→0.36, sweet half 0.10→0.25 (+0.03 perk), strikePower 0.13→0.18 — the `min()` ceilings above are unreachable and exist only as safety rails. A focused build reaches DX or ST ~12–16 by character level 5 and caps ~25 by level 15–20; tune M6 difficulty against stat levels **1 / 8 / 16 / 25**, not against the ceilings. This matches the codebase idiom: stats widen tolerances/add power, always capped, never trivializing (Armory Break `ST_ZONE_WIDEN_PER_LEVEL`, Lockpicking DX tolerance, Last Stand HP window).

**Sanity math (rev 3):** at ST 0, a perfect on-tempo light fills ~0.13–0.16 (tempo ×0.75→1.25) and a critted heavy ~0.28; intended play lands a finished piece in the **12–25 s** band (asserted by the bot sims in `forge.test.ts` "run economy"). Re-stoking extends runway at 0.10 max-heat per session.

### Controls

- **Keyboard:** tap `Space` = light strike; hold+release `Space` = heavy; hold `Shift` (or `B`) = bellows. Phase A: hold/release `Space`. Phase C: tap `Space` to plunge.
- **Pointer (mobile):** two on-screen buttons — **hammer** (tap = light, hold = charge; tap = plunge in the quench) and **bellows** (hold). Phase A: hold/release anywhere on the bar panel. Haptic buzz on strikes/crits/quench (coarse-pointer only, `src/lib/haptics.ts`).
- All phases fully playable with either input alone (bellows key optional in a no-re-stoke run).

---

## 4. Legibility (audit pillar)

*"Legibility is the cheapest reward buff"* (plan3 strategic direction; HABIT-09/BAL-07/MINI-12). The Forge must show players that their habit-trained stats are doing something:

- ForgeMinigame header shows live stat chips with **real numbers**: `DX 14 → +11% wider zones`, `ST 12 → +18% strike power` (computed from the formulas above, not hand-written copy).
- The sweet-zone/band are rendered at their actual DX-scaled width, so improvement is visible run-over-run.
- Result panel shows the score breakdown (heat / strikes) alongside the tier, so a near-miss on Masterwork reads as "stoke better", not RNG.

---

## 5. Re-forge (repeatable gold sink)

**Problem:** improving an owned item's quality otherwise costs the full recipe every attempt (obsidian_plate: 3 obsidian + 2 frost_quartz + 2 iron bars + 130g — many deep-mine runs), even when the new run scores lower and changes nothing. Meanwhile plan3 Phase 4 explicitly deferred a *"repeatable ≥500g gold sink"* and named re-forging the best fit (BAL-05).

**Design:** any **owned, crafted** gear/weapon below Masterwork gets a **Re-forge** action in ForgeSection:

- **Cost:** `max(100, 2 × (recipe.gold ?? 0))` gold **+ 1 × the recipe's anchor material**.
  - Anchor = new optional `RecipeDef.reforgeAnchor` (a `MaterialKey`), defaulting to the recipe's first-listed material. Set explicitly for the band recipes: obsidian_plate → `obsidian`, mithril_pickaxe → `obsidian`, resin_trinket → `amber_resin`.
  - Examples: obsidian_plate re-forge = **260g + 1 obsidian**; iron_mace = **100g + 1 iron_bar**.
- Plays the identical minigame; the **upgrade-only rule applies** — a worse run spends the cost and changes nothing. Chasing Masterwork on a big item therefore sinks 500g+ across attempts for a mid-skill player, exactly the deferred target.
- **Pricing rules:** must respect BAL-15/4.10 (**no decoy premiums** — re-forge is honestly cheaper in materials than a full re-craft, and the gold premium is the sink, stated plainly in the UI), and must not undercut the 4.4 band recipes' material demand (hence the anchor material, which keeps deep runs relevant).
- Store action: `reforge(recipeKey, score01, boosts?)` in `economySlice` — validates ownership + cost, consumes, applies the same tier-max write as `craft`.

Full re-craft (complete recipe cost) remains available and is the only path for items you don't own yet.

---

## 6. Fuel & Flux (dead-end material sink)

Optional pre-run panel shown before Phase A (skippable — "Just forge"):

| Slot | Cost | Effect (one run) | Source of material |
|---|---|---|---|
| **Fuel: Seasoned Wood** | 2 wood | heat decay ×0.7 (longer runway) | forest chopping (`src/engine/forest.ts:1091`) |
| **Fuel: Firebrick** | 2 stone | re-stoke fatigue 0.10 → 0.05 (more recoveries) *(rev 3 values)* | mine rubble (`src/engine/mining.ts:1023`) |
| **Flux: Gemstone** | 1 gemstone | both sweet zones ×1.25 wider | mine floor 10+ node, dungeon encounters |

- One fuel + one flux max per run; the two fuels are mutually exclusive.
- **Consumed only when the run reaches the result screen** — cancelling mid-forge refunds everything, consistent with the cancel rule in §8. Consumption happens atomically inside `craft`/`reforge` (boosts are passed as an argument, e.g. `craft(key, score01, { fuel: 'wood', flux: true })`), so there is no separate spend step to desync.
- Serves BAL-16: wood, stone, and gemstone currently have **no sink anywhere**. Pelt/game_meat remain out of scope (future cooking/hunting content — note this in the panel copy? No: just leave them untouched, no UI mention).
- Effects are **run-quality helpers, not tier purchases**: they widen margins but a zero-skill run still scores Crude. Flux is deliberately the rare one — it's the "I'm going for Masterwork on obsidian_plate" spend.

---

## 7. Milestones

Build in strict order. Do not start the next milestone until the previous one's tests pass and a manual smoke-check looks correct.

---

### M1 — Quality data model & plumbing (invisible to users) — ✅ shipped 2026-07-08

**Goal:** land the save-format and combat-pipeline changes first, behind a default that changes nothing visible. Every existing test must still pass at the end of M1.

#### Changes

**`src/engine/crafting.ts`** — add tier types and helpers:

```ts
export type CraftTier = 0 | 1 | 2 | 3;
export const CRUDE = 0; export const NORMAL = 1;
export const FINE = 2;  export const MASTERWORK = 3;

export interface CraftTierDef { name: string; mult: number; color: string; glyph: string }

export const CRAFT_TIERS: Record<CraftTier, CraftTierDef> = {
  0: { name: 'Crude',      mult: 0.85, color: '#8b6914', glyph: '🟤' },
  1: { name: 'Normal',     mult: 1.00, color: '#c9a227', glyph: '⬜' },
  2: { name: 'Fine',       mult: 1.15, color: '#7dd3fc', glyph: '🔵' },
  3: { name: 'Masterwork', mult: 1.30, color: '#a78bfa', glyph: '💜' },
};

export function scaleTierStat(base: number, tier: CraftTier): number { /* §2 */ }
export function scoreToTier(score01: number): CraftTier { /* §2 cutoffs */ }
export function tierLabel(tier: number): string { /* name ?? 'Normal' */ }
```

**`src/store/slices/economySlice.ts`**:
- Add `gearQuality: Record<string, number>` and `weaponQuality: Record<string, number>` to the slice type and initial state, both `{}`.
- Change `craft(recipeKey)` (`economySlice.ts:161`) to `craft(recipeKey: string, score01?: number)`. After the existing consumption, compute `tier = score01 === undefined ? NORMAL : scoreToTier(score01)` *(rev-2.1 fix: the earlier `scoreToTier(score01 ?? 1.0)` stored Masterwork on scoreless crafts, contradicting the "no score ⇒ Normal" test below)*; for gear/weapon results write with the **fixed upgrade rule**:
  ```ts
  const prev = /* gearQuality or weaponQuality */[key];
  const newTier = prev === undefined ? tier : Math.max(prev, tier);
  ```
  Item-kind results ignore tier. *(Re-forge and boosts arrive in M5 — keep M1 minimal.)*

**`src/store/commit.ts`** *(rev-2.1 correction: was shared.ts before the ARCH-10 split; shared.ts now just re-exports commit.ts)* — apply quality at the two combat seams:

1. `gearFor` (`commit.ts:78`) — after resolving each equipped `GearDef`, return a quality-scaled copy: `defense`/`ward`/`statBonuses` values through `scaleTierStat(v, gearQuality[key] ?? NORMAL)`; all other fields copied as-is. `aggregateGear` (`src/engine/gear.ts:53`) stays untouched — it sums whatever `gearFor` hands it. (`habitsSlice.ts:178` also consumes `gearFor` for `gearXpMultiplier` — safe, it reads only the unscaled `xpBonus`.)
2. Add `equippedWeaponDef(state): WeaponDef` — `{ ...w, bonus: scaleTierStat(w.bonus, weaponQuality[state.equippedWeapon] ?? NORMAL) }` — and replace the bare `getWeapon(state.equippedWeapon)` at **`commit.ts:136`** (inside `fighterFor`).

> **Correction (plan3 8.1 / MINI-41, re-verified 2026-07-07):** revision 1 claimed `miningSlice`/`forestSlice` build
> run snapshots with bare `getWeapon` calls — they don't; both route through `fighterFor`.
> **`commit.ts:136` is the single combat weapon seam.** At build time, `grep getWeapon src/store src/hooks`
> to confirm nothing else resolves the equipped weapon for combat. (`dungeonSlice.ts:258` reads
> only `attackStat`, which is unscaled — leave it untouched. The remaining `getWeapon` calls in
> `src/components`/`src/views` are display-only; M4 handles their tier display.)

**`src/store/useGameStore.ts`**:
- Bump `persist` `version` **32 → 33** (`useGameStore.ts:176`) with a `// v33:` comment following the version-history convention there.
- *(rev-2.1 correction)* No explicit `merge`/`migrate` line is needed: per the v31 (`trialAttemptNonce`) / v32 (`spiritGroveSeen`) precedent, a new top-level Record field defaults from the slice's initial state (`{}`) via the merge spread on old saves. Declare `gearQuality: {}` / `weaponQuality: {}` in economySlice's initial state (mirroring `ownedGear`) and that is sufficient.

#### Tests for M1

- `scaleTierStat` per-tier values on representative bases (12, 6, 4, 3, 1) — including the small-base floors (base 3 → 2/3/4/5) and `base 1` Crude staying ≥ 1.
- **Distinctness property:** for every craftable gear/weapon stat in `src/content/`, the four tiers produce strictly increasing values.
- `scoreToTier` boundaries at exactly 0.20 / 0.40 / 0.75.
- **First craft at score 0.1 stores CRUDE** (the revision-1 regression); re-craft at 0.9 upgrades to MASTERWORK; re-craft at 0.5 leaves MASTERWORK.
- `craft(recipeKey)` with no score ⇒ stores NORMAL (identical to today).
- `equippedWeaponDef` scales `bonus` only; absent key ⇒ unchanged weapon.
- Quality-scaled `gearFor` → correct `defense`/`ward`/`statBonuses`; `xpBonus`/`mining` untouched; absent keys ⇒ `aggregateGear` output byte-identical to pre-M1.
- `npm run test` and `npm run typecheck` fully green.

#### M1 ship state

One-click craft still works (no `score01` ⇒ Normal). Nothing visibly different. All existing balance tests pass unchanged.

---

### M2 — Forge engine (pure reducer & tests) — ✅ shipped 2026-07-08 (extended: tempo/crits/events/quench/temperaments)

**Goal:** the complete mechanic as a pure, framework-free engine, fully tested.

#### New file: `src/engine/crafting/forge.ts`

Because Phase B now carries real state (heat, fatigue, charging, stoking, progress), the engine is a **pure reducer** in the style of `lastStand.ts`/`rooftopChase.ts` (`stepX(state, input, dt)`), with accuracy helpers in the style of `armoryBreak.ts`:

```ts
export interface ForgeRunState {
  phase: 'stoke' | 'strike' | 'done';
  heatBar: number;                 // Phase A fill
  heat01: number;                  // committed Phase A accuracy
  heat: number; heatMax: number;   // Phase B resource + fatigue ceiling
  restokes: number;
  charging: boolean; chargeT: number;
  stoking: boolean;
  needlePos: number; needleDir: 1 | -1;
  zoneCentre: number; zoneDir: 1 | -1;
  progress: number;
  strikes: { acc: number; weight: number }[];
}

export interface ForgeInput { hammerHeld: boolean; bellowsHeld: boolean }
export interface ForgeMods  { decayMult: number; fatigue: number; zoneMult: number } // fuel/flux, defaults 1/0.15/1

export function initForge(dx: number, st: number, mods?: Partial<ForgeMods>): ForgeRunState;
export function stepForge(s: ForgeRunState, input: ForgeInput, dtSec: number,
                          dx: number, st: number, mods: ForgeMods): ForgeRunState;
export function commitStoke(s: ForgeRunState, dx: number): ForgeRunState;   // Phase A release
export function forgeScore(s: ForgeRunState): number;                        // §3 blend
// plus the pure helpers: heatBandWidth, heatAccuracy, strikeSweetHalf,
// strikeAccuracy, strikePower — formulas in §3
```

Reducer responsibilities: needle/zone oscillation, passive heat decay (× fuel `decayMult`), charge accumulation + zone shrink while charging, strike resolution on hammer release (light vs heavy by `chargeT`), re-stoke sessions (rise, progress cooling, fatigue on session start), and end conditions (progress ≥ 1 or heat ≤ 0 → `phase: 'done'`).

Constants from §3 all exported so the UI renders bands/zones at true size. No RNG, no React, no store imports — the Forge is single-player and synchronous, so no `runRng` plumbing and no co-op concerns.

#### New file: `src/engine/crafting/__tests__/forge.test.ts`

Cover:
- Helper formulas: band/zone widening with DX (monotone, correct at DX 0 and 25); `strikePower` at ST 0 = 0.20, ST 25 ≈ 0.275.
- `heatAccuracy`/`strikeAccuracy`: centre → 1.0, edge → 0, outside → 0.
- Reducer: light strike advances progress by `acc × strikePower`; heavy = ×`CHARGE_MULT` and requires `chargeT ≥ CHARGE_TIME_S`; zone half-width shrinks toward ×`CHARGE_ZONE_SHRINK` while charging; heat decays during charge.
- Re-stoke: heat rises while stoking, progress cools at `PROGRESS_COOL_RATE`, `heatMax` drops `RESTOKE_FATIGUE` per session (not per frame), strikes impossible while stoking.
- End conditions: progress ≥ 1 ends phase; heat ≤ 0 ends phase (including **mid-charge** — charge is lost, no strike fires).
- `forgeScore`: all-perfect → ≥ 0.75; all-zero → Crude band; weighted `meanAcc` (one accurate heavy outweighs one sloppy light); spam (fill via many low-acc strikes) scores below fewer accurate strikes; heat01 = 0 caps score at 0.65 (Masterwork unreachable).
- Fuel/flux mods: `decayMult` slows drain; `fatigue` override; `zoneMult` widens both zones.

---

### M3 — Forge minigame UI wired to craft — ✅ shipped 2026-07-08 (split into `forge/` subcomponents)

**Goal:** clicking "Craft" opens the interactive Forge modal; on completion the item is written to the store with its earned tier.

#### New file: `src/components/inventory/ForgeMinigame.tsx`

A full-screen modal (fixed-inset z-50, like other overlays). **Primary template: `src/components/trials/ArmoryBreak.tsx`** — it already demonstrates every hard part: rAF loop reading refs (never state) per frame, state mirrored into refs so callbacks avoid stale closures, `setPointerCapture` + Space keydown/keyup with `e.repeat` guard, and hold-release scoring.

```
ForgeMinigame
├── Header: recipe name, cost reminder, stat chips (§4: "DX 14 → +11% wider zones")
├── Phase A panel — heat bar (vertical, fills on hold) + DX-scaled sweet band
│     "Hold to stoke — release to lock heat"
├── Phase B panel
│   ├── Heat gauge with fatigue ceiling marker (dims as heat drops)
│   ├── Needle bar + moving sweet-zone (shrinks visibly while charging)
│   ├── Forge-progress bar + strike count badge
│   └── Buttons: [🔨 hammer — tap/hold] [💨 bellows — hold]   (+ Space / Shift keys)
└── Result panel — item crest (Sprite), tier badge (name+glyph+colour), score
      breakdown (heat / strikes), flavour line, "Continue" → craft(recipeKey,
      score01), onClose()
```

Implementation notes:
- One `useRef` rAF loop calls `stepForge` with dt and writes `heat`/`needlePos`/`zoneCentre`/`progress` **directly to DOM styles** (the `MineRunOverlay.tsx:161-177` charge-bar discipline — no 60 fps React re-renders). React state changes only at phase transitions.
- **Release-instant projection:** apply the `projectReleasePower` pattern (`src/engine/trials/armoryBreak.ts:33`) to hammer releases — project needle position forward from the last rAF frame to the true pointer-up timestamp so strike accuracy doesn't quantize to frame boundaries. (This feel detail is why Armory Break's releases feel fair; don't skip it.)
- Read `useGameStore(s => s.character.statLevels)` once at mount; snapshot DX/ST into refs.
- Consider parameterizing `src/components/trials/MashMeter.tsx` (vertical bar + sweet-zone overlay + needle, with locked-state colours) for the Phase A heat bar rather than forking it.
- Styling: `Panel tone="parchment"`, `text-ink`, `border-gold-deep`, `Hammer` icon (lucide-react, already imported in ForgeSection).
- `prefers-reduced-motion`: detect via `window.matchMedia` (idiom: `useSmoothCamera.ts:143`); if set, slow the needle ×1.5 and widen both bands ×1.5. (Note: this is the first *gameplay-affecting* reduced-motion accommodation in the codebase — existing handling is visual-only. Deliberate: the Forge is unavoidable core-loop content, unlike optional trials.)
- Props: `{ recipeKey: string; mode?: 'craft' | 'reforge'; onClose: () => void }` (mode used from M5).

#### Modified: `src/components/inventory/ForgeSection.tsx`

- `const [forgeTarget, setForgeTarget] = useState<string | null>(null)`; the Craft button opens the modal instead of calling `craft` directly. Guard: recipes with `result.kind === 'item'` (none today) still call `craft(key)` directly and skip the minigame.
- Render `<ForgeMinigame recipeKey={forgeTarget} onClose={...} />` when set.

#### Manual verification for M3

`npm run dev` → Crafting tab (dev settings: unlimitedGold) → Craft "Iron Mace":
1. Modal opens; stat chips show real DX/ST numbers.
2. Phase A hold/release in band → Phase B opens at committed heat.
3. Phase B: light taps land; hold produces a visibly shrinking zone then a heavy hit; bellows re-stoke raises heat, drains progress, lowers the ceiling marker.
4. Let heat run out mid-run → run ends and scores what was banked.
5. Deliberately hit all four tiers across runs; store writes the tier (visible in M4).

---

### M4 — Tier display & visual feedback — ✅ shipped 2026-07-08 (incl. BattleScene weapon label)

**Goal:** quality is visible everywhere items appear.

1. **`ForgeSection.tsx`** recipe rows: best-crafted tier chip (`Fine 🔵` / `Masterwork 💜`) when `gearQuality[key]`/`weaponQuality[key]` exists — this is also the "should I re-forge?" signal.
2. **`src/components/inventory/GearSection.tsx`**: owned gear/weapon cards get a tier-prefixed name ("Fine Leather Vest") tinted `CRAFT_TIERS[tier].color`; stat text shows the scaled values (already flowing from `gearFor` — display-only work). Add `tierPrefix(name, tier)` helper here (plain name when tier absent or Normal).
3. **`src/components/character/PaperDoll.tsx`** *(correct path — revision 1 said `inventory/`)*: tier badge on equipped slots. **Rev-2.1 note:** PaperDoll computes its displayed totals with raw `getGear`/`getWeapon` + its own `aggregateGear` call (`PaperDoll.tsx:64-72`) — it bypasses `gearFor`. M4 must route its numbers through the quality-scaled helpers (or scale in place) so the displayed stats match what `fighterFor` actually fields; a tier badge alone would leave the shown numbers wrong for non-Normal items. Same check applies to `BattleScene.tsx:494` and `WeaponsSection.tsx:22` weapon displays.
4. **ForgeMinigame result panel** (built in M3): confirm tier name + glyph + colour + score breakdown are prominent.

Never colour-only: tier is always name + glyph + colour (matches the trials' a11y idiom).

---

### M5 — Re-forge & Fuel/Flux (economy features) — ✅ shipped 2026-07-08

**Goal:** ship §5 and §6 on top of the working minigame.

#### Changes

- **`src/content/recipes.ts`**: optional `reforgeAnchor?: MaterialKey` on `RecipeDef`; set for the three band recipes (§5).
- **`src/store/slices/economySlice.ts`**:
  - `reforge(recipeKey, score01, boosts?)` — requires the item owned and below MASTERWORK; cost `max(100, 2 × (recipe.gold ?? 0))` gold + 1 anchor material (`unlimitedGold` bypasses gold as usual); consumes; writes tier via the same upgrade rule.
  - Extend `craft(recipeKey, score01?, boosts?)` — `boosts: { fuel?: 'wood' | 'stone'; flux?: boolean }`; validate + consume fuel/flux materials atomically in the same write that consumes the recipe.
- **`ForgeMinigame.tsx`**: pre-run Fuel & Flux panel (skippable); pass resulting `ForgeMods` to `initForge`; `mode: 'reforge'` variant shows the re-forge cost and current tier → target.
- **`ForgeSection.tsx`**: owned, non-Masterwork recipes show a **Re-forge** button with explicit cost copy ("260g + 1 Obsidian — quality can only improve").

#### Tests for M5

- `reforge`: happy path upgrades tier; below-cost rejected; already-Masterwork rejected; worse score spends cost but keeps tier; unowned item rejected.
- Boost consumption: fuel/flux subtracted exactly once, only on commit; insufficient materials disables the slot (UI) and is rejected (action guard).
- Mods reach the reducer: wood run drains slower; stone run fatigues less; gemstone run has wider zones (assert via engine, not pixels).
- Anchor default = first-listed material when `reforgeAnchor` absent.

---

### M6 — Balance, polish & accessibility — ✅ code complete 2026-07-08; human playtest-tuning pass still open (plan3 8.3)

**Goal:** the minigame feels good at all stat levels, looks polished, and is accessible.

#### Balance tuning

- Playtest the DX × ST grid at **1 / 8 / 16 / 25** (the real stat range — see §3 tuning anchor):
  - Low stats (new player): Normal reliable, Fine takes effort, Masterwork possible on a great run with flux.
  - Mid stats: Fine comfortable, Masterwork achievable with good play.
  - Capped stats: Masterwork consistent with good play — but never AFK (Crude must remain the honest outcome of not playing).
- Verify the three-verb economy holds: charging must honestly out-score light-spam at equal skill (cf. the mine's `CHARGE_DAMAGE_MULT` retune, `crawl.ts:305` — it was DPS-negative at 1.75 and had to go to 2.25; watch for the same trap with `CHARGE_MULT`), and a 3-re-stoke marathon must not beat a clean 2-stoke run.
- Re-forge pricing: confirm a mid-skill Masterwork chase on obsidian_plate sinks ≥ 500g cumulative without feeling like a decoy (BAL-15).
- Cross-check `engine/__tests__/balance.test.ts` — Normal tier must still match the pre-M1 baseline everywhere.
- Revisit `scoreToTier` cutoffs and all §3 constants against playtest data.

#### Visual & audio polish

- Screen-shake on strikes: reuse `shakeOffset` (`src/engine/crawl.ts:515`) with a local shake ref — heavy strikes shake harder; **zero shake under reduced motion** (idiom: `useSmoothCamera.ts:203`).
- Spark burst on Fine/Masterwork reveal (CSS animation; keep it small). Hit-flash via a CSS class toggled directly on the element (`crawler-hit-flash` pattern, `useCrawlRunFx.ts`).
- **SFX: 4 new cues in the existing synth engine `src/lib/sfx.ts` — no new audio system.** Add to the `SfxCue` union + `_CUES` map, templated from the armory set (`sfx.ts:667-690`): `forgeStoke` (rising sawtooth+noise while held, from `armoryCharge`), `forgeStrikeGood` / `forgeStrikeMiss` (from `armoryLockCrack`/`armoryLockMiss`), `forgeComplete` (from `armoryFinish`). Optional: `setDroneIntensity` tied to remaining heat for late-run tension.
- Anvil/flame scene via `getScene`/`resolveSceneImage` placeholder (`src/lib/scenes.ts`, new `forge:anvil` key; real PNG swappable later via the art seam).

#### Accessibility

- Reduced motion (extends M3): also slow heat decay 50%.
- Minimum widths regardless of DX: strike sweet-zone half-width never below 0.10 effective after all modifiers; even DX 1 must reach Normal with modest effort.
- Crude flavour text clearly distinguishes outcome from bug: *"The tempering went poorly — a rough but serviceable piece."*
- All verbs work via keyboard (Space + Shift), pointer (two buttons), no colour-only indicators.

---

## 8. Edge Cases & Decisions

| Case | Behaviour |
|---|---|
| Existing saves | Absent quality entry ⇒ Normal ⇒ identical stats. Zero migration (persist bump 32→33; initial-state defaults suffice, no merge/migrate lines — v31/v32 precedent). |
| Shop / loot items | No quality entry ⇒ Normal (×1.0) everywhere. |
| First craft scores Crude | **Stored as Crude** (bug fixed — see §2). Item works, stats ×0.85 with the −1 floor. |
| Re-craft / re-forge an upgraded item | `max(existing, newTier)` — upgrade only, never downgrade. Cost always spent. |
| Player closes the modal mid-forge | `onClose()` without `craft`/`reforge` — nothing consumed (recipe, gold, fuel, flux). Cancellable until the result screen's Continue. |
| Heat hits zero mid-charge | Run ends; the primed heavy is lost (no strike fires); banked progress is scored. |
| Re-stoke below current heat band | Allowed — stoking is a Phase B resource action, not re-scored; `heat01` stays the Phase A commit. |
| Consumable (item-kind) recipes | Skip the minigame; `craft(key)` directly; quality maps untouched. |
| `unlimitedGold` dev setting | Bypasses gold (craft + re-forge); materials and skill still gate tier. |
| `unlimitedEnergy` / `repeatMinigames` dev settings | N/A — no energy cost, no daily gate. |
| Fuel/flux with insufficient materials | Slot disabled in UI; action guard rejects (no partial consumption). |
| Concurrent equip during a forge run | Crafting is fully synchronous; no race with equipping. |
| Co-op / multiplayer | None — single-player, no `runRng`, no broadcasts. |

---

## 9. Critical Files

| File | Change |
|---|---|
| `src/engine/crafting.ts` | Tier types/helpers: `CraftTier`, `CRAFT_TIERS`, `scoreToTier`, **`scaleTierStat`**, `tierLabel` |
| `src/engine/crafting/forge.ts` | **New** — pure reducer (`initForge`/`stepForge`/`commitStoke`/`forgeScore`) + helpers + constants |
| `src/engine/crafting/__tests__/forge.test.ts` | **New** — full engine test suite |
| `src/store/slices/economySlice.ts` | `gearQuality`/`weaponQuality`; `craft(key, score01?, boosts?)`; **`reforge`** (M5) |
| `src/store/commit.ts` | Quality scaling in `gearFor` (:78); `equippedWeaponDef` replacing `getWeapon` at **:136** (single combat weapon seam). *(rev-2.1: was listed as shared.ts — ARCH-10 moved these)* |
| `src/store/useGameStore.ts` | Persist version **32→33**; merge defaults |
| `src/content/recipes.ts` | Optional `reforgeAnchor` field (M5) |
| `src/components/inventory/ForgeMinigame.tsx` | **New** — two-phase modal (template: `ArmoryBreak.tsx`) |
| `src/components/inventory/ForgeSection.tsx` | Craft → modal; tier chips; Re-forge button (M5) |
| `src/components/inventory/GearSection.tsx` | Tier prefix + tint on owned items |
| `src/components/character/PaperDoll.tsx` | Tier badge on equipped slots *(corrected path)* |
| `src/lib/sfx.ts` | 4 new cues templated from the armory set (M6) |
| `src/lib/scenes.ts` | New `forge:anvil` scene key (M6 art seam) |

---

## 10. Reuse (do not reinvent)

| Existing asset | Where to reuse it |
|---|---|
| `canCraft` / `getRecipe` + consumption loop (`economySlice.ts:161`) | Unchanged; extend the action |
| **`ArmoryBreak.tsx`** — rAF/ref discipline, pointer capture, Space handling, hold-release | Primary UI template for ForgeMinigame |
| **`projectReleasePower`** (`armoryBreak.ts:33`) | Release-instant projection for strike accuracy |
| `lastStand.ts` / `rooftopChase.ts` reducer shape | Template for `stepForge` |
| `armoryAccuracy` triangular-falloff shape | `heatAccuracy` / `strikeAccuracy` |
| `scoreToStars` 0.40/0.75 thresholds (`trials.ts`) | Tier cutoff basis |
| `MashMeter.tsx` (bar + sweet-zone + needle) | Parameterize for the Phase A heat bar |
| `aggregateGear` (`gear.ts:53`) | Unchanged; quality applied upstream in `gearFor` |
| Mine charged swing (`crawl.ts:303-306`, mult 2.25 after retune) | Heavy-strike risk/reward model + its balance lesson |
| `shakeOffset` (`crawl.ts:515`) + reduced-motion zeroing (`useSmoothCamera.ts:203`) | Strike screen-shake |
| `src/lib/sfx.ts` synth engine + armory cues (:667-690) | The 4 forge cues; optional heat-drone via `setDroneIntensity` |
| `MineRunOverlay.tsx:161-177` charge-bar-to-ref pattern | All per-frame DOM writes |
| `Panel`, `Button`, `Sprite`, `Hammer` icon | Layout |

---

## 11. Verification Checklist

*Ticked 2026-07-08 against the code + test-suite audit (85 forge engine tests, `forgeQuality`
store suite, full suite green, typecheck clean). The remaining human pass is the M6
playtest-tuning grid (plan3 8.3).*

At each milestone:
- [x] `npm run typecheck` — no type errors.
- [x] `npm run test` — all existing tests still green (1860+).
- [x] New milestone-specific unit tests pass.

End-to-end (after M3+):
- [x] Craft an affordable recipe → modal opens; stat chips show real DX/ST-derived numbers.
- [x] Phase A hold/release; commit inside band → Phase B opens at committed heat.
- [x] Phase B: light taps, a charged heavy (zone visibly shrinks), a re-stoke (heat up, progress bleeds, ceiling marker drops). Quench plunge scores the finisher.
- [x] Deliberately bad play → **Crude stored and displayed** (not silently Normal). Good play → Masterwork. (Bot sims: intended play ≥0.75; mashing can never fake Masterwork; re-stoke marathon loses to a clean run.)
- [x] Item shows tier prefix/badge in inventory, recipe row, and paper doll (M4).
- [x] Equip → combat stats reflect `scaleTierStat`; on a +3 trinket all four tiers show **different** integers (distinctness property test over all craftables).
- [x] Old save loads → everything Normal, stats identical to pre-Forge (absent-key ⇒ Normal at read; persist v33 defaults).
- [x] Re-forge (M5): cheaper cost shown honestly; worse run keeps tier; Masterwork item offers no re-forge.
- [x] Fuel/flux (M5): consumed only on Continue; cancel refunds; effects observable in-run (engine-level mod tests).
- [x] `prefers-reduced-motion` → slower needle/decay, wider bands; fully playable (bot sim: same tier earned under RM mods).
- [x] `grep -r "getWeapon" src/store src/hooks` → only the `equippedWeaponDef` seam (`commit.ts`) resolves the equipped weapon for combat (`dungeonSlice.ts` reads `attackStat` only — allowed).
- [ ] **M6 human playtest-tuning** (Orion): DX×ST grid at 1/8/16/25; re-forge Masterwork chase on obsidian_plate sinks ≥500g without feeling like a decoy; revisit retuned constants against real play.
