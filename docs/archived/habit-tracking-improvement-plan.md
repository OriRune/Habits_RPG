# HabitsRPG: Habit-Tracking Improvement Plan

> **Based on:** `docs/habit-tracking-analysis.md` (2026-06-20)
> **Branch:** `feature/multiplayer`
> **Scope:** Habit tracking experience, reward balance, accountability, and long-term usefulness. Minigames are addressed only in terms of how their rewards and gating relate to habits — individual minigame design is out of scope.

---

## Table of Contents

1. [Biggest Weaknesses](#1-biggest-weaknesses)
2. [Missing Features to Add](#2-missing-features-to-add)
3. [Habit Logging, Editing, Streak, Goal, and Challenge Improvements](#3-habit-logging-editing-streak-goal-and-challenge-improvements)
4. [Preventing Abuse, XP Farming, and Shallow Engagement](#4-preventing-abuse-xp-farming-and-shallow-engagement)
5. [XP and Reward Balance](#5-xp-and-reward-balance)
6. [Making Minigames Reinforce Habits](#6-making-minigames-reinforce-habits)
7. [Party and Multiplayer Improvements](#7-party-and-multiplayer-improvements)
8. [UX Improvements](#8-ux-improvements)
9. [Data Model, Backend, and Validation](#9-data-model-backend-and-validation)
10. [Technical Debt](#10-technical-debt)
11. [Staged Implementation Roadmap](#11-staged-implementation-roadmap)
12. [Risks, Dependencies, and Open Decisions](#12-risks-dependencies-and-open-decisions)

---

## 1. Biggest Weaknesses

These are the problems with the highest impact on the core promise of the site — that using it actually helps users build habits.

### 1.1 No habit-edit UI (critical missing feature)

`updateHabit(id, patch)` exists in `habitsSlice.ts:59` but has zero call sites anywhere in `src/`. `HabitForm.tsx` only ever calls `addHabit`. A user who misspells a habit name, picks the wrong stat, or sets the wrong difficulty must delete the habit — permanently erasing its entire history — and start over. This is the single most impactful missing feature.

### 1.2 Skill Trials completely bypass the energy throttle

The intended incentive loop is: habits → energy → minigame access. But Skill Trials (`trialsSlice.ts`) cost **zero energy**, run **8 times per day**, and grant XP directly into the same leveling ledger as habits. At level 5 with perfect scores, 8 trials = 480 XP/day — roughly 3× the XP from a strong habit day, plus gold that habits never produce. A user who never logs a single habit can level up, accumulate stats, and earn gold through Trials alone. The energy link between habits and game progression is effectively optional.

### 1.3 Streak Freeze item is broken

`useStreakFreeze` in `economySlice.ts:55-67` consumes the item and sets `lastCompletedISO = today` — but does not write a `log[today]` entry. Because `currentStreak` in `engine/habits.ts:109` walks the `log` map (not `lastCompletedISO`), the streak is unaffected. The item is consumed for zero benefit. The integration test (`store.integration.test.ts`) only asserts that `lastCompletedISO` is updated — not that the streak survives a missed day.

### 1.4 Uncompleting a habit today is an energy farm

`completeHabit` with `isToday` awards `character.energy += 1` (`habitsSlice.ts:143`). `uncompleteHabit` (`habitsSlice.ts:153-191`) subtracts the XP but never touches energy. Rapidly completing and un-completing any habit today permanently generates free energy. Because energy costs 2–3 per minigame run, this is a real, repeatable exploit.

### 1.5 Unrestricted backdating undermines habit integrity

The `DatePicker` in `DashboardView.tsx` allows logging completions for any past date back to the earliest habit's `createdISO`. Back-dated completions grant full XP and count toward all challenge progress. There is no limit, no friction, and no server-side audit. A user can create a habit today and immediately fill in a month of completions, earning large amounts of XP and completing streaks/challenges without any real behavior.

### 1.6 Habits produce no gold or items — ever

Completing habits awards only `statXp` and `+1 energy`. Gold and items come exclusively from minigames. This means a player who only tracks habits cannot afford anything in the shop, cannot craft anything, and cannot advance gear — they are locked out of the economy no matter how consistent their habit behavior. This makes habit tracking feel secondary to minigame playing.

### 1.7 No reminders or prompts

There is no push notification, browser notification, or in-app reminder system. Users who don't open the app at the right time miss their habits with no signal. Habit consistency research consistently identifies reminders as one of the highest-impact features for daily engagement.

---

## 2. Missing Features to Add

Features that are absent but standard in habit trackers and would meaningfully improve the experience:

### 2.1 Habit edit UI (highest priority)

Add an edit mode to `HabitForm.tsx` that pre-populates all fields from an existing habit and calls `updateHabit(id, patch)` on submit. Wire the "Edit" action in `HabitCard.tsx`'s kebab menu (currently: Suspend / Reactivate / Retire / Delete — Edit is absent).

Fields to allow editing: name, tag, stat, difficulty, frequency, target/unit/uncapped, and days/timesPerWeek. Fields that must **not** be retroactively editable: type (binary/quantity), because changing this would invalidate historical log entries.

If the user changes the stat, apply the patch going forward — existing `log` entries already store their own `xp` value and are not recalculated. If the user changes difficulty, prompt: "This changes future XP only; past entries are not adjusted."

### 2.2 Daily reminder / notification support

Add browser notification support via the Notifications API (PWA-compatible). Allow users to set a reminder time per habit or a global daily reminder. Even a basic "You have 4 habits to complete today" notification at a user-chosen time would meaningfully improve daily return rates.

### 2.3 Delete confirmation for habits

`HabitCard.tsx`'s kebab "Delete" calls `removeHabit(id)` immediately with no confirmation. Add a confirmation dialog (consistent with how the party leave action is handled in `PartyView.tsx`). Show the habit name and a warning that all history will be lost; offer "Retire instead" as the safer alternative.

### 2.4 XP feedback on binary completion

Binary habits (`type: 'binary'`) give no visible XP feedback when completed. The quantity dialog (`CompleteHabitDialog.tsx`) shows an XP preview, but binary completions just update the level bar silently. Add a brief XP toast or inline indicator (e.g., "+20 XP" in the stat color) that appears for ~2 seconds after sealing a binary habit.

### 2.5 History entry point on each habit card

The "Chronicle" analytics view (`HistoryView.tsx`) is accessible only via the `BarChart3` icon in the Dashboard header. Add a "View History" link or icon to each `HabitCard.tsx` (in the kebab menu or as a small chart icon) that opens `HistoryView` scrolled to that specific habit's `HabitHistoryCard`. This brings analytics into the daily flow rather than hiding them behind a small header icon.

### 2.6 Habit import/export

All state lives in `localStorage` with no export path. Add a JSON export button to `SettingsView.tsx` that downloads `GameState.habits` (with logs) as a file. Add a corresponding import that validates structure and merges by `habit.id`. This is critical for users who want to backup data, switch browsers, or migrate to a new device without waiting for Supabase cloud save.

---

## 3. Habit Logging, Editing, Streak, Goal, and Challenge Improvements

### 3.1 Fix `useStreakFreeze`

**Current:** `economySlice.ts:55-67` sets `lastCompletedISO = today` only — has no effect on the computed streak.

**Fix:** Write a zero-XP placeholder log entry for today:
```ts
habits: s.habits.map((h) =>
  h.id === habitId
    ? {
        ...h,
        log: { ...h.log, [today]: { xp: 0, frozen: true } },
        lastCompletedISO: today,
      }
    : h,
),
```

Add `frozen?: boolean` to `HabitEntry` in `engine/habits.ts`. In `currentStreak`, a `frozen` entry counts as a "completed" day (streak not broken) but does not increment the streak count. Update the test in `store.integration.test.ts` to assert that a missed day with a freeze applied does not reduce `habit.streak`.

### 3.2 Fix `uncompleteHabit` energy asymmetry

**Current:** `habitsSlice.ts:153-191` subtracts XP but not energy.

**Fix:** In `uncompleteHabit`, if `day === today` and energy was originally awarded (check `entry.xp > 0` or just guard on `isToday`), decrement `character.energy` by 1 (clamped to 0):
```ts
const isToday = day === toISODate();
if (isToday && next.character.energy > 0) {
  next.character.energy -= 1;
}
```

### 3.3 Limit backdating window

**Current:** Any past date back to `createdISO` is loggable.

**Recommended:** Limit the `DatePicker` max-past-date to 7 days before today. Change the `min` bound in `DatePicker.tsx` from `habit.createdISO` to `max(habit.createdISO, sevenDaysAgo)`. For users who genuinely need to log further back (e.g., after an illness or travel), add a "Log older entry" option in the kebab menu that opens a freeform date input with a warning about integrity.

Separately: visually distinguish back-dated completions in the `Heatmap` with a slightly different shade or a small indicator. Currently a backdated completion looks identical to a real-time completion.

### 3.4 Quantity habit default input

**Current:** `CompleteHabitDialog.tsx:19` pre-fills `actual = habit.target`. One-tap always logs exactly 100%.

**Improvement:** Pre-fill with the blank/empty or with yesterday's logged amount (if available from `habit.log`). Showing yesterday's value ("Last time: 18 pages") gives context without defaulting to the goal, which encourages honest logging over lazy one-tapping.

### 3.5 Cap uncapped quantity habits per day

**Current:** `uncapped: true` habits have no XP ceiling — logging `10,000` against a target of `1` gives 10,000× base XP.

**Fix:** Add a soft daily cap: `Math.min(actual, target * UNCAPPED_DAILY_MAX)` where `UNCAPPED_DAILY_MAX = 10` (10× target). This still allows genuine outlier days (someone runs 50km when their goal is 5km) while preventing trivial exploitation. Show the cap in `CompleteHabitDialog.tsx` as a note ("XP is capped at 10× your goal").

### 3.6 Challenge improvements

**Weekly rotation cadence:** The weekly rotation (`engine/weekly.ts weeklyRotation`) currently auto-assigns challenges. Add a "skip" button (one skip per week, free) so users who get a challenge that doesn't fit their current habits can reroll once. Log the skip so it doesn't carry over.

**Challenge expiry warning:** Show a badge or warning on the `ChallengesView` tab icon when an active challenge expires within 48 hours. Currently there is no tab-level urgency signal.

**Party challenges:** The six challenge kinds in `engine/challenges.ts` are entirely single-player. Add a `partyChallenge` kind that maps a challenge definition to a shared party goal, with progress drawn from the aggregate `party_quests.progress` counter. Party challenge rewards should go to all members.

---

## 4. Preventing Abuse, XP Farming, and Shallow Engagement

### 4.1 Audit and fix the energy exploit (uncomplete loop)

Covered in §3.2. After the fix, also add a sanity clamp: `character.energy = Math.max(0, Math.min(character.energy, MAX_ENERGY))` at the end of `completeHabit` and `uncompleteHabit`, where `MAX_ENERGY` is already defined in `shared.ts`. This prevents any future energy accumulation beyond the cap regardless of code path.

### 4.2 Enforce a backdating window server-side (when Supabase is active)

Client-side gating in `DatePicker.tsx` is easy to bypass. When Supabase is configured, add validation in the `increment_party_quest` RPC and in any future server-side habit logging endpoint: reject completions dated more than 7 days in the past (or flag them as "late" in the quest counter rather than counting them equally).

For the localStorage-only path, client-side enforcement is the best available option, but it should still be applied.

### 4.3 Rate-limit Skill Trials by habit activity

Trials currently gate only on `trialsClearedOn` (once per day per trial). Add a secondary gate: to run a given trial, the player must have completed at least one habit of the **same stat** today (or in the last 7 days, to be lenient). Example: the WI trial unlocks after logging any WI habit. This makes Trials feel like an extension of habit work rather than a parallel track. Store the per-stat gate flag alongside `trialsClearedOn`.

### 4.4 Cap or remove the `uncapped` XP path for new users

The `uncapped` flag is a power-user feature that is trivially exploitable. Options:
- **Lock behind level 10:** Only users at level 10+ can create uncapped habits. Low-level players cannot accidentally (or intentionally) use it as an early farm.
- **Cap at 10× target as described in §3.5.** Keeps the design intent without the unlimited ceiling.

### 4.5 Require habits for challenge eligibility

Challenges that compute progress from `habit.log` (`count`, `quantity`, `streak`, `recovery`) already require genuine habit logs. But `class` and `rival` challenges could be gamed with a single trivially-named habit. Consider: a challenge cannot be started unless the player has at least 2 active habits of the required stat.

---

## 5. XP and Reward Balance

The current reward numbers, with specific changes recommended:

### 5.1 Habit XP — keep as-is

The BASE_XP table (`xp.ts:7`) is well-designed:
- Easy: 10, Normal: 20, Hard: 35, Epic: 50
- Recovery bonus (+10%) is meaningful without being dominant
- Quantity scaling with a 150% cap is sensible

No changes needed here. Habit XP is appropriately calibrated — the problem is that competing XP sources are too large.

### 5.2 Skill Trial XP — reduce to supplemental

`trialReward` at level 5, perfect score: **60 XP + 40 gold** per trial. 8 trials = **480 XP/day**. This is 3× the output of a strong habit day (160 XP from 8 normal habits).

**Target:** Trials should be the best supplement to habits, not a replacement for them. Recommended adjustment: reduce trial XP to `(10 + 4×level) × (0.25 + 0.75×score01)`. At level 5, perfect score: **30 XP + 40 gold** per trial → 240 XP/day max from all trials. This is ~1.5× a habit day at high consistency, maintaining trials as a valuable add-on without making them the dominant leveling path.

Gold rewards from trials can stay at current levels — gold gating minigame purchases is healthy; the problem is XP, not gold.

### 5.3 Add a small gold reward to habits

Habits currently award zero gold. This means a habits-only player is completely locked out of the shop and crafting system. Add a small gold trickle to habit completions:
- Easy: 0 gold (no change — easy habits shouldn't also be gold farms)
- Normal: +2 gold
- Hard: +5 gold
- Epic: +10 gold

This keeps the economy centered on minigames (a dungeon run producing 30–60 gold dwarfs habit gold) while giving consistent habit-trackers enough to participate in the shop over time.

### 5.4 Minigame XP trickle — confirm and fix doubling

**Current:** `commitMining` in `shared.ts:967` grants `{ ST: trickle, EN: trickle }` — each stat receives the **full** trickle value, doubling the total. Forest (DX+EN) works the same; tactics (AG+DX+EN) triples it. The surrounding comment says "a modest trickle," which suggests the intent was a single small bonus, not a double/triple dose.

**Decision needed (see §12):** If this is unintentional, fix it by splitting the trickle across stats:
```ts
statXp: { ST: Math.ceil(trickle / 2), EN: Math.floor(trickle / 2) }
```
If intentional (multi-stat games reward more total XP to reflect higher complexity), document this explicitly in a comment. Either way, the ambiguity should be resolved.

### 5.5 Challenge rewards — make them the premium habit reward

Challenges are the **only** way to earn items, weapons, and gear through habit activity. This is good design — challenges should be the premium layer of habit reward. Reinforce this:
- Increase challenge item/gear rewards slightly relative to shop prices
- Add a new reward tier for consecutive week completions (e.g., complete the weekly challenge 4 weeks in a row → unlock a unique item)
- Make party challenge rewards party-exclusive (not obtainable solo)

### 5.6 Party quest rewards — implement them

Party quests currently hardcode `reward: { gold: 0 }` in `PartyQuestPanel.tsx` and the DB schema. This completely removes the in-game incentive for party participation. Implement a modest reward:
- On quest completion: each contributing member receives `50 + 10 × memberCount` gold, capped at 200 per quest
- Distribute proportionally by per-member completion contribution (already tracked via `increment_party_quest` deltas if stored per-member — see §7)
- Emit the reward via a new `claim_party_quest_reward` RPC that checks `party_quests.completed_at` is set and the user hasn't claimed

---

## 6. Making Minigames Reinforce Habits

The goal is not to weaken minigames but to make minigame access feel earned through habit completion.

### 6.1 Enforce the energy throttle for Skill Trials

Add an energy cost to Skill Trials (1 energy per trial is the minimum friction). This makes the 8-trial daily run cost 8 energy — requiring at least 8 habit completions to fund. The cost does not have to be large; even 1 energy per trial meaningfully connects Trials to the habit loop.

Alternatively: do not charge energy for the first 3 trials per day (beginner accessibility), then charge 1 energy per trial after that. This lets casual users sample trials freely while making the full Trial sweep require actual habit completions.

### 6.2 Stat-gated trial access

Each trial maps to a stat (WI trial, DX trial, etc.). Require at least one habit completion of that stat today to unlock each trial (see §4.3). Enforce this in `trialsSlice.ts:completeTrial` by checking `s.completionLog` for today's count on that stat, or add a `statCompletedToday: Record<StatId, boolean>` field derived by `completeHabit`.

### 6.3 Habit-streak multiplier on minigame rewards

Add a passive "Habit Streak Bonus" that increases minigame gold (not XP) by a small percentage based on the player's active habit streak health. Example: if ≥75% of active habits are currently at streak ≥3, apply a +10% gold multiplier to all minigame runs for the day. This creates a direct in-game value signal for consistent habit tracking.

Compute this in `shared.ts` alongside `recomputeMood` — it can use the same 7-day rolling window. Store as `character.habitBonus: number` (a multiplier, 1.0–1.25). Apply in `commitMining`, `commitForest`, etc.

### 6.4 Mood affects minigame difficulty (existing system — surface it)

`recomputeMood` in `shared.ts:571` already computes a mood score from habit completions. If `character.mood` is used anywhere to adjust minigame difficulty or rewards, make that connection visible in the UI (e.g., "Your team's morale is high — +5% gold today"). If it is not yet wired to any minigame system, wire it: a low mood (missed habits) should show a gentle warning, and a high mood should show a visible reward bonus.

---

## 7. Party and Multiplayer Improvements

### 7.1 Implement party quest rewards

As described in §5.6: distribute gold on quest completion via a `claim_party_quest_reward` RPC. Track per-member contribution in `party_quests` — either as a JSONB column (`contributions: { userId: delta }`) populated by the `increment_party_quest` RPC, or by adding a `party_quest_contributions` table. Reward distribution proportional to contribution gives members an incentive to log habits actively rather than letting one member carry the quest.

### 7.2 Add per-habit habit visibility (opt-in)

Party members currently see only an aggregate completion count via the quest counter. Add an opt-in profile setting (`settings.shareHabitNames: boolean`, default false) that publishes a member's active habit list (names + streak + today's status) to a new `party_member_habits` view or JSONB column on the `members` table. Display this in `PartyView.tsx` as an expandable member card showing their habits and streaks.

This is the most effective accountability feature in social habit trackers — seeing your party member's specific habits creates real social accountability and reduces the sense that the party counter is just a number.

### 7.3 Separate the leaderboard into two tracks

The current leaderboard ranks by `total_xp` from `public_snapshot`. This disadvantages players who are dedicated habit trackers but not minigame enthusiasts. Add a second "Consistency" leaderboard tab that ranks by a habit-only score:
- **Habit Score** = 30-day completion rate (completions / scheduled-habit-days, as a percentage), with a tiebreaker of total habit XP earned
- Derive from `habit.log` entries in the last 30 days; store the rolled-up value in `public_snapshot.habit_score` (updated on cloud save sync)

Keep the XP leaderboard alongside it — they measure different things and serve different user types.

### 7.4 Party challenge quests

Add a `party_challenge` quest type that works like a shared challenge:
- Defined by the party leader via a new "Start Party Challenge" button in `PartyQuestPanel`
- Uses the same six challenge kinds from `engine/challenges.ts` but with a combined goal (sum of all members' individual progress)
- Progress is fed from `increment_party_quest` using existing infrastructure
- Reward is shared on completion (see §5.6)

### 7.5 Anti-manipulation measures for leaderboard

The "trust the client" model means leaderboard XP is as trustworthy as the player's localStorage. Short of adding server-side XP recomputation (a large undertaking), add soft signals:
- Rate-limit XP delta per cloud-save sync: if a sync shows a player gaining >5,000 XP since the last sync (which is practically impossible through normal play in a short window), flag the save as `suspect` on the server and exclude from leaderboard until reviewed
- This is a soft guard, not a hard one, and can be toggled per party by the party leader ("competitive mode" vs. "casual mode")

---

## 8. UX Improvements

### 8.1 Daily habit summary in the hero banner

The `HeroBanner` currently shows character portrait, mood ring, level bar, and energy. Add a line below it: "**3 / 6 habits done today**" — a simple completion count that gives users an at-a-glance sense of their day before scrolling. This is the most universally requested feature in habit tracker UX research.

Derive from `selectDashboardHabits(today).completed.length` and `.pending.length`, both already computed in `selectors.ts`.

### 8.2 Promote history entry points

- Add "Chronicle" to the top-level tab navigation or the Dashboard header as a labeled link, not just a `BarChart3` icon.
- Add a "View history" item to each `HabitCard.tsx` kebab menu that opens `HistoryView` pre-scrolled to that habit.
- In `WeeklyReportModal.tsx`, add a "View detailed breakdown →" link that opens Chronicle.

### 8.3 Progress context in the habit list

In the habit list, show in-progress context:
- For `times_per_week` habits: already shows "X / Y this week" — good; keep.
- For `daily`/`weekdays`/`custom` habits: show current streak count inline on the card (already shown via the flame icon + number — good).
- For habits with active challenges: show a small challenge badge on the card linking to the relevant challenge (e.g., "📜 Day 5 / 7").

### 8.4 Active challenge callout on Dashboard

When a challenge is in progress, show a compact callout at the top of the Dashboard (below the hero banner, above the habit list) with the challenge name, progress bar, and days remaining. Today's relevant habits should appear highlighted in the list below. Currently challenges live in their own tab with no dashboard integration.

### 8.5 Rename "Quest Log" or add subtitle

The Dashboard tab is titled "Quest Log · Today" — appropriate RPG theming, but may confuse new users who don't yet know this is where habits live. Add a small subtitle: "Your daily habits" in muted text below the title on the Dashboard. This is a one-line change in `DashboardView.tsx` with high clarity impact for new users.

### 8.6 Surface the "Chronicle" name in onboarding

If there is any form of onboarding or first-run experience, include a mention of Chronicle and where to find it. If there is no onboarding, add a single first-visit tooltip ("Track your progress over time in **Chronicle** — tap the chart icon in the header").

---

## 9. Data Model, Backend, and Validation

### 9.1 Add `frozen: boolean` to `HabitEntry`

Required for the Streak Freeze fix (§3.1). Update `engine/habits.ts` `HabitEntry`:
```ts
interface HabitEntry {
  amount?: number;
  xp: number;
  frozen?: boolean;
}
```
Update `currentStreak` to count `frozen` entries as completion days without breaking the streak. Update `uncompleteHabit` to reject deleting a `frozen` entry (or allow it but also remove the freeze item's benefit — TBD). Update the store migration in `useGameStore.ts` if needed (existing entries default to `frozen: undefined`, which is equivalent to false — no migration needed).

### 9.2 Wire `server_now()` into daily gating (when Supabase is active)

`supabase/migrations/0001_phase1_auth_saves.sql` defines `server_now()` which returns the server's `current_timestamp`. Add a call in `engine/date.ts` or `store/useGameStore.ts` that fetches server time on app load (when Supabase is configured) and caches it as a reference point:

```ts
// on mount, when supabase is available
const { data } = await supabase.rpc('server_now');
const serverOffset = new Date(data).getTime() - Date.now();
// store serverOffset; use Date.now() + serverOffset for all daily gating
```

This closes the device-clock exploit without requiring a server call on every "today" read. One call per session is enough to establish the offset.

Apply the server-authoritative date to: `trialsClearedOn` gating, `weeklyRollover`, `lastActiveISO`, and any future server-side validation of habit completions.

### 9.3 Store migration hygiene

The current migration at `useGameStore.ts:111` handles version 22 of the localStorage schema. As improvements in this plan add new fields (`frozen` on `HabitEntry`, `habitBonus` on `character`, etc.), each addition should be reflected in a migration step with a version bump. Keep the convention: new fields get a default value in `withCharacterDefaults` and `migrate`, so old saves load correctly.

Document the field-version mapping in a comment block at the top of `useGameStore.ts` (or in a separate `SCHEMA_CHANGELOG.md`).

### 9.4 Per-member contribution tracking in party quests

Currently `increment_party_quest` increments a single `progress` counter for the quest. To support proportional reward distribution (§7.1), extend the `party_quests` table:
```sql
ALTER TABLE party_quests
  ADD COLUMN contributions jsonb NOT NULL DEFAULT '{}';
```
In the `increment_party_quest` RPC, atomically update:
```sql
contributions = jsonb_set(
  contributions,
  ARRAY[user_id::text],
  to_jsonb(COALESCE((contributions->>user_id::text)::int, 0) + delta)
)
```
This lets the reward RPC distribute gold proportionally on quest completion.

### 9.5 Validate `HabitType` is immutable across edits

When the habit-edit UI (§2.1) is implemented, add a guard in `updateHabit` (`habitsSlice.ts:59`):
```ts
updateHabit: (id, patch) =>
  set((s) => ({
    habits: s.habits.map((h) => {
      if (h.id !== id) return h;
      const { type: _ignored, ...safePatch } = patch; // strip type changes
      return { ...h, ...safePatch };
    }),
  })),
```
This ensures that existing `log` entries (which may have `amount` values calibrated to the original type) are never invalidated by a type change.

---

## 10. Technical Debt

Debt items specifically related to habit tracking, ordered by impact on reliability:

### 10.1 `updateHabit` dead call site

`habitsSlice.ts:59` and `shared.ts:253` declare `updateHabit`, but nothing calls it. Once the edit UI is added (§2.1), this becomes live code and the declaration is no longer dead. Until then, it creates a false impression that edit functionality exists. Priority: resolve when implementing §2.1.

### 10.2 Streak Freeze integration test is incomplete

`store.integration.test.ts:338-345` only asserts `lastCompletedISO` and item count after `useStreakFreeze`. It does not assert streak survival across a missed day. After the §3.1 fix, extend the test:
```ts
// simulate: complete habit → advance to tomorrow → use freeze → advance another day → check streak
```

### 10.3 `useGameStore.ts` god-module (~2,700 lines)

The slice split (`src/store/slices/`) is underway but `useGameStore.ts` remains the central orchestration file at ~2,700 lines. The habit-related logic that remains in `shared.ts` (especially `recomputeMood`, `checkLevelUp`, `applyWeeklyRollover`, `commitMining`/`commitForest`) should migrate to their respective slices or to a dedicated `rewardSlice.ts` as the split continues. This is not urgent for correctness but reduces the risk of habit-related logic being missed when tracing data flow.

### 10.4 No automated tests for `usePartyQuestReporter`

`hooks/useParty.ts:208` fires on every habit completion and is the sole bridge between the habit system and the Supabase party backend. It has no tests. Add a test that mocks the Supabase client and asserts that `incrementPartyQuest` is called with the correct delta when `completeHabit` is dispatched. A regression here silently breaks party accountability for all users.

### 10.5 `server_now()` SQL function unused in client

Documented as a bug in §9.2. The function exists and is correct; the gap is purely on the client side. Track as a debt item until the client-side integration is shipped.

### 10.6 Party quest `reward` hardcoded to `{gold: 0}`

`PartyQuestPanel.tsx` hardcodes `reward: { gold: 0 }`. Once rewards are implemented (§5.6, §7.1), this must be removed in favor of the DB-stored `party_quests.reward` value. Until then, the column is misleadingly present.

### 10.7 `placeholderArt.ts` gap

`src/lib/placeholderArt.ts` is a first-class system used in production renders. The gap between placeholder and final art is visible to users and reduces the polish of the overall experience. This is not a habit-tracking bug, but it affects perceived quality enough that new users may question the app's maturity. Track as ongoing asset debt.

---

## 11. Staged Implementation Roadmap

Organized by priority tier. Each item references the section above where the change is described in detail.

### Stage 1 — Bug Fixes (ship as soon as possible)

These are correctness bugs that should be fixed before any new features are added. They affect every user on every session.

| # | Change | Source | Effort |
|---|---|---|---|
| 1.1 | Fix `useStreakFreeze` — write `log[today]` entry, recompute streak | §3.1, §10.2 | Small |
| 1.2 | Fix `uncompleteHabit` energy asymmetry — subtract 1 energy on uncomplete today | §3.2 | Small |
| 1.3 | Add delete confirmation dialog in `HabitCard.tsx` | §2.3 | Small |
| 1.4 | Fix `server_now()` wiring — fetch on Supabase mount, cache offset | §9.2 | Medium |
| 1.5 | Update Streak Freeze integration test to assert streak survival | §10.2 | Small |

### Stage 2 — Core Missing Feature (habit edit UI)

This is the most impactful single feature missing from the tracker. It has no dependencies and the store action already exists.

| # | Change | Source | Effort |
|---|---|---|---|
| 2.1 | Add edit mode to `HabitForm.tsx`; wire "Edit" in `HabitCard.tsx` kebab menu | §2.1, §9.5 | Medium |
| 2.2 | Guard `updateHabit` to strip `type` changes | §9.5 | Small |

### Stage 3 — Reward Balance

These changes address the Skill Trials bypass and the habit → gold gap. They affect the incentive structure for all users.

| # | Change | Source | Effort |
|---|---|---|---|
| 3.1 | Add energy cost (1 energy) to Skill Trials | §6.1 | Small |
| 3.2 | Reduce Trial XP to `(10 + 4×level) × mult` | §5.2 | Small |
| 3.3 | Add small gold reward to habits (Normal: 2g, Hard: 5g, Epic: 10g) | §5.3 | Small |
| 3.4 | Add `character.habitBonus` streak multiplier; apply to minigame gold | §6.3 | Medium |
| 3.5 | Confirm/fix minigame trickle doubling in `shared.ts:967` | §5.4 | Small (after decision) |

### Stage 4 — Integrity and Abuse Prevention

These close the backdating loophole and the uncapped XP farm before the multiplayer system is stressed.

| # | Change | Source | Effort |
|---|---|---|---|
| 4.1 | Limit `DatePicker` to 7-day backdating window | §3.3 | Small |
| 4.2 | Cap uncapped quantity habits at 10× target | §3.5 | Small |
| 4.3 | Add `MAX_ENERGY` clamp at end of `completeHabit` / `uncompleteHabit` | §4.1 | Small |
| 4.4 | Add per-stat gate: complete a stat habit today before that stat's trial unlocks | §4.3, §6.2 | Medium |

### Stage 5 — Party and Accountability

These make the multiplayer layer genuinely motivating rather than cosmetic.

| # | Change | Source | Effort |
|---|---|---|---|
| 5.1 | Implement party quest rewards; add `contributions` column to `party_quests` | §5.6, §7.1, §9.4 | Medium |
| 5.2 | Add opt-in habit visibility to party member cards | §7.2 | Medium |
| 5.3 | Add "Consistency" leaderboard track (habit completion rate) | §7.3 | Medium |
| 5.4 | Add `usePartyQuestReporter` automated tests | §10.4 | Small |

### Stage 6 — UX and Feedback ✅ DONE (2026-06-22)

These improve the daily experience for existing users. Each is standalone with no cross-dependencies.

| # | Change | Source | Effort | Status |
|---|---|---|---|---|
| 6.1 | XP toast on binary habit completion | §2.4 | Small | ✅ `useToastStore.ts` + `Toaster.tsx`, wired in `HabitCard.tsx` + `App.tsx` |
| 6.2 | Daily habit summary count in `HeroBanner` | §8.1 | Small | ✅ `HeroBanner.tsx` reads `selectDailySummary` |
| 6.3 | Active challenge callout on Dashboard | §8.4 | Small | ✅ `ActiveChallengeCallout` component in `DashboardView.tsx` |
| 6.4 | Add "View History" to `HabitCard.tsx` kebab | §2.5, §8.2 | Small | ✅ `onViewHistory` prop threaded; `HistoryView` accepts `focusHabitId` + scrolls |
| 6.5 | Show yesterday's amount as context in `CompleteHabitDialog.tsx` | §3.4 | Small | ✅ `lastLoggedAmount()` helper + hint text |
| 6.6 | Dashboard subtitle: "Your daily habits" | §8.5 | Trivial | ✅ Under `<SectionTitle>` in `DashboardView.tsx` |

### Stage 7 — Long-term Features ✅ DONE (2026-06-22)

These are higher-effort additions that matter for retention and long-term engagement.

| # | Change | Source | Effort | Status |
|---|---|---|---|---|
| 7.1 | Browser notification / daily reminder support | §2.7 | Large | ✅ `useReminders.ts` hook (foreground-only); toggle + time input in `SettingsView.tsx`; in-app toast fallback |
| 7.2 | Habit JSON import/export | §2.6 | Medium | ✅ Export/import in `SettingsView.tsx`; `importHabits()` action in `habitsSlice.ts`; merge-by-id + completionLog recompute |
| 7.3 | Party challenge quest type | §7.4 | Large | ✅ `QuestForm` kind selector (count/class/quantity); `computeQuestTotal()` pure helper; kind-aware reporter in `useParty.ts` |
| 7.4 | Challenge expiry warning badges | §3.6 | Small | ✅ `badges` prop on `TabBar.tsx`; `hasExpiringChallenge` computed in `App.tsx` (≤2 days left) |
| 7.5 | Leaderboard anti-manipulation rate limiting | §7.5 | Medium | ✅ `0009_leaderboard_antimanip.sql` — `suspect` flag, XP-delta trigger, leaderboard view exclusion (live-Supabase verification deferred) |

---

## 12. Risks, Dependencies, and Open Decisions

These are questions and risks that need resolution before or during implementation. Changes that depend on unresolved decisions are noted.

### 12.1 Decision: Is the minigame trickle doubling intentional?

`commitMining` in `shared.ts:967` grants the full trickle to both ST and EN — effectively doubling the total stat XP per mine run. The same pattern applies in forest (×2) and tactics (×3). The surrounding comment says "modest trickle," which implies it may be unintentional.

**Must decide before Stage 3.5.** If unintentional, fix to split; if intentional, document and adjust balance numbers in §5.2 accordingly (the baseline comparison in the analysis assumed single-stat trickle).

### 12.2 Decision: What is the correct Streak Freeze semantic?

The fix proposed in §3.1 writes `log[today] = { xp: 0, frozen: true }`. But there is a philosophical question: should a frozen day count as "completing" the habit for morale/mood purposes, for challenge progress, and for `completeHabit`'s per-day guard?

**Proposed answer:** A frozen day should NOT grant XP or count toward challenge progress, but SHOULD protect the streak. The `completeHabit` per-day guard (`if (habit.log[day] !== undefined) return s`) would block completing a habit on a frozen day — which is incorrect. The guard should be changed to `if (habit.log[day]?.frozen !== true && habit.log[day] !== undefined) return s`, allowing a real completion to replace a freeze on the same day.

**Resolve before Stage 1.1.**

### 12.3 Decision: Should type changes in `updateHabit` be blocked or warned?

§9.5 proposes silently stripping `type` from edit patches. An alternative: allow type changes with a warning dialog ("Changing from quantity to binary will not affect past logs, but your history chart will no longer show amounts"). This is more transparent but adds complexity to the edit flow.

**Resolve before Stage 2.1.**

### 12.4 Risk: `DatePicker` backdating limit may frustrate legitimate users

The 7-day limit in §3.3 is a judgment call. Users who travel internationally, are ill for a week, or use the app infrequently will hit it. The "Log older entry" escape hatch (a freeform date input with a friction warning) mitigates this but adds UX complexity. Consider making the limit configurable (default 7 days; user can extend to 30 days in Settings if they accept a disclaimer about streak integrity).

### 12.5 Risk: Energy cost on Trials may break early-game progression

Adding 1 energy per trial (§6.1) means the first 8 trials of the week cost 8 energy. A brand-new user with 2–3 habits (producing 2–3 energy/day) cannot run all 8 trials after completing their habits. This is actually the intended behavior, but it may feel punishing to beginners who just unlocked trials (at level 3). Mitigations:
- Free first 3 trials per day (see §6.1 alternative)
- Or: new users get 10 "free trial credits" that decay over the first 2 weeks
- Or: no energy cost for the first 7 days of play

**Decide before Stage 3.1.**

### 12.6 Dependency: Party quest rewards depend on per-member contribution tracking

Stage 5.1 (party quest rewards) requires the `contributions` JSONB column (§9.4) to be added to the DB before the reward RPC can distribute proportionally. The migration is a non-breaking addition to `party_quests`. Run it as `supabase/migrations/0006_party_quest_contributions.sql` before deploying the reward RPC.

### 12.7 Risk: `habit.type` immutability via `updateHabit`

If type changes are stripped silently and the user doesn't know, they may be confused when their edit form shows the type field as uneditable with no explanation. The guard in §9.5 should be paired with a UI change: grey out / disable the "Type" select in the edit form with a tooltip ("Type cannot be changed after creation — existing logs would become inconsistent").

### 12.8 Open: `recovery` item effect is undocumented

`content/items.ts:18` defines a `recovery` item with an effect described as "clears broken-streak penalty." No such penalty exists in the current habit engine (`engine/habits.ts` and `engine/xp.ts` have no broken-streak concept — the `recovery` flag in `resolveCompletion` is a bonus, not a penalty reversal). This item may be vestigial or may be intended for a future "missed habit penalty" system. Decide: is this item still planned? If not, remove it. If yes, design the penalty system before Stage 3 so the balance numbers account for it.

### 12.9 Follow-up: Server-side XP validation (long-term)

The "trust the client" model accepted in `docs/MULTIPLAYER_PLAN.md` is pragmatic for now but limits leaderboard integrity. The rate-limit approach in §7.5 is a soft guard. A proper server-side validation would require the server to recompute XP from the raw `habit.log` stored in the `saves.state` JSONB — possible via a Postgres function or Edge Function, but a significant undertaking. Flag this for consideration after the rest of the party improvements (Stage 5) are shipped and the player base grows large enough that leaderboard manipulation becomes a real concern.
