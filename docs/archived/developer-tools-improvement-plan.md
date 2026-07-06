# Developer Tools Improvement Plan

Based on `docs/developer-tools-analysis.md`. Steps are ordered by priority: correctness bugs first, then missing high-value tools, then polish.

---

## Stage 1 — Fix Broken Behaviour (bugs in existing tools)

### Step 1.1 — Fix `devSetLevel` to update `statLevels`

**Problem:** `devSetLevel` sets `character.level` and `statXp` but leaves `character.statLevels` frozen. All combat scaling, encounter checks, and class synergy read from `statLevels`, so a character jumped to Lv 50 fights like a Lv 1.

**Implementation:**

In `src/store/slices/coreSlice.ts`, update `devSetLevel` to synthesize stat levels after distributing XP. Use `allocateStatGains` repeatedly (once per simulated level-up) with even XP distribution, or derive them directly from the XP using `statLevelsFromXp` (already used in the v7 migration at `src/store/useGameStore.ts:76`):

```typescript
import { statLevelsFromXp } from '@/engine/progression';

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
    const statLevels = statLevelsFromXp(statXp as Record<StatId, number>);
    return {
      character: {
        ...s.character,
        level,
        statXp,
        statXpAtLastLevel: { ...statXp },
        statLevels,
      },
      pendingLevelUp: null,
    };
  }),
```

`statLevelsFromXp` uses the sqrt curve that converts raw XP into stat points (already used for legacy save migration), giving a reasonable combat-stat distribution proportional to the target level.

**Test to update:** `store.integration.test.ts:824` — add a check that `statLevels` values are all > 1 after a level jump, and that they scale with the target level (Lv 50 > Lv 10).

---

### Step 1.2 — Fix Unlimited Energy to cover Skill Trials

**Problem:** `trialsSlice.ts::completeTrial()` deducts 1 energy unconditionally, ignoring `unlimitedEnergy`.

**Implementation:**

In `src/store/slices/trialsSlice.ts`, find the energy deduction in `completeTrial` and wrap it with the same guard used everywhere else:

```typescript
const free = s.settings.unlimitedEnergy;
const energy = free ? s.character.energy : Math.max(0, s.character.energy - TRIAL_ENERGY_COST);
```

**Test to add:** `store.integration.test.ts` — "completeTrial does not deduct energy when unlimitedEnergy is on."

---

### Step 1.3 — Fix `resetGame` to clear `mineTombstone`

**Problem:** `mineTombstone` is not included in the `resetGame` return object, so a ghost tombstone from a past life persists on a fresh save.

**Implementation:**

In `src/store/slices/coreSlice.ts::resetGame`, add:

```typescript
mineTombstone: null,
```

---

### Step 1.4 — Fix `resetGame` to clear `claimedPartyQuests`

**Problem:** `claimedPartyQuests` is not reset, so claimed party quest IDs persist and prevent re-claiming on a fresh character.

**Implementation:**

In `src/store/slices/coreSlice.ts::resetGame`, add:

```typescript
claimedPartyQuests: [],
```

---

### Step 1.5 — Fix `Repeat Skill Trials` UI description

**Problem:** The toggle description says "Skip the once-per-day gate" but it also bypasses the stat gate (requiring a recent habit completion for that stat). This surprises developers who expected their trial to be gated when they have no matching habits.

**Implementation:**

In `src/views/SettingsView.tsx:309–311`, update the `Toggle` description:

```tsx
<Toggle
  label="Repeat Skill Trials"
  description="Skip the once-per-day gate and the stat-activity requirement — trials can be replayed immediately without matching habits."
  checked={settings.repeatMinigames}
  onChange={(v) => updateSettings({ repeatMinigames: v })}
/>
```

---

## Stage 2 — Add High-Value Missing Tools

### Step 2.1 — Add feedback when `devSpawnTrial` is a no-op

**Problem:** If a battle already exists, `devSpawnTrial` silently returns early. Settings closes, nothing happens, and the developer is left confused.

**Implementation:**

In `src/views/SettingsView.tsx`, read `battle` from the store and disable the spawn buttons when a battle is active, with an explanatory note:

