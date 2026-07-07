# Habits RPG — Improvement Plan

> A practical, staged plan grounded in
> [`habits-rpg-game-analysis.md`](./habits-rpg-game-analysis.md). Scope is the
> **whole system** — architecture, code organization, core loop, habit tracking,
> party/multiplayer, RPG progression, UX, data model, reliability, and
> maintainability. Individual minigames are addressed **only** where they touch
> these cross-cutting systems; per-minigame redesigns are out of scope here.
>
> Guiding constraints (from the codebase, not negotiable):
> - The app **must keep working offline** with `isBackendConfigured() === false`.
> - The **engine stays pure** (deterministic, RNG-injected, no React/store/net
>   imports). All new rules go there and get tests.
> - Any persisted-shape change needs a **schema version bump** + `migrate`/`merge`
>   handling; cloud blobs reuse the same envelope.

---

## 1. Biggest current problems & weaknesses

Ranked by leverage (impact × how much it blocks future work):

1. **`useGameStore.ts` is a 2,742-line god-module.** Every action for every
   system lives in one file. This is the single biggest drag on maintainability,
   the top merge-conflict source, and the hardest thing for a new contributor to
   navigate. It also makes the store the implicit "junk drawer" for anything
   that doesn't obviously belong in the engine.
2. **The network/co-op layer is the riskiest code and the least tested.**
   `src/net/`, the co-op hooks, and cloud-save CAS logic have **zero automated
   tests**, while the pure engine (the *safe* part) is heavily covered. Distributed
   desync, host-disconnect, and CAS-conflict paths are exactly where regressions
   hide.
3. **Client-trusted state with no server validation.** Energy, XP, scores, and
   deepest-tier records live in a client-writable save. The leaderboard and party
   quests are trivially editable via localStorage. Fine for friends-and-family;
   a real problem if competition is intended. A decision is needed (§9).
4. **Stale, sprawling documentation.** `README.md` lists shipped systems as
   "not yet built"; `net/env.ts` and SQL comments describe a prior phase plan;
   `docs/` has ~30 overlapping analysis/plan files with no index and several
   `-2.md` duplicates. New contributors are actively misled.
5. **The two-XP model (`statXp` ledger vs `statLevels`) is a comprehension
   cliff.** It's correct and commented, but it's the most common "why didn't my
   stat move?" confusion and couples leveling, class assignment, and combat in
   non-obvious ways.
6. **Daily-reset gating trusts device time.** `server_now()` exists in SQL but
   appears unused; trials/mood/weekly rollover use local `toISODate()`. Resets
   are spoofable and inconsistent across devices/timezones.
7. **Progression inconsistencies.** Tactics is a headline (and co-op) mode but is
   missing from the public snapshot/leaderboard; the in-dungeon vs trial-boss
   level-up interplay (`checkLevelUp` early-returns on `state.battle`) is subtle
   and fragile.
8. **Six near-duplicate `commitX` reward/finalize functions** and other
   copy-paste in the store.

---

## 2. Highest-priority improvements

The "do these first" shortlist — high value, and they unblock everything else:

- **P0 — Refresh the docs of record.** Rewrite `README.md` to reflect reality;
  fix the misleading comments in `net/env.ts` and `supabase/migrations/0003`;
  add a `docs/INDEX.md` and archive/merge the duplicate `*-2.md` analyses. Cheap,
  immediate, prevents wasted effort. (§7)
