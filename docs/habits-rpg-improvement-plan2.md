# Habits RPG — Improvement Plan

## Purpose

This document turns the current technical/gameplay analysis of **Habits RPG** into a practical improvement roadmap.

The app is already built and has a strong foundation: a habit tracker, RPG progression, minigames, optional Supabase backend, parties, chat, leaderboards, co-op play, cloud saves, and a mature TypeScript/React architecture.

The main goal of this plan is **not** to add more game content immediately. The priority is to make the existing app clearer, more habit-focused, more balanced, easier to maintain, and safer to extend.

---

## Strategic Direction

### Core product principle

**Real-life habit completion should remain the center of the app.**

The RPG systems, Energy, loot, battles, parties, and minigames should all reinforce this core behavior:

> The player improves their real life, and the game world responds.

If a player can get more satisfaction from minigames than from completing habits, the product focus is drifting.

---

## Current Strengths to Preserve

### 1. Strong core loop

Current loop:

1. Log real-life habits.
2. Gain XP and Energy.
3. Spend Energy on minigames.
4. Earn loot, materials, items, and more progression.
5. Improve the character.
6. Use multiplayer/party features for motivation.
7. Repeat daily and weekly.

This loop is fundamentally good. Improvements should clarify and strengthen it, not replace it.

### 2. Good architecture

The project already has a useful separation of responsibilities:

- `engine/` contains pure game logic.
- `content/` contains data tables.
- `store/` orchestrates state.
- `hooks/` handle timing, sync, and realtime coordination.
- `views/` and `components/` handle UI.
- `net/` contains backend/network code.

Preserve this layering. New rules should go into pure engine functions where possible. UI should not accumulate gameplay math.

### 3. Offline-first design

The optional Supabase backend is a major strength. The app can run fully offline, but gains accounts, cloud saves, parties, chat, leaderboards, and co-op when configured.

Do not make new core features require Supabase unless there is a clear offline fallback.

### 4. Rich game systems

The app already has enough game content:

- Dungeon Delve
- Deep Mine
- Wild Forest
- Arena
- Hex Tactics
- Eight Skill Trials
- Classes
- Equipment
- Gear
- Crafting
- Relics
- Challenges
- Party quests
- Co-op modes

Because the content surface is already large, the next phase should focus on polish, balance, clarity, and habit-tracker depth.

---

# Priority Summary

## Highest priority

1. Make the habit dashboard the true main screen.
2. Improve habit creation, habit editing, and habit repair.
3. Clarify Training XP vs Hero Stats.
4. Rebalance habits vs minigame rewards.
5. Expand weekly planning and weekly review.
6. Strengthen party features around accountability.
7. Fix server-date usage for online daily/weekly systems.
8. Decide the anti-cheat/trust model.
9. Add tests around co-op, cloud sync, and risky edge cases.
10. Clean up stale documentation.

## Avoid for now

- Do not add another major minigame yet.
- Do not add more progression currencies until existing ones are clearer.
- Do not deepen multiplayer competition until the trust model is explicit.
- Do not make the app more complex before improving onboarding and habit UX.

---

