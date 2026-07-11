# Minigame Sizing & Tap-to-Act Plan — July 2026

> **Status: IMPLEMENTED (2026-07-10, same day).** All three phases + the `useForestLoop`
> merge shipped together. Full suite 2,150 green, typecheck clean, browser-verified
> (mine tap-mine/tap-step at 700px upscale, forest tap-step + thicket-face filtering,
> arena live-resizing 448px ↔ 238px). Deviations from the proposal: none in behavior;
> the HUD-width coupling shipped as a pure-CSS shared expression (no measuring JS —
> see the note in Part A3's implementation in MineRunOverlay/ForestRunOverlay), and
> `CrawlSpellBar`'s `maxWidthClass` prop became a CSS-length `maxWidth`. One extra
> behavior alignment from the loop merge, by design: forest treeline advance now
> yields to an adjacent faced beast (mine's descend-priority rule).
> Baseline: commit `6597e2e` plus the uncommitted responsive-column widenings
> (TownView/TownBuildPanel → `lg:max-w-5xl xl:max-w-6xl`, DungeonView/BattleScene → `lg:max-w-3xl`).

Two related goals, planned together because they share the same coordinate math:

1. **Click/tap a tile to mine or attack** in the Deep Mine and Wild Forest.
2. **Let the minigame boards use desktop screen space** — Mine/Forest currently render at a
   fixed 572×572px and only ever scale *down*; Arena picks a fixed hex size per radius with no
   viewport awareness.

Homestead, Dungeon Delve, and the Battle overlay are already handled by the column widenings.
Hex Tactics already viewport-fits (`fitSize` + ResizeObserver — the pattern Arena will copy).
Skill Trials are intentionally compact and stay as-is.

---

## Current architecture (what the plan builds on)

### Mine / Forest input model — "bump to face, act separately"

- All real-time input lives in the loop hooks (`useCrawlLoop` for mine, the un-migrated twin
  `useForestLoop` for forest), which hold pressed directions in refs and fire store actions on a
  rAF clock. The overlays own **no** keyboard or board pointer handlers today.
- Movement: `mineMove(dir)` / `forestMove(dir)`. Walking into a rock/monster/tree does **not**
  act — it only turns the player to face it (`engine/mining.ts:1217-1226`, `engine/forest.ts:969`).
- Acting: `mineStrike()` / `forestAct(now)` resolve against the **faced cell** (monster → attack,
  rock/ore → mine; forest ranged weapons scan down the faced orthogonal line,
  `engine/forest.ts:359-381`). **No store or engine action takes a target `(r, c)` today.**
- Space is context-multiplexed in mine (descend > boon/tombstone pickup > strike), with the same
  precedence encoded in the loop (`useCrawlLoop.ts:233,260`; `miningSlice.ts:162-178`).
- Cadence gates: move 150ms, strike 240ms, monster tick 120ms (`useMiningLoop.ts:11-15`).
- Co-op: guests do not resolve attacks locally — they send `{type:'attack', monsterId, dmg}`
  intents from the loop (`useCrawlLoop.ts:235-238,259-267`; `useForestLoop.ts:168-173,210-217`).

### Mine / Forest board geometry (three stacked transforms)

```
board viewport (572×572 = min(VIEW,cols)·CELL, overflow-hidden)
└─ FitToWidth wrapper        — CSS scale, top-left origin, clamped to ≤ 1 (FitToWidth.tsx:34)
   └─ worldRef container     — translate3d written every frame by useSmoothCamera
      └─ tiles at (c-baseC0)·CELL, (r-baseR0)·CELL   — render-window-relative, NOT world-absolute
```

`useSmoothCamera` interpolates the player in world-pixel space, clamps the camera to the map,
adds shake offsets, and writes the transform directly to the DOM (`useSmoothCamera.ts:189-205`).
The camera position is internal to the hook — not exposed to React.

**Client→tile inversion** therefore should read the DOM rather than re-derive camera math:

```ts
// scale from the board frame (jsdom-safe: rect is all-zeros in tests → fall back to 1,
// the same idiom TownCanvas::vbPerPx uses)
const frameRect = frameRef.current.getBoundingClientRect();
const scale = frameRect.width ? frameRect.width / boardW : 1;
// worldRef's rect already folds in the camera translate AND the FitToWidth scale
const wRect = worldRef.current.getBoundingClientRect();
const c = baseC0 + Math.floor((clientX - wRect.left) / (CELL * scale));
const r = baseR0 + Math.floor((clientY - wRect.top) / (CELL * scale));
```

### Arena geometry

Everything derives from `sizeFor(radius)` (26/30/34px, `ArenaOverlay.tsx:17-19`). Game state is
**pure hex space** — no pixel coordinate is ever persisted; pixels exist only in the render layer
and one transient React state (`floats`). Hit-testing (`pixelToCell`, board-click aim) reads live
`getBoundingClientRect` but passes the *cached* `SIZE`/`BOARD` constants, so DOM size and math
size must never diverge.

---

## Part A — Mine & Forest board upscaling

The column widenings can't help here: the board is fixed-pixel and `FitToWidth` refuses to scale
above 1:1. The fix is to let it.

**A1. `maxScale` prop on `FitToWidth`** (`src/components/ui/FitToWidth.tsx`)
- `maxScale?: number` (default `1`), clamp becomes `Math.min(maxScale, avail / contentWidth)`.
- Default 1 keeps the third consumer (RooftopChase) byte-identical. (Its whole-area
  `onClick={controls.jump}` is positionless and scale-immune anyway.)
- CSS `transform: scale` up to ~1.5 stays crisp: tile sprites use `image-rendering: pixelated`
  and text rerasterizes at the scaled resolution.

**A2. Pass `maxScale={1.5}` from both overlays** and widen the outer cap from
`min(boardW px, …dvh budget…)` to `min(boardW·1.5 px, …dvh budget…)`
(`MineRunOverlay.tsx:628`, `ForestRunOverlay.tsx:454`). The existing
`calc((100dvh - 300px) · aspect)` term already prevents the board from pushing the action row
below the fold on short viewports — it becomes the effective cap on most laptops, which is
exactly the intent.

**A3. Keep the HUD attached to the board.** HUD rows are `max-w-lg` (512px — already narrower
than the 572px board) in mine and `max-w-[600px]` in forest. Give both overlays a single shared
width so HUD and board track together, e.g. a wrapper `max-width: min(858px, <same dvh calc>)`
holding HUD + board + action rows, replacing the per-row classes. `CrawlSpellBar`'s
`maxWidthClass` prop already parameterizes this (`CrawlSpellBar.tsx:10`).

**Risk: low.** No coordinate math reads the rendered size today (that's Part B's job to add —
scale-aware from day one).

## Part B — Tap-to-act in Mine & Forest

### Semantics (v1)

| Tap target | Action |
|---|---|
| Adjacent rock / ore / monster (or beast in forest) | Face it, then strike/act — the key-driven "turn + Space" collapsed into one tap |
| Adjacent walkable tile | Face + step onto it (one `move(dir)` — bump semantics make this safe: if it turns out blocked, it just faces) |
| Player's own tile | Context action, exactly like Space: descend / boon / tombstone / shrine precedence |
| Forest only: beast on the faced-able orthogonal line within ranged-weapon range | Turn toward it + ranged act (reuses `rangedScan`) |
| Anything else (non-adjacent, fogged, out of bounds) | Ignored — no pathfinding in v1 |

Fog check matters: unseeable tiles render as plain black divs in the same tile layer
(`MineRunOverlay.tsx:653-660`) and would happily receive taps.

### Plumbing (the part that keeps co-op and cadence honest)

1. **New control on the loop hooks**: `tapAct(r: number, c: number)` added to
   `CrawlLoopControls` (`useCrawlLoop.ts:26-47`) and to `useForestLoop`. It validates the target
   (adjacency/own-tile/ranged-line, fog, `status === 'active'`), stores it in a `tapQueue` ref,
   and the **existing rAF loop** consumes it next frame: issue the facing `move(dir)` if needed,
   then run the *same* strike branch the keyboard uses — same `swingIntervalMs` gate, same
   descend/pickup precedence, same guest-intent path (`facedMonsterId` → broadcast intent, never
   local damage). Implementing tap inside the hook rather than as direct store calls is what
   makes co-op correctness free.
2. **Never touch the charge path**: `swing()` starts a hold-to-charge timer
   (`useCrawlLoop.ts:329-335`) — `tapAct` bypasses it (queue a plain strike), so a tap can't
   leave a phantom charge running.
3. **Overlay wiring**: one `onPointerDown`/`onPointerUp` pair on the board frame with a small
   movement threshold (≤ 8px, the TownCanvas tap idiom) so future drag gestures stay possible;
   convert client→tile with the inversion above; call `controls.tapAct(r, c)`. All FX layers
   above the tiles are already `pointer-events-none`, and the pointer-events-auto panels
   (banking/death/boon) only mount when the run isn't active — no interception conflicts.
4. **Coexistence**: the coarse-pointer D-pad stays; tap is additive on both pointer types. The
   first-run hint copy should gain a "tap a tile to mine" line.

### Known wrinkles (accepted for v1)

- `worldRef.getBoundingClientRect()` captures the live screen-shake offset
  (`useSmoothCamera.ts:196-204`), so a tap mid-shake can be displaced by a few px. The
  adjacency/own-tile validation self-limits the blast radius (worst case: the tap is ignored).
- Mid-glide taps use the interpolated camera (correct: it matches what the player sees).

## Part C — Arena viewport fit

Copy the Tactics pattern: `ResizeObserver` on a board wrapper → `vp` state →
`size = fit(radius, vp)` with `sizeFor(radius)` as the pre-measure fallback
(`TacticsOverlay.tsx:195-206, 250-255` is the reference implementation).

The inventory found game state is pixel-free, so this is a render-layer refactor with three
concrete obligations:

1. **Kill the hidden hardcoding.** `boardFor(radius)` and `centerFor(h, radius)`
   (`ArenaOverlay.tsx:20-28`) internally re-call `sizeFor(radius)` — they must take the live
   `size` as a parameter. Callers: the render scope, the damage-floater effect
   (`:150-184`), and `handleBoardClick` (`:274`). Everything else (`SIZE`/`CELL`/`BOARD`/
   `cellBox`/`spriteBox` and ~25 derived render values) is recomputed per render and scales for
   free once threaded.
2. **Hit-testing follows automatically** — `pixelToCell` (`:53-55,257,285`) and the aim
   dead-zone (`:277`) already take `size`/`BOARD` args; they just need the live values. These
   handlers are pointer events (mouse *and* touch), so this fixes tap aim on all inputs.
3. **Damage floaters**: `floats` state captures pixel coords at spawn (`:88,119,150-184`) —
   the only pixel-space state that survives renders. On a resize, in-flight floaters (~850ms
   lifetime) render at stale positions. Cheapest correct fix: clear `floats` when `size`
   changes. (A resize mid-combat is rare; dropping a damage number is invisible.)

Polish, can ship later: a few hardcoded px values won't scale (projectile sprite 14px `:462`,
minion HP bar `w-7` `:491`, telegraph label font 8px `:451`) — harmless at 1.0–1.5×, worth
deriving from `SIZE` while in the file.

**Risk: moderate.** No component test exists for ArenaOverlay at all, so regressions in floater/
aim coordinates have no safety net — Phase 3 includes adding one (see test plan).

---

## Issues found during investigation

1. **`useForestLoop` is an un-migrated twin of `useCrawlLoop`** (acknowledged at
   `useCrawlLoop.ts:9-14`). Tap-to-act must be implemented twice and can drift. Recommend
   migrating forest onto `useCrawlLoop` *first* (or at minimum extracting the shared tap-queue
   logic) rather than growing the fork.
2. **Arena's `centerFor`/`boardFor` silently re-derive size from radius** — a latent coupling
   that would have made any future dynamic sizing wrong in three separate places (render,
   floaters, click aim). Fixed by Part C item 1.
3. **Arena `floats` is the codebase's only pixel-space React state** — stale after any resize.
4. **Fogged tiles are tappable** black divs in the same layer — tap validation must check sight.
5. **`FitToWidth` hides its scale** and hard-clamps to ≤1 — Part A lifts the clamp; Part B
   derives scale from rects instead of needing it exposed.
6. **Any raw-pixel click handler would already be broken today on narrow screens** (FitToWidth
   downscales below 1 on mobile) — why Part B's inversion divides by measured scale from day one.
7. **Test coverage is thin exactly where this plan lands**: no tests for `useCrawlLoop`/
   `useForestLoop`/`useSmoothCamera`, none for MineRunOverlay/ForestRunOverlay boards, none for
   ArenaOverlay. The engine layer is well covered; the input/render seam is not.
8. **Mine HUD (512px) is already 60px narrower than its own board (572px)** — a pre-existing
   cosmetic misalignment that Part A3's shared-width wrapper also fixes.
9. **jsdom returns all-zero rects**, so the client→tile helper needs the `rect.width ? … : 1`
   fallback (TownCanvas precedent) or every tap test breaks.

---

## Phasing & test plan

**Phase 1 — Upscaling (small, safe, immediately visible)**
`FitToWidth.maxScale` + overlay caps + shared HUD width (A1–A3).
Tests: FitToWidth unit test (clamps at `maxScale`, default still 1); visual playtest desktop +
narrow viewport. RooftopChase smoke check.

**Phase 2 — Tap-to-act, Mine first, then Forest**
Extract a pure `clientToTile(clientXY, rects, baseR0C0, boardW)` helper (unit-testable, no DOM);
`tapAct` queue in `useCrawlLoop`; overlay pointer wiring; then forest (decision on migrating
`useForestLoop` first — recommended). Forest adds the ranged-line rule.
Tests: helper unit tests (scale 1, scaled-down, scaled-up, jsdom zero-rect fallback); loop-level
tests for tap precedence (descend vs strike, guest-intent routing, fog rejection); an overlay
tap-gesture test in the TownCanvas style. Playtest both modes, including a co-op guest session.

**Phase 3 — Arena viewport fit**
Thread `size` through the helpers; ResizeObserver wrapper; floater clear-on-resize; px polish;
add a first ArenaOverlay component test (board renders at fitted size; click aim maps to the
right cell at a non-default size).
Playtest at several window sizes + radius tiers (r3/r4/r5).

Each phase is independently shippable; Phase 1 and Phase 3 don't block each other. Phase 2's
helper is written scale-aware, so landing it before or after Phase 1 is safe in either order.

## Open decisions (defaults chosen, flag if you disagree)

- **Tap on empty adjacent tile steps toward it** (default: yes — it makes tap a complete touch
  control, not just combat).
- **No pathfinding for distant taps in v1** (default: ignore them; a future v2 could route
  through the existing BFS flow fields in `crawl.ts`).
- **`maxScale = 1.5`** for mine/forest (858px board cap; the dvh budget usually caps lower).
- **Forest ranged tap requires the beast to be on an orthogonal line within range** (mirrors
  keyboard capability exactly; no free-aim state added).
