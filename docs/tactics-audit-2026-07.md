# Hex Tactics — Full Audit (2026-07-08)

> **Status (2026-07-08): all 6 phases of §6 implemented** on `feature/tactics-audit`
> (commits `f224d5a`…`c6eae0a`, one per phase). Every D/B/U finding below is addressed;
> §4's items shipped in Phases 5–6 (the 6A record row already existed). Notable extras found
> during implementation: the U7 bleed-through root cause was an undefined `wood-950` Tailwind
> shade (every `bg-wood-950/*` was silently transparent), the overlay sat at z-40 under the app
> chrome (all other run overlays use z-50), the AdventureRitualModal had its own B1-class
> unlimited-energy gate, and unit sprites swallowed hover so the damage preview never fired when
> pointing at an enemy. Balance knobs to revisit after real play: holder leash 4, kiter press 3
> turns, waves 2-per-2-turns above cap 5, Large gold step 0.25, +1 MP/turn.

**Method:** Three passes, cross-checked against each other and against the two prior analysis docs:
1. **Live playtest** via browser automation — fresh guest character, quick-start defaults, dev-leveled to 5, four matches played (Tier 5 Small ×2, Tier 4 Small ×2; one legitimate win, turn 15), exercising Move, Strike, Sparks, Force Push, Overwatch/Hold, Mend, danger-zone/intent toggles, the Adventure Ritual modal, and both end screens.
2. **Game-design audit** of the engine (`src/engine/hexBattle/`, `tacticsSlice`, rewards/commit path), grounded in code with worked numbers.
3. **Code-health audit** of the whole module (engine, slice, view, overlay, hooks, co-op integration, tests — all 4 suites green, 112 tests).

**Prior docs:** `tactics-improvement-plan.md` says "20 of 25 done, 5A/5B still open" — that status note is stale: **5A (engine split) and 5B (overlay tests) are both done now.** Genuinely still open from that plan: **6C** (flat XP split), **5C** (solved differently via `isTacticsLoadoutSpell()` — close it), partials **2B** (no "↑ Moved" chip) and **4C** (objective sting reuses the victory cue).

---

## 1. Verdict

The core loop is genuinely good and the engineering is in excellent shape. Per-turn decisions are real (free move + one action; height, cover, hazards; MP as a hard budget), all eight stats visibly express in-match — the best stat integration of any minigame — and the architecture is clean: pure engine DAG, thin slice, tested co-op reducers, immutability discipline with a direct test.

The gaps cluster in three places:

1. **The information layer lies or whispers.** The threat overlay doesn't know about the AI's catch-up lunge, two status effects on the player do literally nothing, the damage preview omits exhaustion and renders as 11px text at the bottom of the screen, and the failed Swift objective never says "missed."
2. **Passivity is possible and common.** In live play I watched two consecutive enemy phases where all three enemies did nothing ("holds its ground" ×3). Holders mathematically never advance; kiters idle at max range. Nothing forces engagement.
3. **The endings are flat.** Victory and defeat are a floating word, a tiny gold number, and a button — no XP line, no materials (which wins always grant!), no objective recap, with the action bar still live underneath. The payoff moment of the whole habit→energy→match loop is the least celebrated screen in the mode.

Aesthetically, the parchment/wood entry screen is handsome; the in-match board is functional but muddy (brown-on-brown tiles, emoji units that collide with emoji terrain, overlapping labels/sprites, and the blurred entry panel bleeding through behind the board).

---

## 2. What's already working (don't touch)

- **Engine purity and module split** — `state → geometry → combat/ai → turns → generation` is a proper DAG; importers use the barrel only.
- **`tacticsSlice` (129 lines)** is a model orchestrator; run completion goes through the shared `commitRun`.
- **Anti-farm economics all check out**: loss pays damage-fraction gold with no materials/objective bonus; tier sandbagging is dominated (21 g/energy at T4 vs 113 at T50); energy only comes from habits; minigame XP is trickle-tagged at 0.5 allocation weight. Tactics cannot substitute for real habits.
- **Session shape**: Small ≈ 4–8 min for 3 energy, a real decision every ~20s, Retreat banks partial value. Right size for a habit app.
- **The Adventure Ritual modal** (habits → energy → entry cost recap) is a great loop-reinforcing touch.
- **Stat expression**: AG move/climb/dodge, ST melee/cleave, DX ranged, EN stamina, WI spell power, KN MP/heal/blink range, CH push distance/debuff duration, HP pool.

