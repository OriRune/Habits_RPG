# Audit 2026-07 — Minigames

**Date run:** 2026-07-05 · **Branch:** `feature/multiplayer` · **Sections complete before this one:** 01 architecture, 02 habit-core, 03 balance

Method: fact-checked the active per-mode analysis docs and plan open-item lists via 6 parallel fact-check agents (Mine/Forest, Dungeon/Bosses, Arena/Tactics, Trials A, Trials B, Forge), then gap-audited with 6 parallel design-audit agents batched per the run request: **Mine+Forest as one auditor, Dungeon+Bosses as another**, plus Arena, Tactics, Trials batch A (Rooftop/Lockpicking/Grove/Library), Trials batch B (Armory/March/Court/Last Stand). All P0/P1 findings were re-verified by hand at the cited lines this session, including confirming the P0's lack of any escape path (only `resetGame` and schema migrations ever clear an active run). Reward/parity context comes from section 03's tables and is not re-derived.

Inputs carried from earlier sections (not re-reported, referenced where they interact): BAL-02/-06 (boss weaknesses/dead affinity), BAL-04 (Arena named-boss gold farm), BAL-10 (Tactics dominated on rewards), BAL-11 (mine bounty dead data), BAL-12 (bank-anywhere), BAL-13 (free descent), BAL-19 (free boss retries), BAL-20 (completeTrial silent no-op), BAL-23 (AG caps), BAL-25 (restart at depth 1); ARCH-04 (mitigation fork), ARCH-09 (elite earnedXp undercount).

## Executive summary

- **One P0: deep Mine/Forest runs can soft-lock permanently.** When the boon pool is exhausted (~floor 16–20 / stage 10–14), a guardian kill or cache pickup enters `'choosing'` with zero options, no skip exists, banking is gated on `'active'`, and nothing but a full `resetGame` ever clears the run (MINI-01).
- **A single clock-mixing bug guts both crawlers:** slices inject `Date.now()` while engine ticks run on the rAF clock, so charged-strike stagger and spell freezes are *permanent*, ring-of-fire never expires, and the forest's signature windup telegraph **never renders** — the mode's core skill loop is invisible (MINI-02).
- **Every combat mode has a movement dominant strategy that deletes risk.** The player out-speeds every threat in Arena (6.67 vs 4.0 cells/s), Tactics (move ≥ enemy move, reach 7 vs 5, no turn limit), Mine, and Forest (150 ms/cell vs 320–950 ms cadences); Dungeon's flee keeps 100%. Failure is opt-in everywhere, so difficulty never bites regardless of build (MINI-06, -09, -20; BAL-12 family).
- **The flagship fights are the shallowest content in the game.** No named level-gate boss has a moveset — every level-up battle is untelegraphed attack-spam — while the full intent/moveset AI ships and works in dungeon trash mobs and biome bosses. Meanwhile dungeon combat rooms pay zero loot (treasure strictly dominates routing) and biome bosses are ~7× over-curve walls that also pay zero (MINI-03, -04, -05).
- **Trials are reward-rich but skill-optional:** Last Stand is 3★-able by eyes-closed mashing, Royal Court by safe-picks-only, Ancient Library by abandon-and-transcribe; energy/daily-gate charge only on completion, so mid-run abandonment is a free retry everywhere; and 3 of 8 trials never read their own stat (MINI-10, -11, -12). Sharpens section 03's BAL-01.

## Prior-doc fact check

Condensed to load-bearing verdicts; ~60 claims were checked in total. "Doc" abbreviations: mining/forest/f-m = the three crawler analyses; dd = dungeon-delve analysis; arena2/tactics2 = the *-2 analyses; per-trial docs named directly.

| # | Claim | Source | Verdict | Evidence |
|---|-------|--------|---------|----------|
| 1 | Mine sizes 33→57 by band; rock durability 1/2/3; monsters min(10, 2+0.6f); pick = pickaxe+⌊melee/8⌋, charge ×1.75; guardians floor 7/15 | mining | **verified** | `mining.ts:69-76,341-343,463,559,887-893`; `content/mining.ts:186-189` |
| 2 | "Mine has no death penalty" (top recommendation) | f-m §7.2 | **stale — shipped** | `MINE_DEATH_KEEP=0.5` + tombstone (`mining.ts:85`, `shared.ts:1153-1168`) |
| 3 | "Mine has no fog of war" | mining §9 | **stale — shipped** | sight radius 4 + lantern hook (`MineRunOverlay.tsx:30,443,622-633`) |
| 4 | Crawler trickle: each stat gets full `4+3×deepest` | f-m §3.11 | **wrong** | split ceil/floor across the two stats (`shared.ts:1138-1142,1172-1176`) — half what the doc implies |
| 5 | stone_golem floor 10 / def 6; ancient_guardian stage 10 | f-m tables | **wrong (transcription)** | floor 7 / def 4 (`content/mining.ts:150-155`); stage 8 (`content/forest.ts:162-167`) |
| 6 | Forest guardians 4/8; score +10×stage kill, +100×stage advance; alpha_boar | forest | **verified** | `content/forest.ts:239-242`; `forest.ts:417,820` |
| 7 | Dungeon: FLOOR_LOSS_KEEP=0.25 "in dungeon.ts:87"; flee keeps 100% | dd | **verified, cite wrong** | constant lives at `dungeonSlice.ts:31`; flee `dungeonSlice.ts:219` |
| 8 | Treasure-room probability rises with depth (0.4+0.05d) | dd | **wrong** | room weight flat 2 (`dungeonMap.ts:52-64`); doc conflated the in-room weapon-drop chance (`dungeon.ts:83`) |
| 9 | Second map edge = flat 45% | dd | **stale** | if/else-if double draw ⇒ ~70% for interior nodes (`dungeonMap.ts:117-121`) |
| 10 | Relics = 28 entries (23 boons); triggered relics = top open item | dd | **wrong / shipped** | 38 entries (33 boons 12/14/7 + 5 curses); triggers live (`relics.ts:48-50`, `dungeonSlice.ts:229-233`) |
| 11 | No in-run damage stats; `encounterRoomFor`/`generateFloor` cleanup open; audio/RelicTray/merchant-preview open | dd/plan | **all shipped** | `dungeonSlice.ts:251-256,320-328`, `DungeonView.tsx:245-252`; identifiers gone; `useDungeonAudio.ts`, `RelicTray.tsx:44-74`, `FloorMap.tsx:182-190` |
| 12 | Encounters 28 (10/biome); persist v22 | dd | **stale** | 36 (13/biome incl. deep-room events); v27 (`useGameStore.ts:65`) |
| 13 | Boss scale 1+(d−1)·0.1+(L−1)·0.06; boon tiers @4/10; checkChance floor .15 | dd | **verified** | `biomes.ts:41`; `shared.ts:890-896`; `encounters.ts:130-132` |
| 14 | Arena constants: 3 energy, cooldowns 320/520/700, iframe 550, telegraphs, minions 18%/35% cap 4, layouts 6@30%, speed 0.85→1.2@L23, death keep 0.5 | arena2 | **verified** | `arena.ts:40-87,362-403,1231-1236` |
| 15 | Arena weakness ×1.3/0.7; gear doesn't feed arena; minion bolts skip walls | arena2 | **wrong ×3** | 1.25/0.6 (`combat.ts:330-331`); `fighterFor` folds gear (`shared.ts:608-648`); bolts wall-checked (`arena.ts:926`) |
| 16 | Tactics: tier = deepest+1, player-chosen | tactics2 | **wrong** | forced `clamp(level, 4, 50)` (`tacticsSlice.ts:57`) |
| 17 | Tactics stat XP "(4+tier) each to AG/DX/EN" | tactics2 | **wrong** | (4+tier) is the *total*, split 3 ways (`shared.ts:1265-1279`) |
| 18 | Overwatch fires before the enemy acts; enemy count ignores board size; icons/terrain-glyph items open | tactics2 | **wrong / stale / done** | overwatch runs *after* `enemyAct` (`hexBattle.ts:1178-1192`); sizeBonus exists (`:1444-1449`); 1A/terrain glyphs shipped (`:1478,1393-1399`) |
| 19 | Tactics plan: 5A split, 5B overlay test, 6C playstyle XP open; 5C via `isTacticsLoadoutSpell`; 2B/4C partial | tactics plan | **confirmed** | single 1,763-ln file; no TacticsOverlay test exists; `shared.ts:1265-1279`; `hexBattle.ts:76-82` |
| 20 | Trial reward = (20+8L)×mult | **all 8 trial docs** | **stale everywhere** | halved to (10+4L) in Stage 3.2 (`trials/trials.ts:121-137`); gold (15+5L) unchanged |
| 21 | Rooftop: 3 prop kinds, 40/35/25; dash 380 ms/+40% | rooftop2 | **stale/wrong** | 4 kinds — crossbowman 15% gated i≥10 (`rooftopChase.ts:184,283-303`); dash 550 ms/+90% (`:140,146`) |
| 22 | Lockpicking scoring, DX tolerance +0.3°/+0.1°, break floors, reveal phase; RNG unseeded | lockpicking | **verified** | `lockpicking.ts:27-48,60-73,106-126`; `Lockpicking.tsx:317` |
| 23 | Spirit Grove pool 15, no WI read; §4.1 ambient audio open | grove (archived) | **stale / audio still open** | 30 rounds, WI clue gating + mastery draft (`spiritGrove.ts:22-45,62-119`); sfx.ts has only one-shot grove cues |
| 24 | Library 2→8/7 rounds; KN hints @5/10; hint RNG = Math.random | library | **verified** | `ancientLibrary.ts:9-10,56-95,124-126`; `AncientLibrary.tsx:64` |
| 25 | Last Stand /resolved scoring; BLOCK_WINDOW_BY_WAVE dormant | last-stand | **verified** | `lastStand.ts:113-117`; component imports only SPAWN_AHEAD/GRACE |
| 26 | Long March formulas verified; EN "+6 stamina ties progression to trial" | long-march | **verified / overstated** | `MARCH_MAX_STA=12` clamps the bonus away on step 1 (`longMarch.ts:6-9,99-101`, `LongMarch.tsx:55`) — see MINI-13 |
| 27 | Long March plan 2.2 (hard mode) and 6.3 (hub streak) open | lm plan | **confirmed open** | no hardMode/dailyTheme/trialStreak anywhere in repo |
| 28 | Royal Court d20+CH vs DC 10/13/16; 14 exchanges, 7 gambits | royal-court | **verified** | `royalCourt.ts:7-74`; `content/trials.ts:463-647` |
| 29 | Forge greenfield; plan's integration assumptions | forge plan | **verified, 2 corrections** | no engine module; `ForgeSection.tsx:42-97` one-click stub. Corrections: no bare `getWeapon` exists in mining/forestSlice (both route through `fighterFor` — fixing `shared.ts:647` alone suffices); PaperDoll is at `components/character/`, not `inventory/` |