```tsx
const battle = useGameStore((s) => s.battle);

// In the Spawn Boss Trial section:
{battle && (
  <p className="text-[10px] text-ember">A battle is already active — dismiss it first.</p>
)}
{TRIALS.map((t) => (
  <Button
    key={t.level}
    variant="secondary"
    onClick={() => spawn(t.level)}
    className="px-3 py-1 text-xs"
    disabled={!!battle}
  >
    {t.label}
  </Button>
))}
```

No store change needed.

---

### Step 2.2 — Expand boss trial spawning to cover Lv 30, 40, 50

**Problem:** Only Lv 5, 10, and 20 boss trials are spawnable. High-level combat balance is untestable without grinding.

**Implementation:**

In `src/views/SettingsView.tsx`, extend the `TRIALS` constant:

```typescript
const TRIALS = [
  { level: 5,  label: 'Slime (Lv 5)'    },
  { level: 10, label: 'Guardian (Lv 10)' },
  { level: 20, label: 'Golem (Lv 20)'   },
  { level: 30, label: 'Wyvern (Lv 30)'  },
  { level: 40, label: 'Lich (Lv 40)'    },
  { level: 50, label: 'Dragon (Lv 50)'  },
];
```

Verify that `bossForLevel(30/40/50)` in `src/engine/combat.ts` (or wherever `bossForLevel` is defined) returns valid fighters for these levels. If it doesn't, extend the boss table there first.

---

### Step 2.3 — Add "Fill Energy" one-shot button

**Problem:** No way to restore energy to a specific finite value for economy testing. Unlimited Energy bypasses costs but doesn't let you test "player has exactly 5 energy."

**Implementation:**

Add a store action `devFillEnergy()` in `coreSlice.ts`:

```typescript
devFillEnergy: () =>
  set((s) => ({
    character: { ...s.character, energy: MAX_ENERGY },
  })),
```

(Import or define `MAX_ENERGY` — check `src/engine/habits.ts` or `shared.ts` for where the energy cap is defined.)

In `src/views/SettingsView.tsx`, add to the testing jumps section:

```tsx
<div className="space-y-1.5">
  <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
    Energy
  </span>
  <Button
    variant="secondary"
    onClick={() => devFillEnergy()}
    className="px-3 py-1 text-xs"
  >
    Fill to max
  </Button>
</div>
```

Wire up `devFillEnergy` in `shared.ts` (the `GameState` action interface) and `useGameStore.ts` as with other dev actions.

---

### Step 2.4 — Add "Add Gold" tool

**Problem:** No way to give yourself a specific gold amount for testing shop/craft flows without grinding.

**Implementation:**

Add a store action `devAddGold(amount: number)` in `coreSlice.ts`:

```typescript
devAddGold: (amount) =>
  set((s) => ({
    character: { ...s.character, gold: s.character.gold + Math.max(0, Math.floor(amount)) },
  })),
```

In `src/views/SettingsView.tsx`, add preset buttons next to or below the energy tool:

```tsx
<div className="space-y-1.5">
  <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
    Gold
  </span>
  <div className="flex flex-wrap gap-1.5">
    {[100, 500, 2000].map((amt) => (
      <Button
        key={amt}
        variant="secondary"
        onClick={() => devAddGold(amt)}
        className="px-3 py-1 text-xs"
      >
        +{amt}
      </Button>
    ))}
  </div>
</div>
```

---

### Step 2.5 — Add "Force Weekly Rollover" button

**Problem:** Testing weekly reports, challenge expiry, and streak processing requires waiting until Monday or manipulating system time.

**Implementation:**

Add a store action `devForceWeeklyRollover()` in `coreSlice.ts` that sets `lastWeekKey` to the *previous* week key, then immediately calls `checkWeeklyRollover()`:

```typescript
devForceWeeklyRollover: () =>
  set((s) => {
    // Set sentinel to a past week so the rollover condition is met.
    const prevWeek = weekKey(toISODate(), -7); // one week ago
    return { ...s, lastWeekKey: prevWeek };
  }),
```

Then in `SettingsView`, the button calls `devForceWeeklyRollover()` followed by `checkWeeklyRollover()`:

```tsx
<Button
  variant="secondary"
  onClick={() => { devForceWeeklyRollover(); checkWeeklyRollover(); onClose(); }}
  className="px-3 py-1 text-xs"
>
  Force weekly rollover
</Button>
```

