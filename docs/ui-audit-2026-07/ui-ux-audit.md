# HabitsRPG — UI/UX & Aesthetics Audit (July 2026)

**Method:** Live walkthrough via Playwright against the dev build. Desktop at 1440×900, mobile at 390×844. Fresh guest account, all 4 starter habits completed, every tab visited, Deep Mine played twice (desktop + mobile), Wild Forest once, Homestead build sheet opened, settings and both themes checked. Screenshots in `docs/ui-audit-2026-07/screens/`.

**Verdict in one line:** The fantasy identity is strong and consistent — wood, parchment, gold, serif small-caps, pixel sprites — but the app is undermined by (1) real mobile layout breakage, (2) a family of light-mode contrast failures from translucent surfaces over the dark background, and (3) weak visual hierarchy (everything glows, so nothing does).

---

## What works — keep and lean into it

- **A real identity.** The parchment-card-on-dark-wood look, gold filigree borders, ❖ corner ornaments, and serif display caps read unmistakably as a fantasy journal. Nothing here looks like a generic Tailwind dashboard. (`desktop-04`, `desktop-10`)
- **Consistent card language.** Every tab uses the same parchment card + engraved header treatment; users always know where content lives.
- **Minigame landing pages** (`desktop-11`, `desktop-16`) are genuinely good: flavor text, energy cost vs. what you have, personal records, and a derived stats profile — informative without clutter.
- **The "Before You Adventure" modal** listing today's completed habits as the source of your energy is a lovely reinforcement of the core loop (habits → adventure).
- **Onboarding.** "Forge Your Hero" is charming, and "Quick start with defaults" respects impatient players. The welcome card on first load explains the loop in 3 bullets.
- **Dark mode** is handsome and — notably — *fixes* several light-mode contrast bugs (see F2). The palette system in Settings (preset + custom palettes via CSS variables) is a great foundation for any restyle.
- **Mobile touch controls in runs** (`mobile-09`): the d-pad left / MINE+DASH right split is thumb-friendly, buttons are big, and everything fits the 844px viewport without scrolling.
- **Pixel item sprites** (mace, bow, vest, bedroll) have charm and should become the norm (see F13).
- Party, Battle, and Explore hubs are clean, focused, and uncluttered on both form factors.

---

## What doesn't work — findings, most severe first

### P0 — broken, fix before any polish

**F1. Mobile horizontal overflow breaks multiple tabs.**
On a 390px viewport the Quests page renders 419px wide and Crafting renders **623px** wide. Symptoms: hero card text clipped ("4/4 TODA", "64 / 10"), the `+ Habit` button half off-screen (`mobile-02`), and on Crafting the **Craft buttons are entirely off-screen** — the feature is unusable one-handed (`mobile-12`).
Root causes found live:
- Quest Log header row (title + 4 icon buttons) can't wrap; its min-content width forces the whole `max-w-2xl` column wide.
- The Materials empty-state line ("No materials yet — gather ore…") renders as a single unwrapped 509px line.
Fix direction: sweep views for unwrappable flex rows and nowrap text (`min-w-0`, `flex-wrap`, remove `whitespace-nowrap`); then keep an `overflow-x: clip` guard on `main` so one bad row can never widen the page again. Verify at 360px and 390px.

**F2. Light-mode contrast failures (one root cause, many symptoms).**
Translucent parchment/grey surfaces (`bg-parchment-100/50`, `bg-wood-900/40`, etc.) sit over the dark wood body background and produce muddy mid-greys, then dark "ink" text lands on them:
- The mood banner is **illegible** — dark red text on dark red panel (`desktop-04`). The same banner is perfectly readable in dark mode (`desktop-28`), confirming it's a light-mode token problem.
- The three dashboard stat tiles (`StatChip`, `src/views/DashboardView.tsx:399`) look disabled/washed-out; their sub-labels are unreadable (`desktop-04`).
- The energy modal's "Energy available / Cost to enter" rows — the red "−2" on grey is nearly invisible (`desktop-17`).
- Trial Board category pills (STREAK, DEVOTION…) are grey-on-grey embossed (`desktop-05`).
- The Hero Stats explainer box: gold link-text on translucent grey (`desktop-07`).
Fix direction: make raised surfaces **opaque** in light mode (real parchment tones), and give status colors (danger red, success green) on-parchment variants that meet WCAG AA. This is a token-level fix, not per-component.