## Findings

### [MINI-01] Boon-pool exhaustion soft-locks the run — and then the whole mode, permanently (P0, confidence: high)
- **Area:** src/content/boons.ts, src/engine/mining.ts, src/engine/forest.ts, src/store/slices/miningSlice.ts, forestSlice.ts
- **Observation:** Hand-verified end to end. `rollBoonChoices` filters held boons and returns `[]` once the pool (mine 7, forest 8) is exhausted (`boons.ts:143-151`). Guardian kills (`mining.ts:820-822`, `forest.ts:419-423`) and cache pickups (`miningSlice.ts:170-182`, `forestSlice.ts:140-155`) still transition to `status:'choosing'` with the empty array. The choice panel renders only `pendingBoonChoice.map(...)` buttons — no skip (`MineRunOverlay.tsx:1093-1103`); `chooseMineBoon` requires a valid pick (`miningSlice.ts:263-268`); `beginBanking` requires `status==='active'` (`miningSlice.ts:270-273`); `endMining` is only reachable from the banking/death screens. The run persists and `beginMining` refuses while `s.mining` exists (`miningSlice.ts:72`). Repo-wide, the only writers that clear `mining` are `resetGame` (`coreSlice.ts:174`) and persist-version migrations — no dev tool, no other action.
- **Prior-doc status:** not covered by any prior doc (boon system post-dates the crawler analyses).
- **Impact:** The most engaged players (deep-run record chasers, ~floor 16–20 / stage 10–14 under expected cache/guardian rates) hit an inescapable modal, lose the haul, and lose the entire mode until a full save wipe. Meets the P0 bar: data loss with no recovery path.
- **Recommendation:** In `killMonster`/`killBeast` and both cache paths, skip the `'choosing'` transition when `choices.length === 0` (grant a small consolation heal/gold instead); add a Skip button to the panel as belt-and-braces.

### [MINI-02] Mixed timebases (Date.now vs rAF clock) permafreeze monsters, make buffs permanent, and delete the forest's windup telegraph (P1, confidence: high)
- **Area:** src/store/slices/miningSlice.ts, forestSlice.ts, src/engine/mining.ts, forest.ts, src/components/forest/ForestRunOverlay.tsx
- **Observation:** Hand-verified. `mineStrikeCharged` injects `Date.now()` (~1.78e12) into the engine (`miningSlice.ts:189`; forest equivalents `forestSlice.ts:167,221`), which stamps `frozenUntilMs = nowMs + STAGGER_MS` (`mining.ts:876`). But the tick pipeline runs on the rAF clock (`useMiningLoop.ts:225` passes the rAF timestamp, ms since page load, ~1e5), and every consumer compares against that clock: `nowMs < m.frozenUntilMs` (`mining.ts:1235`) is true forever. Same class: spell freeze, ring-of-fire expiry (`mining.ts:1294`), bless pruning, 30 s rune expiry. The overlay inverts it — `b.windupUntilMs > Date.now()` (`ForestRunOverlay.tsx:934-936`) compares an engine (rAF) timestamp against epoch time, always false, so the red windup glow and its audio cue never render. Related: perf-clock run timestamps (`staNextRegenMs`, `readyAtMs`, `lastDashMs`) are persisted, so a reloaded run stalls until the new session's rAF clock catches up to the old uptime.
- **Prior-doc status:** not covered; the crawler analyses describe the telegraph as working.
- **Impact:** One charged tap permanently disables any forest beast including guardians (it can never move or strike again) — trivializes all forest combat; mine monsters become stationary turrets; and the forest's central read-the-telegraph skill loop is invisible to every player, so the design's best mechanic effectively doesn't exist.
- **Recommendation:** Thread the loop's rAF `now` into `mineStrikeCharged`/`forestActCharged`/both cast actions (one parameter each); render frozen/windup state from `performance.now()`; rebase persisted run timestamps on rehydration.

