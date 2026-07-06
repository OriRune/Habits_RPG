---
name: audit
description: Run one section of the 2026-07 HabitsRPG project audit (architecture | habit-core | balance | minigames | multiplayer | synthesis). Fact-checks prior analysis docs against current source, audits gaps with parallel subagents, and writes a standardized findings doc to docs/audit-2026-07/.
---

# HabitsRPG Project Audit — Section Runner

The user invoked `/audit $ARGUMENTS`. The argument names one section: `architecture`, `habit-core`, `balance`, `minigames`, `multiplayer`, or `synthesis`. If no argument was given, list the sections, show which output files already exist in `docs/audit-2026-07/`, and ask which to run.

## Ground rules (all sections)

1. **Read first:** `docs/audit-2026-07/00-audit-charter.md` (severity scale, finding format, doc structure — follow it exactly), then this skill's brief for the requested section, then the section's predecessor docs.
2. **Read prior section outputs** in `docs/audit-2026-07/` if any exist — don't re-report their findings; build on them.
3. **This is an audit, not a fix session.** Read-only with respect to `src/`. The only file you write is the section's output doc (and, for synthesis, the plan docs). Running `npm run test` / `npm run typecheck` to gather evidence is allowed and encouraged.
4. **Evidence discipline:** every finding cites `file:line`. Unverifiable claims go to the "Needs manual check" appendix at `confidence: low`.

## Standard workflow (sections 01–05)

**Step 1 — Fact-check pass.** Read the predecessor doc(s) and extract the 10–20 *load-bearing* claims — the numeric formulas, architectural assertions, and "X is broken / X was fixed" statements that the improvement plans lean on. Batch them (3–6 claims per batch, grouped by code area) and spawn `doc-fact-checker` agents **in parallel** to verify each batch against current source. Collect per-claim verdicts: verified / stale / wrong.

**Step 2 — Gap pass.** Fan out the section's specialist agents (listed in each brief) **in parallel** over the section's file list, targeting what the prior docs never covered. Give each agent: its scope files, the relevant fact-check verdicts, and the guiding questions from the brief.

**Step 3 — Verify before reporting.** For any P0/P1 candidate finding from Step 2, confirm the evidence yourself (Read the cited lines) before including it at high confidence. Downgrade or move to "Needs manual check" anything you can't confirm.

**Step 4 — Write the section doc** to the charter's output path in the charter's structure: executive summary, prior-doc fact-check table, severity-ordered findings with `PREFIX-NN` IDs, needs-manual-check appendix.

**Step 5 — Report.** End your final message with a ≤5-line executive summary and the suggested next section per the charter's run order.

---

## Section briefs

### 01 `architecture` — layer integrity, hotspots, test gaps

- **Predecessor docs:** `docs/habits-rpg-game-analysis.md` (architecture + tech-debt/bugs chapters), plus verify that `CLAUDE.md`/`AGENTS.md` architecture descriptions still match reality.
- **Gap-pass agents:** `code-health-auditor`, one per group:
  - Engine hotspots: `src/engine/hexBattle.ts` (~1,763 ln), `src/engine/forest.ts` (~1,633), `src/engine/mining.ts` (~1,407), `src/engine/arena.ts` (~1,236), `src/engine/trials/rooftopChase.ts` (~1,119)
  - Store: `src/store/shared.ts` (~1,279), the 14 slices in `src/store/slices/`, `selectors.ts`, `runRng.ts`
  - Content & lib: `src/content/encounters.ts` (~2,226), `src/lib/sfx.ts` (~1,217), `src/lib/placeholderArt.ts` (~1,107)
  - Views/components hotspots: `ForestRunOverlay.tsx`, `MineRunOverlay.tsx`, `TacticsOverlay.tsx`, `RooftopChase.tsx`, `Lockpicking.tsx`, `BattleScene.tsx`
- **Guiding questions:**
  - Does every `src/engine/` file stay pure (no React/store/net imports)? Do components ever bypass `selectors.ts` and compute derived state inline?
  - Which of the ~20 engine modules without a direct test file are actually risky (real logic: `crawl.ts`, `bosses.ts`, `combatStats.ts`, `spells.ts`, 5 untested trials) vs. trivially data-only (`materials.ts`, `palettes.ts`)? Check for indirect coverage (e.g., `crawl-*.test.ts`) before flagging.
  - Are the giant files cohesive-but-large (fine) or genuinely tangled (split candidates)? `hexBattle.ts` split is already tracked as Tactics item 5A — don't re-report, but assess whether other hotspots deserve the same.
  - Store slices: any action living in the wrong slice, duplicated helper logic that belongs in `shared.ts` or the engine, or state that should be transient (like `runRng`) but is persisted?
  - Doc drift: is `README.md` still stale? Does `docs/INDEX.md` match the actual doc set?

