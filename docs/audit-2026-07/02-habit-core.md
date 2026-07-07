# Audit 2026-07 — Habit Core

**Date run:** 2026-07-05 · **Branch:** `feature/multiplayer` · **Sections complete before this one:** 01 architecture

Method: user interview (2 rounds, recorded verbatim below), then fact-check of `docs/habit-tracking-analysis.md` (2026-06-20) and plan2 Phases 2–5/8 "Done" claims via 4 parallel fact-check agents, then a 3-agent behavioral-design gap pass (daily logging loop, onboarding path, habit↔game coupling). Every P1/P2 finding was re-verified by hand at the cited lines this session.

## Executive summary

- **The June habit-tracking analysis is largely obsolete — in a good way.** Its four "Critical" items (no edit UI, broken streak freeze, energy-refund asymmetry, free trials) and most "High" items (unlimited backdating, no delete confirmation, no party-quest reward, no binary XP feedback, uncapped XP farm) were all fixed between 2026-06-20 and now. The remaining live findings are second-generation issues in the fixes themselves.
- **One P1 economy hole survives in a normal gameplay surface:** the custom-challenge "Edit reward" field bypasses `suggestReward`'s clamps entirely — one habit tap can mint arbitrary XP and gold with no cheat-mode framing (HABIT-01).
- **The streak system fails exactly when the owner needs it.** His interview says long streaks are his strongest motivator and losing one is his strongest demotivator — yet the streak freeze can only be used *before* a miss (using it after eats the 80g item for nothing, while the UI baits it with a stale cached streak), streak-at-risk warnings are masked behind generic prompts and fire from midnight, and crossing day 7/30/100 is visually identical to day 2 (HABIT-02, -11, -13).
- **The cue end of cue→routine→reward is structurally missing.** The owner's #1 friction is *remembering to open the app*. A daily reminder shipped (he doesn't know it exists — default-off, buried in Settings), but it is foreground-only: no PWA manifest, no service worker, so it can only remind someone who already opened a tab (HABIT-03).
- **The strongest habit→minigame incentive is invisible.** `habitBonus` (up to ×1.25 gold on every minigame payout for keeping streaks) appears in zero UI files; focus habits chosen in the weekly plan are never evaluated by the weekly report. Both incentive loops exist mechanically but not psychologically (HABIT-09, -10) — consistent with the owner reporting rewards motivate him only "somewhat" and minigames feel "neutral."

## User interview (primary evidence, recorded verbatim)

Conducted 2026-07-05 via in-session structured questions, two rounds.

| Question | Answer |
|---|---|
| Which parts of the app do you touch on a typical day? | **Habit dashboard, Skill Trials, Big minigames** (not the meta screens: Chronicle/Challenges/Party/Shop/Crafting) |
| Do XP/energy rewards motivate you to log real habits? | **"Somewhat — nice feedback, but I'd log habits anyway; the rewards are secondary"** |
| Biggest friction point when logging? | **"Remembering to open — no reminder/notification, so I forget to log until late or miss days"** |
| Do streaks and the weekly review change what you do? | **"Both matter — streaks and the weekly review both influence my behavior"** |
| Do minigames pull time away from habit-building? | **"Neutral — I play after habits are done; no real interaction either way"** |
| Do you use unlimitedEnergy/repeatMinigames in real play? | **"Only for testing — only while developing/testing features, never in a real session"** |
| What should the app nag you about? | **"Daily log reminder, Streak at risk — since it's a web app, not a phone app, notifications are hard to implement"** |
| What happens when you miss a day? | **"It depends — losing a long streak can be demotivating. Losing a short streak is not demotivating. But maintaining a long streak is a motivator."** |

Implications used in this section: the real energy economy is what he plays (dev flags are test-only); the cue gap is the top friction; streak protection and streak-at-risk surfacing are the highest-leverage behavioral fixes; reward legibility (not reward size) is the likelier explanation for "somewhat."

## Prior-doc fact check

Claims from `docs/habit-tracking-analysis.md` (HTA, 2026-06-20) and `habits-rpg-improvement-plan2.md` (plan2) vs. current source. "Stale (fixed)" = the doc's complaint was valid then and has since been resolved.