**F3. Guest session doesn't survive a reload.**
After choosing "Play offline as a guest," a refresh lands back on the sign-in screen. Progress *is* retained once you click guest again, but a returning guest hits a login wall every single visit — most will assume their save is gone. Persist the guest choice next to the save and skip the auth screen.

**F4. Deep Mine floor 1 can kill you in seconds (gameplay, not cosmetic — flagging anyway).**
Three runs, three deaths, all under a minute. Twice, monsters were adjacent at spawn and HP went 56→0 / 60→0 within ~2 seconds before meaningful input. A level-1 first-run experience that ends in instant death (and a "you forfeit half your haul" lesson) is brutal. Suggest a spawn-safety radius (no monsters within N tiles) and a look at early-floor monster DPS vs. 60 starting HP.

### P1 — layout and UX debt

**F5. Desktop wastes the screen and loses its nav.**
The sidebar isn't sticky — on long pages (Hero) it scrolls away entirely, leaving a dead brown column (`desktop-08`). Meanwhile content is locked to `max-w-2xl` (~672px) so at 1440px roughly half the screen is empty. Suggest: sticky sidebar; widen to `max-w-4xl`+ with two-column layouts where content suits it (Dashboard: quest log + character/stats side by side; Hero: loadout beside stats; Skills: 3–4 trial columns).

**F6. Minigame overlay doesn't respect the viewport (desktop).**
At 1440×900 the run overlay is 946px tall — Descend/Bank and the d-pad hang below the fold mid-run (`desktop-13`). Related: the on-screen d-pad renders on desktop at all (keyboard is primary there); the rotating tip toast is clipped off the left canvas edge ("OU'RE BRIEFLY IMMUNE…"); and the camera anchors the map at the top of the canvas, leaving ~60% dead black below (`desktop-13`, `desktop-18`). Suggest: scale the overlay to fit (canvas flexes, controls always visible), hide touch controls on pointer devices (show a key-hint strip instead), center the camera window, keep toasts inside the canvas.

**F7. Mobile bottom nav is over capacity.**
Eight labeled items at 390px: "BATTLE CRAFTING PARTY" labels visually collide (`mobile-03`). Options: shorten labels ("Craft", "Fight"), drop letterspacing at this size, or move to 5 primary tabs + "More". At minimum, fix the collision.

**F8. Mobile hero header truncates badly.** "ADVENTU…" with "Lv" and "1" wrapping onto separate lines (`mobile-04`). Give the name room (smaller type on mobile, chip layout for level).

**F9. Locked content is dead weight.**
- Skill Trials: 8 tall, mostly-empty dark cards with low-contrast titles crowded by lock icons (`desktop-09`, `mobile-05`). Locked cards should be compact rows stating the unlock condition ("Unlocks at Level 3"), not full-size ghosts.
- Class Codex: a wall of 64 identical "???" shields (`desktop-08`). Collapse to a teaser row + count until at least one is unlocked.

**F10. Explore cards omit the one number that matters** — energy cost (`desktop-10`). Add a small ⚡ cost badge per card (and grey it when unaffordable) so players don't need to click through.

**F11. Icon-only ambiguity in the Quest Log header.** Two near-identical calendar icons ("Pick a day", "Plan week") plus a chart icon, no labels or tooltips (`desktop-04`). Add tooltips + aria-labels at minimum; better, label them on desktop where space allows.

