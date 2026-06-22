# docs/ — Index

All documents in this directory, grouped by scope. Where a newer document
supersedes an older one, both are kept but the status is noted. Check modification
dates (git log) when in doubt about which is current.

---

## Whole-project

| File | Description |
|---|---|
| [`habits-rpg-game-analysis.md`](./habits-rpg-game-analysis.md) | Comprehensive technical + gameplay overview of the entire project (architecture, all minigames, backend, multiplayer, bugs/debt). **Start here.** |
| [`habits-rpg-improvement-plan2.md`](./habits-rpg-improvement-plan2.md) | **Current roadmap (Phases 1–9).** Phases 1–8 complete as of 2026-06-22; Phase 9 deferred. Contains status markers per phase and a "Still open / deferred" tracked-items table. **Use this, not the older plan below.** |
| [`habits-rpg-improvement-plan.md`](./habits-rpg-improvement-plan.md) | ⚠️ **Superseded** by `habits-rpg-improvement-plan2.md`. Earlier staged roadmap (Stage 0–5). Kept for historical reference. |
| [`trust-model.md`](./trust-model.md) | **Decided trust model (Phase 6, 2026-06-22): Option A — Friendly Trust.** Documents what the server defends against (clock manipulation, ownership) and what it does not (save editing, leaderboard accuracy). Read before building competitive features. |
| [`habit-tracking-analysis.md`](./habit-tracking-analysis.md) | Analysis of the habit-tracking core: stat mapping, frequency types, streak/XP formulas, mood/load warning, suspension flow. |
| [`habit-tracking-improvement-plan.md`](./habit-tracking-improvement-plan.md) | Improvement recommendations for the habit-tracking core derived from the analysis above. |
| [`placeholder-art-tracking.md`](./placeholder-art-tracking.md) | Art coverage table (updated 2026-06-22): which sprites have real PNGs vs generated placeholders, drop-in asset seam docs, quick-win gaps. Reference before adding new entities. |
| [`MULTIPLAYER_PLAN.md`](./MULTIPLAYER_PLAN.md) | Original plan for publishing as a website and adding accounts, parties, and real-time co-op. Historical context; superseded in scope by the improvement plan. |
| [`balance-audit.md`](./balance-audit.md) | Stats & resources balance audit (2026-06-17): XP formulas, energy earn/spend rates, minigame reward scales, enemy stats. Reference before changing any numeric formula. |

---

## Per-minigame analyses

Each minigame has an analysis doc (facts, mechanics, current state) and an
improvement plan (recommendations). Read the analysis before the plan.

### Whole-project analyses that cover multiple minigames
| File | Description |
|---|---|
| [`forest-mining-minigame-analysis.md`](./forest-mining-minigame-analysis.md) | Combined analysis of the Deep Mine and Wild Forest crawlers (post-Phase-1 verified). Overlaps with the separate `forest-minigame-analysis.md` and `mining-minigame-analysis.md`; this combined doc is the more thorough post-Phase-1 source. |

### Dungeon Delve
| File | Description |
|---|---|
| [`dungeon-delve-minigame-analysis.md`](./dungeon-delve-minigame-analysis.md) | Analysis of the turn-based branching dungeon. |
| [`dungeon-delve-improvement-plan.md`](./dungeon-delve-improvement-plan.md) | Improvement recommendations for the dungeon. |

### Deep Mine
| File | Description |
|---|---|
| [`mining-minigame-analysis.md`](./mining-minigame-analysis.md) | Analysis of the Deep Mine crawler. See also the combined `forest-mining-minigame-analysis.md`. |
| [`mining-improvement-plan.md`](./mining-improvement-plan.md) | Improvement recommendations for Deep Mine. |

### Wild Forest
| File | Description |
|---|---|
| [`forest-minigame-analysis.md`](./forest-minigame-analysis.md) | Analysis of the Wild Forest crawler. See also the combined `forest-mining-minigame-analysis.md`. |
| [`forest-improvement-plan.md`](./forest-improvement-plan.md) | Improvement recommendations for Wild Forest. |

### The Arena
| File | Description |
|---|---|
| [`arena-minigame-analysis.md`](./arena-minigame-analysis.md) | ⚠️ **Superseded** by `arena-minigame-analysis-2.md` (older, pre-Phase-D content). Kept for historical reference. |
| [`arena-minigame-analysis-2.md`](./arena-minigame-analysis-2.md) | **Current** analysis of the Arena (updated through Phase D: boss glyphs, minion variants, authored layouts). Use this one. |