- **P0 — Add a test harness for the net/co-op layer.** Before refactoring
  anything networked, make the co-op protocol reducers and CAS logic testable
  (they're nearly pure). This is the safety net for P1. (§3, §7)
- **P1 — Split `useGameStore.ts` into per-domain slices** behind the same public
  `useGameStore` API. The highest-leverage maintainability win. (§3)
- **P1 — Decide and enforce the trust model** (client-trusted vs server-validated
  leaderboard). This is a prerequisite for any competitive multiplayer work. (§5, §9)
- **P2 — Wire `server_now()` into daily gating** and centralize "today" resolution.
  (§5)
- **P2 — Close the obvious progression gaps:** add `deepestTacticsTier` to the
  snapshot/leaderboard; document and test the dungeon/trial level-up interplay. (§4)

---

## 3. Recommended architecture changes

### 3.1 Decompose the store into domain slices
Keep one `useGameStore` (so persistence, `migrate`/`merge`, and component imports
are unchanged), but compose it from slice creators:

```
store/
  useGameStore.ts        // create()+persist(); composes slices; owns migrate/merge
  slices/
    characterSlice.ts    // character, statXp/statLevels, level-up, class
    habitsSlice.ts       // habits, completeHabit/uncompleteHabit, streaks
    challengesSlice.ts   // challenges, customChallenges, weekly rollover
    economySlice.ts      // inventory, materials, gold, gear, weapons, crafting, shop
    dungeonSlice.ts      // Dungeon Delve run
    crawlerSlice.ts      // Mine + Forest (they share crawl.ts already)
    arenaSlice.ts        // Arena
    tacticsSlice.ts      // Hex Tactics
    settingsSlice.ts     // dev/appearance settings
```

- Use Zustand's slice pattern (`StateCreator` per slice, merged in `create`).
- **Shared cross-slice helpers** (`applyReward`, `checkLevelUp`, `grantStatXp`,
  `fighterFor`, the `commitX` family) move to `store/shared.ts` — they're the
  real coupling and deserve to be named, tested seams rather than file-local
  functions.
- Persist config (`name`, `version`, `migrate`, `merge`) stays centralized in
  `useGameStore.ts`. Don't distribute migration logic.
- This is a **mechanical, behavior-preserving refactor** — gate it behind the
  existing store integration tests plus the new net tests; no schema bump needed.

### 3.2 Unify the run-commit boilerplate
Collapse `commitMining`/`commitMineDeath`/`commitForest`/`commitForestDeath`/
`commitArena`/`commitTactics` into a single `commitRun(state, { reward, statXp,
deepestField, deepestValue, scoreField })` helper. Each minigame supplies its
reward + trickle policy; the clone/applyReward/checkLevelUp plumbing is written
once.

### 3.3 Make co-op reducers pure and testable
The co-op message handlers in `useCoopSession`/`useTacticsCoopSession` and the
`coopApply*` store actions mix transport with state transition. Extract the
**state-transition half** into pure functions in `engine/` (or `net/coop/reduce.ts`
if they must stay net-aware), e.g. `applyWorldSlice(run, slice) -> run`. The hook
keeps only channel wiring. This is what makes desync logic testable and is a
prerequisite for trusting co-op.

### 3.4 Centralize "now"/date resolution
Introduce a single `clock` seam (`engine/date.ts` already owns date math) that
the store calls for "today," with an optional server-time source injected by
`src/net/`. Offline → device time (unchanged); online → `server_now()`-corrected.
One place to reason about resets and timezones.

### 3.5 Keep the layering rules explicit
Add a lightweight lint/CI guard (even a grep-based test) asserting `engine/`
never imports from `store`, `net`, or `react`, and `content/` stays logic-free.
The discipline is currently maintained by convention; make it enforced so the
slice refactor can't quietly leak.

---

## 4. Recommended gameplay / progression changes

These are **consolidation, not new features** — the surface area is already large.

- **Normalize the reward pipeline.** Every source (habits, challenges, trials,
  dungeon, mine, forest, arena, tactics) ultimately funnels through `applyReward`,
  but each computes its own gold/statXp/trickle inline. Define reward *policies*
  per source in one place so balance is tunable centrally and the `commitRun`
  unification (§3.2) has a clean contract. Cross-reference the existing
  `docs/balance-audit.md` rather than re-deriving numbers.
- **Make progression records first-class and complete.** There's an implicit
  "deepest X" record set (`deepestMineFloor`, `deepestForestStage`,
  `deepestArenaTier`, `deepestTacticsTier`, `deepestFloor`). Treat them as one
  uniform structure, surface all of them in `buildPublicSnapshot` + the
  `leaderboard` view (Tactics is currently missing), and show them consistently
  in the UI. Low effort, fixes the §1.7 inconsistency.
- **Clarify the two-XP model in-product, not just in comments.** The
  `CharacterView`/`StatBar` should make the ledger-vs-level distinction legible
  (e.g. "effort toward next level" vs "combat value, set at level-up"). This is a
  UX fix for a conceptual problem; don't change the math.
- **Make the level-up/boss-gate interplay robust.** Document the rule that
  dungeon XP only *flags* a pending level-up (applied post-run) and that
  `checkLevelUp` is inert during a `battle`. Add explicit tests for: leveling
  while in a dungeon, leveling while a trial boss is live, and crossing multiple
  level thresholds at once. This is correctness debt around the game's central
  gate.
- **Audit Energy as the universal sink.** Energy is the spine of the loop (+1 per
  habit, spent on minigames). Confirm the earn/spend rates still make sense now
  that there are five sinks of differing cost, and that `unlimitedEnergy` is the
  only bypass. No redesign — just verify the economy isn't starved or trivial.
- **Co-op reward fairness.** Define explicitly how co-op runs split rewards
  (currently each player keeps their own haul, host owns the world). Make sure
  co-op can't be a reward multiplier exploit (e.g. AFK guests) — relevant once
  the trust model is decided.

---

## 5. Recommended data model / backend improvements

- **Resolve the trust model (blocking decision — see §9).** Two coherent options:
  - **(A) Honor system (keep current):** document it openly, keep the leaderboard
    "for fun," and stop investing in anti-cheat. Cheapest.
  - **(B) Server-validated records:** move the *records that matter*
    (level, total XP, deepest tiers) behind validated RPCs or recompute them
    server-side from a constrained event log. The full save can stay
    client-owned; only the *public, comparative* numbers need protection.
  - Do **not** half-build (B); a partially-trusted leaderboard is worse than an
    openly honest one.
- **Add `deepestTacticsTier` to `profiles.public_snapshot` and the
  `leaderboard` view.** Tactics is a co-op headline mode and is currently
  invisible to social comparison. (Migration `0005`.)
- **Server time for daily resets.** Expose/consume `server_now()` (already
  defined) through the `clock` seam (§3.4). Decide a canonical reset boundary
  (UTC vs local) and apply it to `trialsClearedOn`, weekly rollover, and mood.
- **Harden party invariants.** `getMyParty` assumes one membership
  (`maybeSingle()`); the schema PK allows multiple rows. Either enforce
  single-party at the DB level (constraint/trigger) or make the client tolerate
  multiple. Pick one and make the assumption explicit.
- **Co-op session lifecycle robustness.** Decide host-migration vs
  end-session-on-host-leave for Mine/Forest/Tactics, and make stale-session
  cleanup deterministic (a `coop_sessions` row can currently linger as
  `active`). A scheduled cleanup or a TTL is worth considering.
- **Save-size discipline.** The persisted blob grows unbounded in places
  (`completionLog` keyed by every date, per-habit `log`). It's the cloud blob
  too. Define a retention/compaction policy (e.g. archive old `log` entries) before
  long-term players hit localStorage/row-size limits. Verify before changing —
  this may not be urgent, but it should be measured.

All schema changes go in a new ordered `supabase/migrations/000N_*.sql`; keep the
"run manually, idempotent where practical" convention, and note in the analysis
doc that there is **no migration runner** (a candidate for tooling later).

---

## 6. Recommended frontend / UX improvements

- **Make the core loop legible on the dashboard.** The loop (log habit → Energy →
  spend on content → rewards → level) is implemented but not visibly reinforced.
  Surface Energy, "XP to next level," and any `pendingLevelUp` boss prominently on
  `DashboardView` so the player always knows the next action.
- **Clarify the level-up gate.** When `pendingLevelUp` is set, the path to
  resolving it (win the boss in the Battle tab) should be an obvious call-to-action,
  not a state the player can wander past.
- **Two-XP transparency** (mirrors §4): label ledger vs combat-value clearly in
  `CharacterView`.
- **Consistent records surface.** A single "Records" panel (deepest mine/forest/
  arena/tactics/dungeon, best trial stars) reusing the unified record structure
  from §4.
- **Co-op presence/feedback consistency.** Co-op toasts, presence labels
  (`deriveActivity`), and the `CoopRaidPanel` states are good; audit them for the
  Arena (no co-op) and ensure offline mode never shows party/co-op affordances
  (it already gates on `isBackendConfigured`, but verify the empty states read
  well).
- **Error boundaries beyond the dungeon.** `ExploreView` wraps `DungeonView` in a
  recovery boundary; the other heavy overlays (Arena/Tactics/Mine/Forest) lack one.
  A lazy-loaded overlay that throws currently has no graceful recovery. Add a
  shared overlay error boundary.
- **Loading/auth states.** The auth gate shows a bare "Loading…"; co-op join has
  minimal feedback. These are fine but worth a pass once the backend is a
  first-class (not optional-feeling) path.

Keep the parchment/Cinzel aesthetic; this is polish and information architecture,
not a visual redesign.

---

## 7. Technical debt to fix

| Debt | Action | Effort |
|---|---|---|
| Stale `README.md` | Rewrite to current feature set | XS |
| Misleading comments (`net/env.ts` "unused", `0003` "arena reserved") | Correct in place | XS |
| `docs/` sprawl + `-2.md` duplicates | Add `docs/INDEX.md`; merge/archive dupes | S |
| `useGameStore.ts` god-module | Slice refactor (§3.1) | L |
| 6× `commitX` duplication | `commitRun` helper (§3.2) | M |
| Co-op logic untestable | Extract pure reducers + tests (§3.3) | M |
| Module-scope RNG globals (`mineRng`/`forestRng`/seeds) | Document the design intent; consider folding into a run-context object passed explicitly | S–M |
| Spirit Grove has no `engine/trials/` file | Move its logic out of the component for pattern consistency | S |
| No layering guard | Add CI import-rule test (§3.5) | S |
| Loose working files in `src/` (`colorschemes.txt`) | Move to `docs/` or remove | XS |
| Net/hooks/components untested | Add targeted tests for the now-pure reducers (don't chase 100%) | M |

Effort: XS<½d, S≈1d, M≈2–4d, L≈1–2wk.

---

## 8. Staged implementation roadmap

Each stage is independently shippable and leaves the app in a working state
(online and offline). Do not start a stage until its predecessor's tests are green.

### Stage 0 — Truth & safety net (days)
- Rewrite `README.md`; fix misleading comments; add `docs/INDEX.md`.
- Build the **net/co-op test harness**: extract co-op state transitions into pure
  functions (§3.3) and write reducer tests; add CAS cloud-save tests with a
  faked Supabase client.
- Add the **layering guard** test (§3.5).
- *Exit:* docs accurate; co-op + cloud-save logic covered; no behavior change.

### Stage 1 — Store decomposition (1–2 weeks)
- Slice `useGameStore.ts` (§3.1); move shared seams to `store/shared.ts`.
- Unify `commitX` → `commitRun` (§3.2).
- Centralize the `clock`/"today" seam (§3.4), still device-time-only.
- *Exit:* identical behavior, store split, all tests (incl. Stage 0) green. No
  schema bump.

### Stage 2 — Progression & data consistency (~1 week)
- Make "deepest X" records a uniform structure; add `deepestTacticsTier` to
  snapshot + `leaderboard` (migration `0005`).
- Normalize the reward pipeline into per-source policies (§4), cross-checked
  against `docs/balance-audit.md`.
- Add tests for the dungeon/trial level-up interplay; document the rule.
- *Exit:* records complete and consistent; reward math centralized & tested.

### Stage 3 — Backend trust & reset integrity (depends on §9 decision)
- Implement the chosen trust model (A or B).
- Wire `server_now()` into daily gating through the `clock` seam; choose the
  canonical reset boundary.
- Harden party single-membership invariant and co-op session cleanup/host-leave.
- *Exit:* resets are server-anchored; leaderboard integrity matches the chosen
  model; party/co-op lifecycle edge cases handled.

### Stage 4 — UX legibility & resilience (~1 week)
- Dashboard loop legibility (Energy, XP-to-next, pending boss CTA).
- Two-XP transparency in `CharacterView`; unified Records panel.
- Shared overlay error boundary; auth/co-op loading polish.
- *Exit:* the loop and progression are self-explanatory; overlays fail gracefully.

### Stage 5 — Maintainability tail (ongoing)
- Spirit Grove engine extraction; RNG-globals cleanup; save-size/compaction
  policy (measure first); migration-runner tooling if manual SQL becomes painful.

> Minigame-specific redesigns (the per-game `docs/*-improvement-plan.md` work)
> slot in **after Stage 2**, once the reward pipeline and record structure they
> plug into are stable.

---

## 9. Risks, dependencies & decisions to make first

**Decisions required before implementation (blocking):**
1. **Trust model for competitive state (A vs B in §5).** Blocks Stage 3 and any
   serious multiplayer investment. Recommendation: pick **(A) honor system** unless
   there's a concrete plan to grow a competitive audience — (B) is a large,
   ongoing cost.
2. **Daily-reset boundary: UTC vs local time.** Affects trials, weekly rollover,
   mood, and streaks. Must be decided before wiring `server_now()`; changing it
   later is a migration headache.
3. **Co-op host failure policy:** end-session vs host-migration. Simpler
   (end-session) is recommended first; revisit if co-op retention warrants it.
4. **Backend posture:** is Supabase becoming a first-class requirement, or
   staying strictly optional? This shapes how much UX investment the
   online paths deserve (Stage 4) and whether offline must remain fully featured.

**Risks & dependencies:**
- **Store refactor (Stage 1) is broad-touch.** Mitigation: it's mechanical and
  behavior-preserving, *but only if Stage 0's tests exist first.* Do not reorder.
- **Schema/persist changes** (Stages 2–3) require version bumps + `migrate`/`merge`
  updates and affect the cloud blob. Follow the existing v22 changelog pattern;
  test old-save load paths.
- **Manual SQL migrations have no runner.** Coordination risk in any multi-env
  setup; document the exact apply order and consider tooling if it recurs.
- **Balance changes (Stage 2)** can silently regress feel. Lean on
  `engine/__tests__/balance.test.ts` and `docs/balance-audit.md`; treat reward
  tuning as data, not logic, so it's reversible.
- **Offline-first constraint** must hold through every stage. Any feature that
  reads the network needs an offline fallback; add this to the layering guard if
  feasible.
- **Performance:** the store mutates ~10 Hz in real-time minigames; the slice
  refactor and any new subscribers must not add per-tick cost. Keep new
  subscribers debounced/change-gated like the existing cloud-save and presence
  paths.

---

### One-paragraph summary
The codebase is well-architected at the engine layer and over-concentrated at the
store layer, with a capable-but-untested networking tier and documentation that
no longer matches reality. The plan front-loads **truth (docs) and a safety net
(net/co-op tests)**, then performs the **behavior-preserving store decomposition**
that unblocks everything else, then closes **progression/data consistency gaps**,
then resolves the **backend trust and reset-integrity** questions, and finally
invests in **UX legibility and resilience** — deferring per-minigame redesigns
until the reward and record systems they depend on are stable. The only true
blockers are a handful of product decisions (trust model, reset boundary, co-op
failure policy, backend posture) that should be settled before Stage 3.