---

## 3. Findings

Severity: P0 none found. P1 = degrades the core promise of the mode; P2 = real but bounded; P3 = polish/hygiene.

### 3.1 Game design & balance

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| D1 | P1 | **Freeze and blind inflicted on the player do nothing.** 5 of 16 enemy templates (draugr_mage, wisp, ice_wolf, ice_wisp, frost_revenant) spend 20–60% of their move weight on inflicts the player-action path never reads; the overlay still renders the ❄️/💫 badge on the hero as if it mattered. Weaken/burn/poison/bless DO work. | `ai.ts:297-301` applies; no read in `combat.ts:109-163` (move/strike) or `playerCastSpell`; badge `TacticsOverlay.tsx:42` |
| D2 | P1 | **The anti-kite catch-up lunge is invisible to the danger zone and intent arrows.** Chargers/flankers get a 2×move+1 budget once `turnsOutOfReach ≥ 2`, but `computeEnemyThreat` and `planEnemyIntents` always use the base budget. The overlay under-predicts reach by up to move+1 tiles exactly when the player is kiting — the flagship "trust the red tiles" contract breaks when it matters most. | lunge `ai.ts:225-227`; predictors `geometry.ts:164`, `ai.ts:321→127` |
| D3 | P2 | **Holders never advance — free kills for ranged/caster builds, dead content otherwise.** Holder scoring (`−dist − 3·distFromSelf + elevGain`) makes any approach net-negative, and all three holder templates are melee (range 1). A bow (range 5) or spells (range 4) kill them with zero risk; ~19% of spawned threat is inert furniture. A 2-holder low-tier match is literally unlosable. | `ai.ts:116-119`, holder list `ai.ts:71`, lunge exemption `ai.ts:214` |
| D4 | P2 | **Stalemates are real.** Live play produced back-to-back enemy phases of "holds its ground" ×3 — kiters idle at max range, holder idles, player out of everyone's range = nothing happens, indefinitely. Only the (sometimes-absent) Swift objective applies any clock. | Playtest, Tier 5 Small; AI scoring as in D3 + kiter behavior |
| D5 | P2 | **Damage preview omits the stamina-exhaustion ×0.5 penalty** — it can display LETHAL on a hit that won't kill. Low-EN melee runs dry routinely (mace cost 3 vs +2/turn regen). The preview is the mode's crown jewel; it must not overstate by 2×. | `combat.ts:33-57` never checks `sta ≥ staminaCost`; real roll halves at `combat.ts:142-143` |
| D6 | P2 | **Difficulty scales by alive-count against a fixed one-action economy — narrow fun band.** Count `2+⌊T/5⌋+sizeBonus` clamp [2,8]; damage taken grows ≈ count². Tiers ≲10 comfortable, ≳25 a wall regardless of skill. Also Large boards are the *worst* gold-per-foe at entry tiers (T4: 17 g/foe Large vs 32 Small for ×3 the fight). | `generation.ts:107-134`; `rewards.ts:31` |
| D7 | P2 | **Tier defaults to max (your level).** Fresh level-5 characters open at Tier 5 — my two natural games at that default were both losses. Bad onboarding default; the record-chase should be opt-in. | `TacticsView.tsx:39` (`useState(level)`) |
| D8 | P3 | **Positional spells are "free" but non-casters can barely cast them.** No MP regen in-match; a KN-2 fighter has 14 MP ≈ one Push or two Blinks *per match*. The positional system stays a caster luxury. | `turns.ts:100-107` (stamina only); maxMp 8+3·KN |
| D9 | P3 | **Tactics XP is flat AG/DX/EN regardless of playstyle** (plan item 6C, still open). Arena already usage-weights via `run.statUsage`. | `commit.ts:782` vs `commit.ts:746-758` |
| D10 | P3 | **Melee Overwatch is near-useless vs the archetypes that need countering.** Kiters/holders never step adjacent, so Hold with a sword rarely fires (confirmed in play). Fine vs chargers; worth a hint or a melee-specific bonus (e.g. free strike when an enemy *leaves* adjacency). | Playtest + `ai.ts` archetype movement |

### 3.2 Bugs & correctness