### Hex Tactics
| File | Description |
|---|---|
| [`tactics-minigame-analysis.md`](./tactics-minigame-analysis.md) | Brief/overview of Hex Tactics (2026-06-18, verified against source). |
| [`tactics-minigame-analysis-2.md`](./tactics-minigame-analysis-2.md) | Extended developer analysis of Hex Tactics. Overlaps with `tactics-minigame-analysis.md`; the `-2` version is the more detailed source used as the basis for the improvement plan. |
| [`tactics-improvement-plan.md`](./tactics-improvement-plan.md) | Improvement recommendations for Hex Tactics. |

### Skill Trials (8 stat-specific daily microgames)

| File | Description |
|---|---|
| [`lockpicking-minigame-analysis.md`](./lockpicking-minigame-analysis.md) | Analysis of the DX Lockpicking trial. |
| [`lockpicking-improvement-plan.md`](./lockpicking-improvement-plan.md) | Improvement recommendations. |
| [`rooftop-chase-minigame-analysis.md`](./rooftop-chase-minigame-analysis.md) | ⚠️ **Superseded** by `rooftop-chase-minigame-analysis2.md`. Kept for history. |
| [`rooftop-chase-minigame-analysis2.md`](./rooftop-chase-minigame-analysis2.md) | **Current** analysis of the AG Rooftop Chase trial (revised 2026-06-). Use this one. |
| [`rooftop-chase-improvement-plan.md`](./rooftop-chase-improvement-plan.md) | Improvement recommendations (based on analysis2). |
| [`armory-break-minigame-analysis.md`](./armory-break-minigame-analysis.md) | Analysis of the ST Armory Break trial. |
| [`armory-break-improvement-plan.md`](./armory-break-improvement-plan.md) | Improvement recommendations. |
| [`long-march-minigame-analysis.md`](./long-march-minigame-analysis.md) | Analysis of the EN Long March trial. |
| [`long-march-improvement-plan.md`](./long-march-improvement-plan.md) | Improvement recommendations. |
| [`spirit-grove-minigame-analysis.md`](./spirit-grove-minigame-analysis.md) | Analysis of the WI Spirit Grove trial. Note: a dedicated `src/engine/trials/spiritGrove.ts` now exists (added Phase 7); all 8 trials follow the same engine-file pattern. |
| [`spirit-grove-improvement-plan.md`](./spirit-grove-improvement-plan.md) | Improvement recommendations. |
| [`royal-court-minigame-analysis.md`](./royal-court-minigame-analysis.md) | Analysis of the CH Royal Court trial. |
| [`royal-court-improvement-plan.md`](./royal-court-improvement-plan.md) | Improvement recommendations. |
| [`ancient-library-minigame-analysis.md`](./ancient-library-minigame-analysis.md) | Analysis of the KN Ancient Library trial. |
| [`ancient-library-improvement-plan.md`](./ancient-library-improvement-plan.md) | Improvement recommendations. |
| [`last-stand-minigame-analysis.md`](./last-stand-minigame-analysis.md) | Analysis of the HP Last Stand trial. |
| [`last-stand-improvement-plan.md`](./last-stand-improvement-plan.md) | Improvement recommendations. |

---

## Design / reference

| File | Description |
|---|---|
| `../habits_rpg_gameplay_design.md` *(root)* | The original gameplay design brief. Many engine comments cite it by section ("brief §7.2", etc.). **Canonical spec for all numeric formulas.** |
| `../sprites_needed.md` *(root)* | Working art backlog: which sprites still need real pixel art vs placeholder. Reference before adding new entities. |
| `../src/colorschemes.txt` *(src/)* | Working note for color palette experiments. Not a build artifact. |

---

## Applying SQL migrations

There is **no migration runner**. Apply each file manually in the Supabase
dashboard SQL editor, in order, once per environment:

```
0001_phase1_auth_saves.sql         → accounts, saves, server_now()
0002_phase2_parties.sql            → parties, chat, leaderboard, quests
0003_phase3_coop_sessions.sql      → co-op session lobby + seed handshake
0004_coop_tactics.sql              → CHECK constraint for game types
0005_tactics_leaderboard.sql       → deepestTacticsTier in snapshot/leaderboard view
0006_party_quest_contributions.sql → per-member contribution tracking for party quests
0007_member_habits.sql             → party-visible habit data (opt-in member_habits table)
0008_consistency_leaderboard.sql   → 30-day habit consistency score in leaderboard view
```

Each file is additive; apply in order, once per environment. `0005`–`0008` are idempotent.