### [MINI-03] No named level-gate boss has a moveset — every level-up fight is decision-free attack-spam while the full combat AI ships unused beside it (P1, confidence: high)
- **Area:** src/engine/bosses.ts, src/engine/combat.ts
- **Observation:** Hand-verified: `moveset` appears in `bosses.ts` only in the type definitions (`:71,113`) — none of the 7 `NAMED_BOSSES` nor the generic fallback defines one. `pickEnemyMove` returns null for an empty moveset (`combat.ts:289-292`) and the caller falls back to a plain basic attack every turn (`combat.ts:568`), so intent telegraphs, heavy/guard/drain/inflict moves, and the enemy MP/STA economy never fire in a level-gate battle. The same engine runs rich movesets for dungeon trash (`enemies.ts:37-227`) and all three biome bosses (e.g. Bone Tyrant's per-phase movesets, `content/biomes.ts:45-63`) — this is a data gap, not an engine gap.
- **Prior-doc status:** not covered (named bosses post-date the June docs); interacts with BAL-02 (unusable weaknesses) and BAL-19 (free retries) — together the flagship gate is both shallow and rigged.
- **Impact:** The most important recurring fight in the progression loop — the one the whole `pendingLevelUp` system builds toward — is the shallowest combat in the game; optimal play is provably attack-spam + heal-when-low, and pity retries repeat the identical non-decision.
- **Recommendation:** Data-only fix: author a 3-move moveset per named boss and a small shared moveset for the generic Trial Guardian; the engine already supports it end to end.

### [MINI-04] Biome bosses are ~7× over on-curve player power, pay zero loot, and get no pity relief — the depth ladder walls at floor 4 (P1, confidence: high on math, medium on felt severity)
- **Area:** src/content/biomes.ts, src/engine/combat.ts, src/store/shared.ts
- **Observation:** Bone Tyrant base phases 110/90 HP, atk 9/12 (`content/biomes.ts:43,52-53`, hand-verified) scale by 1.64 at depth 5/L5 (`biomes.ts:41`) → 180+148 HP, atk 15/20. The repo's own on-curve L5 build (balance.test.ts:44-45: maxHp 100, +3 weapon, mitigation 0) deals ~10/turn and takes ~17.5/turn: ~37 turns needed vs ~6 survivable. Anti-frustration relief requires `lossesBefore ≥ 3` and is never passed for dungeon bosses (`shared.ts:951-957`, `combat.ts:180-184`). All three biome bosses pay `{gold: 0, items: []}` (`content/biomes.ts:66,115,179`, hand-verified). The test suite asserts only that L1 *loses* to it — nothing asserts any realistic build can win.
- **Prior-doc status:** not covered by the dungeon analysis (it documents the bosses, not their tuning).
- **Impact:** `deepestFloor` gates (merchant@5, elite@8, T3 boons@10) sit behind a wall ~5 levels above the depth curve that must be re-approached from floor 1 each attempt (BAL-25) and pays nothing when finally beaten; rational play banks at depth 4 forever.
- **Recommendation:** Cut phase HP ~35%, add depth-scaled boss gold (e.g. 100+50×region), pass the run's boss-loss count into `enterRoom` so relief applies — and add a balance test asserting a realistic build beats `bossFor(catacombs, 5, L)` within N rounds.

### [MINI-05] Normal combat rooms award zero loot — treasure strictly dominates the floor map and the mode's core content is rationally avoided (P1, confidence: high)
- **Area:** src/store/slices/dungeonSlice.ts, src/engine/enemies.ts, src/engine/dungeon.ts, src/engine/dungeonMap.ts
- **Observation:** Hand-verified: the combat win branch adds XP and stats but no reward for `room.type==='combat'` — only elites append gold (`dungeonSlice.ts:224-250`); `enemyFor` hardcodes `rewards: {gold: 0, items: []}` (`enemies.ts:258`). Treasure pays 60+10×depth+rng(0..40) gold + materials + 50% spellbook, riskless and checkless (`dungeon.ts:75-84`). Room weights make combat the most common room (5 vs treasure 2, `dungeonMap.ts:52-63`) and one combat per floor is forced (`dungeonMap.ts:106-110`). Per-room EV at depth 5: treasure ≈ 130 g riskless; combat = 0 g, ~13 stat XP, minus HP.
- **Prior-doc status:** not covered; complements BAL-13 (descent free) — combat is where the time goes and where nothing pays.
- **Impact:** Optimal routing taps treasure and dodges swords; players who fight everything feel poor and battered relative to treasure-tappers, inverting the mode's fantasy.
- **Recommendation:** One line in the won branch: depth-scaled combat gold ≈ half a treasure room (e.g. 20+5×depth).

### [MINI-06] Arena: the player permanently outruns every threat — kiting + ranged is risk-free at all levels, and wins re-farm named-boss item drops (P1, confidence: high)
- **Area:** src/engine/arena.ts, src/hooks/useArenaLoop.ts
- **Observation:** Hand-verified constants: player `MOVE_INTERVAL_MS = 150` fixed (`useArenaLoop.ts:41`) = 6.67 cells/s; boss `BOSS_MOVE_CD_MS = 300` (`arena.ts:56`) at the 1.2× speed cap = 4.0 cells/s; bats 433 ms. The boss stops moving during windups (`arena.ts:1193`), and every telegraph window (633–792 ms at cap) is ≥2× the steps needed to exit its area; boss contact damage outside telegraphs does not exist (`bossThink` only queues telegraphs, `arena.ts:1163-1194`). Ranged equals melee per-hit (same CD, same `attackRoll`, defense applied both paths — `arena.ts:698` vs `:938`) with zero exposure, so ranged/spell kite strictly dominates. Wins also re-pay `boss.rewards.items` every run — no first-kill flag (`arena.ts:582-583,1231-1232`).
- **Prior-doc status:** contradicts arena2's framing of telegraph-dodging as the skill test; item re-farm extends BAL-04 (gold side already reported).
- **Impact:** One strategy wins every fight at every level with near-zero failure; melee is a dominated build (compounding BAL-02's anti-ST gate math); death happens only to inattentive players, making Arena a safe repeatable faucet.
- **Recommendation:** Give the boss a gap-closer telegraph (charge onto the player's cell) and/or let boss move CD keep scaling past the 1.2× cap; price the ranged/melee choice (melee damage premium ~1.3× or ranged stamina premium).

### [MINI-07] Arena: ice_rune sustains near-permanent boss lockdown (P1, confidence: medium-high)
- **Area:** src/engine/arena.ts, src/content/spells.ts
- **Observation:** Verified constants: `FREEZE_DURATION_MS = 3000` flat, not speed-scaled (`arena.ts:70`); ice_rune costs 7 MP (`content/spells.ts:145`); MP regen 1.8/s (`arena.ts:50`); a frozen boss can neither move nor act (`arena.ts:1164`). Cycle ≈ 3.0 s freeze + ~0.3–0.6 s re-approach (boss auto-paths to the player, so a rune dropped adjacent re-triggers reliably) → ~2.0 MP/s spend vs 1.8 MP/s regen; with maxMp = 8+3×KN, KN 12 sustains ≈ 180 s of lockdown — longer than any fight. No freeze resist or diminishing returns exists.
- **Prior-doc status:** not covered (runes post-date arena2's writing on spell balance).
- **Impact:** Any player with the ice_rune spellbook and modest KN stunlocks every boss, including all named ones, winning damage-free — trivializes the mode harder than kiting.
- **Recommendation:** Post-freeze immunity window on the boss (6–8 s), or halve freeze duration against bosses.

### [MINI-08] Tactics: tier is forced to character level with linearly unbounded enemy scaling against stat-capped players (P1, confidence: high)
- **Area:** src/store/slices/tacticsSlice.ts, src/engine/hexBattle.ts
- **Observation:** Hand-verified: `tier = max(4, min(50, character.level))` — never player-chosen (`tacticsSlice.ts:57`). Enemy HP/attack scale ×(1+0.07×(tier−1)) with count up to 8 (`hexBattle.ts:1444-1449,1471,1488-1491`): total enemy HP ≈ 82 at t4 → ~1,205 at t50 (14.7×) against a player capped at STAT_CAP 25 + weapon +6 with one action/turn; win gold grows only linearly (64→340).
- **Prior-doc status:** contradicts tactics2 ("tier = deepest+1"); compounds BAL-10 (already the worst-paying mode).
- **Impact:** The player can never pick a fight they enjoy; matches turn into slogs or zero-gold losses precisely as the character grows, and "Highest tier won" measures level, not skill. Strongest single driver of mode abandonment.
- **Recommendation:** Add a tier selector clamped to [4, level] (board size is already a pre-match setting — mirror it); one line in `beginTactics` plus a picker row in TacticsView.
### [MINI-09] Tactics: ranged kiting is damage-free and dominant — 10 of 16 enemy templates can never attack a bow player (P1, confidence: high)
- **Area:** src/engine/hexBattle.ts, src/content/weapons.ts
- **Observation:** Player move = min(6, 2+⌊AG/4⌋) (`hexBattle.ts:90`) vs enemy `moveTiles = 3 + max(0, radius−4)` (`hexBattle.ts:1496`, hand-verified) — the player matches or beats every enemy from AG 4 on small/medium boards. Reach: hunting_bow 5 + height ≤2 = 7 vs enemy max 5 (magic 3 + height), melee 1. Enemy AI is greedy min-distance with no interception (`hexBattle.ts:1129-1131,1215`); no turn limit exists; STA regen 2/turn ≥ bow cost. Overwatch — the nominal counter-tool — fires only *after* `enemyAct` completes (`hexBattle.ts:1178-1192`), so it never prevents damage.
- **Prior-doc status:** contradicts tactics2's depth framing; the overwatch ordering also invalidates its §4 description.
- **Impact:** Retreat-then-shoot wins every board with zero damage (auto-completing the Unscathed objective); cleave/push/cover — the mode's actual depth — are strictly suboptimal flavor.
- **Recommendation:** Give chargers a once-per-fight lunge (double move budget after 2+ turns out of reach) or a soft turn cap (spreading hazard); either breaks the "player speed ≥ enemy speed forever" invariant.

### [MINI-10] Last Stand: penalty-free input mashing earns ~0.9 score with zero direction-reading (P1, confidence: high)
- **Area:** src/components/trials/games/LastStand.tsx, src/engine/trials/lastStand.ts
- **Observation:** Hand-verified: `block()` silently returns when no matching attack is in flight — no lockout, no penalty, no rate limit (`LastStand.tsx:186`); the keydown handler has no `e.repeat` guard (`LastStand.tsx:203-211`; contrast `ArmoryBreak.tsx:109`), so autorepeat mashes all three lanes. The block window spans the full flight (`el ≥ landMs − SPAWN_AHEAD_MS`, `:183`) and `reactionSpeed` rewards blocking at spawn (`lastStand.ts:43-46`). Cycling three keys at ~5/s yields per-attack speed ≈ 0.86 ("Perfect!"), mean score ≈ 0.9 → guaranteed 3★, HP untouched.
- **Prior-doc status:** not covered by last-stand analysis (it documents the dormant per-wave windows but not the whiff-free mash).
- **Impact:** The HP trial's entire skill is optional; combined with trials being the best per-energy reward (BAL-01), the daily optimum is 20 seconds of eyes-closed mashing.
- **Recommendation:** ~200 ms input lockout (or small speed penalty) on empty blocks — restores read-then-react at one line.

### [MINI-11] Trials charge energy and the daily gate only on completion — free mid-run abandonment turns each trial's RNG policy into a retry exploit (P1, confidence: high)
- **Area:** src/store/slices/trialsSlice.ts, src/components/trials/TrialModal.tsx, src/components/trials/games/AncientLibrary.tsx, SpiritGrove.tsx
- **Observation:** Energy deduction and `trialsClearedOn` stamping happen only inside `completeTrial` (`trialsSlice.ts:30-57`); the Abandon path has no cost (`TrialModal.tsx:119-137`). Consequences by RNG policy: Ancient Library's master sequence is daily-seeded and identical across reopens (`AncientLibrary.tsx:38-41`) — watch the show phase, abandon, transcribe, reopen, score 1.0; Spirit Grove redraws 5 fresh questions per mount from `Math.random` (`SpiritGrove.tsx:34`) — redraw-scum for known rounds; Rooftop separately offers sanctioned unlimited "Run Again" before accepting (`RooftopChase.tsx:1037-1094`), making retry policy inconsistent across the eight.
- **Prior-doc status:** not covered; sibling of BAL-20 (silent no-op on the other side of the same gate).
- **Impact:** The KN trial degenerates into transcription; the daily-gate design (the only thing containing trials' best-in-game reward rate, per section 03) is voided for anyone who notices; four different implicit retry rules erode trust in the "daily" framing.
- **Recommendation:** Re-seed per attempt (`dailySeed(iso) ^ attemptNonce`) for Library, persist a per-day attempt nonce generally, and adopt Rooftop's explicit retry policy (with fresh seeds) everywhere.

### [MINI-12] Three trials never read their own stat: Rooftop ignores AG entirely, Armory ignores ST, Last Stand ignores HP (P2, confidence: high)
- **Area:** src/engine/trials/rooftopChase.ts, armoryBreak.ts, lastStand.ts, src/components/trials/TrialModal.tsx
- **Observation:** Repo-wide grep: no `statLevels` read anywhere in the Rooftop engine/hook/component; Armory's `LOCK_CONFIG` is constant with no stat input (`ArmoryBreak.tsx:16-24`); Last Stand's `STARTING_HP = 100` is constant (`lastStand.ts:11`) and its engine-side per-wave window scaling (`BLOCK_WINDOW_BY_WAVE`, `blockWindowForWave`, `lastStand.ts:19,102-104`) is exported but never used by the component. TrialModal renders stat-effect info boxes for EN/DX/CH but none for AG/ST/HP (`TrialModal.tsx:154-185`).
- **Prior-doc status:** confirms the last-stand doc's dormant-API note; the Rooftop AG gap is not covered by any doc.
- **Impact:** For 3 of 8 stats, raising the trial's namesake stat changes nothing the player can feel — the "your real effort transfers into the game" promise breaks exactly where trials are supposed to embody it.
- **Recommendation:** AG scales dash cooldown in Rooftop (e.g. −60 ms/AG, floor 1,800); wire the dormant `blockWindowForWave` as an HP-scaled window; scale Armory `zoneWidth` with ST the way lockpicking scales with DX.

### [MINI-13] Long March: the advertised EN bonus is clamped away on the first step, and rest-spam guarantees 0.70 while the ceiling is ~0.86 (P2, confidence: high)
- **Area:** src/engine/trials/longMarch.ts, src/components/trials/games/LongMarch.tsx, src/components/trials/TrialModal.tsx
- **Observation:** `marchStartStamina` grants up to 18 at EN 18 (`longMarch.ts:99-101`) but every step clamps to `MARCH_MAX_STA = 12` (`LongMarch.tsx:55`), so the effective bonus is +1 to +3 of the advertised +6 — while the intro box promises "18 total" (`TrialModal.tsx:154-165`). Separately: Rest gains stamina on every terrain *and* advances the tile (`longMarch.ts:22`, `LongMarch.tsx:57`), so completion is unconditional → score floor 0.70 (2★ free); the 0.7/0.3 tile/distance weighting with `MARCH_MAX_DISTANCE = 32` caps realistic scores ≈ 0.855, so this trial can never pay the full multiplier other trials can.
- **Prior-doc status:** the analysis states both facts without noting they conflict; plan 2.2's hard mode is pointless until this scoring is fixed.
- **Impact:** The EN trial has no failure state, a near-free 3★ (dist ≥ 5.4 suffices), all decisions compressed into a ~12% reward swing — and cross-trial unfairness in the shared multiplier.
- **Recommendation:** Clamp to `max(MARCH_MAX_STA, startStamina)` so the EN buffer depletes instead of vanishing; renormalize distScore to an achievable max (~20) or make Rest not advance the tile.

### [MINI-14] Royal Court: gambits are −EV until CH ≈ 9–13, two are strictly dominated at any CH, and safe-picks-only yields 3★ ~94% of days at CH 0 (P2, confidence: high)
- **Area:** src/content/trials.ts, src/engine/trials/royalCourt.ts, src/components/trials/TrialModal.tsx
- **Observation:** From the exchange data (`content/trials.ts:463-644`): 9 of 14 exchanges have a safe pick worth the max; E[safe-only] ≈ 0.875. Gambit break-evens under d20+CH vs DC with nat-1/20 rules: Jester/Rhovas need CH ≥ 9, Herald ≥ 10, Aldric ≥ 13; only Kessir is +EV from CH 3. Voss (`:602`) and Physician (`:641`) gambits pay the same as their safe picks with added downside — dominated at any CH. The intro copy tells players bold responses become "more reliable" with CH (`TrialModal.tsx:178-184`), steering them into −EV picks at realistic CH 4–8.
- **Prior-doc status:** not covered — the analysis documents the mechanics, not the EV.
- **Impact:** The CH trial's risk/reward layer is a numerically wrong bet for nearly every real character; optimal play routes around CH, echoing BAL-07's "CH is the worst stat" from the other direction.
- **Recommendation:** Raise gambit success payoffs to +5/+6 (break-even ≈ CH 3–5); give Voss/Physician gambits +4 so no gambit is dominated.

### [MINI-15] Lockpicking: uncapped linear tolerance growth makes the trial unfailable by ~L15/DX15 (P2, confidence: high)
- **Area:** src/engine/trials/lockpicking.ts
- **Observation:** tol = base + (L−1)×0.6 + DX×0.3 and open = baseOpen + (L−1)×0.2 + DX×0.1, no clamps (`lockpicking.ts:60-73`). Hardest lock (base 11°): L15/DX15 → 23.9° (zone = 27% of the 180° arc); L20/DX20 → 28.4° (32%); the novice lock reaches 44% of the arc. 3★ needs only 3 of 6 picks left (`:117-126`).
- **Prior-doc status:** not covered (the doc verified the formulas, not their asymptote).
- **Impact:** The healthiest stat-coupled trial inverts into an automatic daily 3★ by mid-game — score inflation exactly where BAL-01 says trial XP already outcompetes habits.
- **Recommendation:** Cap combined bonus at 2× base per lock, or make the DX term diminishing (√DX) — one line in `lockTolerance`.

### [MINI-16] Spirit Grove: every answer is taught after each pick, so the 30-round pool decays into recall in ~2 weeks; mastery mode is all stick, no carrot (P2, confidence: high)
- **Area:** src/engine/trials/spiritGrove.ts, src/components/trials/games/SpiritGrove.tsx
- **Observation:** Correct answers + explanations are revealed after every pick and recapped at the end (`SpiritGrove.tsx:146,170,183-189,213-247`); the pool is 30 (10/10/10 — the fact-check note of 31 counts the interface line; corrected here), drawn 5/day (`spiritGrove.ts:96-105`); honest play sees all hard rounds in ~14–15 days. The mastery draft (0e/2m/3h once best ≥ 1) feeds the same `trialReward` with no bonus — it strictly lowers expected score for a player who had one lucky perfect.
- **Prior-doc status:** the archived analysis's staleness is confirmed (WI gating/mastery shipped per commit 5a8bdee); this finding is about what shipped.
- **Impact:** WI's clue gating — the trial's clever stat hook — matters for two weeks, then WI is cosmetic; veterans experience a checklist.
- **Recommendation:** Track per-round seen/answered history and bias drafts toward unseen rounds; give mastery a ×1.15 gold multiplier so it reads as prestige.

### [MINI-17] Charged strikes are throughput-negative everywhere, and in the Mine stagger has zero defensive value because contact damage ignores frozen (P2, confidence: high)
- **Area:** src/engine/crawl.ts, src/engine/mining.ts, src/engine/forest.ts
- **Observation:** Charge = ×1.75 damage for a 480 ms hold vs 1.0× per 240 ms mash → 0.875× DPS (`crawl.ts:298-300`); for mining/chopping, `ceil(1.75E)/2` per double-interval is never faster than E per interval for E = 1–3 and loses to overkill rounding. The one payoff — 500 ms stagger — does nothing defensively in the Mine: the contact-damage block finds any adjacent monster without checking `frozenUntilMs` (`mining.ts:1258-1268`, hand-verified; the forest gates strikes on frozen at `forest.ts:1400`). Only the Overcharge boon makes charging profitable.
- **Prior-doc status:** not covered; adjacent to but distinct from ARCH-04's mitigation fork. Note this ranking only *matters* once MINI-02 is fixed (today's permafreeze accidentally makes charge overpowered).
- **Impact:** The crawlers' single skill verb is a strict trap in the mine and marginal in the forest; mashing dominates.
- **Recommendation:** Add the frozen check to the mine's contact blocks (parity with forest), and raise `CHARGE_DAMAGE_MULT` to ≥2.25 so charge honestly trades cadence for burst.

### [MINI-18] Touch/D-pad players fire one phantom charged swing, then lose the charge verb for the rest of the run (P2, confidence: high)
- **Area:** src/components/mining/MineControls.tsx, forest controls, src/hooks/useMiningLoop.ts, useForestLoop.ts
- **Observation:** Touch Act buttons fire only `onPointerDown` (`MineControls.tsx:45-47`); `swing()` sets `spaceDownAt` once (`useMiningLoop.ts:251-257`) and only the keyboard `keyup` ever clears it (`useMiningLoop.ts:93-96`). First tap → an uninvited charged swing 480 ms later; thereafter `spaceDownAt` stays set with `chargeConsumed` true — deliberate charging is impossible on touch.
- **Prior-doc status:** not covered.
- **Impact:** Mobile players are locked out of the charge mechanic (and the Overcharge boon's value) with one surprise heavy swing as the only symptom.
- **Recommendation:** Wire a release callback to `onPointerUp/Leave/Cancel` mirroring the keyup reset.

### [MINI-19] Mine kill loot scales inversely with combat investment and always uses meleePower, even for archers (P2, confidence: high)
- **Area:** src/engine/mining.ts
- **Observation:** Drop quantity ≈ `round(ceil(maxHp / max(1, meleePower)) / avgNodeDurability) + killStreak` (`mining.ts:805-810`) — a ST 10 melee kill of a cave slug yields qty 2 while a ST 0 archer (killing at full ranged speed) yields ~6; the stat consulted is always `meleePower` regardless of wielded weapon.
- **Prior-doc status:** extends BAL-11 (bounty dead data — the intended reward channel); not covered by the mining analysis.
- **Impact:** Investing in the stat that fights lowers fight income; casters/archers quietly farm 3× loot — backwards on both axes.
- **Recommendation:** Consume the existing dead `bounty` field like the forest does (closes BAL-11 too), or at minimum use the wielded attack stat.

### [MINI-20] Both crawlers' difficulty goes flat (mine floor ~14, forest stage ~11) while rewards keep scaling, and the player's speed edge makes every enemy ignorable (P2, confidence: high)
- **Area:** src/engine/mining.ts, forest.ts, src/content/mining.ts, forest.ts
- **Observation:** Mine monster count caps at floor 14 (`mining.ts:559`), rock durability at floor 7 (`:463`), ore table at 15 — but ore cluster count `4+⌊f/2⌋` is uncapped (`:485`); forest mirrors (beasts cap stage 11, `forest.ts:695`; nodes uncapped, `:551`). Player moves 100–150 ms/cell vs all enemy cadences 320–950 ms (prey excepted) — a 2–6× speed edge at AG 0; the forest windup is cancelled by any single step (`forest.ts:1388-1391`).
- **Prior-doc status:** not covered post-rebalance; the crawler side of the same speed-invariant root cause as MINI-06/-09.
- **Impact:** Past mid-depths both modes are safe harvesting treadmills — reward-per-minute rises, risk doesn't; HP/defense/AG progression buys convenience, not survival.
- **Recommendation:** Let count/touchDamage keep scaling per band past the caps, and give one late-band enemy per mode a sub-300 ms cadence or a 1-cell lunge that tracks through the windup.

### [MINI-21] Arena difficulty is flat from L23 to L50 — only HP sponges grow (P2, confidence: high)
- **Area:** src/engine/arena.ts, src/engine/bosses.ts
- **Observation:** Auto speed caps at 1.2× at L23 (`arena.ts:362-370`); named bosses end at L30; after that only generic HP grows (55+8t) while sustained player DPS is stamina-bound (1.5 attacks/s) — modeled TTK ≈ 7 s flat from t25 to t45. Boss attack growth is irrelevant to a kiter (MINI-06).
- **Prior-doc status:** arena2 documents the ramp; the post-cap flatness is not covered.
- **Impact:** Over half the level range is a repetitive threat-free grind exactly where rewards are largest (BAL-04).
- **Recommendation:** Extend the speed ramp past 1.2× (or convert post-23 scaling into recoverMs reduction); give generic bosses rolled weaknesses and a <25% HP enrage.

### [MINI-22] Tactics: larger boards add up to +4 enemies for zero extra reward — Small is strictly dominant (P2, confidence: high)
- **Area:** src/engine/hexBattle.ts, src/views/TacticsView.tsx
- **Observation:** `sizeBonus` (r3→0, r4→1, r6→4) feeds enemy count (`hexBattle.ts:1444-1449`) but `tacticsReward` reads only tier + objective (`:1752-1762`).
- **Prior-doc status:** not covered (the size option post-dates tactics2's enemy-count complaint, which it replaced with this new imbalance).
- **Impact:** The entry screen's board-size choice is a trap for reward-motivated players.
- **Recommendation:** Multiply gold by (1 + 0.15×sizeBonus) — one line.

### [MINI-23] Tactics: losses and retreats pay zero gold while the retreat tooltip promises "partial rewards" (P2, confidence: high)
- **Area:** src/engine/hexBattle.ts, src/components/tactics/TacticsOverlay.tsx, src/store/shared.ts
- **Observation:** `tacticsReward` returns `{}` on any non-won status (`hexBattle.ts:1752-1753`); loss XP = 40% of a (4+tier) *total* split three ways — ~6 XP for ~10 min + 3 energy at L10 (`shared.ts:1265-1279`). The retreat confirm says "collect partial rewards" (`TacticsOverlay.tsx:777`). Arena pays damage-proportional on retreat/death; Tactics pays nothing.
- **Prior-doc status:** not covered; sharpens BAL-10 — the worst-paying mode also has the sharpest per-minute loss penalty, on a difficulty the player didn't choose (MINI-08).
- **Impact:** Failure is a pure time tax; the UI lies about it. Prime abandonment driver.
- **Recommendation:** Pay gold × fraction of enemy HP destroyed on loss/retreat; at minimum fix the tooltip.

### [MINI-24] Tactics: the beacon objective is never contested by the AI and fast wins void the bonus (P2, confidence: high)
- **Area:** src/engine/hexBattle.ts
- **Observation:** No AI archetype's `scoreMoveTile` has a beacon term (`hexBattle.ts:1119-1145`) — enemies only chase heroes; the beacon needs 5 consecutive enemy-free turns (`:1624-1627`), so winning before turn 5 leaves it incomplete and forfeits the +60% gold (`:1758-1761`).
- **Prior-doc status:** not covered.
- **Impact:** The optimal line is to kite *away* from the beacon and stall (synergizing with MINI-09), while decisive play is punished.
- **Recommendation:** Auto-complete the beacon on a win with an unbroken streak; optionally add a beacon-attraction term to one archetype.

### [MINI-25] Arena: EN absorbs ~half of an attacker's XP budget while barely affecting outcomes (P2, confidence: high)
- **Area:** src/engine/arena.ts, src/store/shared.ts
- **Observation:** Every melee/ranged action tallies EN alongside the attack stat (`arena.ts:703-704,730-731`), so `commitArena`'s usage split pays EN ~50% (`shared.ts:1241-1248`); but EN only sets the opening stamina pool (regen-bound throughput is identical from EN 10 to EN 20).
- **Prior-doc status:** not covered; the arena-side mechanism behind BAL-09's EN drift.
- **Impact:** The usage-attribution system misreports what helped; EN silently absorbs Arena's progression payout.
- **Recommendation:** Tally EN at 0.25 weight — or make EN real by scaling STA regen (3 + EN×0.1/s), fixing the dead stat instead.

### [MINI-26] Arena: runes and ring_of_fire bypass boss ward/defense, nullifying the anti-caster design of named bosses (P2, confidence: high)
- **Area:** src/engine/arena.ts
- **Observation:** Rune power rolls pass ward 0 and empty affinity arrays (`arena.ts:814`); ring damage applies via raw `hurtEnemy` with no mitigation (`arena.ts:822,1017,1026`) — while direct spells correctly subtract bossWard (`:845-848`). Mirror Demon (ward 5) and Anxiety Wraith (ward 3) are designed to tax casters.
- **Prior-doc status:** not covered.
- **Impact:** The one adapt-to-this-boss knob for WI builds is voided by the mechanically-flavored spells (and ice_rune additionally locks down — MINI-07).
- **Recommendation:** Pass `s.bossWard` into the rune roll and subtract ward in `tickRingOfFire` when the target is the boss.

### [MINI-27] Dungeon: relic stat bonuses never apply to encounter or shrine checks despite "+X for this run" descriptions (P2, confidence: high)
- **Area:** src/store/slices/dungeonSlice.ts
- **Observation:** Encounter resolution passes only gear statBonuses (`dungeonSlice.ts:140`); shrine pray reads raw statLevels (`:382`); UI mirrors both, so displayed odds are honest but the relics lie — shrine_stone's stacking WI/CH runBuff never helps the shrine mechanic it references (`relics.ts:50`).
- **Prior-doc status:** not covered (triggered relics shipped after the analysis).
- **Impact:** WI/CH-flavored boons are near-dead picks; relic text over-promises.
- **Recommendation:** Fold `aggregateRelics` + runBuff into the bonuses arg of `chooseEncounter` and the shrine power calc (and the two UI odds calcs).

### [MINI-28] Dungeon: encounter difficulty and payouts are flat vs depth — checks saturate at 95% while treasure scales (P2, confidence: high)
- **Area:** src/engine/encounters.ts, src/content/encounters.ts, src/store/slices/dungeonSlice.ts
- **Observation:** `checkChance` caps at 0.95 (`encounters.ts:131`); content difficulties are fixed 1–8 with no depth term across ~120 checks; success gold is flat 20–40 at depth 1 and depth 20 alike, plus flat +10 XP (`dungeonSlice.ts:151`); the depth-gated deep-room events reuse the same flat numbers.
- **Prior-doc status:** dd analysis open question §11.2, still unresolved — confirmed.
- **Impact:** The narrative half of the mode decays into auto-win text with trivial loot exactly when players descend far enough to see the deep content.
- **Recommendation:** `difficulty += floor(depth/3)` at resolution, or depth-scale rewardOnSuccess gold.

### [MINI-29] Multi-phase fights pay XP and record damageDealt from the final phase's HP bar only (P2, confidence: high)
- **Area:** src/engine/combat.ts, src/store/slices/dungeonSlice.ts
- **Observation:** `bossMaxHp` is overwritten per phase (`combat.ts:156-158`); on win, `combatXpForWin(b.bossMaxHp)`, `dungeonCombatStatXp(b.bossMaxHp)`, and `damageDealt += b.bossMaxHp` all see only the last phase (`dungeonSlice.ts:235-244,255`). Bone Tyrant (328 HP fought) pays as a 148-HP foe — comparable to one elite at the same depth.
- **Prior-doc status:** not covered; distinct from ARCH-09 (elite ledger undercount).
- **Impact:** The hardest fights systematically under-reward (compounding MINI-04's zero gold); the run-summary damage stat is wrong for every multi-phase fight.
- **Recommendation:** Accumulate `totalHpDefeated` on BattleState in the phase-down handler and use it for XP and the stat.

### [MINI-30] Dungeon: flee is a free bank-anywhere with retries — death is opt-in and the loss rule almost never binds (P2, confidence: high)
- **Area:** src/store/slices/dungeonSlice.ts, src/engine/combat.ts
- **Observation:** Flee ends the run keeping 100% (`dungeonSlice.ts:217-220`, hand-verified); flee chance min(0.9, 0.4+AG×0.03) retryable each turn at the cost of one enemy hit (`combat.ts:56,508-517`). A player fleeing below 2-average-hits HP has ≈0 death probability, so FLOOR_LOSS_KEEP 0.25 is nearly unreachable; on boss floors the checkpoint already banked everything, so "engage, flee if losing" gives unlimited cheap boss attempts.
- **Prior-doc status:** dd §11.5 records 100%-keep as intentional; the *retryable* flee EV is not covered. Dungeon member of the BAL-12 bank-anywhere family.
- **Impact:** The bank-vs-push tension the mode is built on rarely binds.
- **Recommendation:** Flee keeps floor loot at 0.6 (still strictly better than death's 0.25), or one flee attempt per fight.

### [MINI-31] Mine fog has no memory and no counterplay (lantern is forest-only), making tombstone recovery a blind lottery (P2, confidence: high)
- **Area:** src/components/mining/MineRunOverlay.tsx, src/content/boons.ts, src/engine/mining.ts
- **Observation:** Mine fog renders solid black outside radius 4 with no seen-grid (`MineRunOverlay.tsx:622-633`), unlike the forest's persistent `seen` memory (`forest.ts:184-186`); the only sight boon is `game:'forest'` (`boons.ts:59-62`) even though the mine overlay wires `boonSightBonus` (`MineRunOverlay.tsx:443`). Tombstones land on a random far cell with no HUD indicator (`mining.ts:727-739`) — only the shaft has a compass.
- **Prior-doc status:** not covered (both fog and tombstone post-date the docs).
- **Impact:** The death-mercy mechanic is practically unrecoverable past shallow floors — false hope; mine fog is pure friction with no build answer.
- **Recommendation:** Make lantern `game:'both'`; add a tombstone direction indicator reusing the shaft-compass code.

### [MINI-32] Co-op guest attacks bypass combat math; forest ranged guests act on a local world copy (P2, confidence: medium)
- **Area:** src/hooks/useMiningLoop.ts, useForestLoop.ts, src/engine/mining.ts, forest.ts
- **Observation:** Guest attack intents send raw power (×1.75 if charged) with no attackRoll variance/affinities/defense and no stamina cost (`useMiningLoop.ts:164-166,190-192`; host applies raw at `mining.ts:1362-1377`). Forest guest routing intercepts only the adjacent faced beast (`useForestLoop.ts:193-200`); a ranged guest falls through to `forestAct`, whose line-scan kills the *local* beast copy with local loot (`forest.ts:899-931`) while the host's world keeps it alive.
- **Prior-doc status:** not covered; `net/coop/reduce.ts` was not audited here — **hand off to section 05** for the reducer-side verdict and severity (desync ⇒ potential P0 under the charter).
- **Impact:** Guests hit through guardian defense stamina-free; ranged guests see kills and loot that un-happen on the next world slice (or dupe under client trust).
- **Recommendation:** Route forest guest ranged shots through the attack-intent path; compute intent damage host-side via attackRoll. Re-assess in section 05.

### [MINI-33] Test coverage gaps cluster on each mode's newest systems — the exact code where this section's bugs live (P2, confidence: high)
- **Area:** src/engine/__tests__, src/components (no trial/overlay tests)
- **Observation:** Untested: crawler `castSpell`/runes/ring-of-fire in both engines (where MINI-02 lives), tombstone placement/recovery, the empty-boon `'choosing'` transition (MINI-01), mine kill-qty formula; Arena archers/telegraph geometry/phase scripting/iframes (`arena.test.ts` has zero matches for any of them); hexBattle push/blink/cleave resolution, AI archetype scoring, intent/threat planners, tactics-side moveset kinds (would have caught the enrage gap), preview-vs-roll pinning; `stepChase` (zero calls in tests) and all trial components — the Last Stand mash (MINI-10) and Long March clamp (MINI-13) are component-side, invisible to the green engine suite; dungeon relief math and enemy/boss scale formulas. Well-covered: crawler generation/boons/stash/death splits, relic triggers, phase transitions, merchant bands, arena core (46 tests), hexBattle geometry/rewards, all 8 trial engine scorers.
- **Prior-doc status:** extends section 01's test-gap list with mode-level specificity.
- **Impact:** The suite green-lights builds whose play balance is broken; every fix this section recommends lacks a regression net.
- **Recommendation:** Priority order: (1) empty-boon transition + timebase specs, (2) a TacticsOverlay/LastStand/LongMarch component smoke test each, (3) arena phase-D specs, (4) `stepChase` scenario tests.

### [MINI-34] Royal Court: no timer cleanup — abandoning during the final exchange still completes the trial after the modal closes (P3, confidence: high)
- **Area:** src/components/trials/games/RoyalCourt.tsx
- **Observation:** `setInterval`/nested `setTimeout` chains with no unmount cleanup (`RoyalCourt.tsx:96-150`; contrast `ArmoryBreak.tsx:83-85`); the deferred `onFinish` fires `completeTrial` after unmount — a 700–1,350 ms window where "Abandon → Yes" silently stamps the daily gate, spends the energy, and banks a reward no screen ever showed.
- **Prior-doc status:** not covered; cousin of BAL-20's silent-mismatch class.
- **Recommendation:** Collect timers in a ref and clear on unmount, as the sibling components do.

### [MINI-35] Rooftop: the crossbowman is a reskinned lowbar and the chaser can't catch a disciplined dasher (P3, confidence: high)
- **Area:** src/engine/trials/rooftopChase.ts, src/components/trials/TrialModal.tsx
- **Observation:** `resolveContact` treats lowbar and crossbowman identically (slide-or-stumble, `rooftopChase.ts:561-566`); no bolt exists; the intro text still lists three obstacle types (`TrialModal.tsx:30`). Lead economy: dash nets ≥ +0.9/s against drain even past the 400wu surge, so "caught" is nearly unreachable — falls are the only real fail state.
- **Prior-doc status:** the doc's "prop variety is the top remaining item" is half-stale — the fourth prop shipped but adds no input variety.
- **Recommendation:** Give the crossbowman a jumpable telegraphed bolt (body still slide-only); mention it in the intro; make dash cost something at the margin.

### [MINI-36] Tactics polish: 'enrage' moveset kind silently no-ops, template pool is uniform at every tier, objective sting reuses the victory cue (P3, confidence: high)
- **Area:** src/engine/hexBattle.ts, src/engine/enemies.ts, src/hooks/useTacticsAudio.ts
- **Observation:** frost_troll's `enrage` move falls through to a basic attack in tactics' `enemyAttack` switch (`enemies.ts:165`, `hexBattle.ts:1253-1290`) though the dungeon engine implements it (`combat.ts:643-647`); the spawn pool is uniform over all 16 templates at every tier (`hexBattle.ts:1451,1474`) — composition never evolves; mid-match objective completion plays the match-win 'victory' cue (`useTacticsAudio.ts:100-107`).
- **Prior-doc status:** enrage/pool not covered; the cue is plan item 4C's remainder.
- **Recommendation:** Add the enrage case (or filter it at generation); weight the pool by tier band; give the objective a distinct chime.

### [MINI-37] Arena polish: minion hits inherit boss affinities, no obstacle connectivity check, retreat is instant mid-telegraph, loss-factor comment drift (P3, confidence: high except connectivity medium)
- **Area:** src/engine/arena.ts, src/store/slices/arenaSlice.ts, src/store/shared.ts
- **Observation:** Ranged rolls apply the *boss's* weak/resist before the target is known, so minions take wrong damage (`arena.ts:718-719` vs melee's isBoss gate at `:698`); `genObstacles` places up to 30% density with no player↔boss connectivity check (`arena.ts:408-423`) — a sealed boss enables zero-risk spell-sniping (spells have no LOS/range check, `:843-849`); `beginArenaBanking` is instant and free even mid-telegraph (`arenaSlice.ts:127-132`); `MINIGAME_XP_LOSS_FACTOR`'s comment claims it covers arena but only Tactics uses it (`shared.ts:1123-1124`).
- **Prior-doc status:** not covered.
- **Recommendation:** Roll affinities at impact by target kind; BFS-verify connectivity and reroll; add a ~1.5 s retreat channel; fix the comment.

### [MINI-38] Crawler UX asymmetries players will read as bugs: forest score ignores gold, dash direction semantics differ, alt-tab leaves keys stuck (P3, confidence: high)
- **Area:** src/store/shared.ts, src/hooks/useMiningLoop.ts, useForestLoop.ts
- **Observation:** `commitMining` folds banked gold into the best score (`shared.ts:1137`) but `commitForest` doesn't (`:1178`); forest dash uses the currently-held key (`useForestLoop.ts:119-125`) while mine dash uses last-pressed (`useMiningLoop.ts:123`); neither hook clears held keys on window blur (`useMiningLoop.ts:98-99`), so returning from alt-tab auto-walks (and the mine can dash on a stale direction).
- **Prior-doc status:** not covered (the dash asymmetry was surfaced by this audit's fact-check pass).
- **Recommendation:** Fold kept gold into forest score; adopt the forest's dash semantics in the mine; add a blur listener clearing `held`/`lastDir` in both hooks.

### [MINI-39] Dungeon polish: deep treasure weapon drops become dead loot after ~2 runs; weak/resist affinities are never surfaced in battle UI (P3, confidence: high)
- **Area:** src/engine/dungeon.ts, src/store/shared.ts, src/components (BattleScene)
- **Observation:** The weapon-drop pool is 2 keys (`dungeon.ts:54`), `applyReward` dedupes owned weapons (`shared.ts:794-796`), and the drop chance climbs to 40% by depth 17 (`dungeon.ts:83` — the "cap unreachable until depth 17" flag resolves as: cap is fine, pool is the problem) — so up to 40% of deep treasure rooms advertise loot that silently evaporates. Separately, BattleScene renders no weakTo/resistTo anywhere; players learn affinities only from post-hit log tags.
- **Prior-doc status:** not covered; the affinity-visibility gap layers on BAL-02/-06 (content problems reported there).
- **Recommendation:** Reroll owned-weapon drops to gold (+30+5×depth); pin a weak/resist chip on the foe card after the first tagged hit.

### [MINI-40] Trials copy and dead-UI polish: "free" claims vs the 1-energy charge; Long March's unreachable done-screen; Armory's frame-quantized ceiling (P3, confidence: high; Armory medium)
- **Area:** src/components/trials/TrialModal.tsx, src/engine/trials/trials.ts, src/components/trials/games/LongMarch.tsx, ArmoryBreak.tsx
- **Observation:** UI and engine docstring both say the daily attempt is free ("Daily free attempt", `TrialModal.tsx:188`; `trials.ts:2`) while `completeTrial` charges `TRIAL_ENERGY_COST = 1` (`trialsSlice.ts:36,54-57`). Long March's "March Again" done-screen is unreachable — `onFinish` fires synchronously and unmounts the component first (`LongMarch.tsx:66-70,194-216`). Armory lock 3 (rise 1.40/s, zone ±0.075) is limited by once-per-rAF-frame power sampling to ~0.84 average accuracy even with perfect timing (`ArmoryBreak.tsx:16-24,91-100`) — the batch's hardest multiplier to fill at the same 1-energy price.
- **Prior-doc status:** not covered.
- **Recommendation:** Fix the copy (or actually make the first attempt free — a design call for synthesis); delete or defer-wire the Long March done-screen; interpolate Armory release power from timestamps if the ceiling isn't intended.

### [MINI-41] Forge plan corrections before build: two stale file references, and its material-cost UI must account for the 8 dead-end materials (P3, confidence: high)
- **Area:** docs/forge-minigame-development-plan.md
- **Observation:** Greenfield confirmed (no engine module; `ForgeSection.tsx:42-97` is a one-click list). Plan corrections from the fact-check: (a) the "replace bare `getWeapon` in miningSlice/forestSlice" step targets code that doesn't exist — both slices route through `fighterFor`, so patching the single call at `shared.ts:647` propagates everywhere; (b) PaperDoll lives at `src/components/character/PaperDoll.tsx`, not `components/inventory/`; (c) line refs drifted (gearFor now `shared.ts:596`, fighterFor `:608`). Its other assumptions (craft flow, GearDef/WeaponDef fields, deduped string keys, scoreToStars, armory template, dev flags) all verified against source.
- **Prior-doc status:** the plan is sound; these are pre-build corrections. Section 03 already nominated the Forge as the vehicle for BAL-03/-05/-16/-17's recipes.
- **Recommendation:** Amend the three references in the plan; add the dead-end materials (BAL-16) to its recipe-design inputs.

## Cross-cutting verdicts

**Are the four real-time modes too similar?** Mine and Forest share a byte-identical input skeleton (240 ms act / dash / charge / boons / 33→57 maps) but have genuinely different threat models (global pursuit + attention tax vs ambush + telegraph + prey/predator), banking psychology (tombstone salvage vs stash insurance), and information games (no fog memory vs seen-grid). Verdict: keep one engine, push the two identities further deliberately (mine = pressure-while-working, forest = information game), and unify the accidental deltas (MINI-38) so the remaining differences are all intentional. Arena and Tactics are mechanically distinct from the crawlers and each other; the real cross-mode sameness is the shared *failure* mode — in all four, player speed ≥ threat speed forever (MINI-06/-09/-20).

**Weakest mode:** Tactics — not for its core (its telegraph/preview/elevation layer is the best-designed combat in the game) but because forced tier scaling (MINI-08), zero-gold losses (MINI-23), dominated rewards (BAL-10), and kiting (MINI-09) stack into the clearest rational-abandonment case. It is also the most fixable: four one-line-to-small changes.

**Open-item dispositions** (from the plans this section was asked to adjudicate):

| Item | Status in code | Ruling |
|------|----------------|--------|
| Tactics 5A (hexBattle split) | single 1,764-ln file, now threading co-op branches | Keep, P3 — the risk argument got stronger |
| Tactics 5B (overlay test) | no test exists; overlay 1,048 ln | Keep, small — one select→move→attack→endTurn smoke test |
| Tactics 5C (availableIn field) | goal met via `isTacticsLoadoutSpell` (tested) | **Close** as done-differently |
| Tactics 6C (playstyle XP) | flat AG/DX/EN split | Keep, P3 — Arena's statUsage pattern is copyable |
| Tactics 2B (Moved chip) | movesLeft counter + disabled states cover it | **Drop** |
| Tactics 1A (enemy icons) | `tmpl.glyph` shipped and consumed | **Drop** (done) |
| Tactics 4C (objective sting) | reuses 'victory' cue — actively misleading | Keep as MINI-36's cue item |
| Long March 2.2 (hard mode) | not built | Keep but **subordinate to MINI-13** — pointless on the current scoring |
| Long March 6.3 (hub streak) | not built | **Move** to the trials-hub/behavioral backlog (section 02 territory); drop from this mode's plan |
| Spirit Grove §4.1 (ambient audio) | still absent (only one-shot cues) | Keep, P3 polish |
| Dungeon plan leftovers | audio/RelicTray/merchant-preview **shipped**; BoonChoice timing + scene art open; rooms-remaining covered by Layer X/Y | **Close** shipped items; keep BoonChoice timing + art as P3; drop rooms-remaining |
| Forge plan | not started | Proceed after MINI-41 corrections; feeds BAL-03/-05/-16/-17 |

## Needs manual check

- **Boon-exhaustion reachability (MINI-01):** the trigger mechanism is verified in source; the ~floor 16–20 / stage 10–14 onset is modeled from cache/guardian rates. Confirm on a real deep run — or just ship the two-line guard regardless. (confidence: high on mechanism, medium on frequency)
- **Ice-rune re-trigger cadence (MINI-07):** the freeze/MP arithmetic is verified; the ~0.3–0.6 s re-approach assumes the boss paths onto an adjacent rune reliably. One in-game check of sustained lockdown uptime. (confidence: medium)
- **Biome-boss severity (MINI-04):** raw math says wall; a potion/relic-stocked player may experience "brutal slog" instead. Playtest Bone Tyrant at D5 with an on-curve L5–7 build. (confidence: medium for felt severity)
- **Kiting in practice (MINI-06/-09):** modeled from speed constants; minion body-blocking (Arena) and wall-pocket maps (Tactics small board) may occasionally trap a kiter. Verify feel at two or three tiers. (confidence: medium for edge cases)
- **Armory frame ceiling (MINI-40):** the ~0.84 average cap derives from rAF sampling assumptions (60 Hz); high-refresh displays raise it. Measure on-device. (confidence: medium)
- **Co-op guest paths (MINI-32):** `net/coop/reduce.ts` was out of scope here — section 05 must confirm whether the reducer normalizes guest damage and whether the forest local-kill divergence reproduces. (confidence: medium; potential P0 upgrade there)
- **Run-length estimates:** trial durations (Armory ~20 s … Library ~3 min) and the ~6–8× reward-per-minute spread across trials at the same energy price are modeled, not stopwatched. (confidence: low)