**F12. Crafting list readability.** Every row repeats the item name in the subtitle ("Leather Vest / Leather Vest — +4 Def"); requirement text is tiny; the disabled gold-on-gold CRAFT/price buttons barely read as buttons (`desktop-21`). Suggest: drop the duplicate name, render requirements as small met/unmet chips (green check / red count), and give disabled buttons a clearly distinct treatment.

**F13. Mood copy contradicts reality.** After a perfect 4/4 first day, the dashboard shows "Recovering" and "Things feel tough right now — let's simplify" (`desktop-04`, engine: `src/engine/dashboard.ts:225`). The empathy system is a great idea, but firing "struggling" on a brand-new perfect account damages trust in all future messages. Gate it on actual missed-day history.

### P2 — polish for the "beautiful, professional" bar

**F14. Glow discipline.** Nearly every card carries the gold glow shadow, so the page shimmers uniformly and nothing is focal (`desktop-05` is 4 stacked glowing bars). Reserve the glow for the single hero element per screen (character card, active run card); default cards get a crisp border + flat shadow. This one change will do the most for "professional."

**F15. Progress bar styling.** Near-black bar tracks on parchment (Hero stats, Defense/Ward) look like a different app and make tiny colored slivers illegible at low values (`desktop-07`). Use recessed parchment-tone tracks with gold ticks; consider Lv-pip rows instead of near-empty bars at low levels.

**F16. Typography: all-caps letterspaced serif is used for body text.** The Skill Trials intro is a full paragraph of tracked caps (`desktop-09`, `mobile-05`) — genuinely hard to read. Reserve caps+tracking for headers/labels; body text gets normal case. A small type scale (display / header / body / caption) applied consistently would settle most pages.

**F17. Item art inconsistency.** Pixel sprites (mace, bow) sit next to text-tile placeholders ("M — MITHRIL PICKAXE", "O — OBSIDIAN PLATE", the "A" avatar tile) (`desktop-22`). Finishing the sprite set (or generating consistent procedural icons) is high-leverage for perceived quality.

**F18. Homestead presentation.** The iso plot is flat untextured green/grey; the three stat chips share the F2 washed-grey problem (`desktop-24`). Light texture on owned tiles, a subtle grid shimmer on buildable area, and opaque chips would make the town feel like a place.

**F19. Run HUD details.** Mobile title wraps mid-phrase ("THE DEEP MINE · FLOOR / 1 ROCKY CAVERNS…", `mobile-09`); top bars are icon-only (fine) but the CHARGE label is near-invisible; keyboard hints ("Move: arrow keys / WASD…") show on touch devices. Small fixes, big perceived-quality gain in the mode players stare at most.

**F20. Death/summary moments are plain text.** "Fallen in the Deep" / "Haul Secured" float as bare text over black (`desktop-14`, `desktop-19`). These are the emotional beats of a run — a parchment summary panel with the haul itemized, kept/lost columns, and record callouts would land much better.

---

## Suggested plan (for your approval — pick any subset)

**Phase A — Fix what's broken (P0):**
1. Mobile overflow sweep + `overflow-x` guard (F1) — verify every tab at 360/390.
2. Light-mode surface/contrast token pass (F2) — opaque raised surfaces, AA status colors; re-check banner, StatChips, energy modal, pills, explainer.
3. Persist guest session past reload (F3).
4. Mine spawn-safety radius + early-floor damage look (F4) — gameplay change, smallest possible tweak.

**Phase B — Layout & hierarchy (P1):**
5. Sticky sidebar + wider desktop content with 2-column layouts where natural (F5).
6. Minigame overlay viewport fit: flex canvas, controls always on-screen, touch controls only on touch, camera centering, in-canvas toasts (F6, F19).
7. Bottom-nav label fix (F7) and mobile hero header fix (F8).
8. Locked-state redesign: compact locked trials, collapsed codex (F9).
9. Explore energy-cost badges (F10); Quest Log header labels/tooltips (F11); crafting row cleanup (F12); mood-copy gating (F13).