| # | Sev | Finding | Evidence |
|---|-----|---------|----------|
| B1 | P2 | **Entry button ignores `unlimitedEnergy`** — with the dev toggle on (header shows ∞), the button still says "Need 3 energy". The slice honors it (`tacticsSlice.ts:54`); only the view gate blocks. TrialsView does it right. | `TacticsView.tsx:58`; cf. `TrialsView.tsx:66` |
| B2 | P2 | **Invincibility toggle is entirely unwired in Tactics** — no reference in the slice or engine (Arena/Dungeon/boss battles all honor it). Verified live: HP dropped 163→28 with the toggle on. | grep: zero `invincible` refs in `tacticsSlice.ts` / `hexBattle/`; cf. `commit.ts:177`, `arenaSlice.ts:68` |
| B3 | P2 | **Entry screen shows stale movement math** — local mirror caps move at 6, engine caps at 7 (post-BAL-23). AG ≥ 20 players are told 6, move 7. Import `moveTilesFor`/`climbFor` from the engine instead. | `TacticsView.tsx:59-61` vs `state.ts:71-75` |
| B4 | P2 | **Rules-of-hooks violation:** `hoverPreview` useMemo sits *after* `if (!tactics) return null`. Latent "rendered more hooks" crash; currently masked by App's conditional mount. | `TacticsOverlay.tsx:235` vs `:278` |
| B5 | P2 | **`applyPush` ignores hero occupancy** — in co-op, Force Push can stack an enemy onto an ally's hex, corrupting occupancy for the rest of the match. Unreachable solo. | `combat.ts:390`; cf. `occupiedKeys` `state.ts:332-339` |
| B6 | P3 | **Swift objective never shows "✗ Missed"** — the engine only ever sets `complete`, so a blown turn budget keeps rendering as live amber ("Turn 10/5" seen in play). The banner's failed branch is unreachable. | `turns.ts:96,147-149`; `TacticsOverlay.tsx:1034` |
| B7 | P3 | **Attack/spell preview re-hardcodes combat constants** (0.85/1.15 variance, 1.25/0.6 weak/resist) and has zero tests — any future combat.ts tuning silently makes the preview lie. | `combat.ts:49-53,86-92` vs `engine/combat.ts:323,363-385` |
| B8 | P3 | **Co-op guest intent ownership not asserted** (`msg.heroId !== msg.userId` never checked). Harmless at 2 players; a spoofing hole if sessions grow. One-line fix. | `reduce.ts:500-503,636` |
| B9 | P3 | **Ranged-tile hint reads the state-level weapon, not the per-hero weapon** — wrong hint for a ranged guest with a melee host. | `TacticsOverlay.tsx:808` vs `:250` |
| B10 | P3 | **`engine/hex.ts` hygiene:** dead `boardPixelSize`, effectively-dead `hexLine`/`stepToward`, stale "for the Arena" header (Arena migrated to grid.ts), and `hexBattle/combat.ts:361-364` re-declares the six direction vectors that `hex.ts` already exports. | `hex.ts:1,63,143,151` |

### 3.3 UX & readability (playtest)

