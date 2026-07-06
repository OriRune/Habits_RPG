# Plan3 execution log

One line per completed (or blocked) plan item, appended by `/fix`. Fresh sessions read
this instead of re-deriving state from git history. Newest at the bottom.

**Columns:** date · plan item · finding IDs · files touched · notes (deviations, discovered issues, blockers).

| Date | Item | Findings | Files touched | Notes |
|---|---|---|---|---|
| 2026-07-06 | 1.1 | MP-01 | src/net/cloudSave.ts, src/net/__tests__/cloudSave.test.ts | Sidecar keys `habits-rpg-last-synced-version` + `habits-rpg-dirty`; module-load dirty subscription; push-not-pull branch requires non-null local envelope (verifier catch). Verified fable PASS. Known one-time gap: pre-upgrade saves have no marker, so the *first* post-upgrade launch can't detect an offline session. Pull-path clearDirty not gen-guarded (microtask window, benign). |
| 2026-07-06 | 1.2 | MINI-01 | src/engine/crawl.ts, mining.ts, forest.ts; src/store/slices/miningSlice.ts, forestSlice.ts; src/store/shared.ts; src/net/coop/reduce.ts; MineRunOverlay.tsx, ForestRunOverlay.tsx; + 3 test files | Scout found TWO extra `'choosing'` writers beyond the finding's four: guest-side guardian detection in coop/reduce.ts (both modes) — guarded too (all six). Shared `boonConsolation` helper in crawl.ts (heal 15, gold 40). `skipMineBoon`/`skipForestBoon` + Skip button also rescue legacy saves already stuck with `pendingBoonChoice: []`. Verified fable PASS. Nit deferred: consolation is silent (no toast) — cosmetic. |
| 2026-07-06 | 1.3 | MP-06 | src/net/cloudSave.ts, src/App.tsx, src/components/settings/SaveConflictModal.tsx (new), src/net/__tests__/cloudSave.test.ts | Deviation: rejected keep-newer-by-`lastActiveISO` (date-granularity; fresh saves stamp today at init → heuristic would auto-pick a brand-new cloud row over weeks of local). Forced-choice dialog instead; auto keep-local only when cloud row is trivial. Nothing applied/owned/stamped until the player chooses; `startAutoSync` guarded while pending; `wipeLocalSave` now skips never-adopted (null-owner) saves (verifier catch — session expiry during dialog would have wiped local). Verified fable PASS. Deferred: keep-local stamps owner only on next launch's pull (needs push success signal — 1.4). |
