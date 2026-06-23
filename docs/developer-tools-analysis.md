# Developer Tools Analysis

> **Status (2026-06-23): all bugs and gaps identified in this document have been resolved.**
> The improvement plan (`docs/archived/developer-tools-improvement-plan.md`) was fully implemented in the
> same session. This document is kept as historical context. For current behaviour, see the README's
> "Developer (creative) mode" section.

---

> Settings → Developer section. All tools live in `src/views/SettingsView.tsx` (lines 271–468); backing actions are in `src/store/slices/coreSlice.ts`.

---

## Overview

The Developer panel is labeled *"Creative mode — for exploring features freely. Not meant for normal play; toggles persist across reloads."* It is always visible (not gated by an env var or build flag) and contains five persistent toggles, one analytics modal, and four groups of one-shot action buttons. A "Dev" badge in the header lights up whenever any of the three cheat flags are active.

---

## Toggles

### Adventure Ritual (`settings.showAdventureRitual`, default: `true`)

Shows a pre-entry checklist modal before each minigame listing today's completed habits and the energy cost. Consumed in `DungeonView`, `MiningView`, `ForestView`, `ArenaView`, and `TrialsView`.

**Correctness:** Works as described. The modal is gated on this flag at every entry point consistently. Dismissing via the modal's "don't show again" also writes `showAdventureRitual: false` back to settings.

**Classification concern:** This is a legitimate user-facing UX feature toggle, not really a developer tool. It belongs in General settings, not the Developer section.

---

### Unlimited Gold (`settings.unlimitedGold`, default: `false`)

Purchases and crafting ignore their gold cost. The header replaces the gold count with `∞`.

**Where enforced:**
- `economySlice.ts` → `buyItem()`, `buyWeapon()`, `craft()`
- `dungeonSlice.ts` → `dungeonBuy()` (merchant rooms)

**Correctness:** All gold-spending paths check this flag. Gold balance is never deducted when enabled; item acquisition proceeds normally. ✓

---

### Unlimited Energy (`settings.unlimitedEnergy`, default: `false`)

Entering any minigame does not deduct energy. The header replaces the energy count with `∞`.

**Where enforced:**
- `dungeonSlice.ts` → `startDungeon()`
- `miningSlice.ts` → `beginMining()`
- `forestSlice.ts` → `beginForest()`
- `arenaSlice.ts` → `beginArena()`

**Correctness:** Every minigame entry checks this flag before deducting. ✓

