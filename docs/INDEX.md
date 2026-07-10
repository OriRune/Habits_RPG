# docs/ — Index

All documents in this directory, grouped by scope. Where a newer document
supersedes an older one, both are kept but the status is noted. Check modification
dates (git log) when in doubt about which is current.

---

## Whole-project

| File | Description |
|---|---|
| [`habits-rpg-improvement-plan3.md`](./habits-rpg-improvement-plan3.md) | **Current roadmap** (2026-07-06, Phases 1–8 all ⏳). Built from the 2026-07 audit; every item cites an audit finding ID. Supersedes plan2. |
| [`habits-rpg-game-analysis.md`](./habits-rpg-game-analysis.md) | Comprehensive technical + gameplay overview of the entire project (architecture, all minigames, backend, multiplayer, bugs/debt). **Start here** for orientation — but note the 2026-07 audit fact-checked it and found drift; where they disagree, trust `audit-2026-07/`. |
| [`habits-rpg-improvement-plan2.md`](./habits-rpg-improvement-plan2.md) | **Superseded by plan3** (2026-07-06). Previous roadmap; its Phases 1–8 shipped, Phase 9 and its "Still open / deferred" residuals are carried into plan3. Kept for history. |
| [`trust-model.md`](./trust-model.md) | Decided trust model (Phase 6, 2026-06-22): Option A — Friendly Trust. **Stale in both directions** per audit finding MP-27 (doesn't know migration 0009's server trigger, nor the party-quest forgery paths) — refresh tracked as plan3 item 2.10. Option A itself still holds for saves. |
| [`habit-tracking-analysis.md`](./habit-tracking-analysis.md) | Analysis of the habit-tracking core (2026-06-20). Largely obsolete — its Critical/High items were fixed; see `audit-2026-07/02-habit-core.md` for the current state. |
| [`placeholder-art-tracking.md`](./placeholder-art-tracking.md) | Art coverage table (updated 2026-06-22): which sprites have real PNGs vs generated placeholders, drop-in asset seam docs, quick-win gaps. Reference before adding new entities. |
| [`balance-audit.md`](./balance-audit.md) | Stats & resources balance audit (2026-06-17). **Superseded by `audit-2026-07/03-balance.md`** — it predates the reward rebalance; every number in it should be considered stale. |

---

## 2026-07 project audit (`audit-2026-07/`)

Five-section audit of the whole project (2026-07-05/06), fact-checked against source
with file:line evidence, severity-graded P0–P3. **The section docs are the current
per-area analyses**; the synthesis is the merged register behind plan3.

| File | Description |
|---|---|
| [`audit-2026-07/00-audit-charter.md`](./audit-2026-07/00-audit-charter.md) | Severity scale, finding format, doc structure, run order. |
| [`audit-2026-07/01-architecture.md`](./audit-2026-07/01-architecture.md) | Layer integrity, hotspots, test gaps (ARCH-01..25). |
| [`audit-2026-07/02-habit-core.md`](./audit-2026-07/02-habit-core.md) | Habit loop as a behavioral tool, incl. the owner interview (HABIT-01..24). |
| [`audit-2026-07/03-balance.md`](./audit-2026-07/03-balance.md) | Economy and stat parity re-derived from source (BAL-01..27 + parity tables). |
| [`audit-2026-07/04-minigames.md`](./audit-2026-07/04-minigames.md) | Per-mode depth, doc drift, open-item rulings (MINI-01..41). |
| [`audit-2026-07/05-multiplayer.md`](./audit-2026-07/05-multiplayer.md) | Co-op correctness, cloud-save CAS, trust model (MP-01..31). |
| [`audit-2026-07/99-synthesis.md`](./audit-2026-07/99-synthesis.md) | Merged severity-ranked register, cross-section themes, disposition of all previously tracked items. |

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

Improvement plan archived — see [`archived/dungeon-delve-improvement-plan.md`](./archived/dungeon-delve-improvement-plan.md) below.

### Deep Mine
| File | Description |
|---|---|
| [`mining-minigame-analysis.md`](./mining-minigame-analysis.md) | Analysis of the Deep Mine crawler. See also the combined `forest-mining-minigame-analysis.md`. |

Improvement plan archived — see [`archived/mining-improvement-plan.md`](./archived/mining-improvement-plan.md) below.

### Wild Forest
| File | Description |
|---|---|
| [`forest-minigame-analysis.md`](./forest-minigame-analysis.md) | Analysis of the Wild Forest crawler. See also the combined `forest-mining-minigame-analysis.md`. |

Improvement plan archived — see [`archived/forest-improvement-plan.md`](./archived/forest-improvement-plan.md) below.

### The Arena
| File | Description |
|---|---|
| [`arena-minigame-analysis-2.md`](./arena-minigame-analysis-2.md) | **Current** analysis of the Arena (updated through Phase D: boss glyphs, minion variants, authored layouts). |