| # | Sev | Finding |
|---|-----|---------|
| U1 | P1 | **Combat feedback is a whisper.** Hits, resists, dodges, and debuffs land as one 11–12px log line at the very bottom of the screen; the damage preview renders in the same tiny bottom strip (`TacticsOverlay.tsx:797-801`), nowhere near the tile you're aiming at. I played four matches and never once *noticed* the preview during play — the mode's best feature is invisible at the point of decision. Floating damage numbers / status popups over units and a cursor-adjacent preview card would transform match feel. |
| U2 | P1 | **Victory/defeat screens bury the payoff.** Both are a floating word + a small gold number + one button, over a still-interactive action bar ("Move up to 5 more tiles" was still armed under my DEFEATED banner). Not shown: XP earned and where it went, **the guaranteed win materials (cloth + bronze — the game's premier source of them, per BAL-10, completely invisible)**, objective status, tier-record progress, or any "why you lost / what to try" coaching on defeat. |
| U3 | P2 | **Enemy identity is muddled.** Board labels say "Charger/Kiter/Holder" while the log says "Ice Wolf / Wailing Wisp / Stone Sentry" — two naming systems with no bridge. Worse, the Stone Sentry's 🪨 icon is the *same glyph as wall/boulder terrain* (two identical rocks on my first board, one hostile). Emoji picks are also tonally scattered (☃️ snowman as the fearsome Frost Revenant). |
| U4 | P2 | **Danger zone conveys ~nothing on Small boards.** At match start 33 of 37 tiles were red-tinted. When everything is dangerous, nothing is. Needs intensity grading (1 attacker vs 3), or scope to "tiles attackable *next* enemy phase," or per-enemy isolation on hover. |
| U5 | P2 | **Sprite/label collisions.** Back-row unit sprites overlap front tiles and units (the Holder sprite half-covered my hero); adjacent enemies' "KITER KITER" labels overlap each other. Needs elevation-aware sprite anchoring, label de-confliction, and a hover-to-front rule. |
| U6 | P2 | **Silent no-op interactions.** Clicking a non-highlighted tile with a spell armed does nothing — no "out of range," no shake, no sound. Clicking an out-of-range enemy should either explain or auto-path+cast. |
| U7 | P2 | **The board floats over the blurred entry screen.** The backdrop behind the hex board is the blurred Tactics *menu text*, which reads as visual noise, not a scene. A proper vignette/gradient backdrop (or the scene art system used elsewhere) would instantly raise perceived quality. |
| U8 | P2 | **Hard-blocked on touch devices** — `disabled={!canEnter || coarse}` with "Best played on desktop" (`TacticsView.tsx:246-250`). A turn-based tap game is the *most* mobile-suited mode in the app; this is the only mode that refuses to run there. Tap-to-select/tap-to-confirm works fine on hexes this size. |
| U9 | P3 | **Move-mode ▲ elevation markers flood the board** (plan 4D was about overlap; the bigger issue is quantity — every tile shouts). Show deltas only on hover-path, or only where climb actually constrains movement. |
| U10 | P3 | **Zero accessibility surface.** Tiles are anonymous SVG polygons — no `data-hex`, no `aria-label`, no roles. Screen readers get nothing; it also makes E2E testing needlessly hard (my automation had to color-match stroke values). |
| U11 | P3 | **Turn-flow legibility**: "✓ Acted" chip exists but there's no "moves left" pip next to the hero, and no "↑ Moved" chip (plan 2B partial). After acting, disabled buttons explain nothing ("why can't I strike? — you already acted"). |

---

## 4. How it can better serve the habit tracker

The mode already respects the loop (energy from habits, honest rewards, trickle XP). The missed opportunities are motivational, not economic:

1. **Make the habit→power line visible at the moment of play.** The entry screen shows the AG formula, but in-match nothing says "your Stretch streak is why you move 5 tiles." Cheap, high-leverage: on match start, one log line — "Agility 14 (trained by Stretch, Walk): move 5, climb 2." On the victory screen: "+9 AG XP → Stretch is building this stat."
2. **Fix the XP honesty gap (D9/6C).** A WI-caster win training DX undermines the game's core promise. Arena's usage-weighting already exists; port it.
3. **Surface the record.** `deepestTacticsTier` appears only on the tactics entry screen (plan 6A still effectively open). Put "Tactics: Tier X" on the Hero sheet / dashboard records row.
4. **Onboarding default (D7).** Default the tier picker to `max(4, deepestTacticsTier)` — climb by choice, not by default. A defeated new player on day 3 is a churn risk for the *habit* app, not just the minigame.
5. **Defeat coaching.** Losses currently pay a gold fraction with no framing. One line ("The Frost Revenant resists spark — try steel" / "You never used your free Blink") turns a loss into a lesson, which is exactly the growth-mindset frame a habit RPG wants.

---

## 5. Aesthetic direction

The entry screen (parchment, gold frames, display serif) is the app at its best. The match view should inherit that quality:

- **Palette:** tiles are near-identical desaturated browns/greys; elevation is the mode's core mechanic yet height reads only via extrusion depth. Grade tile top-face lightness by elevation (higher = warmer/lighter), keep terrain hue for type (green slow, red hazard, blue-grey stone), and reserve saturation for interactive states.
- **Units:** keep emoji if you like the charm, but (a) never reuse a terrain glyph for a unit (🪨), (b) put units on distinct "token" bases — colored archetype ring + drop shadow + slight scale-up for the hero — so figure/ground never fails, (c) fix z-ordering so lower-row sprites always draw above higher-row tiles.
- **Labels:** replace the floating archetype captions with the creature name (hover/selected shows "Kiter — stays at range"), and de-conflict label positions.
- **Backdrop (U7):** dark vignette or biome gradient behind the board; never blurred UI text.
- **Moments:** the effects/stagger system exists (`EFFECT_STAGGER_MS`) — add floating damage numbers, a screen-edge pulse on player hits, a brief slow banner on objective complete/fail, and a real end-screen card (trophy/skull, gold + materials + XP rows, objective line, tier record, then Claim). The `sfx` hooks are already in place for a dedicated objective sting (plan 4C).

---

## 6. Step-by-step implementation plan

Ordered for impact-per-risk; each phase ships independently. File paths are exact; severities reference §3.

### Phase 1 — Trust & truth (the information layer stops lying) — ~1 day
1. **D1** Make freeze/blind bite the player. In the end-of-enemy-phase hero restore (`turns.ts:100-107`): if hero frozen → `movesLeft = 0`, `hasActed = true` for the coming turn (halve instead if playtests feel brutal); in `resolvePlayerStrike` (`combat.ts:136-163`) add the same `rng() < 0.4` miss blind already uses in `ai.ts:247`. Tests: frozen hero can't move/act; blind hero misses at forced-rng.
2. **D2** Teach the predictors the lunge: in `computeEnemyThreat` (`geometry.ts:164`) and `planEnemyIntents` (`ai.ts:321`), use the lunge budget when `(enemy.turnsOutOfReach ?? 0) >= 2`; add a "winding up" marker on the intent badge. Test: threat set expands on the lunge turn.
3. **D5** Honest preview: compute `full = sta >= weapon.staminaCost` in `previewPlayerAttack` (`combat.ts:33-57`), halve min/max and append "(exhausted)"; grey the Strike caption when `sta < cost`. Add the missing preview tests (B7): export the variance/weak/resist constants from `engine/combat.ts`, consume them in both places, assert preview brackets the actual roll.
4. **B6** Set `objective.failed = true` for swift when `turnCount > target` in `endPlayerTurn`; banner branch already renders "✗ Missed."
5. **B3** Delete the view's local move/climb mirror; import `moveTilesFor`/`climbFor` from `@/engine/hexBattle` (`TacticsView.tsx:59-61`).

### Phase 2 — Bug sweep (small, surgical) — ~½ day
6. **B1** `canEnter = unlocked && (unlimitedEnergy || energy >= TACTICS_ENERGY_COST)` (`TacticsView.tsx:58`), mirroring `TrialsView.tsx:66`.
7. **B2** Wire Invincibility: in `tacticsSlice` after each engine call (or in `endPlayerTurn`), top the hero up when `settings.invincible` — match `commit.ts:177`'s pattern.
8. **B4** Hoist the `hoverPreview` useMemo above the `if (!tactics) return null` guard (`TacticsOverlay.tsx:235/278`); add `!tactics` to its guard.
9. **B5** In `applyPush`'s march loop (`combat.ts:390`), also stop when a living hero occupies `next` (reuse `occupiedKeys`). Test with a 2-hero fixture.
10. **B8** In `handleTacticsMessage`, ignore intents where `msg.heroId !== msg.userId`.
11. **B9** Use the local per-hero `weapon.ranged` at `TacticsOverlay.tsx:808`.
12. **B10** Delete `boardPixelSize`, fix the `hex.ts` header, replace `combat.ts`'s local `HEX_DIRS` with the `hex.ts` export.
13. Update the stale status block at the top of `docs/tactics-improvement-plan.md` (5A/5B done; point at this audit).

### Phase 3 — Combat feel (feedback where the eyes are) — ~1–2 days
14. **U1** Floating combat text: on each new effect in the existing `effects[]` queue, render a rising/fading number (damage, "RESIST", "MISS", "❄ FROZEN") anchored to the target's hex; keep the log as history. The stagger clock already exists.
15. **U1** Move the preview to the point of aim: small card near the hovered tile (damage range, hit note, exhaustion/weak/resist icons); keep the bottom strip as fallback for keyboard users.
16. **U2** Real end-screen card in `TacticsOverlay` (both outcomes): outcome header, gold (+objective bonus line), **materials earned**, XP split with stat icons, tier record ("New best!"), objective recap; disable/hide the action bar behind it. Reuse reward math already mirrored at `TacticsOverlay.tsx:720` / `commit.ts:550`.
17. **U6** On invalid target click: brief tile shake + "Out of range" toast near cursor + error blip.
18. **4C (plan)** Dedicated objective-complete sting in `useTacticsAudio.ts`; add a fail thud for the new swift-fail transition.

### Phase 4 — Readable board (aesthetics core) — ~2 days
19. **U3** Unit identity pass: per-template name shown on hover/selection ("Wailing Wisp — Kiter · stays at range"); replace the Stone Sentry glyph (anything but terrain-rock — e.g. 🗿); archetype = colored ring only, not the caption.
20. **U5** Z-order & labels: sort unit sprites by projected row so front sprites draw last; offset labels above the sprite with collision nudging; hovered unit raises to front.
21. **Palette pass (§5):** elevation-graded top faces + terrain hue + interactive-state saturation, in the tile fill helper in `TacticsOverlay`/`iso.ts`.
22. **U7** Replace the blurred-menu backdrop with a vignette/scene gradient behind the SVG.
23. **U4** Danger-zone grading: opacity by number of enemies threatening the tile; hovering an enemy isolates its personal threat + intent.
24. **U9** Elevation markers only along the hovered move path (or where climb blocks); kill the board-wide flood.
25. **U11** Add the "↑ Moved / n left" pip next to "✓ Acted" (plan 2B close-out); tooltip on disabled Strike: "already acted this turn."

### Phase 5 — Engagement & balance (design changes, playtest each) — ~2–3 days
26. **D3** Holder leash: when nearest hero distance > 4, score approach like a charger (revert to hold inside the leash). Kills the ranged free-farm and the D4 stalemate's worst case.
27. **D4** Anti-stalemate pressure: if *no* enemy acted for 2 consecutive phases, force the nearest kiter to reposition toward the player (or spawn creeping hazard from the board edge). Cheap rule, ends standoffs.
28. **D7** Default tier picker to `max(TACTICS_UNLOCK_LEVEL, deepestTacticsTier)` instead of `level` (`TacticsView.tsx:39`).
29. **D8** `+1 MP/turn` in the same restore block as stamina (`turns.ts:106`) — one line; watch caster balance at high KN.
30. **D6** Reinforcement waves: above ~5 enemies, spawn 2–3 up front and trickle the rest from the far edge every 2–3 turns (`generation.ts` + `turns.ts`); raise Large-board gold factor so entry-tier Large isn't the worst g/energy. Playtest tiers 15–30 after.
31. **D9 (6C)** Usage-weighted XP: count action types on `HexBattleState`, reuse Arena's weighting in `commit.ts:774-782`.
32. **D10** Melee overwatch value: trigger also when an adjacent enemy *leaves* adjacency (attack of opportunity), and say so in the How-to-play.

### Phase 6 — Reach & integration — ~1–2 days
33. **U8** Mobile: remove the `coarse` hard-block; tap-to-select, tap-again-to-confirm; larger touch targets for the action bar. Ship behind a "beta" tag if worried.
34. **§4.1** Habit→power visibility: match-start log line naming the habits behind your AG; victory-screen XP rows named by stat.
35. **§4.3 (6A)** "Tactics: Tier X" record on the Hero sheet / dashboard records.
36. **§4.5** One-line defeat coaching (rule-based off the match log: most-resisted element, unused free spells, turns spent out of range).
37. **U10** Accessibility/testability floor: `data-hex="q,r"` + `aria-label` ("Stone tile, elevation 2, cover; Wailing Wisp here") on tile polygons; `role="button"` on targetables.

**Verification cadence:** engine changes land with vitest cases beside them (`hexBattle.test.ts` fixtures make D1–D3 cheap to lock); each UI phase gets a manual playtest at Tier 4/5 Small and one Large; re-run the §3.1 worked numbers after Phase 5 balance changes. The untested-risk ranking from the code-health pass (TacticsView first, previews second, threat/intent third) is the test-writing priority list.

---

*Sources: live playtest 2026-07-08 (guest save, dev level 5); game-design audit of hexBattle engine + rewards; code-health audit (all suites green, 112 tests). Prior docs `tactics-minigame-analysis.md`, `-2.md`, `tactics-improvement-plan.md` were fact-checked against current source; drift noted inline.*