**Gap:** Skill Trials consume energy too (1 per trial), but `trialsSlice.ts::completeTrial()` deducts energy unconditionally—`unlimitedEnergy` is never checked there. A player testing trials with Unlimited Energy on will still lose 1 energy per completion. This is inconsistent with the description "Enter dungeons without spending energy." (The description says "dungeons" specifically, but the toggle's intent is clearly broader.)

---

### Invincibility (`settings.invincible`, default: `false`)

HP, MP, and stamina are topped up to maximum after every combat action; the "lost" battle status is overwritten back to "active."

**Where enforced:**
- `battleSlice.ts` → `battleAction()` — calls `topUpFighter()` each turn
- `dungeonSlice.ts` → `dungeonEncounterChoose()` — tops up HP/MP/STA post-choice; `dungeonBattleAction()` — calls `topUpFighter()` each turn
- `arenaSlice.ts` — passes `invincible: s.settings.invincible` into arena init state

**Correctness:** ✓ Works reliably. Damage is still recorded in combat stat trackers (which is correct—the telemetry remains meaningful), but you can never be defeated.

**Minor note:** The Dungeon's `dungeonEncounterChoose()` tops up *after* applying the choice's damage, so for a single tick the HP register goes negative before being reset. The display never shows the negative value because this all happens in one state update, so there is no visible bug.

---

### Repeat Skill Trials (`settings.repeatMinigames`, default: `false`)

**Described as:** "Skip the once-per-day gate — trials can be replayed immediately."

**Actual behavior in `trialsSlice.ts`:**
```typescript
if (!s.settings.repeatMinigames && s.trialsClearedOn[trialId] === today) return s;         // daily gate
if (!s.settings.repeatMinigames && !statCompletedWithin(s.habits, def.stat, today, 7)) return s;  // stat gate
```

This flag bypasses **both** gates: the daily clear gate *and* the stat-activity gate (which requires at least one completion of that stat's habits within the past 7 days).

**Correctness issue:** The UI description is incomplete. It says only "skip the once-per-day gate," but the flag also removes the requirement to have trained the corresponding stat recently. A developer testing trial mechanics without any habits set up needs `repeatMinigames: true`—the description should mention this.

---

## Balance Report

**Button:** "Balance Report" (opens `BalanceReportModal`)

Displays cumulative XP/gold/count tallied per earning source since save v25 (`state.earnings`), plus per-day energy flow (`state.energyLog`). Sources tracked: `habit`, `mine`, `forest`, `arena`, `tactics`, `dungeon`, `trial`, `challenge`, `boss`.

**Correctness:** Works as described. Data is accurate for any session started or migrated to v25+.

**Gaps:**
- No way to reset the earnings ledger in isolation (without a full game reset). When testing a specific economic scenario you can't zero the history without wiping the whole save.
- The UI shows historical sums but no time-range filter, making it hard to isolate a specific testing session's results.

---

## Testing Jumps — Set Level

**Buttons:** Lv 3, Lv 5, Lv 10, Lv 20, Lv 50

**Store action:** `devSetLevel(target: number)` in `coreSlice.ts:100–119`

```typescript
devSetLevel: (target) =>
  set((s) => {
    const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(target)));
    const total = cumulativeXpToReach(level);
    const per = Math.floor(total / STAT_IDS.length);
    const remainder = total - per * STAT_IDS.length;
    const statXp = emptyStatXP();
    STAT_IDS.forEach((id, i) => {
      statXp[id] = per + (i === 0 ? remainder : 0);
    });
    return {
      character: { ...s.character, level, statXp, statXpAtLastLevel: { ...statXp } },
      pendingLevelUp: null,
    };
  }),
```

**What it does:**
- Sets `character.level` to the target (clamped to `[1, MAX_LEVEL]`)
- Distributes the cumulative XP for that level evenly across all 8 stats
- Sets `statXpAtLastLevel` equal to `statXp`, so the XP delta for the next level-up starts at zero
- Clears any pending level-up trial
- Unlocks dungeon access at level ≥ 3, Skill Trials at level ≥ 5, class assignment at level ≥ 10

**Critical gap — `statLevels` are not updated.** `character.statLevels` are the actual combat values used everywhere: `deriveCombatant()` for battle stats, `dungeonStamina()` for dungeon stamina, stat-check rolls in dungeon encounters, and the stat display in `CharacterView`. These values are only incremented by `applyLevelUp()` (called when a boss trial is won). `devSetLevel` skips all level-up events, so jumping to Lv 50 via this button gives the character the Lv 50 label and XP budget but leaves combat stats frozen at whatever they were before the jump (base 1 for a fresh character, or whatever accumulated through real play).

For a freshly-reset character, `devSetLevel(10)` → `statLevels` stay at {ST:1+, DX:1+, ...} from character creation while the character is nominally level 10. Any feature gated on stat *levels* (e.g. dungeon encounter scaling, class synergy bonuses) won't reflect the jumped level. The level jump is useful for unlocking gated content, but not for testing combat balance at high levels.

**Suggestion:** Either synthesize appropriate `statLevels` when jumping (e.g. simulate N level-ups with even XP distribution), or add a separate "Set stat level" control.

---

## Testing Jumps — Deepest Floor

**Buttons:** Reset (Floor 0), Floor 5, Floor 8, Floor 10

**Store action:** `devSetDeepestFloor(n: number)` → `set(() => ({ deepestFloor: Math.max(0, Math.floor(n)) }))`

**What it unlocks:**
- Floor 5 → merchant rooms appear in dungeon runs
- Floor 8 → elite combat rooms appear
- Floor 10 → Tier-3 relic rooms unlock

**Correctness:** ✓ Simple and correct. The deepest floor record is read only at dungeon entry to populate the room pool, so changes take effect on the next run.

**Minor gap:** There is no Floor 3 jump, even though Floor 3+ is technically a milestone (beyond Floor 0/1 content). All present jumps align with the content gate comments in the UI hint, so this is acceptable.

---

## Testing Jumps — Spawn Boss Trial

**Buttons:** Slime (Lv 5), Guardian (Lv 10), Golem (Lv 20)

**Store action:** `devSpawnTrial(level: number)` in `coreSlice.ts:124–131`

```typescript
devSpawnTrial: (level) =>
  set((s) => {
    if (s.battle) return s;
    const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
    const boss = bossForLevel(target);
    const battle = createBattle(fighterFor(s), boss, { lossesBefore: s.bossLosses[target] ?? 0 });
    return { pendingLevelUp: target, battle };
  }),
```

The `spawn()` wrapper in `SettingsView` also calls `onClose()` to dismiss settings so the `BattleOverlay` becomes visible.

**Correctness:** ✓ Boss anti-frustration scaling (`bossLosses`) is respected. Winning the fight calls `applyLevelUp()` and properly advances the character (including updating `statLevels`).

**Gap — silent no-op when a battle already exists.** If a battle is already in progress, `devSpawnTrial` returns the current state unchanged. The settings panel closes (from the wrapper), but nothing happens—no battle is shown because the existing one takes precedence, and no feedback is given. The developer has to navigate away, find and dismiss the existing battle, and try again. A guard message or a console warning would help.

**Gap — only three bosses available.** There is no Lv 20+ (Golem is the highest). Developers cannot spawn a Lv 30, Lv 40, or Lv 50 boss trial to test high-level combat scaling, even though `bossForLevel` likely supports them.

---

## Class Assignment

**Controls:** Primary stat dropdown + Secondary stat dropdown → class preview → "Assign" / "Clear"

**Store actions:**
- `chooseClass(primary, secondary)` — derives class via `classFor()`, writes `character.classId`, adds to codex, clears `pendingClassChoice`
- `devClearClass()` — sets `character.classId` to `null`

**Correctness:** ✓ Class derivation is live-previewed. "Assign" respects the existing `chooseClass` logic (including codex recording), and "Clear" properly nulls out the class so it can be reassigned. The normal Level 10 gate is bypassed, which is appropriate for dev testing.

**Minor gap:** Reassigning via "Assign" without first pressing "Clear" silently overwrites the existing class. This is fine for a dev tool but it means `chooseClass` is called even when a class is already set (which is normally blocked in the production flow by `pendingClassChoice`). No negative side effects were found, but it is worth noting that the class gets re-added to the codex on every "Assign" click (deduplicated by the includes check, so it's safe).

---

## Reset Game (General section, not Developer section)

**Button:** "Reset game" — a small destructive link in the General panel, confirmed by a `window.confirm` before firing.

**Store action:** `resetGame()` in `coreSlice.ts:136–177`

**What it resets:** habits, character (via `freshCharacter()`), inventory, materials, spells, weapons, combat stats, codex, challenges, custom challenges, week key, pending reports, all minigame active states, all depth records, trial records, level-up and class-choice queues, dungeon history, completion log, settings (via `freshSettings()`), onboarding flags, earnings ledger, energy log.

**Gaps — two state fields are not reset:**

1. **`mineTombstone`** (`shared.ts:246`) — the haul record left by the most recent mine death. After a full game reset, a fresh character may see a ghost tombstone from a past life if the resurrection UI surfaces it.

2. **`claimedPartyQuests`** (`shared.ts:283`) — the set of party quest IDs whose gold reward has already been credited. After reset, those quest IDs are still marked claimed, so a fresh character that re-joins the same party quest cannot claim the reward again. (Minor; only affects multiplayer scenarios.)

---

## Missing Tools

The following capabilities would be useful for testing but have no current dev-tool equivalent:

### 1. Set combat stat levels directly
`devSetLevel` sets `character.level` and `statXp` but leaves `character.statLevels` frozen. There is no tool to set individual stat levels to specific values. Testing high-level combat (boss scaling, class synergy, weapon damage formulas) requires winning real boss fights all the way up.

**Suggested addition:** A "Set stat Lv" control (slider or number input per stat) that directly patches `character.statLevels[id]`, or a companion action `devSetStatLevel(id, value)`.

### 2. Inject gold / energy directly
There is no "Give N gold" or "Fill energy" button. Unlimited Gold/Energy toggles bypass costs, but there is no way to start a test with a specific finite gold or energy balance. For economy testing (e.g., "can a player afford the Tier-3 weapon after 3 runs?") this matters.

**Suggested additions:**
- "Fill energy" one-shot button (sets `character.energy` to max)
- "Add 1000 gold" button (or an editable input)

### 3. Complete a habit (one-shot)
No tool can simulate a habit completion without actually setting up a habit and clicking through. Testing streak mechanics, XP scaling by difficulty, or the habit bonus multiplier requires real habits. A "Log habit completion (mock)" button that fires `completeHabit` on the first active habit would reduce setup friction.

### 4. Spawn high-level boss trials (Lv 30 / Lv 40 / Lv 50)
Only Lv 5, 10, and 20 bosses are spawnable. Testing high-level combat balance or anti-frustration scaling at Lv 30–50 is impossible without winning real boss chains.

### 5. Reset earnings ledger in isolation
The balance report data can only be cleared via a full game reset. An "Reset earnings ledger" button in the Balance Report modal would let developers start a fresh economy measurement without losing progression.

### 6. Force a weekly rollover
There is no button to trigger `checkWeeklyRollover()` for the current date. Testing the weekly report, challenge expiry, and streak processing requires either waiting until Monday or manipulating system time.

### 7. Unlock all codex entries
Testing the Codex screen with sparse data is inconvenient. A "Fill codex" button (adding all class IDs and other discoverable entries) would help UI/UX review of the codex.

### 8. Toggle visibility of game-state inspector
A collapsible overlay or panel printing key state values (`level`, `statLevels`, `gold`, `energy`, `deepestFloor`, current `classId`, active run state) would help diagnose issues without opening DevTools and digging through the Zustand store manually.

---

## Summary Table

| Tool | Works as described | Gaps / Issues |
|---|---|---|
| Adventure Ritual toggle | ✓ | Misclassified as dev tool; belongs in General |
| Unlimited Gold | ✓ | — |
| Unlimited Energy | Partially | Skill Trials still deduct 1 energy (inconsistent) |
| Invincibility | ✓ | — |
| Repeat Skill Trials | Partially | Also bypasses stat gate; UI description is incomplete |
| Balance Report | ✓ | No isolation reset; no time-range filter |
| Set Level | Partially | **`statLevels` not updated** — combat stats stay frozen |
| Set Deepest Floor | ✓ | — |
| Spawn Boss Trial | Partially | Silent no-op if battle exists; only 3 of possible ~10 bosses |
| Class Assign / Clear | ✓ | — |
| Reset Game | Partially | `mineTombstone` and `claimedPartyQuests` not cleared |