### The Forge
| File | Description |
|---|---|
| [`forge-minigame-development-plan.md`](./forge-minigame-development-plan.md) | Design/build plan, **all milestones M1–M6 shipped** (revision 3, 2026-07-08; human playtest-tuning pass still open, plan3 8.3). The one-click Forge crafting screen is now a three-phase DX/ST-driven hammering minigame — heat economy (light/heavy strikes, re-stoking with fatigue, tempo meter, crits, forge events, metal temperaments, quench finisher) that sets item quality tiers (Crude/Normal/Fine/Masterwork) — plus a Re-forge gold sink and a Fuel & Flux slot for BAL-16 dead-end materials. Engine: `src/engine/crafting/forge.ts` (pure reducer) + `src/engine/crafting.ts` (tiers); store: `economySlice` (`craft`/`reforge`, quality maps) + `commit.ts` seams; UI: `src/components/inventory/ForgeMinigame.tsx` + `forge/` subcomponents. |

### The Homestead (town-builder)
| File | Description |
|---|---|
| [`homestead-development-plan.md`](./homestead-development-plan.md) | Design/build plan for **The Homestead** — a persistent isometric town-builder that is the repeatable gold + material sink (BAL-05), fuelled by habit-earned *labor* (no energy cost). **All milestones M1–M6 landed** (Phase 10 of plan3). Engine: `src/engine/town.ts` (pure reducer) + catalogs `src/content/townBuildings.ts`, `townDecor.ts`; store `src/store/slices/townSlice.ts` (persist v34 intro; v37 orphan heal); renderer `src/components/town/` (`iso.ts`, `TownCanvas.tsx`, `townArt.tsx`, `TownBuildPanel.tsx`, `TownBuildingCard.tsx`, `TownDecorCard.tsx`) + `src/views/TownView.tsx`. |
| [`homestead-audit-2026-07.md`](./homestead-audit-2026-07.md) | Full feature audit (2026-07-10, rev 2 with adversarial-review addendum folded in): findings TOWN-01–TOWN-20 with live browser repros, economy snapshot computed from the catalogs, and gameplay improvement suggestions. **All findings fixed same day** — see the plan below. |
| [`homestead-plan-2026-07.md`](./homestead-plan-2026-07.md) | Fix & improvement plan executing the audit. **All 23 items complete (2026-07-10)**: Phases 1–4 (rotation `footprintDims`, demolish guard + v37 heal, exact-amount labor clawback, receipt truthfulness, decor removal UI, shared engine validation, test debt) and Phase 5 balance (tier-scaled `perkValues`, open-ended charters, adjacency prestige, building-prestige deed gates). |

### Hex Tactics
| File | Description |
|---|---|
| [`tactics-minigame-analysis.md`](./tactics-minigame-analysis.md) | Brief/overview of Hex Tactics (2026-06-18, verified against source). |
| [`tactics-minigame-analysis-2.md`](./tactics-minigame-analysis-2.md) | Extended developer analysis of Hex Tactics. Overlaps with `tactics-minigame-analysis.md`; the `-2` version is the more detailed source used as the basis for the improvement plan. |
| [`tactics-improvement-plan.md`](./tactics-improvement-plan.md) | Improvement recommendations for Hex Tactics. **20/25 done** (verified 2026-07-05). Remaining items adjudicated in `audit-2026-07/04-minigames.md` (open-item dispositions): 5A/5B/6C keep, 5C/2B/1A closed, 4C folded into MINI-36. |

### Skill Trials (8 stat-specific daily microgames)

| File | Description |
|---|---|
| [`lockpicking-minigame-analysis.md`](./lockpicking-minigame-analysis.md) | Analysis of the DX Lockpicking trial. |
| [`rooftop-chase-minigame-analysis2.md`](./rooftop-chase-minigame-analysis2.md) | **Current** analysis of the AG Rooftop Chase trial (revised 2026-06-). Improvement plan archived — see [`archived/rooftop-chase-improvement-plan.md`](./archived/rooftop-chase-improvement-plan.md) below. |
| [`armory-break-minigame-analysis.md`](./armory-break-minigame-analysis.md) | Analysis of the ST Armory Break trial. |
| [`long-march-minigame-analysis.md`](./long-march-minigame-analysis.md) | Analysis of the EN Long March trial. |
| [`long-march-improvement-plan.md`](./long-march-improvement-plan.md) | Improvement recommendations. Hard Mode (2.2) and streak indicator (6.3) not yet implemented (verified 2026-07-05). |
| Spirit Grove (WI trial) | Both analysis and improvement plan archived — see [`archived/spirit-grove-minigame-analysis.md`](./archived/spirit-grove-minigame-analysis.md) and [`archived/spirit-grove-improvement-plan.md`](./archived/spirit-grove-improvement-plan.md) below. |
| [`royal-court-minigame-analysis.md`](./royal-court-minigame-analysis.md) | Analysis of the CH Royal Court trial. |
| [`ancient-library-minigame-analysis.md`](./ancient-library-minigame-analysis.md) | Analysis of the KN Ancient Library trial. |
| [`last-stand-minigame-analysis.md`](./last-stand-minigame-analysis.md) | Analysis of the HP Last Stand trial. |