### 02 `habit-core` — usefulness as a real habit-building tool

- **Predecessor docs:** `docs/habit-tracking-analysis.md`; `docs/habits-rpg-improvement-plan2.md` Phases 2–5 (dashboard, XP clarity, guided creation, weekly planning/review) and the Phase 8 onboarding gap.
- **Step 0 (this section only) — user interview.** Before any code work, interview Orion with AskUserQuestion (2 rounds of up to 4 questions; keep options concrete). Cover: which features he touches daily vs. never; whether energy/XP rewards actually motivate logging real habits; friction points in logging (taps to log one habit, habit-creation flow); whether streaks/weekly review change his behavior; whether the minigames pull time *away* from habit-building; what he'd want the app to nag him about. Record answers verbatim in the section doc — they are primary evidence.
- **Fact-check focus:** streak formulas, XP-per-habit numbers, weekly rollover behavior, template list — verify `habit-tracking-analysis.md` claims against `src/engine/habits.ts`, `src/engine/leveling.ts`, `src/store/slices/habitsSlice.ts`, `src/engine/date.ts`.
- **Gap-pass agents:** `game-design-auditor` (lens: behavioral design, not minigame fun) over the habit loop: `DashboardView`, habit creation/templates components, weekly review flow, `WelcomeCard`/`CreationView` onboarding.
- **Guiding questions:**
  - Cue→routine→reward: does the app create a *cue* to log (reminders? nothing?), or does it rely on the player opening it? Is the reward (energy/XP) delivered at the moment of logging with clear feedback?
  - Streak psychology: what happens on a missed day — is it punishing enough to matter but forgiving enough not to trigger abandonment (freeze/repair mechanics)?
  - Cost of logging: count the actual taps/clicks from app-open to habit-logged.
  - The un-built guided onboarding (Phase 8 gap): what does a brand-new player actually see, and where would they bounce?
  - Does game progression *require* real habits, or can a player ignore habits and still play (energy economy as the coupling)? Cross-check with Orion's interview answers.

### 03 `balance` — economy and stat parity, re-derived from current source