| # | Claim | Source | Verdict | Evidence |
|---|-------|--------|---------|----------|
| 1 | BASE_XP 10/20/35/50; COMPLETION_CAP 1.5; RECOVERY_BONUS 1.1 | HTA §6 | **verified** | `engine/xp.ts:7-12,15,25` |
| 2 | Uncapped quantity habits have no XP ceiling (10,000× exploit) | HTA §11 | **stale (fixed)** | `UNCAPPED_RATIO_CAP = 10` at `xp.ts:22,38`; comment cites the exploit being closed |
| 3 | Streak semantics: as_needed→0; times_per_week = consecutive complete weeks, *partial current week doesn't count*; day-scheduled walks back | HTA §4 | **wrong (one part)** | `habits.ts:116-148` — as_needed/day-scheduled accurate, but the times_per_week loop starts at the *current* week: a met partial week counts; an unmet one zeroes the streak regardless of prior weeks |
| 4 | Recovery bonus fires when completing "the day after a missed scheduled day" | HTA §4 | **wrong** | `habits.ts:190-192` — actual trigger is `dayScheduled && gap > 1` with no scheduled-day check; see HABIT-05 |
| 5 | Habit XP multiplied by equipped gear (`gearXpMultiplier`) | HTA §6 | **verified** | `habitsSlice.ts:168`; `gear.ts:70-80` |
| 6 | Habits never produce gold or items | HTA §6 | **stale** | Habits now award gold 0/2/5/10 by difficulty (`xp.ts:55`, `habitsSlice.ts:169,197`, refund-exact via log entry). Items: still challenge-only — that half holds |
| 7 | No habit-edit UI; `updateHabit` has zero call sites | HTA §11 (Critical #1) | **stale (fixed)** | `HabitForm.tsx:177,214-218` edit mode; `HabitCard.tsx:184,217` kebab → Edit; `type` immutable post-creation (`habitsSlice.ts:76-87`) |
| 8 | completeHabit sequence (guard → resolve → gear → log/streak → statXp → challenges → isToday side effects → checkLevelUp) | HTA §3 | **verified** | `habitsSlice.ts:164-227` (plus new: gold at :197, ledgers, MAX_ENERGY clamp at :226) |
| 9 | Unlimited backdating to any past day | HTA §11 | **stale (fixed)** | 7-day window: `BACKDATE_WINDOW_DAYS = 7` (`date.ts:102`), floor at `DashboardView.tsx:88-89`; older entries via deliberate "Log older entry…" modal with integrity warning (`HabitCard.tsx:230-243,345-381`) |
| 10 | uncompleteHabit doesn't reverse +1 energy (farming exploit) | HTA §12 (Critical #3) | **stale (fixed)** | Refund at `habitsSlice.ts:277-284` — but see HABIT-04 (spend-then-uncomplete leak) and HABIT-16 (max-energy edge) |
| 11 | Delete has no confirmation dialog | HTA §11 | **stale (fixed)** | `DeleteHabitDialog.tsx:22-58`, incl. "Retire instead" alternative |
| 12 | Binary completion shows no XP feedback | HTA §11 | **stale (fixed, imperfectly)** | `+XP` toast at `HabitCard.tsx:74-79` — but it understates (see HABIT-06) |
| 13 | useStreakFreeze is broken (no log entry, no streak recompute) | HTA §12 (Critical #2) | **stale (fixed)** | `economySlice.ts:59-80` writes `{xp:0, frozen:true}`, recomputes streak; streak-survival test at `store.integration.test.ts:431-462` — but see HABIT-02 (proactive-only) |
| 14 | Party quests grant no reward (`gold: 0` hardcoded) | HTA §8 | **stale (fixed)** | 50 + 10/member capped 200 (`PartyQuestPanel.tsx:35,131,140`), idempotent claim via `claimedPartyQuests` (`economySlice.ts:82-90`), tested |
| 15 | `recovery` item does nothing (no broken-streak penalty exists) | HTA §12 | **verified** | `recovery_elixir` (`content/items.ts:77-85`, 70g); `effect.recovery` declared (`engine/items.ts:19`) but zero consumers repo-wide — see HABIT-15 |
| 16 | Skill Trials cost 0 energy and bypass the habit→energy gate | HTA §7 (Critical-adjacent) | **stale (fixed)** | `TRIAL_ENERGY_COST = 1` (`trials/trials.ts:104`, charged `trialsSlice.ts:36,57`); trials also stat-gated (matching-stat habit within 7 days, `trialsSlice.ts:40`, copy at `TrialsView.tsx:76`) — already established in section 01, re-confirmed |
| 17 | ≥12 daily habits triggers load warning | HTA §9 | **verified** | `selectors.ts:108-114` → `selectDailySummary` |
| 18 | Mood = last-7-days completions vs scheduled, shown in hero banner | HTA §9 | **verified** | `shared.ts:672-686`; bucketing in `engine/mood.ts:18-31`; `HeroBanner.tsx:17,41-42` |
| 19 | Dashboard command center shipped (energy today, streaks, focus, missed, weekly %, warnings, recommended action) | plan2 Phase 2.1 ✅ | **stale (6 of 7)** | `DashboardView.tsx:313-366,122-138,217-231`; **no "missed habits" section** — misses surface only via at-risk recommendation and per-habit insight modals |
| 20 | Guided creation + templates shipped | plan2 Phase 2.2/2.3 ✅ | **stale (partial)** | Template picker + one-page custom form with reward preview (`HabitForm.tsx:25-433`), not a step wizard; `CATEGORY_STAT_SUGGESTIONS` never wired (dead — already ARCH-19) |
| 21 | Health warnings + recovery mode shipped | plan2 Phase 2.4/2.5 ✅ | **stale (mostly)** | Warnings fully shipped (`habitHealth.ts:15-21,191-218` + HabitCard/dashboard surfacing); RecoveryModal ships keep-1-3/suspend-rest (`RecoveryModal.tsx:44-57`) but **no restart bonus, no target reduction** in the flow |
| 22 | Weekly planning shipped (focus habits, stat focus, challenge, energy target) | plan2 Phase 3.1 ✅ | **stale (partial)** | Only the focus-habit picker (max 3) shipped (`PlanWeekModal.tsx:26-108`); no stat focus / challenge / energy target anywhere in `src/` |
| 23 | Expanded weekly review shipped (rates, breakdowns, energy in/out, habit-vs-minigame XP) | plan2 Phase 3.2 ✅ | **stale (partial)** | `WeeklyReport` has most-improved/most-missed/suggestion (`weekly.ts:11-28`) but no completion-rate %, no by-habit breakdown, no energy *spent*, no XP-source split (that lives in the dev Balance Report) |
| 24 | Onboarding = WelcomeCard + CreationView templates; no guided sequence; Balance Report dev-accessible | plan2 Phase 8 / 4.1 | **verified** | `DashboardView.tsx:141`, `CreationView.tsx:214-253`, `SettingsView.tsx:329-339`, `BalanceReportModal.tsx:74-75` ("Tracking started at save v25") |
| 25 | Phase 1.3 XP-clarity and Phase 4.4 "you earned this adventure" ritual shipped | plan2 ✅ | **verified** | `CharacterView.tsx:55-71` (Training XP vs Hero Stats explainer); `AdventureRitualModal.tsx:38-69`, default-on (`shared.ts:585`), wired into all six entry points |
| 26 | "There are no reminders/notifications" | HTA §9 | **stale (fixed, weakly)** | `useReminders.ts` shipped: daily reminder, Settings toggle (`SettingsView.tsx:177-196`) — default-**off** (`shared.ts:586`), foreground-only; see HABIT-03 |

## Findings

### [HABIT-01] Custom-challenge reward override bypasses all clamps — one habit tap mints arbitrary XP/gold (P1, confidence: high)
- **Area:** src/store/slices/challengesSlice.ts, src/components/challenges/ChallengeBuilder.tsx
- **Observation:** `suggestReward` clamps challenge rewards to 20–300 gold / 30–400 statXp (`engine/challenges.ts:260-265`), but the builder's "Edit reward" path only floors values at 0 (`ChallengeBuilder.tsx:64-71`) and `createCustomChallenge` stores the override verbatim: `reward: rewardOverride ?? suggestReward(base)` (`challengesSlice.ts:109`). Claiming applies it via `applyReward` + `checkLevelUp` (`challengesSlice.ts:90-91`). Verified by hand: a count-1, 1-day challenge with gold/XP set to 999999 completes off a single habit completion.
- **Prior-doc status:** not covered by habit-tracking-analysis.md (it predates the reward editor).
- **Impact:** Unlike `unlimitedEnergy` (labeled a dev switch in a Developer panel), this is an unlabeled normal-gameplay surface in the Challenges tab. It severs "progression requires real habits" for XP and gold simultaneously — max level from one checkbox. Within the friendly-trust model self-cheating is tolerated, but this reads as a legitimate feature, not a cheat, so an honest player can wreck their own save's integrity without realizing it.
- **Recommendation:** Clamp the override in `createCustomChallenge` to `suggestReward` bounds (or ±50% of the suggestion) — one line at `challengesSlice.ts:109`.

### [HABIT-02] Streak freeze is proactive-only and the UI baits wasting it after the streak is already dead (P1, confidence: high)
- **Observation:** `useStreakFreeze` writes only `log[today]` (`economySlice.ts:64-76`); `currentStreak` breaks at any past unfrozen miss (`habits.ts:136-148`). `habit.streak` is a cache refreshed only on complete/uncomplete/edit/freeze — `normalizeHabits` never recomputes it — so after missing yesterday, the Inventory "Protect a Streak" panel still lists the habit at its old streak (`InventoryView.tsx:26` filters on cached `h.streak > 0`; `:71` renders "🔥 {h.streak}"). Sequence verified in source: 30-day streak → miss yesterday → panel shows 🔥 30 → Freeze → item consumed (`economySlice.ts:68`) → streak recomputes through yesterday's miss → 0. The item description promises the opposite: "Protects one missed habit so your streak survives" (`content/items.ts:73`).
- **Area:** src/store/slices/economySlice.ts, src/views/InventoryView.tsx, src/engine/habits.ts
- **Prior-doc status:** contradicts the fixed-ness implied by the June fix; the HTA-era bug (no log entry) is fixed, but the redesign kept a same-day-only model.
- **Impact:** Forgetting to log and forgetting to pre-freeze are the same act, so the mechanic built to soften the owner's stated worst demotivator (losing a long streak) fails in the only realistic failure mode — and consumes the 80g item while doing it. A bad day becomes a bad day plus a scam.
- **Recommendation:** Allow the freeze to repair the most recent missed scheduled day (yesterday-grace), or at minimum: refuse to consume when `currentStreak(habit, today) === 0` and display live `currentStreak` (not the cache) in the Protect panel.

### [HABIT-03] The habit cue is structurally missing: reminder is foreground-only, default-off, and undiscoverable; no PWA path exists (P1, confidence: high)
- **Area:** src/hooks/useReminders.ts, index.html, package.json
- **Observation:** `useReminders` polls once a minute *while a tab is open* (`useReminders.ts:7,31-83`; ":16 — no service worker is required — this is foreground-only"). No manifest link in `index.html`, no `vite-plugin-pwa`/workbox in `package.json`, no service-worker registration anywhere (grep verified this session). `new Notification(...)` from a page context (`useReminders.ts:68`) throws on Chrome-for-Android, falling back to a 2.2s in-app toast. The feature is default-off (`shared.ts:586`) and reachable only via Settings (`SettingsView.tsx:177-196`); nothing on the dashboard ever suggests enabling it.
- **Prior-doc status:** HTA §9 said no reminders exist — stale; but the shipped fix cannot reach the stated need.
- **Impact:** The owner's #1 friction is remembering to open the app; a reminder that only fires inside an open tab is circular. He doesn't know the feature shipped — direct evidence of the discoverability gap.
- **Recommendation:** Add `vite-plugin-pwa`: a manifest alone makes the app installable (a home-screen icon is a passive daily cue with zero notification code), and a minimal service worker makes `registration.showNotification` work on mobile. Interim: a one-time dashboard card after any missed scheduled day offering to enable the existing reminder.

### [HABIT-04] Complete → spend → uncomplete → re-complete mints unlimited energy from one habit (P2, confidence: high)
- **Area:** src/store/slices/habitsSlice.ts
- **Observation:** `completeHabit` grants +1 energy for today (`habitsSlice.ts:214`); `uncompleteHabit` refunds only `if (day === today && !entry.frozen && next.character.energy > 0)` (`:279`) and deletes the log entry (`:254`), re-arming the completion guard (`:164`). Cycle: complete (+1) → spend it → uncomplete at 0 energy (refund skipped) → complete again (+1). XP/gold refunds are exact; energy leaks +1 per cycle, unbounded.
- **Prior-doc status:** HTA's original energy asymmetry (Critical #3) was fixed; this is a second-generation hole in the fix.
- **Impact:** Infinite minigame entries via ordinary check/uncheck UI, no Developer panel required. Moderated by the friendly-trust model, but it's the last honest-UI leak in an otherwise airtight energy faucet (the only energy source in the codebase is habit completion — verified: `Reward` has no energy field, `applyReward` never touches energy, only other writer is `devFillEnergy`).
- **Recommendation:** Record an energy debt when the refund is skipped, or persist a per-day "energy granted" marker (e.g. on the log entry, mirrored in `energyLog`) and skip the +1 on same-day re-completion.

### [HABIT-05] Recovery bonus fires without a genuine miss — permanent 1.1× XP for gapped schedules and false mood signals (P2, confidence: high)
- **Area:** src/engine/habits.ts
- **Observation:** `recovery = dayScheduled && Number.isFinite(gap) && gap > 1` (`habits.ts:190-192`) checks only days-since-last-completion, never whether an intervening day was *scheduled and missed*. A custom Mon/Wed/Fri habit always has gap ≥ 2 → earns the 1.1× bonus (`xp.ts:76`) on **every completion**; a weekdays habit gets it every Monday. The flag also feeds `recomputeMood(next, today, result.recovery)` (`habitsSlice.ts:216`) as a false `recentlyRecovered` signal.
- **Prior-doc status:** contradicts HTA §4, which described the intended day-after-a-miss semantics as if implemented.
- **Impact:** Systematic XP inflation for non-daily schedules (a balance input for section 03) and a "recovering" mood that can display without any miss. Also the inverse: a genuine miss recovered on the next scheduled day *more than one calendar day later* is indistinguishable from the false positives.
- **Recommendation:** In `resolveCompletion`, walk scheduled days between `lastCompletedISO` and today (the walker already exists for `currentStreak`) and set `recovery` only if at least one scheduled day in the gap is unlogged/unfrozen.

### [HABIT-06] The reward moment under-reports what was earned; the quantity preview shows a number that isn't what's granted (P2, confidence: high)
- **Area:** src/components/habits/HabitCard.tsx, CompleteHabitDialog.tsx
- **Observation:** Binary toast shows base XP only (`HabitCard.tsx:74-79` calls `computeXp` directly) while the actual grant applies the gear multiplier (`habitsSlice.ts:168`) and also includes gold (`:197`) and +1 energy (`:214`) — neither in the toast. Quantity completions get no post-commit toast at all; the dialog preview (`CompleteHabitDialog.tsx:34-40`) computes XP without the recovery flag or gear multiplier, so with either active the number shown ≠ number granted, and no corrected figure is ever displayed.
- **Prior-doc status:** HTA asked for binary XP feedback — shipped, but incompletely; the preview mismatch is new.
- **Impact:** The logging instant is the operant-conditioning hook, and energy — the currency gating every minigame — is invisible at the moment it's earned. Undercounting also silently devalues XP gear and the comeback bonus. Directly relevant to the owner's "rewards motivate me only somewhat."
- **Recommendation:** One shared "reward receipt" toast built from `completeHabit`'s actual computed values (`+12 XP · +5g · +1⚡`), used by both binary and quantity paths; drop or fix the dialog preview.

### [HABIT-07] Quick-start silently creates a strictly weaker hero — forfeits 5 stat points and the signature spell (P2, confidence: high)
- **Area:** src/views/CreationView.tsx
- **Observation:** `quickStart()` calls `createCharacter({ name, allocations: {}, weaponKey: STARTER_WEAPON, spellKey: '' })` (`CreationView.tsx:74-77`, verified by hand). The full path allocates `STARTING_STAT_POINTS = 5` (`progression.ts:24`); empty allocations leave all stats at 1, and an empty `spellKey` means starter spells only (`coreSlice.ts:80`) — with no later mechanism to claim either. The quick-start link is small underlined text at the bottom of the 5-panel creation scroll (`:267-273`) with no disclosure of the trade-off.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** The lowest-commitment path — the one bounce-prone new users take — yields permanently worse minigame/boss performance with zero disclosure.
- **Recommendation:** Have `quickStart` auto-allocate the 5 points (e.g. spread over the default template group's stats) and grant a default signature spell; or disclose in one line under the link.

### [HABIT-08] Default starter template trains only 2 of 8 stats, leaving 6 Skill Trials locked and no attack stat growing (P2, confidence: high)
- **Area:** src/content/habitTemplates.ts, src/views/TrialsView.tsx
- **Observation:** `beginner_fitness` (the pre-selected default, `CreationView.tsx:37-39`) maps its four habits to AG, AG, HP, HP while declaring `primaryStat: 'EN'` (`habitTemplates.ts:39-77`, verified by hand). Trials unlock per-stat only after a matching-stat habit completion within 7 days (`TrialsView.tsx:76`, gate at `trialsSlice.ts:40`) → 6 of 8 trials stay locked on the happy path. Level-up points follow recent per-stat effort (`progression.ts::allocateStatGains`), so they funnel into AG/HP, while every starter weapon attacks with ST or DX (`weapons.ts:2-3`) — stats the default set never trains.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** A new user following the default path hits locked daily content and a stagnant attack stat with no way to diagnose why.
- **Recommendation:** Retag "Walk 10 minutes" → EN (matching the declared primaryStat) and one habit → ST, or broaden the group to 4 distinct stats.

### [HABIT-09] habitBonus — the designed habit→minigame incentive — is invisible in the UI (P2, confidence: high)
- **Area:** src/store/shared.ts, UI layer
- **Observation:** `character.habitBonus` (1.0/1.10/1.15/1.25 by fraction of tracked habits with streak ≥ 3, `shared.ts:696-702`) multiplies gold on mine/forest/arena/tactics banking (`shared.ts:1096`), forest stash (`:1207`), and dungeon banking (`dungeonSlice.ts:319`) — but appears in **zero** `.tsx` files (grep verified this session).
- **Prior-doc status:** not covered by habit-tracking-analysis.md (mechanism post-dates it).
- **Impact:** A contingency the player can't see can't shape behavior. This is the one mechanic designed to make minigame-inclined players maintain habit streaks, and it's doing nothing psychologically — consistent with the interview ("rewards motivate somewhat," minigames "neutral").
- **Recommendation:** Show the multiplier and its cause on every run-banking summary ("Streak bonus ×1.15 — 3 of 4 habits on streak") and beside the dashboard energy counter.

### [HABIT-10] The weekly report never evaluates the weekly plan (P2, confidence: high)
- **Area:** src/engine/weekly.ts, src/components/weekly/PlanWeekModal.tsx, WeeklyReportModal.tsx
- **Observation:** Focus habits (`setHabitFocus`, max 3, `habitsSlice.ts:25,113-120`) have no mechanical effect — they sort first (`DashboardView.tsx:78-80`) and drive one recommendation string (`dashboard.ts:205-211`). `buildWeeklyReport` (`weekly.ts:51-155`) contains no reference to `focus`, so the Plan → Do → Review → Plan cycle (`App.tsx:166-173`) never reports how the three chosen habits went.
- **Prior-doc status:** plan2 Phase 3 marked ✅ — partially contradicted; the plan/review loop closes mechanically but not informationally.
- **Impact:** A commitment with no feedback decays into a skippable modal ("I'll decide later"). The owner says the weekly review genuinely influences him — this is the cheapest way to deepen a loop he already uses.
- **Recommendation:** Add `focusResults: { habitName, completed, scheduled }[]` to `WeeklyReport` and render it as the report's first block.

### [HABIT-11] Streak-at-risk warning is masked by generic prompts, fires from midnight, and picks an arbitrary habit (P2, confidence: high)
- **Area:** src/engine/dashboard.ts
- **Observation:** Priority chain (`dashboard.ts:196-231`): `struggling` > `finish_focus` > `start_today` > `streak_at_risk`. `start_today` fires whenever `completedToday === 0` (`:216`), so on the dangerous did-nothing-yet days the at-risk warning can't surface. When it does, it fires from midnight with "log it before the day ends" copy (`:228`) and targets `atRiskHabits[0]` (`:225`) — habit-array order (`:129,152-154`), not longest streak. Nothing at the at-risk moment mentions streak freezes (freeze UI exists only in InventoryView).
- **Prior-doc status:** not covered by prior docs (recommendation engine post-dates HTA).
- **Impact:** The owner explicitly asked for streak-at-risk warnings; the implemented one is hidden exactly when needed, cry-wolf when visible, and liable to name a 2-day streak while a 60-day streak dies.
- **Recommendation:** Sort `atRiskHabits` by live streak descending; promote `streak_at_risk` above `finish_focus`/`start_today` when the top at-risk streak ≥ 7 and local hour ≥ ~18; append "(you have N Streak Freezes)" when owned.

### [HABIT-12] With a backend configured, first contact is a mandatory account wall with a "no password recovery" warning (P2, confidence: high — deployment-dependent)
- **Area:** src/App.tsx, src/views/LoginView.tsx
- **Observation:** `signedOut` → `<LoginView />` with no guest/offline branch (`App.tsx:113-122`), though the app is fully functional single-player when Supabase is unconfigured. LoginView warns "There is no password recovery — keep it safe" (`LoginView.tsx:114-118`) before the user has seen any product value.
- **Prior-doc status:** not covered by prior docs.
- **Impact:** Interaction-zero drop-off risk: credentials plus a data-loss warning before the first habit exists. Only affects deployments with env vars set — the owner's own hosted instance is exactly that.
- **Recommendation:** "Play offline / as guest" link on LoginView that skips the gate and offers account linking later (the unconfigured path already tolerates this).

### [HABIT-13] Zero streak-milestone recognition — day 7/30/100 look identical to day 2 (P2, confidence: high)
- **Area:** src/components/habits/HabitCard.tsx, src/store/slices/habitsSlice.ts
- **Observation:** Streak display is a static flame + number (`HabitCard.tsx:145-149`). Repo grep finds no habit-related milestone/celebration code; the sfx module is imported only by minigames.
- **Prior-doc status:** not covered by prior docs.
- **Impact:** The owner's strongest motivator (long streaks) receives no reinforcement events at all — near-free reinforcement left on the table.
- **Recommendation:** In `completeHabit`, when the new streak crosses {7, 30, 100}, push a distinct toast (optionally + small gold or a free streak-freeze) — one conditional at `habitsSlice.ts:191` where the new streak is already computed.

### [HABIT-14] Weekly review's suggestedAdjustment is dead-end text; its structured actions are discarded (P2, confidence: high)
- **Area:** src/engine/weekly.ts, src/components/weekly/WeeklyReportModal.tsx
- **Observation:** `habitHealth` warnings carry machine-readable `suggestedActions` (`mark_focus`/`suspend`/`change_frequency`, `habitHealth.ts:29,113`), but `buildWeeklyReport` keeps only `w[0].message` (`weekly.ts:127-140`) and the modal renders a plain string (`WeeklyReportModal.tsx:111-116`). Every store action needed to act on it already exists.
- **Prior-doc status:** plan2 Phase 3.2's "suggested adjustment" shipped as text — partial.
- **Impact:** The report diagnoses, then makes the player navigate away and remember — each added step sheds follow-through.
- **Recommendation:** Carry `{habitId, action}` into `WeeklyReport`; render one action button wired to the existing store action.

### [HABIT-15] recovery_elixir is purchasable but inert (P2, confidence: high)
- **Area:** src/content/items.ts, src/engine/items.ts
- **Observation:** `recovery_elixir` sells for 70g with `effect: { recovery: true }` (`items.ts:77-85`); the `recovery?: boolean` field (`engine/items.ts:19`) has zero consumers repo-wide (grep verified). No broken-streak penalty exists for it to clear; the engine's actual recovery mechanic (1.1× comeback bonus) applies automatically regardless of ownership.
- **Prior-doc status:** confirms HTA §12 ("likely unintentional behavior") — one of the few June findings still live.
- **Impact:** Players pay real gold for nothing — a trust-eroding dead purchase sitting in the shop.
- **Recommendation:** Either wire it (e.g. consume to retroactively repair one missed day — natural pairing with HABIT-02's redesign) or remove it from the shop until it does something.

### [HABIT-16] Uncompleting a completion made at MAX_ENERGY deducts energy that was never granted (P3, confidence: high)
- **Area:** src/store/slices/habitsSlice.ts
- **Observation:** `completeHabit` clamps energy to `MAX_ENERGY = 50` after the +1 (`habitsSlice.ts:226`, `shared.ts:1112`), discarding the grant at cap; `uncompleteHabit` still deducts 1 whenever `energy > 0` (`:279`). Verified by hand.
- **Prior-doc status:** not covered (the clamp and refund both post-date HTA).
- **Impact:** Mildly punishes players at the cap — inverse of HABIT-04, same root cause: the grant isn't recorded, so the refund guesses.
- **Recommendation:** Same fix as HABIT-04 — a per-completion "energy granted" marker makes both edges exact.

### [HABIT-17] Cached streak is displayed after it's stale; the honest 0 only appears at the moment of re-logging (P3, confidence: high)
- **Area:** src/engine/dashboard.ts, src/components/habits/HabitCard.tsx
- **Observation:** `topStreaks` and HabitCard render cached `habit.streak` (`dashboard.ts:143-147`, `HabitCard.tsx:145-148`) while `atRiskHabits` recomputes live (`dashboard.ts:153`). After a missed day, the chip advertises a dead streak until the next log snaps it to 1.
- **Prior-doc status:** not covered by prior docs; display-side companion to HABIT-02.
- **Impact:** The 30→1 snap lands at the exact moment of logging — the reward moment reads as punishment.
- **Recommendation:** Display `currentStreak(h, today)` everywhere (already computed per-render for at-risk); keep the cache for persistence only.

### [HABIT-18] WelcomeCard sets two false expectations for the first session (P3, confidence: high)
- **Area:** src/components/onboarding/WelcomeCard.tsx
- **Observation:** It tells new users to "delve dungeons" — locked until level 3 (`progression.ts:20`, `DungeonView.tsx:127`) — and never mentions Skill Trials, the cheapest content; and promises "Enough XP summons a Level-Up Trial" though levels 2–4 auto-advance (`BOSS_GATE_LEVEL = 5`, `progression.ts:18`).
- **Prior-doc status:** not covered by prior docs.
- **Impact:** The only loop-teaching artifact points at locked content and promises an event days away, eroding tutorial trust.
- **Recommendation:** Reword: "mine ore, hunt the forest, or take a Skill Trial"; "At Level 5, a Trial boss appears."

### [HABIT-19] Creation's primary CTA is disabled with no stated reason (P3, confidence: high)
- **Area:** src/views/CreationView.tsx
- **Observation:** "Begin Adventure" is `disabled={!weaponKey || !spellKey}` (`CreationView.tsx:258`); neither has a pre-selection (`:34-35`) and no helper text explains the dead button (the only hint covers unspent stat points, `:262-266`).
- **Prior-doc status:** not covered by prior docs.
- **Impact:** A user who names their hero meets an unclickable button; the escape hatch (quick start) is the least visible element on the page.
- **Recommendation:** When disabled, render "Choose a weapon and spell to begin" under the button.

### [HABIT-20] Nothing prevents seeding 20 habits (10 dailies) at creation (P3, confidence: high)
- **Area:** src/views/CreationView.tsx, src/content/habitTemplates.ts
- **Observation:** All template groups toggle freely and seed on begin (`CreationView.tsx:52-66`); selecting everything creates 20 habits, 10 daily. The ≥12-daily load warning (`selectors.ts:108-114`) only fires after the fact.
- **Prior-doc status:** not covered by prior docs.
- **Impact:** Classic day-3 abandonment setup for enthusiastic new users; recovery mode mitigates downstream, nothing prevents it upstream.
- **Recommendation:** Soft warning when > 2 groups selected ("Starting small works best — you can add more anytime").

### [HABIT-21] "Allow unlimited — no XP cap" label is wrong; a 10× cap exists and neither cap is taught (P3, confidence: high)
- **Area:** src/components/habits/HabitForm.tsx
- **Observation:** The uncapped checkbox says "no XP cap" (`HabitForm.tsx:319-322`) but `UNCAPPED_RATIO_CAP = 10` clamps it (`xp.ts:22,36-40`); the reward preview doesn't change when toggled and never mentions the default 150% cap.
- **Prior-doc status:** the cap itself is the fix for HTA §11's exploit; the label predates the fix.
- **Impact:** Checkbox describes a rule the engine doesn't have — minor trust/comprehension cost.
- **Recommendation:** Relabel: "XP scales with amount, up to 10× target (normally capped at 150%)."

### [HABIT-22] Two recommended-action branches are effectively dead; the day's natural closure ritual never renders (P3, confidence: high)
- **Area:** src/engine/dashboard.ts
- **Observation:** `load_warning` (`dashboard.ts:242-247`) requires `completedToday > 0` AND energy < 1, but every completion grants +1 energy — near-unreachable, and redundant with the dashboard warnings panel. `all_done` (`:250-255`) is preempted by `energy_ready` (`:234-239`) whenever energy ≥ 1, i.e. almost always after finishing.
- **Prior-doc status:** not covered by prior docs.
- **Impact:** The "well done, hero!" day-closure acknowledgment — a cheap daily reward — is replaced by an upsell to spend energy.
- **Recommendation:** When `pendingToday === 0`, show `all_done` with the energy hint appended; delete `load_warning`.

### [HABIT-23] Weekly challenge rotation is disconnected from the weekly planning ritual (P3, confidence: high)
- **Area:** src/engine/weekly.ts, src/views/ChallengesView.tsx
- **Observation:** `weeklyRotation` (`weekly.ts:172-212`) renders as "This Week's Trials" in ChallengesView requiring manual `startChallenge` (`ChallengesView.tsx:71,151-155`); neither PlanWeekModal nor WeeklyReportModal mentions it. Challenges remain the only item/gear source from pure habit activity (verified: `completeHabit` grants xp/gold/energy only; custom challenges mint only gold/statXp).
- **Prior-doc status:** confirms HTA §6's "challenges are the habit→items bridge"; the disconnection from planning is new.
- **Impact:** The bridge must be discovered on a separate tab in a separate session from the moment the player is already planning their week.
- **Recommendation:** List the rotation inside PlanWeekModal with one-tap Accept (calls existing `startChallenge`).

### [HABIT-24] The player-motivating slice of the Balance Report is hidden in the Developer panel (P3, confidence: high)
- **Area:** src/engine/balance.ts, src/components/balance/BalanceReportModal.tsx
- **Observation:** `habitXpShare` and energy summaries are computed purely (`balance.ts:108-187`) but surface only via Settings → Developer (`SettingsView.tsx:329-339`).
- **Prior-doc status:** plan2 Phase 4.1 built it dev-only by design; this recommends promoting one slice.
- **Impact:** "Your real-life effort powered X% of your hero" is an identity-affirming stat hidden from the person it would motivate.
- **Recommendation:** Two tiles in WeeklyReportModal (habit-XP share, week energy net); keep per-source tables dev-only.

## Needs manual check

- **Owner's reminder setting:** interview implies `dailyReminderEnabled` is off/unknown on his real save — worth simply telling him it exists (Settings → daily reminder) and asking whether the foreground-only behavior ever fires for him. (confidence: low)
- **Notification constructor on Chrome-for-Android:** the page-context `new Notification` throw is documented platform behavior, asserted from docs, not exercised here. (confidence: medium)
- **Mobile fold position:** whether HeroBanner + warnings + chips push the habit list below the fold on a phone (DashboardView stack `:101-152`) — layout math only, needs a device check. (confidence: low)
- **Adventure ritual feel:** whether `AdventureRitualModal` (one extra click on every minigame entry) reads as celebration or friction in practice — playtest question. (confidence: low)
- **Quick-start discoverability:** whether new users scroll far enough to find the quick-start link before abandoning creation. (confidence: low)
- **Forest per-hit SFX absence (carried from section 01, ARCH-15):** ask during a playtest whether Forest's silent combat is a deliberate soundscape choice. (confidence: low)