> **Project status as of 2026-06-22:** All phases (1–8) have been completed, though
> implementation was non-linear — Phases 5–8 were worked on concurrently with earlier
> phases. Status markers under each heading reflect the current state. Phase 9 items are
> intentionally deferred. For tracked open items see the [Still open / deferred](#work-status)
> section near the end of this document.

---

# Phase 1 — Stabilize, Clarify, and Clean Up

> ✅ **Done** (2026-06-22)

## Goal

Make the app easier to understand, safer to modify, and less misleading for future development.

## 1. Rewrite `README.md`

### Problem

The current README is stale and describes some implemented systems as future work. This can mislead both human developers and coding agents.

### Tasks

- Rewrite the README to reflect the current app.
- Include:
  - What the app is.
  - How the core loop works.
  - Offline mode vs Supabase mode.
  - Current minigames.
  - Current multiplayer features.
  - Local development instructions.
  - Build/test/deploy instructions.
  - Current project structure.
- Remove or clearly archive outdated “not yet built” claims.

### Acceptance criteria

- A new developer can read the README and understand the current app.
- No implemented major feature is described as missing.
- Supabase setup is clearly marked optional.
- The README links to the current improvement plan and docs index.

---

## 2. Add `docs/INDEX.md`

### Problem

The docs folder contains many overlapping plans and analysis files. It is hard to tell which files are current.

### Tasks

Create a docs index with sections:

- Current canonical docs
- Architecture docs
- Gameplay/balance docs
- Minigame docs
- Multiplayer docs
- Archived/older plans
- Scratch notes

### Acceptance criteria

- Every major doc has a short description.
- Duplicate or older files are marked as superseded or archived.
- The current improvement plan is easy to find.
- Coding agents have an obvious starting point.

---

## 3. Clarify XP concepts in the UI

### Problem

The app has two XP/stat concepts:

- `statXp`: an effort ledger used for leveling.
- `statLevels`: actual combat stats used by game systems.

This is mechanically valid but confusing to users.

### Recommended terminology

Use clearer visible labels:

| Internal Concept | Suggested User-Facing Label |
|---|---|
| `statXp` | Training XP / Effort XP |
| `statLevels` | Hero Stats / Combat Stats |
| character level | Hero Level |
| level-up stat allocation | Growth Gains |

### Tasks

- Update Character view labels.
- Add a short explanation panel:
  - “Habits grant Training XP.”
  - “Training XP helps your hero level up.”
  - “When your hero levels up, your Hero Stats increase.”
- Add a “likely next stat gains” preview based on recent effort.
- Add tooltips or help text near stat bars.

### Acceptance criteria

- A user can understand why completing a Strength habit does not instantly increase combat Strength.
- The character page explains the relationship between habits, XP, level, and stats.
- The level-up screen shows which real habits contributed to stat growth.

---

## 4. Create a current roadmap document

### Problem

The app has many possible directions. Without a current roadmap, it is easy to add features randomly.

### Tasks

Create `docs/ROADMAP.md` with:

- Current phase
- Next planned milestone
- Deferred ideas
- Explicit non-goals
- Known risks
- Current design principle

### Acceptance criteria

- New work can be compared against the roadmap.
- “Should we build this now?” has a clear answer.
- Major postponed ideas are not forgotten.

---

# Phase 2 — Strengthen the Habit Tracker Core

> ✅ **Done** (2026-06-22)

## Goal

Make the app work better as a real habit tracker, not just as a game powered by a checklist.

---

## 1. Make the habit dashboard the command center

### Problem

The app has many tabs and game systems. The habit dashboard should remain the primary screen and should tell the user what matters today.

### Tasks

Improve the dashboard to show:

- Today’s habits.
- Energy earned today.
- Energy spent today.
- Current streaks.
- Focus habits.
- Missed habits.
- Weekly progress.
- Mood/load warning.
- Recommended next action.
- Quick access to weekly review.
- Quick access to recovery mode when struggling.

### Suggested dashboard sections

1. **Today’s Training**
   - Habit list.
   - Completion status.
   - XP/Energy reward preview.

2. **Current Momentum**
   - Streaks.
   - Weekly completion rate.
   - Recent trend.

3. **Hero Progress**
   - Energy earned today.
   - Training XP gained today.
   - Level progress.

4. **Recommended Action**
   - “Finish your focus habit.”
   - “You have earned enough Energy for one dungeon run.”
   - “You are overloaded; consider reducing today’s load.”
   - “You missed this habit three times recently; repair it?”

### Acceptance criteria

- The user can open the app and immediately know what to do.
- The habit screen feels more important than the minigame tabs.
- The dashboard connects habit completion to game progress clearly.

---

## 2. Add guided habit creation

### Problem

Habit setup has many choices: stat, type, target, unit, frequency, difficulty, tag, uncapped behavior, and status. This is powerful but can overwhelm users.

### Tasks

Add a guided habit creation flow.

### Suggested flow

#### Step 1 — Choose a habit category

Examples:

- Fitness
- Reading
- Writing
- Study
- Sleep
- Cleaning
- Social
- Creative work
- Meditation
- Custom

#### Step 2 — Choose tracking type

- Yes/no
- Minutes
- Pages
- Reps
- Sessions
- Custom quantity

#### Step 3 — Choose frequency

- Daily
- Weekdays
- Specific days
- X times per week
- As needed

#### Step 4 — Choose difficulty

Use plain-language guidance:

- Easy: “Small enough to do even on a bad day.”
- Normal: “A solid daily effort.”
- Hard: “Requires planning or discipline.”
- Epic: “A major effort, not for every habit.”

#### Step 5 — Assign stat

Suggest a stat automatically based on category, but allow override.

Examples:

- Fitness → Strength, Endurance, Agility, HP
- Reading → Knowledge or Wisdom
- Writing → Knowledge or Charisma
- Cleaning → Endurance
- Social → Charisma
- Meditation → Wisdom

#### Step 6 — Confirm reward preview

Show:

- XP per completion
- Energy per completion
- Weekly expected XP
- Stat trained

### Acceptance criteria

- A new user can create a sensible habit without understanding all mechanics.
- The default values are conservative and sustainable.
- Advanced options remain available but are not required.

---

## 3. Add habit templates

### Problem

Blank habit creation can create friction. Templates help users start quickly and avoid bad setups.

### Suggested templates

#### Beginner Fitness

- Walk 10 minutes
- Stretch
- Drink water
- Sleep before target time

#### Reading Routine

- Read 10 pages
- Review notes
- No-phone reading block

#### Writing Practice

- Write 250 words
- Edit one section
- Brainstorm ideas

#### Study Plan

- Study 25 minutes
- Review flashcards
- Summarize one concept

#### Chore Reset

- Clean one surface
- Laundry step
- Dishes
- 10-minute tidy

#### Social Confidence

- Message a friend
- Practice conversation
- Attend/plan one social activity

### Acceptance criteria

- Users can start with a useful habit set in under two minutes.
- Templates produce balanced stat coverage.
- Templates avoid creating too many daily habits at once.

---

## 4. Add habit health warnings

### Problem

The app already warns about high daily habit load, but it can become more useful.

### Suggested warnings

- Too many daily habits.
- Habit missed repeatedly.
- Habit target may be too high.
- Habit is too easy and always completed.
- Quantity habit has frequent partial completions.
- User is consistent on weekdays but weak on weekends.
- User has too many habits mapped to one stat.
- User has not completed any habit today.
- User has not used a habit in several weeks.

### Suggested actions

Each warning should offer a fix:

- Lower target.
- Change frequency.
- Suspend temporarily.
- Retire habit.
- Split into smaller habit.
- Convert daily habit to times-per-week.
- Mark as focus habit.
- Change difficulty.

### Acceptance criteria

- Warnings are specific and actionable.
- The app does not shame the user.
- Each warning leads to a useful edit or recovery action.

---

## 5. Add recovery mode

### Problem

Users will miss days. The app should help them return instead of making them feel punished.

### Tasks

Add a recovery mode triggered by:

- Several missed scheduled habits.
- Long absence.
- Low weekly completion rate.
- User manually choosing “I’m struggling.”

### Recovery mode features

- Temporarily reduce daily targets.
- Suggest suspending non-essential habits.
- Highlight only focus habits.
- Offer a “Return to Training” challenge.
- Give a small recovery bonus for resuming.
- Avoid harsh language.

### Example recovery flow

1. “Looks like this week got rough.”
2. “Pick 1–3 habits to keep alive.”
3. “Suspend the rest until next week?”
4. “Complete one small action today to restart momentum.”

### Acceptance criteria

- A returning user has a clear path back.
- Recovery mode reduces friction.
- Missed days become a restart moment, not a reason to quit.

---

# Phase 3 — Weekly Planning and Review

> ✅ **Done** (2026-06-22)

## Goal

Turn the app into a weekly self-improvement loop, not just a daily checklist.

---

## 1. Expand weekly planning

### Tasks

At the start of each week, allow the user to choose:

- 1–3 focus habits.
- A weekly stat focus.
- A weekly challenge.
- A realistic Energy target.
- Optional party pledge.

### Suggested UI

A “Plan Your Week” modal:

- “What matters most this week?”
- “Choose your focus habits.”
- “Choose your training focus.”
- “Choose a challenge.”
- “Confirm your weekly quest.”

### Acceptance criteria

- The user can define a weekly focus in under one minute.
- Weekly focus habits are highlighted on the dashboard.
- The weekly plan feeds into reports and rewards.

---

## 2. Improve weekly review

### Tasks

Expand the weekly report to include:

- Overall completion rate.
- Completion by habit.
- Completion by stat.
- Energy earned.
- Energy spent.
- XP earned from habits.
- XP earned from minigames.
- Best streak.
- Most improved habit.
- Most missed habit.
- Suggested adjustment.

### Suggested review categories

#### Victory

What went well?

#### Struggle

What was missed?

#### Adjustment

What should change next week?

#### Reward

What did the hero gain?

### Acceptance criteria

- The weekly review gives useful insight, not just stats.
- The app suggests at least one practical adjustment.
- Weekly review reinforces the link between real habits and game progress.

---

## 3. Add habit analytics

### Tasks

Create a habit analytics page or modal with:

- Calendar heatmap.
- Completion rate by habit.
- Completion rate by weekday.
- Current streaks.
- Longest streaks.
- XP by stat.
- Energy earned by day.
- Energy spent by activity.
- Habit load over time.
- Best and worst time periods.

### Acceptance criteria

- Users can identify which habits are working.
- Users can identify which habits need adjustment.
- Analytics are readable without being overwhelming.

---

# Phase 4 — Progression and Balance

> ✅ **Done** (2026-06-22)

## Goal

Ensure the RPG systems support habit formation instead of overpowering it.

---

## 1. Add an internal balance report

### Problem

The app needs visibility into how much progression comes from habits versus minigames.

### Tasks

Create a developer-only or settings-accessible balance report showing:

- XP earned from habits.
- XP earned from minigames.
- XP earned from challenges.
- Gold earned from minigames.
- Gold earned from challenges.
- Energy earned.
- Energy spent.
- Average reward per Energy.
- Average XP per habit.
- Average XP per minigame.
- Fastest route to leveling.
- Stat distribution over time.

### Acceptance criteria

- It is possible to see whether minigames are overpowering habit rewards.
- Balance issues can be diagnosed using real save data.
- The report can be hidden from normal users if desired.

---

## 2. Rebalance minigame rewards

### Design rule

**Habits should be the main source of long-term character growth. Minigames should be the fun conversion layer.**

### Possible changes

- Habits give most Training XP.
- Minigames give mostly gold, loot, materials, and side rewards.
- Cap daily minigame-derived stat XP.
- Increase rewards for playing after completing focus habits.
- Reduce rewards for repeated grinding.
- Improve rewards for consistent real-world completion.

### Suggested reward hierarchy

| Source | Primary Reward | Secondary Reward |
|---|---|---|
| Habits | Training XP, Energy | Streaks, mood, challenge progress |
| Challenges | Focused XP, gold, items | Motivation |
| Minigames | Loot, materials, gold | Some XP |
| Weekly review | Bonus rewards | Insight |
| Party quests | Social rewards, gold | Accountability |

### Acceptance criteria

- A player cannot progress optimally by ignoring real habits.
- Minigames feel rewarding but not mandatory.
- Habit completion remains the best long-term path.

---

## 3. Improve Energy meaning

### Problem

Energy is currently +1 per habit completion and spent on minigames. This is good, but the connection should be more visible.

### Tasks

- Show which habits generated today’s Energy.
- Show “You earned this adventure” before spending Energy.
- Add daily Energy summary.
- Add weekly Energy summary.
- Consider focus-habit Energy bonuses.
- Consider Energy decay or soft caps only if hoarding becomes a problem.

### Acceptance criteria

- Energy feels like real-world effort converted into adventure.
- Players understand why they can or cannot play.
- Energy does not feel like an arbitrary mobile-game stamina system.

---

## 4. Add “before adventure” ritual

### Purpose

Reinforce the idea that minigames are powered by real completed habits.

### Example

Before starting a dungeon:

> “This delve is powered by today’s training:
> - Workout: +1 Energy
> - Read 10 pages: +1 Energy
> - Clean kitchen: +1 Energy”

Then:

> “Spend 3 Energy to enter?”

### Acceptance criteria

- Every Energy-spending activity reminds the player that real habits enabled it.
- This reminder is short and not annoying.
- The player can disable or minimize it after repeated exposure.

---

# Phase 5 — Multiplayer and Accountability

> ✅ **Done** (2026-06-22)

## Goal

Make party features reinforce real habit completion, not just multiplayer gameplay.

---

## 1. Add party accountability tools

### Suggested features

- Party focus habit display.
- Daily party progress summary.
- Weekly party recap.
- Cheer button.
- Gentle nudge button.
- Shared party streak.
- Party pledge for the week.
- “Campfire” feed of completed focus habits.
- Party quest progress tied to real habit completions.

### Acceptance criteria

- Party members can encourage each other.
- Party systems make users more likely to complete habits.
- Social features do not become spammy or shame-based.

---

## 2. Improve party habit visibility controls

### Problem

The backend supports party-visible habit data. The UI should make privacy clear.

### Tasks

- Add explicit opt-in/out controls.
- Let users choose which habits are visible.
- Let users hide habit names while sharing completion status.
- Add “visible to party” labels.
- Add preview of what party members can see.

### Acceptance criteria

- Users understand what they are sharing.
- Habit visibility is never surprising.
- Privacy controls are easy to find.

---

## 3. Add party weekly quests

### Tasks

Add weekly party quests such as:

- Complete 25 total focus habits.
- Earn 100 total Energy.
- Have each member complete at least one habit.
- Maintain a 3-day party streak.
- Complete 10 study-related habits.
- Complete 10 fitness-related habits.

### Acceptance criteria

- Party quests reward cooperation, not just the strongest player.
- Contribution tracking is clear.
- Rewards are fair to participating members.

---

## 4. Improve co-op reliability

### Risks to address

- Host disconnect mid-run.
- Late join after state changes.
- Broadcast loss.
- Stale floor/state.
- Guest reconnect.
- Host authority edge cases.

### Tasks

- Add protocol tests.
- Add reconnect behavior.
- Add host-disconnect messaging.
- Add “session ended” state.
- Add guardrails for stale messages.
- Consider host migration only if needed later.

### Acceptance criteria

- Co-op failure cases are handled gracefully.
- Players are not left in confusing broken states.
- The most common desync cases have tests.

---

# Phase 6 — Online Trust, Server Time, and Fairness

> ✅ **Done** (2026-06-22)

## Goal

Make online features fair enough for parties and leaderboards without overbuilding competitive anti-cheat.

---

## 1. Wire `server_now()` into online date-sensitive systems

### Problem ✅ resolved

~~The backend includes a server clock function, but the client appears to rely mostly on local device time for daily and weekly gates.~~

**Shipped (2026-06-22).** `src/net/clock.ts::syncServerClock()` fetches `server_now()` with RTT compensation and calls `src/engine/date.ts::setClockOffset()`. Every daily/weekly gate routes "today" through `engine/date.ts::toISODate()` → `now()`, which applies the offset — a single injectable chokepoint, so no per-call-site changes were needed. `App.tsx` gates the startup `normalizeHabits()`/`checkWeeklyRollover()` calls on `clockReady` so the very first evaluation also uses server time rather than device time. When the backend is unconfigured, the offset stays 0 and device time is used unchanged.

### Tasks

Use server date when online for:

- Daily trial reset.
- Weekly rollover.
- Party quest contribution dates.
- Public snapshot timestamps.
- Leaderboard-relevant habit score.
- Any future daily reward systems.

### Offline fallback

When offline:

- Use local device date.
- Mark the source as local if needed.
- Sync carefully when the user comes back online.

### Acceptance criteria

- Changing the device clock does not easily manipulate online daily/weekly systems.
- Offline mode still works.
- Server/local date differences are handled gracefully.

---

## 2. Decide the trust model

### Option A — Friendly trust model

Best for friends, families, and small groups.

- Keep client-trusted saves.
- Use light server-date validation.
- Add soft suspicious-activity checks if needed.
- Label leaderboards as motivational.

### Option B — Competitive trust model

Needed only if public competition matters.

- Server validates habit events.
- Server calculates leaderboard fields.
- Client cannot directly upload total XP or score.
- Daily caps are enforced server-side.
- Suspicious saves are rejected or flagged.

### Recommendation

Use **Option A** for now.

This keeps development manageable and matches the likely social use case. Do not heavily invest in anti-cheat unless public competitive leaderboards become central.

**Decided 2026-06-22.** Option A is implemented. See `docs/trust-model.md` for the full decision record, what the server defends against (clock manipulation via `server_now()`, ownership via RLS), and what it does not (save editing, leaderboard accuracy, daily caps).

### Acceptance criteria

- The chosen trust model is documented.
- Leaderboard design matches the trust model.
- Future developers do not accidentally assume the app is cheat-proof.

---

# Phase 7 — Technical Debt and Test Coverage

> ✅ **Done** (2026-06-22) — helper named `commitRun` (not `commitRunOutcome`); RNG file is `src/store/runRng.ts` (not engine/); all 8 trials uniform.

## Goal

Reduce maintenance risk before adding more large systems.

---

## 1. Refactor repeated minigame commit logic

### Problem

Mining, Forest, Arena, Tactics, and related death/finish handlers share similar reward, history, cleanup, and level-check behavior.

### Tasks

Create shared helpers for common run completion steps:

- Apply rewards.
- Add history entry.
- Clear active run.
- Check level-up.
- Update best depth/tier.
- Handle death reward retention.
- Handle cloud-save-safe transient cleanup.

### Suggested helper shape

```ts
commitRunOutcome({
  state,
  runType,
  reward,
  historyEntry,
  clearRun,
  updateProgress,
  deathMode,
  checkLevelUpAfter,
});
```

### Acceptance criteria

- Repeated commit logic is reduced.
- Behavior remains unchanged.
- Existing tests pass.
- New tests cover shared run outcome behavior.

---

## 2. Move hidden mutable RNG state toward explicit run state

### Problem

Module-scope RNG state works but can surprise future maintainers, tests, or complex run scenarios.

### Tasks

- Audit current `runRng.ts` usage.
- Document why RNG is outside persisted save.
- Consider storing explicit seeds/counters in transient run state.
- Ensure tests reset RNG state cleanly.
- Avoid breaking deterministic co-op map generation.

### Acceptance criteria

- RNG behavior is documented.
- Tests cannot accidentally leak RNG state.
- Future co-op features have a clear RNG pattern to follow.

---

## 3. Add tests for risky systems

### Highest-value tests

#### Cloud save

- Pull refuses while run is active.
- CAS conflict causes re-pull.
- Account switch wipes local save.
- Sign-out clears local cache.
- Migration runs on pulled cloud blob.

#### Party quests

- Contribution counts are accumulated correctly.
- Rewards only apply to contributors.
- Duplicate claims are blocked.
- Leaving party does not corrupt quest state.

#### Co-op protocol

- Stale world state is ignored.
- Stale floor messages are ignored.
- Guest join initializes correctly.
- Host disconnect is handled.
- Guest reconnect is handled.
- Tile changes are shared correctly.

#### Daily/weekly reset

- Server date is used online.
- Local date is used offline.
- Timezone edge cases are handled.
- Weekly rollover is not double-applied.

### Acceptance criteria

- The riskiest non-engine systems have test coverage.
- Tests focus on pure logic where possible.
- Co-op and cloud behavior can be refactored with confidence.

---

## 4. Normalize Skill Trial structure

### Problem

Seven trials have dedicated engine files, while Spirit Grove is structured differently.

### Tasks

- Decide whether Spirit Grove should get `engine/trials/spiritGrove.ts`.
- If yes, move logic there.
- Keep content data in `content/trials.ts`.
- Keep component code UI-only.

### Acceptance criteria

- All trials follow the same pattern.
- Future trial work is easier.
- Component code does not contain avoidable game logic.

---

# Phase 8 — Onboarding and User Experience Polish

> ✅ **Mostly done** (2026-06-22) — gap: the full guided onboarding *sequence* (step-by-step walkthrough from "complete first habit → show first reward → unlock dashboard") is not yet built. `CreationView` (with starter-habit template picker) and a one-time `WelcomeCard` cover the basics.

## Goal

Make the app easier to start, understand, and keep using.

---

## 1. Add first-run onboarding

### Suggested onboarding sequence

1. “This is a habit tracker that powers an RPG.”
2. Create character.
3. Choose 3 starter habits.
4. Explain Energy.
5. Explain Training XP.
6. Complete first habit.
7. Show first reward.
8. Unlock the dashboard.

### Acceptance criteria

- A new user understands the core loop within five minutes.
- The user creates a reasonable starting habit list.
- The first reward moment happens quickly.

---

## 2. Improve empty states

### Areas needing empty states

- No habits.
- No completed habits today.
- No challenges.
- No party.
- No inventory items.
- No minigame history.
- No weekly report yet.
- No visible party habits.

### Acceptance criteria

- Empty screens explain what to do next.
- Empty states include direct action buttons.
- The tone is encouraging and fantasy-themed without being confusing.

---

## 3. Improve mobile/responsive experience

### Tasks

- Audit all major screens on narrow widths.
- Check minigame overlays.
- Check tab navigation.
- Check modals.
- Check party chat.
- Check inventory.
- Check character stats.
- Check habit editing forms.

### Acceptance criteria

- Core habit logging works well on mobile.
- No important controls are too small.
- Minigames are either playable or clearly marked as better on desktop.
- Layouts do not overflow.

---

## 4. Replace placeholder art gradually

### Strategy

Do not block gameplay improvements on art. Replace placeholders by priority:

1. Core habit/dashboard icons.
2. Player character/class icons.
3. Common items/materials.
4. Minigame enemies and tiles.
5. Relics and advanced gear.
6. Cosmetic/flavor assets.

### Acceptance criteria

- Most frequently seen placeholder art is replaced first.
- Remaining placeholder art is tracked.
- Art style remains consistent.

---

# Phase 9 — Possible Future Features

> ⏳ **Deferred** — intentionally out of scope until Phases 1–8 are stable and the habit core is stronger.

These are good ideas, but should come after the habit core is stronger.

---

## 1. Habit chains

Allow habits to depend on each other:

- Morning routine
- Workout sequence
- Study block
- Evening shutdown

Example:

1. Put on workout clothes.
2. Stretch.
3. Exercise.
4. Log workout.
5. Cool down.

---

## 2. Bosses based on real-life obstacles

Let users define recurring obstacles:

- Procrastination
- Bad sleep
- Doomscrolling
- Skipping workouts
- Avoiding chores

These could become named bosses or weekly rivals.

---

## 3. Seasonal events

Add limited-time events tied to habit consistency:

- Spring Training
- Summer Expedition
- Autumn Harvest
- Winter Trial

Keep rewards mostly cosmetic or side-grade to avoid balance problems.

---

## 4. Class-specific habit bonuses

Once the class system is clearer, add class-flavored habit bonuses.

Examples:

- Scholar: bonus for reading/study streaks.
- Warrior: bonus for exercise consistency.
- Bard: bonus for social/creative habits.
- Ranger: bonus for outdoor/walking habits.

Avoid making classes too restrictive.

---

## 5. Smarter recommendations

Eventually, the app could recommend:

- Which habit to lower.
- Which habit to suspend.
- Which stat is neglected.
- Which challenge fits the week.
- Which minigame gives useful materials.
- Whether the user is overcommitted.

Start with rule-based recommendations before considering anything more complex.

---

# Implementation Rules for Future Work

## Keep habit tracking central

Before adding a feature, ask:

> Does this make the user more likely to complete real habits?

If the answer is no, defer it.

---

## Keep the engine pure

Gameplay rules should live in `engine/` where possible.

Avoid putting rules directly into React components.

---

## Preserve offline mode

Every core feature should work without Supabase unless explicitly designed as online-only.

---

## Be careful with persisted state

Any persisted shape change needs:

- version bump
- migration
- merge fallback
- cloud save compatibility
- tests if high risk

---

## Keep new subscribers cheap

Real-time minigames mutate store state frequently. Avoid adding expensive subscribers that run on every tick.

---

## Prefer clarity over cleverness

This app already has many systems. New systems should make the experience easier to understand, not harder.

---

# Work Status

Quick-start tasks listed when this plan was written, and their current status:

| Task | Description | Status |
|---|---|---|
| 1 | Documentation cleanup — README, INDEX, ROADMAP, stale doc markers | ✅ Done — README rewritten, `docs/INDEX.md` exists, `docs/trust-model.md` created; ROADMAP folded into this doc (status markers above) |
| 2 | Habit dashboard upgrade — Energy today, weekly progress, focus habits, warning panel | ✅ Done |
| 3 | XP/stat clarity — Training XP / Hero Stats labels, explanatory text, gain preview | ✅ Done |
| 4 | Guided habit creation — template-based starter habits, stat mapping, reward preview | ✅ Done — template picker in `CreationView` |
| 5 | Server date integration — `server_now()` for online gates, local fallback, tests | ✅ Done — `net/clock.ts` + `engine/date.ts` seam; `clockReady` gate in `App.tsx` |
| 6 | Balance report — developer audit doc | ✅ Done — `docs/balance-audit.md` (2026-06-17) |
| 7 | Co-op and cloud tests — protocol, CAS conflict, party quest contribution | ✅ Done — cloudSave, party, co-op reducer, and daily/weekly reset test suites |

---

## Still open / deferred

Verified as not yet implemented as of 2026-06-22. Not blocking the current roadmap but tracked here so they are not lost:

| Item | Details | Priority |
|---|---|---|
| **Co-op staleness guard** | `src/hooks/useTacticsCoopSession.ts:68-71` — guard compares host timestamp `t` against the guest's local `performance.now()` (per-machine, not aligned). Never compares against the current state's own timestamp. Needs a host-relative clock offset per `docs/archived/MULTIPLAYER_PLAN.md:257`. | Real bug |
| ~~5 dead Tactics spells~~ | ✅ Fixed (verified 2026-07-05) — `isTacticsLoadoutSpell()` (`hexBattle.ts:76-82`) now filters any spell with a `mechanic` field out of the Tactics loadout picker, so `rune-fire`/`rune-ice`/`rune-poison`/`ring-of-fire`/`teleport` are no longer selectable. | Done |
| **5 spellbooks missing from `SPELLBOOK_KEYS`** | `src/lib/sprites.ts:145` — `spellbook_fire_rune`, `_ice_rune`, `_poison_rune`, `_ring_of_fire`, `_chaotic_blink` not in the key array; render as generated placeholders. See `docs/placeholder-art-tracking.md`. | Cosmetic |
| **Guided onboarding sequence** | Full step-by-step walkthrough (complete first habit → show first reward → unlock dashboard) not yet built. `CreationView` + `WelcomeCard` cover the basics; no enforced tutorial gating. | UX gap |
| **Co-op desync edge cases** | Host disconnect strands guest mid-run, late-join, broadcast loss. Reducer unit tests exist; no integration-level network-layer tests. See `docs/habits-rpg-game-analysis.md:675`. | Medium |
| **Dungeon death loot loss** | Discrete loot (spellbooks, weapons, gear) lost on dungeon death — penalty may feel disproportionate. See `docs/dungeon-delve-improvement-plan.md:130`. | Design call |
| **`pendingLevelUp` mid-dungeon edge case** | `checkLevelUp` early-returns when `state.battle` is set; dungeon XP only flags a deferred level-up. Possible edge-case bugs around leveling mid-dungeon. See `docs/habits-rpg-game-analysis.md:685`. | Edge case |

---

# Success Criteria for the Next Major Version

The next major version should be considered successful if:

1. New users understand the app faster.
2. Habit creation is easier.
3. The dashboard clearly tells the user what to do today.
4. Habit completion feels more important than minigame grinding.
5. Weekly review helps users adjust their real habits.
6. Online daily/weekly systems use server time when available.
7. Documentation matches the actual app.
8. The riskiest multiplayer/cloud systems have basic tests.
9. No new major minigame was needed to make the app feel better.
10. The app feels more like a habit coach wrapped in an RPG, not an RPG that happens to have habits.

---

# Final Recommendation

The strongest next move is:

> **Deepen the habit-tracking experience before expanding the game.**

The RPG layer is already substantial. The app will improve most by making habit setup, habit review, habit recovery, and habit-to-progression feedback clearer and more satisfying.

Once the habit core is stronger, every existing minigame and multiplayer feature will feel more meaningful.
