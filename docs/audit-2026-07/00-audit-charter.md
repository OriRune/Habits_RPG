# HabitsRPG Project Audit — Charter (July 2026)

**Status:** Active. This charter governs every section of the 2026-07 project audit.
**How to run:** invoke `/audit <section>` in Claude Code (see section list below). Run `/audit synthesis` only after all five sections are complete.

## Purpose

A full-project audit of HabitsRPG — architecture, minigames, balance, and real-world usefulness — feeding a new master improvement plan (`habits-rpg-improvement-plan3.md`). This audit **verifies and extends** the prior body of analysis (notably `docs/balance-audit.md` and `docs/habits-rpg-game-analysis.md`); it does not re-derive from scratch what those docs already established, but it does not trust them blindly either. Every section begins by fact-checking its predecessor doc's load-bearing claims against current source.

## Severity scale

| Level | Meaning |
|-------|---------|
| **P0** | Bug with data loss, save corruption, crash, or multiplayer desync potential |
| **P1** | Significant defect, balance break, or design flaw that degrades the core loop |
| **P2** | Code quality / tech debt / missing tests / meaningful UX friction |
| **P3** | Polish, nice-to-have, cosmetic, or speculative improvement |

## Finding format

Every finding in every section doc uses exactly this shape:

```markdown
### [PREFIX-NN] Short imperative title (P1, confidence: high)
- **Area:** src/engine/forest.ts (or feature name)
- **Observation:** What is true in the code today, with file:line evidence.
- **Prior-doc status:** confirms | contradicts | not covered by <doc name>
- **Impact:** Why it matters to the player or the codebase.
- **Recommendation:** The smallest change that resolves it.
```

Rules:
- **Evidence is mandatory.** Every Observation cites at least one `file:line`. A claim that cannot be verified in source is marked `confidence: low` and listed in the section's "Needs manual check" appendix — it is never presented as fact.
- **Confidence:** `high` = verified in source this session; `medium` = strong inference from source; `low` = unverified or depends on runtime behavior not exercised.
- **Dedupe against known items.** If a finding is already tracked in `habits-rpg-improvement-plan2.md`'s "Still open / deferred" table or an active per-minigame plan, note that in Prior-doc status instead of re-reporting it as new.
- Findings within a section doc are ordered by severity (P0 first).

## Finding ID prefixes

| Section | Prefix | Output file |
|---------|--------|-------------|
| 01 architecture | `ARCH` | `docs/audit-2026-07/01-architecture.md` |
| 02 habit-core | `HABIT` | `docs/audit-2026-07/02-habit-core.md` |
| 03 balance | `BAL` | `docs/audit-2026-07/03-balance.md` |
| 04 minigames | `MINI` | `docs/audit-2026-07/04-minigames.md` |
| 05 multiplayer | `MP` | `docs/audit-2026-07/05-multiplayer.md` |
| 99 synthesis | — | `docs/audit-2026-07/99-synthesis.md` |

## Section doc structure

```markdown
# Audit 2026-07 — <Section name>
**Date run:** <date> · **Branch:** <branch> · **Sections complete before this one:** <list>

## Executive summary
(≤5 bullets: the findings that should change what we build next)

## Prior-doc fact check
(table: claim · source doc · verdict verified/stale/wrong · evidence)

## Findings
(charter format, severity-ordered)

## Needs manual check
(low-confidence items requiring a human playtest or runtime inspection)
```

## Run order and rationale

1. **architecture** — its hotspot map and test-gap list sharpen every later section.
2. **habit-core** — needs Orion's interview answers; do it while attention is fresh.
3. **balance** — depends on knowing which reward code is current (arch section confirms).
4. **minigames** — widest section; benefits from balance numbers already re-derived.
5. **multiplayer** — narrow and deep; last of the technical sections.
6. **synthesis** — strictly last; merges all findings into `habits-rpg-improvement-plan3.md`.

Sections are resumable and independent enough to run out of order if needed, but synthesis must never run before all five section docs exist.
