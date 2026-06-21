# HabitsRPG: Habit-Tracking System Analysis

> **Purpose:** A factual, evidence-based evaluation of HabitsRPG as an actual habit tracker — not as a game. Every non-obvious claim cites the source file and line. Items that are unclear from the code are explicitly labeled as such. This document is intended as a reliable foundation for a habit-tracking improvement plan.
>
> **Branch at time of analysis:** `feature/multiplayer`
> **Analysis date:** 2026-06-20

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Map of Habit Tracking](#2-architecture-map-of-habit-tracking)
3. [Habit Creation, Editing, Tracking, and Completion](#3-habit-creation-editing-tracking-and-completion)
4. [Habit Types Supported](#4-habit-types-supported)
5. [Data Storage, Loading, Updating, Display, and User Binding](#5-data-storage-loading-updating-display-and-user-binding)
6. [How Habits Connect to XP, Stats, Leveling, Items, Parties, and Progression](#6-how-habits-connect-to-xp-stats-leveling-items-parties-and-progression)
7. [Reward Balance: Habits vs. Minigames](#7-reward-balance-habits-vs-minigames)
8. [Multiplayer and Party Features](#8-multiplayer-and-party-features)
9. [Habit Feedback Over Time](#9-habit-feedback-over-time)
10. [The RPG Layer: Motivating or Obscuring?](#10-the-rpg-layer-motivating-or-obscuring)
11. [Weak Points, Loopholes, Confusing UX, and Exploits](#11-weak-points-loopholes-confusing-ux-and-exploits)
12. [Bugs, Incomplete Systems, and Technical Debt](#12-bugs-incomplete-systems-and-technical-debt)
13. [Priorities for an Improvement Plan](#13-priorities-for-an-improvement-plan)
14. [Appendix: File, Function, and Data-Model Index](#14-appendix-file-function-and-data-model-index)

---

## 1. Executive Summary

HabitsRPG is a more capable habit tracker than its RPG presentation suggests. It has a genuinely rich habit data model, five frequency types, streaks, quantity-based goals, a powerful challenge system, meaningful habit history with heatmaps and weekly recaps, and a real networked multiplayer backend (Supabase). The habit engine is well-architected: pure functions, comprehensive tests, and clean separation from game logic.

However, several significant issues undermine its effectiveness as a habit tracker:

**Balance:** Energy — the intended link between habit-completing and minigame-playing — is bypassed by Skill Trials, which cost zero energy and are freely available every day. A user who never logs a single habit can level up, earn gold, and accumulate stat points through Trials alone. Habits produce no gold, no items, and no gear — only XP and energy. Minigames produce all three plus XP on top.

**Missing feature:** There is no habit-edit UI. `updateHabit` exists in the store but has zero call sites. Once a habit is created, its name, stat, type, frequency, difficulty, and target cannot be changed — only suspend, reactivate, retire, or delete.

**Bugs:** The Streak Freeze item is effectively broken — it only updates a convenience cache field, not the `log` that drives streak computation (`economySlice.ts:63-65`). Uncompleting a habit today does not reverse the +1 energy awarded on completion (`habitsSlice.ts:153-191`). The SQL `server_now()` function exists to prevent device-clock manipulation but is never called from the client, so daily and weekly gating trusts the device clock.

**Backdating exploit:** Users can log completions for any past day back to the habit's creation date, granting full XP and challenge progress (though not energy). There is no limit on how many habits a user can create, making large-scale backdating feasible.

**RPG theming vs. clarity:** The RPG layer is genuinely attractive but occasionally obscures habit-tracking affordances — the history view ("Chronicle") is reachable only via a small icon button; challenges and party features are on separate tabs with no dashboard link; there is no XP-earned feedback on binary completions.

Overall: the tracker has solid bones. The reward balance, the missing edit UI, the streak-freeze bug, and the backdating loophole are the most important things to fix before the habit-tracking experience can be considered reliable and fair.

---

## 2. Architecture Map of Habit Tracking

The codebase follows a strict layer separation. Here is what is involved specifically in habit tracking:

### Engine (pure functions, no React/store imports)

| File | What it does for habits |
|---|---|
| `src/engine/habits.ts` | Habit data model, scheduling logic, streak computation, `resolveCompletion` |
| `src/engine/xp.ts` | XP formula: base by difficulty, quantity ratio, recovery bonus, completion cap |
| `src/engine/stats.ts` | The 8 stat definitions (DX, AG, ST, EN, WI, CH, KN, HP) habits map to |
| `src/engine/date.ts` | `now()` / `toISODate()` — the local-date seam; `_setNow` for tests |
| `src/engine/tracking.ts` | Derived analytics: heatmap cells, per-habit stats, quantity chart series |
| `src/engine/challenges.ts` | Six challenge kinds computed over habit logs |
| `src/engine/weekly.ts` | Weekly recap data, challenge rotation, rival goals |
| `src/engine/gear.ts` | `gearXpMultiplier` — gear can amplify habit XP |

### Store (Zustand + localStorage persistence)

| File | What it does for habits |
|---|---|
| `src/store/slices/habitsSlice.ts` | All habit CRUD + `completeHabit` / `uncompleteHabit` actions |
| `src/store/slices/challengesSlice.ts` | `checkWeeklyRollover`, challenge management |
| `src/store/slices/economySlice.ts` | `useStreakFreeze`, `buyItem` (items affect habits) |
| `src/store/slices/trialsSlice.ts` | Daily Skill Trials (habit-adjacent; same XP ledger) |
| `src/store/shared.ts` | `GameState` / `Character` types, reward policy constants, `checkLevelUp`, `recomputeMood`, `applyWeeklyRollover` |
| `src/store/useGameStore.ts` | Zustand persist config, migration v22, merge logic |
| `src/store/selectors.ts` | `makeSelectDashboardHabits`, history selectors |

### Views and Components

| File | Role |
|---|---|
| `src/views/DashboardView.tsx` | "Quest Log · Today" — main habit list + date picker + history button |
| `src/views/HistoryView.tsx` | "Chronicle" — full habit history overlay |
| `src/views/ChallengesView.tsx` | Challenge browsing, creation, claiming |
| `src/components/habits/HabitForm.tsx` | New-habit creation form |
| `src/components/habits/HabitCard.tsx` | Single habit row: completion button, streak, kebab menu |
| `src/components/habits/CompleteHabitDialog.tsx` | Quantity-habit completion dialog with XP preview |
| `src/components/habits/SuspendDialog.tsx` | Pick a resume date for a suspended habit |
| `src/components/habits/DatePicker.tsx` | Back-dating calendar (min = earliest `createdISO`, max = today) |
| `src/components/history/HabitHistoryCard.tsx` | Per-habit analytics card in Chronicle |
| `src/components/history/Heatmap.tsx` | GitHub-style 26-week completion grid |
| `src/components/history/HabitChart.tsx` | Bar chart for quantity habits (week/month/year) |
| `src/components/challenges/ChallengeBuilder.tsx` | Custom challenge creation UI |
| `src/components/weekly/WeeklyReportModal.tsx` | Auto-shown weekly recap modal |

### Multiplayer / Network

| File | Role |
|---|---|
| `src/net/party.ts` | Party CRUD, quests, leaderboard, messages (Supabase RPCs) |
| `src/net/supabaseClient.ts` | Optional Supabase client (feature-flagged by env vars) |
| `src/hooks/useParty.ts` | Party store, Realtime presence/chat/quests, `usePartyQuestReporter` |
| `supabase/migrations/0001–0005_*.sql` | Database schema: accounts, saves, parties, co-op sessions |

### Tests

| File | Coverage |
|---|---|
| `src/engine/__tests__/habits.test.ts` | Core habit scheduling, streak, completion logic |
| `src/engine/__tests__/tracking.test.ts` | Heatmap, habitStats derivations |
| `src/engine/__tests__/challenges.test.ts` | Challenge kinds and progress |
| `src/engine/__tests__/weekly.test.ts` | Weekly recap, rollover |
| `src/store/__tests__/store.integration.test.ts` | Full store action integration tests |
| `src/store/__tests__/resetBoundary.test.ts` | Day-boundary reset behavior |

---

## 3. Habit Creation, Editing, Tracking, and Completion

### Creation

The entry point is `src/views/DashboardView.tsx`, which shows a "+ Habit" button that opens `src/components/habits/HabitForm.tsx`. The form collects:

- **Name** (free text)
- **Stat** (select from all 8: DX, AG, ST, EN, WI, CH, KN, HP)
- **Tag** (optional free text)
- **Type**: "Yes-No" (binary) or "Quantity"
- **Target, unit, uncapped** (quantity only — e.g. "20 pages", "5 km", with optional "uncapped" flag for linear scaling)
- **Frequency**: Daily, Weekdays, Custom Days, X per Week, or As Needed
- **Custom days** picker (Sunday through Saturday, shown when frequency = Custom)
- **Times per week** (numeric input, shown when frequency = X per Week)
- **Difficulty**: Easy (10 XP), Normal (20 XP), Hard (35 XP), Epic (50 XP) — the XP value is shown in the UI

On submit, `addHabit(input)` is called (`habitsSlice.ts:44`), which creates the habit with `{ status: 'active', streak: 0, log: {}, createdISO: toISODate(), ...input }` and a generated `uid()`.

The form's submit button is labeled **"Inscribe Habit"** — the RPG theming is present even in this creation flow.

### Editing

**There is no habit-edit UI.** The store action `updateHabit(id, patch)` is defined at `habitsSlice.ts:59` and declared in `shared.ts:253`, but a search across all of `src/` finds **zero call sites**. `HabitForm.tsx` only ever calls `addHabit` and has no pre-fill/edit mode.

After creation, a habit's name, stat, type, frequency, difficulty, target, and unit **cannot be changed**. The only post-creation controls are in the kebab menu on `HabitCard.tsx`: Suspend, Reactivate, Retire, and Delete.

This is the single biggest missing feature in the habit UX.

### Tracking / Completion

**Binary habits:** A wax-seal button on `HabitCard.tsx` (`onSeal`, lines 40–48). One click logs the habit as complete for the viewed day. Hovering over a completed habit shows an undo icon; clicking again calls `uncompleteHabit`.

**Quantity habits:** The same button opens `CompleteHabitDialog.tsx`, which shows a numeric input pre-filled with `habit.target`. An XP preview is displayed as the user types. "Log Completion" submits via `completeHabit(id, actual, viewDate)`.

**Back-dating:** The Dashboard has a `DatePicker` above the habit list (min = earliest habit's `createdISO`, max = today). Changing the date shows only that day's scheduled habits. Any past day can be logged. Back-dated completions grant XP and challenge progress but **not energy, mood, or weekly-rollover** side effects (guarded at `habitsSlice.ts:143`: `if (isToday)`).

### Per-day guard

`completeHabit` at line 109 checks `if (habit.log[day] !== undefined) return s`. This hard-blocks completing the same habit twice on the same calendar day. It cannot be bypassed from the UI — only via a different date. The same guard applies to back-dated days, so you can't log the same past day twice either.

### `completeHabit` full sequence (`habitsSlice.ts:102-151`)

1. Guard: habit exists; `log[day]` empty; `effectiveStatus(habit, day) === 'active'`.
2. Call `resolveCompletion(habit, day, { actual })` → `{ xp, recovery }`.
3. Multiply XP by `gearXpMultiplier(gearFor(s), habit)` (equipped gear may boost it).
4. Write `log[day] = { amount: actual, xp }`; update `lastCompletedISO`; recompute cached `streak = currentStreak(updated, today)`.
5. Add XP to `character.statXp[habit.stat]`; increment `completionLog[day]`.
6. Recompute progress for all active challenges.
7. **If `isToday` only:** `energy += 1`, set `lastActiveISO`, `recomputeMood`, `applyWeeklyRollover`.
8. `checkLevelUp(next)`.

### `uncompleteHabit` (`habitsSlice.ts:153-191`)

Deletes `log[day]`, recomputes `lastCompletedISO` and `streak`, subtracts the stored XP (floored at 0), decrements `completionLog`. **Does not reverse the +1 energy or mood** — this is an asymmetry (see §12).

---

## 4. Habit Types Supported

### Binary (Yes/No)

The simplest form. One tap = done. Base XP by difficulty, no partial credit.

### Quantity

User logs a numeric amount (e.g., "30 minutes", "5 km"). XP scales by `actual/target`, capped at 150% (`COMPLETION_CAP = 1.5`, `xp.ts:14`) by default. The `uncapped` flag removes this ceiling, allowing XP to scale linearly with no limit (intended for habits like "miles run"; however, this is an unbounded XP source — see §11).

`CompleteHabitDialog.tsx` pre-fills the input with the target value, so one-tap logging without adjustment always claims exactly 100% XP. For quantity habits in the history view, a bar chart shows logged amounts over time.

### Frequencies

| Frequency | Behavior |
|---|---|
| `daily` | Scheduled every day; appears red in heatmap when missed |
| `weekdays` | Scheduled Monday–Friday; missed Sat/Sun doesn't break streak |
| `custom` | Scheduled on user-chosen days of the week |
| `times_per_week` | X completions per calendar week; not "scheduled" on specific days; streak = consecutive weeks meeting the target |
| `as_needed` | Loggable any day; never "missed" or red; streak always 0 |

`isScheduledOn` (`habits.ts:51`): only `daily`, `weekdays`, `custom` have "scheduled" semantics that create a missed-day penalty. `times_per_week` and `as_needed` are purely count-based.

### Streaks

`currentStreak` (`habits.ts:109`):

- `as_needed` → always 0 (no streak concept).
- `times_per_week` → consecutive calendar weeks (backward from last complete week) where completions ≥ `timesPerWeek`. Partial current week does not count until the week ends.
- `daily`/`weekdays`/`custom` → walks backward over scheduled days; stops at the first scheduled-but-uncompleted day. If today is scheduled and uncompleted, the streak stops at yesterday.

Streak is **cached** in `habit.streak` and recomputed on every `completeHabit` and `uncompleteHabit` call. The displayed value is the cached one.

### Recovery Bonus

When a scheduled habit is missed on day D and logged on day D+1 (the next scheduled day), `resolveCompletion` in `habits.ts` sets the `recovery` flag, triggering a `+10%` XP multiplier (`RECOVERY_BONUS = 1.1`, `xp.ts:18`). This is tracked purely by log examination — no separate field. There is a "recovery" challenge kind (`challenges.ts`) that counts these as special events.

### Difficulty

Four levels with direct XP consequences:

| Difficulty | Base XP |
|---|---|
| Easy | 10 |
| Normal | 20 |
| Hard | 35 |
| Epic | 50 |

Set at creation, cannot be changed afterward (edit-habit UI is missing). The XP value is shown in the creation form.

### Challenges

Six challenge kinds defined in `src/engine/challenges.ts`:

| Kind | Description |
|---|---|
| `count` | Complete any/specified habit N times within the window |
| `quantity` | Log a total of N units on a quantity habit |
| `streak` | Maintain a streak of N days/weeks |
| `recovery` | Complete a habit the day after missing it N times |
| `class` | Complete habits of a specific stat category N times |
| `rival` | Beat last week's completion count (frozen as `rivalGoal` at challenge start) |

Challenge progress is **recomputed from `habit.log`** on every `completeHabit` and `uncompleteHabit` — not incrementally tracked. This keeps it correct even when habits are completed out of order or un-completed.

Templates are predefined in `CHALLENGE_TEMPLATES` (`challenges.ts:60-124`). A weekly rotation (`engine/weekly.ts weeklyRotation`) presents new challenges automatically. Custom challenges can be authored in `ChallengeBuilder.tsx` with `createCustomChallenge`; rewards are auto-balanced via `suggestReward` (`challenges.ts:257`).

Rewards can include gold, statXp, items, materials, weapons, and gear — making challenges the **only way to earn items/gold from habit activity**. Completing habits alone never yields gold or items.

### Status Lifecycle

`active → suspended (until date) → active` (auto-resumed by `normalizeHabits` on app boot)
`active → retired` (permanently inactive but preserved in history)
`active → deleted` (removed from state entirely, history lost)

Suspended habits appear in the Dashboard but cannot be logged. A `suspendUntilISO` field enables time-limited suspension with automatic return to `active`.

---

## 5. Data Storage, Loading, Updating, Display, and User Binding

### Storage

All state lives in a single Zustand store persisted to `localStorage` with key `'habits-rpg-save'`, current **version 22** (`useGameStore.ts`). The entire `GameState` object — habits (with full `log`), character, inventory, challenges, settings, etc. — is serialized to one JSON blob.

The `habit.log` field is the **source of truth** for all completion history. Its type is `Record<ISO-date-string, HabitEntry>`, where `HabitEntry = { amount?: number; xp: number }`. Presence of a date key means the habit was completed on that day.

### Loading and Migration

On load, the persist middleware runs `migrate(persistedState, version)` (`useGameStore.ts:111`). The migrate function:

- Backfills missing `log: {}` and `status: 'active'` for habits from old versions (line 114).
- If a habit has `lastCompletedISO` but no corresponding log entry, injects `log[date] = { xp: 0 }` (line 115–117) — this handles data from before the log field existed.
- Remaps old material names.
- Derives `statLevels` if missing.
- Clears transient run states.

The `merge` function (`useGameStore.ts:143`) deep-merges `character` (via `withCharacterDefaults`), `settings`, `trialsClearedOn`, and `bestTrialScore` from an in-memory snapshot vs. persisted data. This handles the case where the app is open in multiple tabs and the localStorage snapshot is stale relative to in-memory state.

### Updating

All writes go through the Zustand `set` function inside the slice actions. There is no separate mutation layer; every action returns a new `GameState` object.

### Display

Habits are rendered in `DashboardView.tsx` via `makeSelectDashboardHabits(iso)` from `selectors.ts`. This selector:

- Accepts the viewed ISO date.
- Returns habits grouped as: **pending** (active, scheduled or loggable on that day, not yet completed) → **completed** (logged that day) → **suspended** (suspended status).
- Retired habits are excluded from the dashboard.
- Suspended habits appear with a "resumes {date}" badge and cannot be interacted with.

The dash groups are labeled "Completed (n)" and "Suspended (n)" — collapsed by default when non-empty.

### User Binding

**Single-player (no backend configured):** All data is localStorage only. There is no user account; the save belongs to the device/browser.

**Multiplayer (Supabase configured):** `src/net/supabaseClient.ts` creates a `SupabaseClient` when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present. Cloud saves go to a `saves` table keyed by authenticated user ID (`src/net/cloudSave.ts`). The game state blob is synced per-account. Party membership ties the save to a specific user profile.

The `usePartyQuestReporter` hook (`hooks/useParty.ts:208`) listens to the Zustand store and fires `incrementPartyQuest(partyId, delta)` on every habit completion, computing the delta as `totalCompletions()` (sum of `completionLog`). This is the only network write that habit completion triggers.

---

## 6. How Habits Connect to XP, Stats, Leveling, Items, Parties, and Progression

### XP

Each habit completion grants XP to exactly one stat (`character.statXp[habit.stat] += xp`). The amount is determined by:

```
xp = round(BASE_XP[difficulty] × ratio × recoveryMultiplier × gearMultiplier)
```

Where:
- `BASE_XP` = 10 / 20 / 35 / 50 by difficulty (`xp.ts:7`)
- `ratio` = 1.0 for binary; `actual/target` capped at 1.5 for quantity (or uncapped if flagged) (`xp.ts:29`)
- `recoveryMultiplier` = 1.1 if completing the day after a miss; 1.0 otherwise (`xp.ts:18`)
- `gearMultiplier` = from equipped gear; `gearXpMultiplier(gearFor(s), habit)` in `gear.ts`

### Stats and Leveling

`statXp` is an **effort ledger** (not a combat value). Character level is derived from its sum:

- `totalXp = sum(character.statXp)` (`shared.ts:491`)
- `xpForNextLevel(level) = round(100 × level^1.5)` (`leveling.ts:11`)

Level thresholds: 1→100 XP, 2→283, 3→520, 4→800, 5→1118, 10→3162.

On level-up, `allocateStatGains` (`progression.ts:83`) distributes **3 stat points** per level. Point distribution is weighted by recent per-stat XP effort, so logging habits tagged to WI trains Wisdom for combat. Class membership (if any) adds a nudge toward class-favored stats. Each stat is capped at 25 (`STAT_CAP`); max level is 50 (`MAX_LEVEL`).

Levels 1–4 advance automatically. Level 5+ queues a `pendingLevelUp` that requires winning a boss battle (`BOSS_GATE_LEVEL = 5`, `shared.ts:719`). This is the only content gate tied to character progression — it is tied to dungeon combat skill, not to habit completion count or consistency.

### Items and Gold

Habits **never** produce gold or items. The only rewards from `completeHabit` are:
- `character.statXp[habit.stat] += xp`
- `character.energy += 1` (today only)

All gold, items, gear, weapons, and crafting materials come from: minigame runs (mining, forest, dungeon, arena, tactics), Skill Trials (gold only), and challenge rewards. This is a core asymmetry: you can level up through habits, but you cannot buy anything, craft anything, or equip anything without also playing minigames.

The exception is challenge rewards — completing a challenge triggered by habit activity can grant items, gold, or gear (`Reward` type in `challenges.ts:9-18`). But challenges are time-windowed and not guaranteed daily income.

### Parties

The connection between habits and parties runs through two mechanisms:

1. **Party Quest:** `usePartyQuestReporter` fires an RPC to increment the shared party quest counter on every habit completion. The quest shows a shared progress bar that all members can see in real time. Party quests currently grant **no in-game reward** (gold is hardcoded to 0 in `PartyQuestPanel.tsx`).

2. **Leaderboard:** The leaderboard (`getLeaderboard` in `party.ts`) ranks party members by `total_xp` from their `public_snapshot`, which reflects habit-driven `statXp`. More habit completions = higher rank.

Party presence and chat (via Supabase Realtime) provide social accountability. `deriveActivity()` in `useParty.ts` derives a status label ("In the Mine", etc.) visible to party members, though it does not distinguish habit activity from minigame activity.

---

## 7. Reward Balance: Habits vs. Minigames

### Habit XP per day

The maximum XP from habits on a typical day depends on:
- How many active habits are scheduled that day
- Their difficulty settings

A typical daily setup might have 6–8 habits. At "normal" difficulty:
- 8 habits × 20 XP = **160 XP/day from habits**

A power user with epic habits and gear multipliers might reach 400 XP/day — but only from real daily behavior.

### Minigame XP per day

**Skill Trials** (one per stat, 8 total, from `engine/trials/trials.ts`):

- Cost: **0 energy** — completely free
- `trialReward(stat, score01, level)` (`trials.ts:124`):
  - `statXp = round((20 + 8×level) × (0.25 + 0.75×score01))`
  - `gold = round((15 + 5×level) × (0.25 + 0.75×score01))`
- At level 5, perfect score: **60 XP + 40 gold** per trial
- At level 5, zero score: **15 XP + 10 gold** (25% floor — you cannot fail entirely)
- 8 trials × 60 XP = **480 XP/day** from trials alone at level 5, scaling further with level
- Gated once per day per trial via `trialsClearedOn` in `trialsSlice.ts:28-50` (bypassable with `repeatMinigames` dev setting)

This means Skill Trials alone, at level 5, yield **3× the XP of a strong habit day**, plus gold that habits cannot produce.

**Energy-gated minigames** (mine, forest, dungeon, arena, tactics):

- Costs: mine 2, forest 2, dungeon 3, arena 3, tactics 3 energy (`mining.ts:83`, `forest.ts:83`, `dungeon.ts:11`, `arena.ts:40`, `hexBattle.ts:31`)
- XP trickle (mine example at `shared.ts:965`): `trickle = CRAWLER_XP_BASE + CRAWLER_XP_PER_DEPTH × run.deepest = 4 + 3 × depth`
- **Important:** The trickle is granted to *each* of two stats simultaneously (`{ ST: trickle, EN: trickle }` at `shared.ts:967`), so the total stat XP is 2× the nominal trickle. At depth 5: (4+15) × 2 = **38 total XP** per mine run. Forest (DX+EN) works the same; tactics spreads across three stats (AG+DX+EN), tripling the value.
- **Whether this doubling/tripling is intentional is unclear.** The constant is named "trickle" and the surrounding comment says "a modest trickle" — suggesting the intention may be to give a small bonus per run, not a double/triple dose. This needs confirmation from the author.
- Plus gold, materials, and items per run.

### The energy throttle (and its bypass)

The intended design is: habits generate energy → energy gates minigame access → habits therefore must be logged to access the full game. This creates a meaningful dependency.

The throttle works for energy-gated minigames. But it is bypassed by:

1. **Skill Trials cost zero energy.** A player who never logs a habit can run all 8 Skill Trials every day and level up at a rate of 480+ XP/day, earning gold on every trial. This is the clearest habit-free progression path.

2. **`unlimitedEnergy` dev flag** (`settings.ts`, toggled in `SettingsView.tsx:156`). When on, all energy cost checks are skipped. This is documented as a dev setting, but it is exposed in the production settings UI.

### Can a user progress primarily through minigames without logging habits?

**Yes, substantially so.** Specifically:

- **Leveling:** Skill Trials drive `statXp` into the same ledger as habits. A no-habit player levels up faster through Trials than through careful daily habit tracking.
- **Stats:** Stat points come on level-up regardless of XP source. Trial XP is earmarked to the trial's specific stat, which can be just as targeted as habit XP.
- **Gold and items:** Only available through minigames. A habits-only player earns zero gold and zero items.
- **Energy-gated content:** Requires energy from habits — but 5–6 habits/day at energy cost 2–3 per run still gives only 2–3 minigame entries/day; a player focused on this can sustain it.

**What habits give that minigames do not:**
- The only in-game mechanics that require habits are the energy supply (for non-trial minigames) and the challenge system (which computes progress from `habit.log`). Without habits, party-quest contribution is also zero.
- Habit streaks, challenge completions, and weekly recap content require genuine habit logs.

**Assessment:** The game's habit incentive structure is weaker than it appears. Minigames are more rewarding per unit of time than habits, produce the exclusive item/gold economy, and (through Trials) are accessible without habits at all. The energy link is real but partially bypassed.

### Daily caps

- **Habit XP:** No daily cap. The only per-completion limit is the 150% quantity ratio cap. A habit cannot be completed twice in one day (`habitsSlice.ts:109`).
- **Minigame XP:** Trials are limited to once per day per trial (8 total); energy-gated minigames have no daily count limit beyond available energy.

---

## 8. Multiplayer and Party Features

### Backend reality

Multiplayer is real and networked — not mocked or simulated. It uses Supabase (Postgres + Auth + Realtime) and is feature-flagged: the Supabase client is only created when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are present in the environment (`supabaseClient.ts`). Without them, the app runs as a pure single-player local app.

The schema lives in `supabase/migrations/` across five SQL files:

- `0001_phase1_auth_saves.sql` — accounts, saves, `server_now()` function
- `0002_phase2_parties.sql` — parties, members, messages, quests, leaderboard view, RPCs
- `0003_phase3_coop_sessions.sql` — co-op lobby + shared seed
- `0004_coop_tactics.sql` — tactics game type constraint
- `0005_tactics_leaderboard.sql` — adds tactics to leaderboard tracking

### Party structure

One party per user (enforced by `getMyParty` using `.maybeSingle()`). Party actions (create, join, leave, kick, rename) use `SECURITY DEFINER` RPCs. `PartyView.tsx` is the main UI: roster with presence dots, invite code copy, `CoopRaidPanel`, `PartyQuestPanel`, `PartyChat`, and `Leaderboard`.

### How parties connect to habit accountability

**What works:**
- **Party quest:** Every habit completion triggers `usePartyQuestReporter` which increments a shared server-side counter via `incrementPartyQuest` RPC. Members can see a real-time progress bar. This is a genuine shared-accountability mechanism: the party knows when someone is completing habits.
- **Leaderboard:** Ranks members by total XP, which reflects cumulative habit and minigame activity. Higher habit consistency = higher XP = higher rank.
- **Presence and chat:** `deriveActivity()` shows what a member is currently doing (e.g. "In the Mine"). Party chat creates social space for encouragement and check-ins.

**What is weak or missing:**
- **Party quests grant no reward.** The `reward: { gold: 0 }` is hardcoded in `PartyQuestPanel.tsx`. There is no in-game incentive (beyond social recognition) to contribute to or complete a party quest. This significantly limits the motivational power of the feature.
- **No per-habit visibility.** Party members cannot see which specific habits another member is completing — only aggregate completion counts via the quest counter. There is no accountability at the habit level.
- **Leaderboard does not distinguish habits from minigames.** A member who games Skill Trials will outrank a member who carefully tracks daily habits. The leaderboard is a XP metric, not a habit-consistency metric.
- **No challenge co-op.** The single-player challenge system (with six kinds) does not have a party equivalent. Party quests are `count`-only and lack the richness of local challenges.
- **Fairness concern:** The XP leaderboard is manipulable. The trust model is client-side: the game saves are stored in `localStorage` and synced to Supabase. There is no server-side XP validation. `public_snapshot` on the leaderboard reflects whatever the client last saved. A user who edits localStorage can inflate their rank. This is documented as a known, accepted limitation in `docs/MULTIPLAYER_PLAN.md` ("trust the client"), but it means the leaderboard is not fair in a competitive sense.

### Co-op minigames

Three minigames support co-op play: Deep Mine, Wild Forest, and Hex Tactics (`CoopRaidPanel` in `PartyView.tsx`). They use a shared server seed for deterministic map generation and sync per-frame state via Realtime broadcast at `COOP_BROADCAST_HZ = 10` Hz (`src/net/coop/`). Arena explicitly does **not** have a co-op mode.

Co-op minigames are disconnected from the habit system — they run entirely in minigame state and do not interact with `habit.log` or `completionLog`.

---

## 9. Habit Feedback Over Time

The feedback system is one of the strongest aspects of the habit tracker. Multiple layers exist:

### History View ("Chronicle") — `src/views/HistoryView.tsx`

Opened via a small `BarChart3` icon in the Dashboard header (low discoverability — see §11). Lists all habits grouped active → suspended → retired, each as a `HabitHistoryCard`.

### Per-habit analytics — `src/components/history/HabitHistoryCard.tsx`

Each card shows:
- Habit name, stat, frequency
- **Heatmap** (26 weeks): GitHub-style color-coded grid via `engine/tracking.ts heatmapWeeks`. States: `green` (full success), `yellow` (partial), `red` (missed), `gray` (scheduled but past and no data), `none` (not scheduled that day).
- **Four stat tiles**: Total Days Completed, Best Streak (shown with flame icon), Success % (for scheduled habits), Total Points.
- **Quantity chart** (toggle "Show graph"): bar chart via `HabitChart.tsx`, range selector (Week / Month / Year).

### Weekly Recap — `src/components/weekly/WeeklyReportModal.tsx`

Auto-pops on the first visit of a new week. Driven by `engine/weekly.ts buildWeeklyReport`. Contains:
- Completions this week vs. last week
- XP earned, broken down by stat (bar chart)
- Top stat
- Best streak maintained
- Challenges won
- Mood rating for the week

This is habit-specific feedback, not just game stats.

### Mood and Load Warning

`recomputeMood` (`shared.ts:571`) computes a mood score from habit completions over the last 7 days vs. the number of scheduled-habit-days. Shown in the hero banner.

`selectHabitLoadWarning` warns when a user has ≥12 active daily habits — a signal that the habit list may be overloaded.

### Streak Display

Every `HabitCard` shows the cached `habit.streak` with a flame icon. For `times_per_week` habits, it instead shows `X / Y this week`.

### What is missing from feedback

- **No daily completion summary or streak count across all habits** (only per-habit).
- **No calendar view** of which days had any completions (the heatmap is per-habit, not a global calendar).
- **No long-term trend analysis** beyond the heatmap and best-streak number.
- **No notifications or reminders** — there is no push notification, browser notification, or reminder system for scheduled habits.
- **XP toast on binary completion** — completing a binary habit shows no immediate XP feedback; the XP preview only exists in the quantity dialog.
- **History view is under-surfaced** — the only entry point is the `BarChart3` icon button in the Dashboard header, which is easy to miss.

---

## 10. The RPG Layer: Motivating or Obscuring?

### Where RPG theming helps

- **Named difficulty levels and XP** make the stakes of a habit explicit at creation time. A user sees "Epic = 50 XP" and understands this habit matters more.
- **The wax-seal completion button** is tactile and satisfying — more distinctive than a plain checkbox.
- **Streak flame** is immediately evocative; a glowing flame on a long streak is more motivating than a plain number.
- **Weekly recap modal** uses RPG framing ("Top Stat of the Week") to make habit-review feel like a debrief rather than a chore.
- **Challenge system** gives habit variety and short-term goals that a plain tracker lacks entirely.
- **Energy dependency** (habits → energy → minigame access) creates a game-mechanical reason to care about habit completion even when intrinsic motivation is low.

### Where RPG theming obscures or competes

- **The main dashboard is titled "Quest Log · Today"** with RPG-themed language throughout. New users who don't immediately see it as a habit tracker may need time to understand what they're looking at.
- **"Inscribe Habit" and "Inscribe"** (form submit button) is thematic but non-standard; a new user may be confused by it.
- **History ("Chronicle")** is named and accessed as an RPG story log, obscuring that it's the analytics section. Discovery requires knowing to click the `BarChart3` icon.
- **`HeroBanner` sits above the habit list**, so the first thing users see is their character portrait, mood ring, and energy bar — game elements — before the habits they came to track.
- **Multiple RPG minigame tabs** (Dungeon, Mine, Forest, Arena, Hex) competing with the habit dashboard ("Quests") for attention. A user who came to track habits can easily spend most of their time in minigames.
- **No explicit "habit tracker" framing** on any screen. The dashboard title is "Quest Log," not "Habit Tracker" or "Daily Goals."

### Net assessment

The RPG layer is largely additive for users who understand the system, adding motivation and variety to what would otherwise be a plain list. However, the theming can obscure functionality (history discoverability, creation form language) and the depth of the minigame system can distract from habit engagement for users who find the games more immediately rewarding. For a habit tracker aimed at a broad audience, the balance currently tips slightly toward game-first.

---

## 11. Weak Points, Loopholes, Confusing UX, and Exploits

### Missing: Habit Edit UI

`updateHabit` (`habitsSlice.ts:59`) exists and is correct, but has zero call sites in `src/`. Habits cannot be edited after creation. A user who names a habit incorrectly, sets the wrong stat, picks the wrong difficulty, or misspells the unit must delete it and recreate it — losing all log history in the process.

**Impact:** High. This is likely the most-requested missing feature in any habit tracker.

### Loophole: Backdating

The `DatePicker` in `DashboardView.tsx` allows viewing and logging completions for any past day back to the earliest habit's `createdISO`. Back-dated completions:
- Grant full XP to `statXp`
- Count toward challenge progress
- Do not grant energy, mood, or weekly-rollover effects

A user could create a habit retroactively for a past date and then log the entire history of that habit on past days, accumulating large amounts of XP and challenge progress. There is no validation that a back-dated completion reflects real behavior. There is no server-side verification.

For a game focused on real-life habit tracking, unrestricted backdating undermines the core value proposition. The feature is useful for catching up on genuinely missed days, but as implemented, there is no limit.

### Loophole: Uncapped Quantity Habits

A quantity habit marked `uncapped: true` has no XP ceiling. The `completionRatio` function returns `actual / target` without a cap (`xp.ts:29-33`). Logging "10,000" against a target of "1" yields 10,000× the base XP. This is by design for the stated use case ("miles run → endurance per mile"), but it is a trivially exploitable XP farm — any user who understands the system can create an epic uncapped habit and log an arbitrarily large amount daily.

### Loophole: Skill Trials bypass energy gate

Skill Trials cost zero energy and run 8× per day. They grant `(20 + 8×level)` statXp per trial directly into the same leveling ledger as habits. This means a user who never logs a habit can level up steadily through Trials alone, earning gold along the way. The habit → energy → minigame dependency chain does not apply to Trials.

### Loophole: Device clock manipulation

All daily gating (`trialsClearedOn`, streak computation, weekly rollover, `isToday` check in `completeHabit`) relies on `engine/date.ts now()` which calls `new Date()` (device local time). The SQL function `server_now()` was created in `supabase/migrations/0001_phase1_auth_saves.sql` to provide a trusted server timestamp, but it is **never imported or called anywhere in `src/`** (verified by grep). A user who changes their device clock can re-complete trials, log habits on future dates, or manipulate streaks. This is a known issue documented in `docs/habits-rpg-game-analysis.md` (§19).

### Bug: Streak Freeze does not protect the streak

`useStreakFreeze` in `economySlice.ts:55-67`:

```ts
return {
  inventory: { ...s.inventory, streak_freeze: s.inventory['streak_freeze'] - 1 },
  habits: s.habits.map((h) =>
    h.id === habitId ? { ...h, lastCompletedISO: today } : h,
  ),
};
```

This consumes one Streak Freeze item and sets `lastCompletedISO = today`. However:
- It does **not** write a `log[today]` entry.
- It does **not** recompute `habit.streak`.
- `currentStreak` in `engine/habits.ts` walks the `log` map — it does not consult `lastCompletedISO`.

Result: `habit.streak` (the cached value shown in the UI) is unchanged after using a Streak Freeze, and will recompute to a broken streak on the next `completeHabit`/`uncompleteHabit` call. The item is consumed and has no meaningful effect. The integration test (`store.integration.test.ts:338-345`) only asserts that `lastCompletedISO` is updated and the item count decrements — it does not assert that the streak survives a missed day.

### Bug: `uncompleteHabit` does not reverse energy

When `completeHabit` runs with `isToday`, it awards `character.energy += 1` (`habitsSlice.ts:143`). `uncompleteHabit` subtracts XP and the completion count but does not decrement energy (`habitsSlice.ts:153-191`). Completing and un-completing a habit today permanently grants +1 energy.

**Impact:** Moderate. A determined user could loop complete/uncomplete across many habits to accumulate unlimited energy, which could then fund unlimited minigame runs. In practice, energy-gated minigames cost 2–3 energy per run, so this is somewhat self-limiting, but it is a real exploit.

### UX: No delete confirmation

The "Delete" option in `HabitCard.tsx`'s kebab menu calls `removeHabit(id)` immediately with no confirmation dialog. This permanently erases the habit and all its history. The lower-consequence actions (Suspend, Retire) have dialogs; the most destructive one does not.

### UX: Binary completions give no XP feedback

Completing a binary habit gives no immediate visible feedback about how much XP was earned. The character XP bar updates, but there is no toast, pop-up, or inline indicator on the card. The quantity dialog (`CompleteHabitDialog`) shows an XP preview before submitting, but binary habits do not. Users may not realize they earned any XP.

### UX: Quantity default logs target, not actuals

`CompleteHabitDialog.tsx:19` pre-fills `actual = habit.target`. A user who taps "Log Completion" without changing the value always logs exactly 100% of target, even if they did more or less. This makes it easy to over- or under-credit without thinking.

### UX: History is hard to find

The "Chronicle" (history/analytics) view is accessible only via the `BarChart3` icon button in the Dashboard header. There is no navigation item, no link in the habit list, and no "view history" link on individual habits. For a feature central to habit tracking effectiveness, this is poor discoverability.

### UX: Challenges and Party not linked from dashboard

The Challenges view and Party view are separate top-level tabs with no dashboard callout when challenges are in progress, near completion, or expiring. A user must remember to check them independently.

---

## 12. Bugs, Incomplete Systems, and Technical Debt

### Confirmed bugs

| Bug | Location | Severity |
|---|---|---|
| `useStreakFreeze` ineffective — doesn't write a log entry or recompute streak | `economySlice.ts:55-67` | High |
| `uncompleteHabit` does not reverse `+1 energy` from today's completion | `habitsSlice.ts:153-191` | Medium |
| `server_now()` SQL function defined but never called from client | `supabase/migrations/0001_...sql` vs. `src/` | Medium |
| No habit-edit UI despite `updateHabit` being defined in the store | `habitsSlice.ts:59`; missing in UI | High (missing feature) |

### Likely unintentional behavior

| Issue | Location | Status |
|---|---|---|
| Minigame XP trickle is applied to each stat at full value, not split — mine/forest double it, tactics triples it | `shared.ts:967,994,1058` | **Unclear** — labeled "trickle" suggesting single modest amount; may be intentional |
| `recovery` item effect (`items.ts:18`) documented as "clears broken-streak penalty" — no broken-streak penalty exists in habit engine | `content/items.ts`, `engine/items.ts` | **Unclear** — may be intended for future system |

### Incomplete / missing features

- **No habit-edit UI** (highest priority missing feature; `updateHabit` is dead call-site code)
- **No push notifications or reminders** — nothing prompts users to log habits during the day
- **Party quests grant no reward** — `reward: { gold: 0 }` hardcoded, making party quests purely cosmetic
- **Tactics minigame missing from leaderboard** — `deepestTacticsTier` added in migration `0005` but the base leaderboard view does not include it
- **Co-op Arena** was planned in `MULTIPLAYER_PLAN.md` but is listed as explicitly not supported; removed from co-op options in `CoopRaidPanel`
- **No habit import/export** — saves are locked in localStorage; no CSV export, no sharing, no backup

### Technical debt

| Debt item | Location | Notes |
|---|---|---|
| `useGameStore.ts` god-module (~2,700 lines) | `src/store/useGameStore.ts` | Slice split is underway (`src/store/slices/`) but the central file remains large |
| No automated tests for network/party layer | `src/net/`, `src/hooks/useParty.ts` | Only `coop/__tests__/reduce.test.ts` and `net/__tests__/cloudSave.test.ts` exist; the party UI and multiplayer hooks are untested |
| Single-party-per-user enforced only client-side | `src/net/party.ts:getMyParty` | A duplicate membership row (possible via race condition) causes a runtime fetch error |
| Client-trusted leaderboard and party quests | `src/net/party.ts` | Documented "trust the client" model; localStorage edits inflate rank/quest progress |
| Stale README | `README.md` | Documents systems as "coming soon" that are already shipped |
| No database migration runner | `supabase/migrations/` | Manual apply order is documented in `docs/INDEX.md` but is error-prone |
| `placeholderArt.ts` is a first-class system | `src/lib/placeholderArt.ts`, `sprites_needed.md` | Not debt per se, but the gap between placeholder and final art is large |

---

## 13. Priorities for an Improvement Plan

The following items are ranked by impact on making the site a stronger, more useful, and better-balanced habit tracker.

### Critical

1. **Add habit-edit UI.** `updateHabit` already exists in the store. The form just needs an edit mode. Until this ships, any user who makes a mistake at creation must delete their habit and lose all history. This is the most impactful missing feature.

2. **Fix `useStreakFreeze`.** The item is purchased with gold, costs a real resource, and is completely broken. Fix: write a `log[today] = { xp: 0 }` entry (zero-XP placeholder) and recompute streak. This makes the freeze actually protect the streak without granting fraudulent XP.

3. **Fix `uncompleteHabit` energy asymmetry.** Either subtract 1 energy when uncompleting a today completion (clamped to 0), or document and accept the asymmetry. The current behavior is a free energy farm.

### High

4. **Rebalance Skill Trials vs. habits.** Trials are free (zero energy cost) and outpace habit XP at almost every level. Options: add an energy cost to trials (e.g. 1 energy each), reduce trial XP to be clearly supplemental to habit XP, or require completing at least N habits today before trials unlock. The intended throttle (habits → energy → minigames) is currently bypassed entirely by trials.

5. **Limit or flag unrestricted backdating.** Options: limit backdating to 7 days (the most common "catch-up" window), require a reason note for backdating, or visually distinguish back-dated completions in the heatmap (e.g. a different shade). Unlimited backdating to any past date undermines the integrity of habit streaks and challenge results.

6. **Wire `server_now()` into daily gating.** The SQL function exists. The client needs to call it (via `supabase.rpc('server_now')`) and use the result as the authoritative "today" value, at least for trial gating and weekly rollover. This closes the device-clock exploit.

7. **Add a reward to party quests.** Party quests completing with `gold: 0` provides no game-mechanical incentive for participation. Even a small reward (100 gold split among contributors, a temporary XP multiplier) would close the motivational gap between party participation and going solo.

8. **Fix: add delete confirmation.** The "Delete" habit action is irreversible and should have a confirmation dialog, matching the pattern used by the party leave action.

### Medium

9. **Improve feedback on binary completions.** Show a brief XP earned indicator (+20 XP in the stat color) when a binary habit is sealed, so users see the reward immediately rather than inferring it from the level bar.

10. **Improve history discoverability.** Add a "View History" link or button within each `HabitCard` (opens Chronicle scrolled to that habit), or add "Chronicle" to the main navigation. The analytics work is excellent but hidden.

11. **Cap or warn on uncapped quantity habits.** Add a soft daily XP cap for uncapped habits (e.g., 5× base XP) or show a tooltip explaining the exploit risk. The uncapped flag is a real design need but is trivially abusable without any guardrails.

12. **Leaderboard: separate habit score from minigame score.** Add a "habit score" metric (e.g. 30-day completion rate, or total habit XP) alongside total XP so that a dedicated habit-tracker is recognizable on the leaderboard even if they don't play minigames.

13. **Add basic reminders / daily prompts.** Without notifications, users who forget to open the app have no prompt to log habits. Even a simple "Your habits are waiting" browser notification could improve daily engagement.

14. **Resolve Tactics leaderboard omission** (`deepestTacticsTier` missing from leaderboard view).

15. **Confirm trickle doubling intent.** Clarify whether the mine/forest/tactics stat-XP grant to multiple stats at full value (not split) is intentional. If unintentional, divide the trickle across the benefiting stats. Either way, document the decision in a comment.

### Lower priority

16. Add challenge or party-quest notifications when near completion.
17. Add habit-to-party visibility (let party members see each other's habit lists, not just aggregate counts), with privacy controls.
18. Add habit import/export (CSV or JSON) for backup and migration.
19. Add push notification / reminder support (PWA-compatible).

---

## 14. Appendix: File, Function, Route, and Data-Model Index

### Habit data model (`src/engine/habits.ts`)

```ts
type HabitType   = 'binary' | 'quantity';
type Frequency   = 'daily' | 'weekdays' | 'custom' | 'times_per_week' | 'as_needed';
type HabitStatus = 'active' | 'retired' | 'suspended';
type Difficulty  = 'easy' | 'normal' | 'hard' | 'epic';  // defined in xp.ts

interface HabitEntry {
  amount?: number;  // quantity amount logged
  xp: number;       // XP awarded for this entry
}

interface Habit {
  id: string;
  name: string;
  stat: StatId;              // one of: DX | AG | ST | EN | WI | CH | KN | HP
  type: HabitType;
  target?: number;           // quantity goal
  unit?: string;             // label for quantity (e.g. "pages", "km")
  uncapped?: boolean;        // remove 150% XP cap for quantity
  frequency: Frequency;
  days?: number[];           // for 'custom' frequency: 0=Sun … 6=Sat
  timesPerWeek?: number;     // for 'times_per_week'
  difficulty: Difficulty;
  tag?: string;
  status: HabitStatus;
  suspendUntilISO?: string;  // auto-resume date
  streak: number;            // CACHED — derived by currentStreak()
  lastCompletedISO?: string; // CACHED convenience
  log: Record<string, HabitEntry>; // SOURCE OF TRUTH — keyed by ISO date
  createdISO: string;
}
```

Creation input type: `NewHabitInput` in `src/store/shared.ts:106-118` (omits `id`, `status`, `streak`, `log`, `createdISO`).

### Key engine functions

| Function | File | Description |
|---|---|---|
| `isScheduledOn(habit, iso)` | `engine/habits.ts:51` | Whether the habit is due on a given date |
| `isLoggableOn(habit, iso)` | `engine/habits.ts:76` | Whether the habit can be logged on a date |
| `effectiveStatus(habit, iso)` | `engine/habits.ts:68` | Returns `active` for auto-expired suspensions |
| `currentStreak(habit, today)` | `engine/habits.ts:109` | Computes streak from `habit.log` |
| `resolveCompletion(habit, day, opts)` | `engine/habits.ts` | Returns `{ xp, recovery }` for a completion |
| `computeXp(input)` | `engine/xp.ts:55` | XP formula: base × ratio × recovery bonus |
| `completionRatio(actual, target, uncapped?)` | `engine/xp.ts:29` | Quantity completion ratio (capped or uncapped) |
| `xpForNextLevel(level)` | `engine/leveling.ts:11` | `round(100 × level^1.5)` |
| `allocateStatGains(pool, xpDelta, current, class?)` | `engine/progression.ts:83` | Distributes 3 stat points per level |
| `challengeProgress(def, startISO, habits, today)` | `engine/challenges.ts` | Recomputes challenge progress from logs |
| `heatmapWeeks(habits, today, nWeeks)` | `engine/tracking.ts` | 26-week heatmap cell data |
| `habitStats(habit, today)` | `engine/tracking.ts:46` | Per-habit analytics: days, streak, successPct, points |
| `trialReward(stat, score01, level)` | `engine/trials/trials.ts:124` | XP + gold formula for Skill Trials |

### Key store actions

| Action | File:line | Description |
|---|---|---|
| `addHabit(input)` | `habitsSlice.ts:44` | Create new habit |
| `updateHabit(id, patch)` | `habitsSlice.ts:59` | **Defined but unused in UI** |
| `removeHabit(id)` | `habitsSlice.ts:64` | Permanently delete habit + history |
| `retireHabit(id)` | `habitsSlice.ts:67` | Set status = retired |
| `reactivateHabit(id)` | `habitsSlice.ts:74` | Set status = active |
| `suspendHabit(id, untilISO)` | `habitsSlice.ts:81` | Suspend with auto-resume date |
| `normalizeHabits()` | `habitsSlice.ts:88` | Auto-resumes expired suspensions (called on mount) |
| `completeHabit(id, actual?, dateISO?)` | `habitsSlice.ts:102` | Log completion; awards XP, energy (today), challenges |
| `uncompleteHabit(id, dateISO?)` | `habitsSlice.ts:153` | Remove completion; subtracts XP; does not reverse energy |
| `useStreakFreeze(habitId)` | `economySlice.ts:55` | **Broken** — updates `lastCompletedISO` only |
| `completeTrial(trialId, score01)` | `trialsSlice.ts:28` | Daily trial completion; awards XP + gold via `applyReward` |

### Key reward / balance constants

| Constant | Value | File |
|---|---|---|
| `BASE_XP.easy` | 10 | `engine/xp.ts:7` |
| `BASE_XP.normal` | 20 | `engine/xp.ts:7` |
| `BASE_XP.hard` | 35 | `engine/xp.ts:7` |
| `BASE_XP.epic` | 50 | `engine/xp.ts:7` |
| `COMPLETION_CAP` | 1.5 | `engine/xp.ts:14` |
| `RECOVERY_BONUS` | 1.1 | `engine/xp.ts:18` |
| `MINE_ENERGY_COST` | 2 | `engine/mining.ts:83` |
| `FOREST_ENERGY_COST` | 2 | `engine/forest.ts:83` |
| `DUNGEON_ENERGY_COST` | 3 | `engine/dungeon.ts:11` |
| `ARENA_ENERGY_COST` | 3 | `engine/arena.ts:40` |
| `TACTICS_ENERGY_COST` | 3 | `engine/hexBattle.ts:31` |
| Skill Trials energy cost | **0** | `trialsSlice.ts` |
| `CRAWLER_XP_BASE` | 4 | `store/shared.ts:942` |
| `CRAWLER_XP_PER_DEPTH` | 3 | `store/shared.ts:944` |
| `MINIGAME_XP_BASE` | 4 | `store/shared.ts:947` |
| `MINIGAME_XP_PER_TIER` | 1 | `store/shared.ts:948` |
| `BOSS_GATE_LEVEL` | 5 | `store/shared.ts:719` |
| `POINTS_PER_LEVEL` | 3 | `engine/progression.ts:11` |
| `STAT_CAP` | 25 | `engine/progression.ts:13` |
| `MAX_LEVEL` | 50 | `engine/progression.ts:15` |

### Key UI components (habit-related)

| Component | File | Purpose |
|---|---|---|
| `DashboardView` | `src/views/DashboardView.tsx` | Main "Quest Log · Today" — lists habits by date |
| `HistoryView` | `src/views/HistoryView.tsx` | "Chronicle" — full analytics overlay |
| `ChallengesView` | `src/views/ChallengesView.tsx` | Browse, create, claim challenges |
| `PartyView` | `src/views/PartyView.tsx` | Party roster, quest, chat, leaderboard |
| `HabitForm` | `src/components/habits/HabitForm.tsx` | New-habit creation (no edit mode) |
| `HabitCard` | `src/components/habits/HabitCard.tsx` | Habit row: completion, streak, kebab menu |
| `CompleteHabitDialog` | `src/components/habits/CompleteHabitDialog.tsx` | Quantity logging with XP preview |
| `SuspendDialog` | `src/components/habits/SuspendDialog.tsx` | Pick resume date for suspension |
| `DatePicker` | `src/components/habits/DatePicker.tsx` | Back-date calendar |
| `HabitHistoryCard` | `src/components/history/HabitHistoryCard.tsx` | Per-habit analytics: heatmap + stats |
| `Heatmap` | `src/components/history/Heatmap.tsx` | 26-week color grid |
| `HabitChart` | `src/components/history/HabitChart.tsx` | Bar chart for quantity habits |
| `WeeklyReportModal` | `src/components/weekly/WeeklyReportModal.tsx` | Auto-pop weekly recap |
| `ChallengeBuilder` | `src/components/challenges/ChallengeBuilder.tsx` | Custom challenge creation |
| `PartyQuestPanel` | `src/components/party/PartyQuestPanel.tsx` | Shared party progress bar (no reward) |

### Database schema (habit-relevant tables)

```sql
-- supabase/migrations/0001_phase1_auth_saves.sql
saves (id, user_id, state jsonb, updated_at)   -- full GameState blob; habits live in state->habits
server_now()                                    -- FUNCTION: returns current_timestamp — UNUSED IN CLIENT

-- supabase/migrations/0002_phase2_parties.sql
party_quests (id, party_id, goal, progress, reward jsonb, completed_at)
-- progress incremented by RPC increment_party_quest on each habit completion
-- reward is currently always {gold: 0}
leaderboard (view: user_id, display_name, total_xp, ...)  -- XP sourced from public_snapshot
```

### Navigation routes

There is no URL router — the app is a single-page React application with a tab-based local state in `App.tsx`. Tabs (viewed via `tab` state):
- `habits` → `DashboardView`
- `dungeon` → `DungeonView` + `BattleOverlay`
- `mining` → + `MineRunOverlay`
- `forest` → + `ForestRunOverlay`
- `arena` → + `ArenaOverlay`
- `hexBattle` → hex tactics
- `trials` → skill trials
- `challenges` → `ChallengesView`
- `party` → `PartyView`
- `shop` → shop
- `craft` → crafting
- `settings` → `SettingsView`

There are no URL routes, deep links, or server-rendered pages. Everything is client-side.
