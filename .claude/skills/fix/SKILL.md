---
name: fix
description: Execute the 2026-07 improvement plan. `/fix <plan item>` (e.g. `/fix 1.3`), `/fix <FINDING-ID>` (e.g. `/fix MP-08`), or `/fix check <phase>` to close out a phase. Scouts the audit finding, implements with cost-appropriate agents, tests, verifies, and updates plan3 status markers.
---

You are executing items from `docs/habits-rpg-improvement-plan3.md` (the roadmap) whose evidence lives in `docs/audit-2026-07/` (the finding register). Input: `$ARGUMENTS`.

## Resolve the argument

- **Plan item** (`1.3`, `7.1`): find that row in plan3; it lists the finding IDs.
- **Finding ID** (`MP-08`): find the plan3 row that carries it; execute that row (or the relevant slice of it if the row bundles several findings and the user named one).
- **`check <phase>`**: phase close-out — see the last section.
- Already `✅`? Say so and stop. Ambiguous? Ask.

## Ground rules

- **Read the finding before touching code.** Each finding in its section doc (`01-architecture.md` … `05-multiplayer.md`) has file:line evidence and a fix shape. Locate the finding heading with Grep, then Read only that finding's block (offset/limit) — never whole section docs.
- **Token discipline:** the main session never reads a 1,000+ line source file end-to-end. `finding-scout` does the reading and returns a brief. You read only the specific ranges you personally edit.
- **Scope discipline:** the smallest diff that resolves the item's findings. Discovered unrelated bugs go in the execution log as one-liners, not into the diff.
- **Bookkeeping every time:** flip the item's `⏳` → `✅` in plan3, and append one line to `docs/audit-2026-07/execution-log.md` (`| date | item | findings | files touched | notes/deviations |`). Never rewrite either file wholesale — targeted Edit only.
- Tests are part of the item: every P0/P1 ships a regression test that fails without the fix. Run targeted `npx vitest run <file>` + `npm run typecheck`; run the full suite only at `check <phase>`.
- Do not commit unless the user asks. Suggest a commit message at the end (`fix(scope): … (MP-08)` style, finding IDs in the message).

## Workflow per item

1. **Brief.** Read the plan3 row + each finding's block. Spawn ONE `finding-scout` (sonnet) with the finding text(s) + fix shape; it returns citation-check, verbatim excerpts, call sites, twin mirrors, test seams, constraints. If the scout reports the finding's premise no longer holds, stop and tell the user — don't fix a fixed bug.
2. **Choose execution mode** (see table). Direct = you implement in the main session using the brief. Delegate = spawn `fix-implementer` (opus) with the item text + finding(s) + full scout brief.
3. **Implement + test** per mode. For bundled rows (e.g. 3.9's seven findings), split into independent chunks; delegate up to 3 `fix-implementer`s in parallel ONLY if their file sets are disjoint (per the scout's call-site map) — otherwise sequence them.
4. **Verify** per the tier table. Feed the verifier the finding, the implementer's report, and the touched-file list. On FAIL: fix the blockers (same mode as before), re-run the verifier once. Still failing → report honestly and leave the item `⏳`.
5. **Bookkeep + summarize:** plan3 marker, execution-log line, then a ≤6-line summary to the user: what changed, test evidence, deviations, suggested commit message, suggested next item (plan order within the phase unless something discovered argues otherwise).

## Execution mode

| Mode | When | Why |
|---|---|---|
| **Direct** (main session) | The four P0s; anything touching persist `migrate`/`merge` or the persist version; co-op wire/protocol changes (message shapes, reducers, staleness/epoch logic); the timebase pass (2.1); cross-file refactors (7.1, 7.2, 7.4); anything the scout flags as persist- or wire-impacting | Highest blast radius; needs the strongest model with full conversational context |
| **Delegate — opus** (`fix-implementer` default) | Self-contained items with a clear fix shape that still involve logic or design judgment: most of Phases 3–6, UI/legibility features, content that must be *designed* (moveset authoring 5.2, recipe stats 4.4), P2 batches touching store/net | Keeps big-file reads out of this context; opus is fully adequate with a good brief |
| **Delegate — sonnet** (`fix-implementer` with `model: "sonnet"` override) | Items where the finding already specifies the exact values or text and the diff is transcription: copy/tooltip honesty fixes (the theme-5 class — MINI-40, HABIT-21, BAL-08 label deletions), mechanical data-table edits with values given in the finding, P3 polish batches (HABIT-18–22, MINI-38/40 copy halves), doc passes (2.10, 7.7) | Same agent, same brief, same test policy — ~40% cheaper where judgment isn't the bottleneck |

Tier rule of thumb: if the scout's SUGGESTED APPROACH contains a decision ("choose", "design", "depends"), it's opus or Direct; if it's a transcription of the finding's fix shape, sonnet is fine. When in doubt, opus — a failed verify cycle costs more than the tier delta saves.

**Cheap sweeps (`repo-sweeper`, haiku):** for enumeration-shaped subtasks, spawn `repo-sweeper` instead of burning scout/main-session tokens: the 2.1 timebase inventory (every `Date.now()`/`performance.now()`/rAF-timestamp usage by layer), 7.6's dead-export and duplication verification, theme-5 copy sweeps (find every tooltip/label string making a numeric claim), and full-suite runs at `check <phase>` when you only need a failure digest. It inventories; it never judges or edits.

## Verification tier

| Severity of item's top finding | Verifier |
|---|---|
| P0, or any Phase 1 data-safety item | `fix-verifier` with `model: "fable"` override |
| P1 | `fix-verifier` (its default, opus) |
| P2 | `fix-verifier` (opus) only if the diff touched store/net/persist; otherwise tests + typecheck suffice |
| P3 | No verifier — tests + typecheck |

## `check <phase>`

1. Run `npm run test` and `npm run typecheck` in full; report failures before anything else.
2. Read the phase's **Acceptance** block in plan3 and the execution log's rows for the phase. For each acceptance criterion: met (evidence), or needs a manual playtest (tell Orion exactly what to try — e.g. Phase 1: "go offline, log a habit, close, relaunch").
3. For Phases 1, 2, and 7 only: spawn `code-health-auditor` over the phase's touched files (from the log) to catch drift the item-level verifiers couldn't see across items.
4. If everything holds, date-stamp the phase heading in plan3 (`# Phase 1 — Data safety ✅ 2026-07-XX`, plan2 convention) and suggest the first item of the next phase.

## Session cost guide (advisory, tell the user when relevant)

- Run the **main session on Fable** for Phases 1, 2, and 7.1/7.4 — that's where Direct-mode correctness work concentrates.
- An **Opus session is fine** for Phases 3, 5, 6, 8 and most of 4 — nearly everything there is Delegate-mode, so the orchestrator mostly routes briefs and bookkeeps.
- Phase 4 re-modeling: after 4.1–4.4 land, re-check reward-per-minute parity by spawning `game-design-auditor` with the numeric-balance lens and `model: "opus"` override (its frontmatter pins fable; the override halves that cost) against section 03's NUMBERS.