`checkWeeklyRollover` is already a store action; bind it from the store. Adding a `-7` day offset helper to `weekKey` may require a small change to `src/engine/date.ts` — alternatively, just hardcode a known-past week string or subtract 7 days from `toISODate()` before passing to `weekKey`.

---

### Step 2.6 — Add "Reset Earnings Ledger" button in Balance Report

**Problem:** The earnings ledger can only be cleared via a full game reset, making isolated economy testing awkward.

**Implementation:**

Add a store action `devResetEarnings()` in `coreSlice.ts`:

```typescript
devResetEarnings: () =>
  set(() => ({ earnings: freshEarningsLedger(), energyLog: {} })),
```

Add a button inside `src/components/balance/BalanceReportModal.tsx` at the bottom of the modal:

```tsx
<Button
  variant="secondary"
  onClick={() => { devResetEarnings(); }}
  className="px-3 py-1 text-xs text-ember"
>
  Reset ledger
</Button>
```

---

## Stage 3 — Polish and Organisation

### Step 3.1 — Move "Adventure Ritual" to General settings

**Problem:** Adventure Ritual is a user-facing UX preference (a pre-entry checklist modal), not a developer tool. It belongs alongside Sound, Daily Reminder, and Arena Speed in the General section.

**Implementation:**

In `src/views/SettingsView.tsx`:
1. Cut the `<Toggle label="Adventure Ritual" ...>` block from the Developer panel (lines 283–288).
2. Paste it into the General panel, after the Arena Speed control and before the Habit Data export block.
3. No store changes needed — the `settings.showAdventureRitual` flag and its consumers are unchanged.

---

### Step 3.2 — Add a live state inspector panel

**Problem:** There is no at-a-glance view of key game state. Developers must open the browser DevTools and navigate the Zustand store to check values like `statLevels`, active run state, or current class.

**Implementation:**

Create a new component `src/components/dev/DevStateInspector.tsx` that renders a compact collapsible panel at the bottom of the Developer section:

Suggested fields to display:
- Level, statLevels (each stat)
- Gold, Energy
- deepestFloor, deepestMineFloor, deepestForestStage, deepestArenaTier
- classId
- pendingLevelUp, battle !== null, dungeon !== null, mining !== null, forest !== null
- mineTombstone (present/absent)
- Active dev flags (unlimitedGold, unlimitedEnergy, invincible)

Keep it read-only (display only). Use a `<details>` element or a local `useState` to collapse by default.

---

### Step 3.3 — Group dev testing jumps under a clearer header

**Problem:** The testing jump section mixes resource tools (future: fill energy, add gold) with progression tools (set level, floor, spawn boss) without visual grouping.

**Implementation:**

In the Developer panel in `src/views/SettingsView.tsx`, split the testing jumps `<div>` into two sub-groups separated by a thin divider:

- **Progression** — Set level, Deepest floor, Spawn boss trial, Class
- **Resources** — Fill energy, Add gold (new from Steps 2.3 / 2.4)

Use the existing `border-t border-gold-deep/20 pt-3` pattern for the divider.

---

## Execution Order

| Step | Change type | Effort | Priority |
|------|------------|--------|----------|
| 1.1 `devSetLevel` fixes `statLevels` | Bug fix | Medium | Critical |
| 1.2 Unlimited Energy covers Trials | Bug fix | Small | High |
| 1.3 Reset clears `mineTombstone` | Bug fix | Trivial | High |
| 1.4 Reset clears `claimedPartyQuests` | Bug fix | Trivial | Medium |
| 1.5 Fix `repeatMinigames` description | Copy fix | Trivial | Medium |
| 2.1 No-op feedback for spawn trial | UX fix | Small | High |
| 2.2 Expand boss trial levels | New tool | Small | Medium |
| 2.3 Fill Energy button | New tool | Small | Medium |
| 2.4 Add Gold button | New tool | Small | Medium |
| 2.5 Force weekly rollover | New tool | Medium | Low |
| 2.6 Reset earnings ledger | New tool | Small | Low |
| 3.1 Move Adventure Ritual to General | Reorganisation | Trivial | Medium |
| 3.2 State inspector panel | New tool | Medium | Low |
| 3.3 Group dev jumps | Reorganisation | Trivial | Low |