---

## Archived

Superseded docs moved to `docs/archived/`. Kept for historical reference only — do not update.

| File | Why archived |
|---|---|
| [`archived/habits-rpg-improvement-plan.md`](./archived/habits-rpg-improvement-plan.md) | Earlier staged roadmap (Stage 0–5). Superseded by plan2, in turn superseded by `habits-rpg-improvement-plan3.md`. |
| [`archived/dungeon-delve-improvement-plan.md`](./archived/dungeon-delve-improvement-plan.md) | Dungeon improvement plan. Most items shipped (audio, RelicTray, merchant preview — verified 2026-07-05); remaining leftovers (BoonChoice timing, scene art, death loot-loss design call) tracked in plan3's deferred table. |
| [`archived/mining-improvement-plan.md`](./archived/mining-improvement-plan.md) | Deep Mine improvement plan. Implemented items verified 2026-07-05 (death penalty/tombstone, fog of war shipped); current Mine findings live in `audit-2026-07/04-minigames.md`. |
| [`archived/MULTIPLAYER_PLAN.md`](./archived/MULTIPLAYER_PLAN.md) | Original multiplayer design plan. Historical context; superseded in scope by the current roadmap and the multiplayer features now shipped. Co-op clock-offset note still referenced at line 257. |
| [`archived/arena-minigame-analysis.md`](./archived/arena-minigame-analysis.md) | Pre-Phase-D Arena analysis. Superseded by `arena-minigame-analysis-2.md`. |
| [`archived/rooftop-chase-minigame-analysis.md`](./archived/rooftop-chase-minigame-analysis.md) | Earlier Rooftop Chase analysis. Superseded by `rooftop-chase-minigame-analysis2.md`. |
| [`archived/lockpicking-improvement-plan.md`](./archived/lockpicking-improvement-plan.md) | All 19 recommendations fully implemented (2026-06-22 audit). |
| [`archived/armory-break-improvement-plan.md`](./archived/armory-break-improvement-plan.md) | All structural/mechanic recommendations implemented; only "verify reward balance after playtesting" remains (no code target). |
| [`archived/ancient-library-improvement-plan.md`](./archived/ancient-library-improvement-plan.md) | All gameplay/engine recommendations implemented; only component RTL tests and trivial CSS star animation remain. |
| [`archived/royal-court-improvement-plan.md`](./archived/royal-court-improvement-plan.md) | All substantive recommendations implemented; remaining gaps (dynamic star thresholds, CH 5th-choice) explicitly optional/speculative. |
| [`archived/last-stand-improvement-plan.md`](./archived/last-stand-improvement-plan.md) | All Pass 1–6 recommendations implemented; remaining gaps (lane redesign, HP scaling) explicitly lowest-priority/optional. |
| [`archived/habit-tracking-improvement-plan.md`](./archived/habit-tracking-improvement-plan.md) | All 7 stages fully implemented (2026-06-22): bug fixes, edit UI, balance, integrity, party, UX polish, long-term features. |
| [`archived/developer-tools-improvement-plan.md`](./archived/developer-tools-improvement-plan.md) | All 14 steps fully implemented (2026-06-23): `devSetLevel` statLevels fix, resetGame fields, expanded boss roster, Fill Energy / Add Gold / Force Rollover / Reset Ledger tools, state inspector, layout polish. |
| [`developer-tools-analysis.md`](./developer-tools-analysis.md) | Pre-improvement analysis of Settings → Developer (written 2026-06-23 before fixes). All identified bugs and gaps have been resolved. Read as historical context only; current tool behaviour is documented in the README. *(File still sits in `docs/` root — candidate for a move to `archived/`.)* |
| [`archived/forest-improvement-plan.md`](./archived/forest-improvement-plan.md) | All player-facing recommendations implemented (verified 2026-07-05): charge feedback, shrine telegraphing, exit visibility, spell HUD, dash, guardian HP bar, adaptive drone, haul stashing. Code-quality refactor items (splitting the overlay, VFX hook, control-loop tests) and the "longer-term" daily-trial idea were left undone as optional housekeeping. |
| [`archived/rooftop-chase-improvement-plan.md`](./archived/rooftop-chase-improvement-plan.md) | All 25 items across phases A–E implemented (per commit `7b98bc4`). |
| [`archived/spirit-grove-improvement-plan.md`](./archived/spirit-grove-improvement-plan.md) | Star system fix, round/difficulty expansion, keyboard nav, WI clue-gating, and a new mastery mode all shipped (commit `5a8bdee`, re-verified 2026-07-05). One item never landed despite the original archive note: the §4.1 ambient audio loop. |
| [`archived/spirit-grove-minigame-analysis.md`](./archived/spirit-grove-minigame-analysis.md) | Superseded a second time — predates the mastery-mode/clue-gating work (commit `5a8bdee`). Historical context only. |

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
0009_leaderboard_antimanip.sql     → suspect flag + XP-rate trigger; leaderboard view excludes suspect rows
```

Each file is additive; apply in order, once per environment. `0005`–`0009` are idempotent.