**Phase C — Aesthetic elevation (P2):**
10. Glow discipline pass (F14) + progress-bar restyle (F15) + typography scale (F16).
11. Finish the item sprite set; replace text-tile placeholders (F17).
12. Homestead ground texture + chip fix (F18).
13. Run summary/death screens as designed moments (F20).

Phases A and B are mostly mechanical CSS/layout work with high user impact. Phase C is where "pleasing" becomes "beautiful" — F14 + F16 (glow + typography) are the two highest-leverage items if you only pick a couple.

---

## Implementation record (2026-07-08)

All plan items (1–13) were implemented and verified: typecheck clean, full suite 78 files / 1910 tests green. "After" screenshots: `screens/after/`.

| Item | Outcome |
|---|---|
| A1 overflow | `min-w-0 overflow-x-clip` on `<main>` (App.tsx) + Quest Log header `flex-wrap`. Quests & Crafting fit 390px. |
| A2 contrast | Root cause was translucent light surfaces over the dark body. Opaque `texture-parchment` on StatChips, mood/action card, TownView chips, locked trial rows; on-wood text in energy modal rows + energy strip; dark chip + `text-gold-bright` for Trial Board pills; parchment inset for Hero Stats explainer. |
| A3 guest | Guest choice persisted (`habits-rpg-guest-mode`, outside the game save), cleared on real sign-in. Reload now skips the auth wall. |
| A4 spawn | Mine already guarded; **Forest clearing-room ambush beasts did not** — now both share `CRAWL_SPAWN_SAFE_RADIUS = 4` (crawl.ts) with 4 regression tests. |
| F4 addendum | The audit's "instant deaths" were re-diagnosed live: contact damage is exactly 4 HP per 800 ms i-frame window (verified via engine simulation + in-browser HP timeline) — deaths took ~12 s of standing still, not seconds. Working as designed; no balance change made. |
| B5 | Sidebar list sticky below the header; Dashboard becomes 2-col at `xl` (quest log + sticky hero/summary rail, `max-w-5xl`). |
| B6/F19 | Overlays fit the viewport (spacing tightened, canvas `dvh`-capped scale, board clamped to map extent); touch controls only on coarse pointers (`.pointer-coarse-only` / `.pointer-fine-only` utilities); tips/banners constrained inside the canvas; "Floor N"/"Depth N" no longer wrap mid-token. |
| B7 | Bottom-nav labels 9px/untracked/truncating + `shortLabel` ("Craft"); hero name `text-xl` + non-wrapping Lv chip. |
| B8 | Locked trials are compact parchment rows with explicit unlock conditions; intro re-set as body text. Codex: 4-shield teaser at 0 discovered, collapse-with-count once any are found. |
| B9 | Explore cards show ⚡ cost badges (ember when unaffordable; Homestead labor note); Quest Log buttons titled + labeled ≥sm; Forge rows de-duplicated with met/unmet requirement tones; "struggling" mood gated on a real recent miss (engine fix + 3 tests — it had been counting pre-creation days as misses). |
| C10 | `Panel` defaults to a plain frame (`frame="gold"` reserved for HeroBanner, minigame landing cards, login, level-up challenge); HubGrid cards plain with hover glow; progress tracks recessed parchment instead of near-black; disabled buttons flatten to a recessed plaque. |
| C11 | 13 item/material keys mapped to bespoke SVG silhouettes (pickaxe/plate/amulet/icicle/droplet/…) through the same `framedSvg` seam monsters use; PNG registry still wins; 6 tests. Known follow-up: 19 relic keys still letter-tiled. |
| C12 | Homestead ground: 3-tone deterministic grass variation + tufts/speckles, hatched undeeded districts, south-face edge depth — ~6 extra DOM nodes total. |
| C13 | Mine/Forest death & bank moments are parchment panels over a dimmed board (ember vs gold accent), itemized kept/lost ledgers, record chips, full-width CTA. |