- **Predecessor docs:** `docs/balance-audit.md` (**2026-06-17 — predates the reward rebalance; treat every number as suspect**); `habits_rpg_gameplay_design.md` (root) as the intended numeric spec.
- **Fact-check focus:** every formula and constant the June audit cites — XP curve (`100×level^1.5`), 3 pts/level allocation (`engine/progression.ts`), energy costs (`DUNGEON/MINE/FOREST/ARENA_ENERGY_COST`), gold multipliers (habit-streak bonus in `store/shared.ts::commitRun`), trial rewards (`trialReward`), enemy roster/weaknesses (`content/`, `engine/enemies.ts`, `engine/bosses.ts`).
- **Gap-pass agents:** `game-design-auditor` (lens: numeric balance) per domain: (a) XP/leveling economy, (b) gold/gear/crafting economy, (c) energy earn-vs-spend loop, (d) per-stat opportunity parity across all modes.
- **Guiding questions:**
  - Re-test the June findings against current code: is **ST still overloaded** (widest gear pull)? Is **AG still the only stat with no real-time minigame application** (Rooftop Chase is AG's trial — did anything else change)? Is the enemy weakness spread still skewed toward WI?
  - Cross-minigame parity: estimate reward-per-minute and reward-per-energy for Dungeon, Mine, Forest, Arena, Tactics at comparable character levels. Flag any mode that strictly dominates.
  - Energy loop: at N habits/day, how many minigame entries per day? Does `unlimitedEnergy` dev-flag usage in Orion's interview (section 02) suggest the real economy is too tight?
  - Boss gate (level ≥5 `pendingLevelUp`): is boss difficulty scaling keeping pace with the stat-level curve?
  - Where code contradicts `habits_rpg_gameplay_design.md`, decide per case whether the spec or the code is right — report as a finding either way.

### 04 `minigames` — per-mode depth, doc drift, and open items

- **Predecessor docs:** the active analyses — `dungeon-delve-`, `mining-`, `forest-`, `forest-mining-` (combined), `arena-minigame-analysis-2`, `tactics-minigame-analysis-2` + `tactics-improvement-plan` (open: 5A, 5B, 5C-variant, 6C; partial: 2B, 4C), the 8 trial analyses, `long-march-improvement-plan` (open: 2.2, 6.3), archived `spirit-grove-improvement-plan` (§4.1 ambient audio never landed), `forge-minigame-development-plan` (not started).
- **Fact-check focus:** for each mode, the 2–3 claims its analysis doc makes about current mechanics + each plan's open-item list ("is 5B really still missing a `TacticsOverlay` test?").
- **Gap-pass agents:** `game-design-auditor`, **one per mode** in parallel: Dungeon Delve (`engine/crawl.ts` + `dungeon*.ts` + `DungeonView`), Deep Mine (`engine/mining.ts` + `MineRunOverlay`), Wild Forest (`engine/forest.ts` + `ForestRunOverlay`), Arena (`engine/arena.ts` + `ArenaOverlay`), Tactics (`engine/hexBattle.ts` + `TacticsOverlay`), Boss battles (`engine/bosses.ts` + `combat.ts` + `BattleScene`/`BattleOverlay`), Trials batch A (Rooftop Chase, Lockpicking, Spirit Grove, Ancient Library), Trials batch B (Last Stand, Long March, Royal Court, Armory Break).
- **Guiding questions:**
  - Per mode: does the build match its analysis doc? Is there a dominant strategy that trivializes it? Does difficulty scale with character progression or go flat? Is it worth its energy cost (feed section 03's parity numbers)?
  - Which confirmed-open items (Tactics 5A/5B/6C, Long March 2.2/6.3, Spirit Grove audio, dungeon death loot-loss design call) still matter vs. should be formally dropped?
  - Forge: confirm greenfield (no engine module; `ForgeSection.tsx` UI stub only), then sanity-check `forge-minigame-development-plan.md` against as-built `engine/crafting.ts`, `gear.ts`, `materials.ts` — do its assumptions (quality-tier maps, no migration) still hold?
  - Cross-cutting: are the four real-time modes too mechanically similar (all crawl-derived)? Which mode is the weakest and why?

### 05 `multiplayer` — co-op correctness, sync, and trust

- **Predecessor docs:** `docs/archived/MULTIPLAYER_PLAN.md` (design intent), `docs/trust-model.md` (Option A), `habits-rpg-game-analysis.md` bug list (co-op desync item), plan2's open items (co-op staleness guard at `useTacticsCoopSession.ts:68-71`, desync integration tests).
- **Fact-check focus:** which parts of MULTIPLAYER_PLAN shipped as designed vs. diverged; whether the staleness bug at `useTacticsCoopSession.ts:68-71` still reproduces in current source; trust-model assumptions vs. what leaderboards/party quests now expose.
- **Gap-pass agents:** `code-health-auditor` over: `src/net/coop/reduce.ts` (~458 ln, host-authoritative reducer) + `protocol.ts` + `session.ts`; `src/net/cloudSave.ts` (CAS logic); `src/net/party.ts`; `src/net/clock.ts` + `engine/date.ts` seam; the coop hooks in `src/hooks/`.
- **Guiding questions:**
  - Reducer correctness: can host and guest apply the same broadcast in different orders? What happens on message loss, duplicate delivery, or a guest joining mid-run? Compare covered cases in `coop/__tests__/reduce.test.ts` (~657 ln) against the reducer's actual branches — enumerate untested branches.
  - Cloud save CAS: what happens on concurrent writes from two devices, offline-then-reconnect, and account switch mid-session? Is the account-switch wipe safe against data loss?
  - Clock seam: every daily/weekly gate routes through `engine/date.ts::now()` — grep for stray `Date.now()`/`new Date()` in gating logic that bypasses the seam.
  - Trust model fit: with leaderboards and party quests live, does Option A (client-trusted saves) still hold, or do specific surfaces now need server-side validation? Recommend, don't redesign.

### 99 `synthesis` — merge findings into improvement plans

Run only when all five section docs exist. Different workflow:

1. Read all five section docs + `habits-rpg-improvement-plan2.md` (especially "Still open / deferred") + active per-minigame plan open items.
2. Merge and dedupe: every finding either (a) maps to an already-tracked open item (note the linkage), (b) is new, or (c) supersedes/invalidates a tracked item.
3. Write `docs/audit-2026-07/99-synthesis.md`: unified severity-ranked register with cross-section themes called out (e.g., a stat-parity issue appearing in both 03 and 04).
4. Write **`docs/habits-rpg-improvement-plan3.md`** as the new master roadmap, following plan2's conventions: phased structure, ✅/⏳ status markers, explicit non-goals, a "Still open / deferred" table seeded from anything consciously deferred. Carry forward unresolved plan2 items; mark plan2 superseded.
5. Only if a single section's findings are dense enough (rule of thumb: ≥8 findings at P2+ in one area), spin its detail into a separate per-area plan doc per the project's analysis-before-plan convention — otherwise keep everything in plan3.
6. Update `docs/INDEX.md`: add the audit folder, plan3 as current roadmap, plan2 as superseded (INDEX rule: keep both, note status).
7. Propose to the user (don't do it unprompted): moving completed plan docs to `docs/archived/`.
