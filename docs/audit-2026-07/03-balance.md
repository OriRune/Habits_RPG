# Audit 2026-07 — Balance

**Date run:** 2026-07-05 · **Branch:** `feature/multiplayer` · **Sections complete before this one:** 01 architecture, 02 habit-core

Method: fact-checked `docs/balance-audit.md` (2026-06-17 — predates the Stage-3/§4 reward rebalance) and `habits_rpg_gameplay_design.md` against current source via 4 parallel fact-check agents, then gap-audited five domains (XP/leveling, gold/gear/crafting, energy loop, per-stat parity, cross-minigame reward parity) with 5 parallel design-audit agents. All five P1 findings were re-verified by hand at the cited lines this session. Run-duration figures in the parity tables are modeled from engine constants, not playtested (±30%; see Needs manual check).

Inputs carried from earlier sections (not re-reported): ARCH-04 (mine/forest contact-damage mitigation fork — balance recommendation below in BAL-06 note), ARCH-09 (elite-win `earnedXp` ledger undercount — corrupts the Balance Report's dungeon XP figures), HABIT-01 (custom-challenge clamp bypass), HABIT-04/-16 (energy mint/deduct edges), HABIT-05 (recovery-bonus 1.1× inflation for gapped schedules), HABIT-09 (invisible habitBonus), HABIT-15 (inert recovery_elixir).

## Executive summary

- **The June audit is largely obsolete and its headline stat claim is inverted.** AG now has real-time roles in Mine/Forest (move cadence, dash cooldown) and Tactics (move range, climb) — only Arena ignores it. The enemy roster grew 10→16, flipping net affinities to DX +5 / ST +3 / WI +1 / CH −2. Relics tripled (only DX still lacks a T3). Energy is capped at 50. Every number in `docs/balance-audit.md` should be considered superseded by this doc.
- **The core design rule — "habits are the main XP source" — fails numerically from about level 3.** Habit XP is flat forever (10/20/35/50) while trial XP scales `10+4×level` and dungeon XP scales with enemy HP; by L10 a realistic day is ~37% habit XP, by L20 ~25%. The planned daily minigame-XP cap (plan2 §4.2) was never implemented (BAL-01).
- **The boss gate is rigged against melee.** Weaknesses can only ever fire for ST, DX, or WI — yet Drill Rex (L8) and Comfort Blob (L12) list only CH/AG/EN weaknesses (unusable) and both resist ST; no boss anywhere is weak to ST. A focused ST build raw-loses the L8/L12/L20 gates that a WI/DX build cruises through, and can pass only via potion spam or the 3-loss pity handicap (BAL-02, BAL-06).
- **The gold economy dies in week one.** Total reachable one-time sinks ≈ 2,030g against mid-game faucets of 300–900g/day, no repeatable sink of consequence, no sell mechanic — and the two toolkit upgrades that were supposed to be the big sinks are literally unpurchasable (no gear shop exists; `iron_pickaxe`'s `price: 200` is dead data). Meanwhile Arena repeatably pays out one-time boss reward tables — 500g per ~3-minute win while at L20 (BAL-03, -04, -05).
- **Reward parity across modes is otherwise decent** (repeatables cluster within ~2× on gold/energy; trials are the deliberate best-deal, contained by the daily gate), with two exceptions: Tactics is strictly dominated on every reward axis, and Mine combat pays ~1–3g per kill because the `bounty` field on all 8 mine monsters is dead data the engine never reads (BAL-10, -11).

## Prior-doc fact check

Claims from `docs/balance-audit.md` (June) and `habits_rpg_gameplay_design.md` (spec) vs. current source. Items marked *(01)* were verified in the architecture section and re-used, not re-derived.

| # | Claim | Source | Verdict | Evidence |
|---|-------|--------|---------|----------|
| 1 | XP curve 100×L^1.5; 3 pts/level; STAT_CAP 25; MAX_LEVEL 50; BOSS_GATE 5; cumulative L10=11,106 / L20=67,135 | June §3 | **verified** *(01)* | `leveling.ts:11-13`, `progression.ts:12-18` |
| 2 | maxHp=50+HP×7+3L; maxMp=8+KN×3; battle sta=12+EN; crawler sta=50+EN (≈3:1) | June §5/App. | **verified** | `combat.ts:50-52`; `crawl.ts:67-69` (comment says intentional) |
| 3 | dodge=min(0.4,AG×0.02); flee=min(0.9,0.4+AG×0.03) | June §2 | **verified** | `combat.ts:55-56` |
| 4 | **"AG is the only stat with no real-time application"** (June P1 #3) | June §2/§7 | **wrong (now)** | `crawl.ts:308-318` dashCooldown=max(800,2000−AG×40), moveInterval=max(100,150−AG×2), live via `useMiningLoop.ts:124,209` / `useForestLoop.ts:126,229`; `hexBattle.ts:90-96` moveTilesFor/climbFor. Only Arena has no AG read (`useArenaLoop.ts:41` fixed 150 ms) |
| 5 | Damage roll: ±15% variance, weak ×1.25, resist ×0.6, exhausted ×0.5, minus defense | June §6 | **verified** | `combat.ts:307-333` |
| 6 | mitigation=floor(sqrt(xp)); combatXpForWin=12+round(hp/6); defense/ward trained only by dungeon wins | June §5 | **verified, with correction** | `combatStats.ts:22-34`; sole writer `dungeonSlice.ts:236-239`. Correction: combatXpForWin feeds only the defense/ward ledger — character stat XP per dungeon fight is `dungeonCombatStatXp = 8+round(hp/10)` split 60/40 attack-stat/HP (`combatStats.ts:41-48`, `dungeonSlice.ts:243-244`) |
| 7 | Spell table: 6 spells (sparks/dazzle/mend/hex/bless/firebolt); damage "power+WI" | June §6 | **stale** | 14 spells now (`content/spells.ts:48-178`): +push, blink, cleave (Tactics), fire/ice/poison runes, ring_of_fire, chaotic_blink. Damage scales WI×1.2 (`combat.ts:347`), heal KN×1.5 (`combat.ts:359`) — coefficients undocumented in content |
| 8 | CH illusion: +1 status turn per floor(CH/8); hex 0.4/3 turns | June §2 | **verified** | `combat.ts:469`; `content/spells.ts` hex entry |
| 9 | Enemy roster = 10; net affinity ST +1 / WI +2 / DX +2 / CH 0 | June §6 | **stale** | 16 enemies (`enemies.ts:29-228`; +draugr_mage, goblin_shaman, corrupt_huorn, frost_troll, ice_wolf, ice_wisp). Current net: **DX +5, ST +3, WI +1, CH −2**, AG/EN/KN/HP 0 |
| 10 | AG/EN/KN/HP have zero enemy affinity | June §6 | **verified** (and stronger — see BAL-06: CH/AG/EN/KN affinity entries are never even tested) | `enemies.ts` scan; `combat.ts:327-328,348-349` |
| 11 | Boss = per-level scaled generic | June §7 | **stale** | 7 named bosses at tiers 5/8/12/15/20/25/30 (`bosses.ts:118-240`); generic fallback hp=55+8t, atk=4+round(0.7t), def=floor(t/8), **weakTo=[]**, gold=40+8t (`bosses.ts:246-261`) |
| 12 | 5 dead-end materials (gemstone/stone/wood/game_meat/pelt) | June P0 #1 | **stale (grew)** | Now **8 of 14**: + frost_quartz, obsidian, amber_resin (`materials.ts:17-33`; recipes consume only leather/iron_bar/cloth_roll/bronze_bar/herbs/crystals, `recipes.ts:24-97`; no sell/scrap anywhere) |
| 13 | Mithril Toolkit unreachable | June P0 #2 | **verified (worse)** | `gear.ts:119-127` no price/recipe/drop — and the Iron Toolkit is *also* unreachable: no buyGear action exists (`economySlice.ts:21-29`), shop sells only priced WEAPONS + SHOP_ITEMS (`InventoryView.tsx:27-29,95-140`), so `gear.ts:117` `price: 200` is dead data. See BAL-03 |
| 14 | Hunting Bow strictly dominates Short Bow | June P2 #11 | **verified** | `weapons.ts:26-65` (+5/cost 1/range 5/170g vs +4/2/3/120g) — carried as BAL-27 |
| 15 | Relics: T1=8/T2=5/T3=3, curses=3; no T3 for AG/CH/DX/WI; no curses on ST/WI/KN/DX/CH | June §8 | **stale** | Now T1=12, T2=14, T3=7, curses=5 (`relics.ts:18-68`). Only **DX** lacks a T3 (soulbound_crown covers CH+WI, frostbitten_edge ST+AG); curses now hit ST (dull_blade) and KN (clouded_mind); WI/DX/CH remain curse-free |
| 16 | All toolkits grant ST; no EN gear; Bard's Cloak has no XP perk | June §8 | **verified** | `gear.ts:100-127`; no `EN:` in gear.ts; `gear.ts:73-87` |
| 17 | Energy has no cap | June P2 #9 | **stale** | `MAX_ENERGY = 50` (`shared.ts:1112`), clamped at `habitsSlice.ts:226`; documented as an anti-bug ceiling, not a design lever (see BAL-18) |
| 18 | Energy is difficulty-blind (+1 flat) | June P2 #10 | **verified** | `habitsSlice.ts:214` (matches spec `habits_rpg_gameplay_design.md:371` — not drift) |
| 19 | Dungeon gold = 60+10×depth+rng(0..39) | June App. | **verified** | `dungeon.ts:76` |
| 20 | Mine gold_vein 8–20, forest berry 1–5 → "forest weakest gold earner" | June P2 #15 | **stale** | Node values verified (`content/mining.ts:91`, `content/forest.ts:88`) but forest beasts now pay guaranteed bounty gold + a material per kill (`forest.ts:394-410`) — forest ≈ rough gold parity with mine (~130 vs ~150/run). Mine monster `bounty` is dead data (BAL-11) |
| 21 | Floor/stage descent restores 25% sta+MP | June §4 | **verified** | `mining.ts:703-704`, `forest.ts:811-812` |
| 22 | 64-entry class chart; 8 advanced classes; advancement cosmetic; class nudge zero before L10 | June §9 | **verified (worse)** | `classes.ts:7-39`; `shared.ts:821,830-836`. `advancedClassFor` has **zero product callers** — not even display; fully dead code. Carried as BAL-28 |
| 23 | Spec: "Boss dungeon = 10 Energy" premium mode | spec §7.2 | **never built** | Boss battles cost 0 energy, unlimited retries (`battleSlice.ts:30-37`); see BAL-19 for the decision |
| 24 | Spec: "players progress mainly through habits, not by grinding minigames" | spec §1 | **wrong in code from ~L3** | See BAL-01. Code should change, not the spec — this is the game's stated first pillar |
| 25 | plan2 §4.2 "cap daily minigame-derived stat XP" (listed option, phase marked ✅ Done) | plan2:684 | **not implemented** | Grep: no cap exists; only reporting (`balance.ts:129-142`). The crawler/arena/tactics trickle nerf *was* done (`shared.ts:1112-1128`) — trials and dungeon were left out of it |
| 26 | Spec stat table: AG→turn order, DX→crit, CH→ally assist, EN→damage reduction in boss battles | spec §7.1 | **never built** | No crit, turn-order, assist, or EN-mitigation mechanics exist in `combat.ts` — long-standing spec drift, noted for synthesis, not newly actionable |

## Findings

### [BAL-01] Habit XP is flat while trial/dungeon XP scales with level — "habits primary" inverts at ~L3 and the planned cap was never built (P1, confidence: high)
- **Area:** src/engine/xp.ts, src/engine/trials/trials.ts, src/store/slices/trialsSlice.ts
- **Observation:** Habit base XP is fixed at 10/20/35/50 at every level (`xp.ts:7-12`). Trial statXp = `round((10+4×level)×(0.25+0.75×score))` at 1 energy (`trials/trials.ts:129-137`, hand-verified) — a perfect trial beats a Normal habit from L3 (22 vs 20), pays 50 at L10, 90 at L20. Dungeon per-fight XP (`8+round(enemyHp/10)`, `combatStats.ts:45-48`) also scales with level via enemy HP scaling (`enemies.ts:245`). No daily minigame-XP cap exists anywhere (plan2:684 listed it; grep finds only the report display at `balance.ts:129-142`). Realistic day at L10 (3 Normal + 1 Hard habit = 95 XP; 4 energy → 4 trials at avg score 0.75 = 164 XP): habit share ≈ 37%. Same routine at L20: ≈ 25%.
- **Prior-doc status:** contradicts plan2 §4.2's ✅ acceptance criteria ("habit completion remains the best long-term path") and spec pillar 1; not covered by the June audit (trial scaling post-dates it).
- **Impact:** The optimal strategy is increasingly "log minimum habits to fund energy, then farm trials" — the exact failure the energy system exists to prevent. The inverse also bites: a habit-only player needs ~87 days for L19→20 (8,285 XP at 95/day); the L^1.5 curve implicitly *requires* minigame grinding, contradicting the app's identity.
- **Recommendation:** Scale habit XP with character level (e.g. `base × (1 + 0.15×(L−1))`, matching the trial slope at ~4 habits/day) — one knob that fixes both the share inversion and mid-game pacing. Alternative: implement the planned daily minigame stat-XP cap (e.g. ≤ that day's habit XP).

### [BAL-02] Boss weaknesses use stats that cannot deal damage, and no boss is weak to ST — melee raw-loses the L8/L12/L20 gates (P1, confidence: high)
- **Area:** src/engine/bosses.ts, src/engine/combat.ts
- **Observation:** Damage can only carry ST/DX (weapon `attackStat`, `combat.ts:326-328`; `weapons.ts:11`) or WI (spell school check, `combat.ts:348-349`; damage school is always WI, `engine/spells.ts:9-13`) — hand-verified both roll paths this session. Yet Drill Rex (L8) is `weakTo: ['CH','AG'], resistTo: ['ST']` (`bosses.ts:147-148`) and Comfort Blob (L12) `weakTo: ['AG'], resistTo: ['ST','EN']` (`bosses.ts:160-161`) — zero exploitable weaknesses, ST resisted. No named boss (`bosses.ts:118-240`) and no generic fallback (`weakTo: []`, `bosses.ts:258`) is weak to ST. Worked math (focused builds, +6 weapon): L8 ST build vs Rex ≈ 15 turns to kill vs 165 incoming against 116 maxHp → raw loss; L12 vs Blob → raw loss; a WI caster beats Blob in ~7 turns. The L20 Burnout Golem (360 phase-HP vs 207/223 for L19/L21 generics, `bosses.ts:185-198`) compounds this for melee.
- **Prior-doc status:** not covered by any prior doc (named bosses post-date June).
- **Impact:** The boss gate — the flagship progression mechanic from L5 up — is a build coin-flip: WI/DX cruise, ST builds pass only via potion spam or by losing 3+ times to trigger the pity handicap (−10% HP/loss to −40%, `combat.ts:144,181-184`). "Lose three times to proceed" is the reward for the game's most-marketed archetype.
- **Recommendation:** Constrain boss/enemy `weakTo` to {ST, DX, WI} (the only testable stats — see BAL-06); give Drill Rex or Comfort Blob an ST weakness and one Burnout Golem phase an ST/DX weakness.

### [BAL-03] Iron and Mithril Toolkits are both unobtainable — mine/forest tool progression is dead at power 1 (P1, confidence: high)
- **Area:** src/store/slices/economySlice.ts, src/views/InventoryView.tsx, src/content/gear.ts, src/content/recipes.ts
- **Observation:** Hand-verified: the store exposes only `buyItem`/`buyWeapon` (`economySlice.ts:21-29,47-57,98-109`); the shop UI renders only priced WEAPONS and SHOP_ITEMS (`InventoryView.tsx:27-29,95-140`). No recipe produces either toolkit (`recipes.ts:24-97`); no content grants `reward.gear` (dungeon treasure drops items/weapons only, `dungeon.ts:82-83`). So `iron_pickaxe`'s `price: 200` (`gear.ts:117`) is dead data and `mithril_pickaxe` (`gear.ts:119-127`) has no path at all. Only gear-grant sites: crafting (`economySlice.ts:136`) and the auto-granted stone_pickaxe (`miningSlice.ts:83`, `forestSlice.ts:81`).
- **Prior-doc status:** June P0 #2 covered mithril only; the iron-toolkit gap is new (and invalidates June's "iron_pickaxe 200g shop price" premise).
- **Impact:** Pickaxe/axe power is 1 forever (`mining.ts:889` fallback): magma-band ores need 5 swings unless ST≥8 (+1 per 8 ST, `mining.ts:887-888`); tool descriptions on-screen advertise upgrades the player can never get; and the single largest advertised gold sink doesn't function (feeds BAL-05).
- **Recommendation:** Add a gear section to the shop + a `buyGear` action (makes iron_pickaxe's existing price live), and give mithril_pickaxe a magma-band recipe (e.g. obsidian ×4 + gold) — which also gives two dead-end materials a sink (BAL-16).

### [BAL-04] Arena repeatably pays out one-time boss-gate reward tables — a 2.5× gold sawtooth peaking at 500g per 3-minute win (P1, confidence: high)
- **Area:** src/store/slices/arenaSlice.ts, src/engine/arena.ts, src/engine/bosses.ts
- **Observation:** Hand-verified: `beginArena` sets `tier = clamp(character.level)` and builds from `bossForLevel(tier)` (`arenaSlice.ts:56-58`); `createArena` copies `boss.rewards.gold` into `rewardGold` (`arena.ts:582`); `arenaReward` pays it in full on every win with no repeat decay (`arena.ts:1231-1235`). Named-boss gold: L12=185, L15=230, **L20=500**, L25=380, L30=500 (`bosses.ts:162,177,197,218,238`) vs the generic curve 40+8t (L19=192, L21=208). At L20 that is ~167 g/energy and ~150 g/min vs Mine's ~75 g/E and ~14 g/min — and mid-game levels last for weeks, so the player camps on the spike. Named-tier wins also repeatably drop `recovery_elixir`/`healing_potion`.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** At L12/15/20/25/30 the rational player farms Arena exclusively; every other gold source is obsolete for the duration of the level. Compounds BAL-05's faucet surplus.
- **Recommendation:** In `createArena`, use the generic gold curve (40+8×tier) for all tiers; reserve `NAMED_BOSSES.rewards` for the actual one-shot level-up battle (`battleSlice.ts:76`), which is correctly non-farmable.

### [BAL-05] Gold goes post-scarcity in under a week — ~2,030g of reachable one-time sinks vs 300–900g/day faucets, no repeatable sink (P1, confidence: high)
- **Area:** src/content/items.ts, weapons.ts, recipes.ts, src/engine/dungeon.ts, src/engine/bosses.ts
- **Observation:** Complete reachable sink list: weapons ≤410g (one of three is the free starter pick, `weapons.ts:41,53,63,71`); 9 spellbooks 140–220g totaling 1,480 (`items.ts:88-168`); recipe gold 140 total (`recipes.ts:36,55,62,88,95`); consumables 50–80g each (`items.ts:39-84`); in-dungeon merchant 18–90g/visit (`dungeon.ts:66-72`). Max ≈ 2,030g one-time; rational path ≈ 1,190g (4 battle spellbooks also drop free at 50%/treasure room, `dungeon.ts:53,82`). No sell/repair/upgrade sink exists. Repeatable potion demand is undercut by free supply: every scripted boss and every 3rd generic tier drops a healing potion (`bosses.ts:136,162,197,238,259`), Tactics tier 8+ too (`hexBattle.ts:1756-1760`). Faucets at mid-game (2–3 runs/day): ~300–900g/day (mine ~150/run, dungeon ~170, forest ~130, ×habitBonus 1.0–1.25, + habit gold).
- **Prior-doc status:** June §5 called gold an "early-game bottleneck" — inverted now; not covered post-rebalance.
- **Impact:** The wallet outruns all sinks by day ~3–6 and grows unboundedly. Habit gold (0/2/5/10), the streak gold multiplier (habitBonus), and most minigame payouts lose all motivational force exactly when retention matters — half the reward loop goes dead.
- **Recommendation:** One scaling repeatable sink — gear upgrade tiers priced in gold + band materials (obsidian plate, mithril toolkit recipe, resin trinket). Three recipes close BAL-03, -05, -16, and -17 simultaneously; `docs/forge-minigame-development-plan.md` is the natural vehicle.

### [BAL-06] Enemy weak/resist entries for CH, AG, EN, KN are dead data — the affinity system only ever tests ST/DX/WI (P2, confidence: high)
- **Area:** src/engine/combat.ts, src/engine/hexBattle.ts, src/engine/enemies.ts
- **Observation:** The only weak/resist consumers are `attackRoll` (attackStat ∈ {ST,DX}, `combat.ts:326-328` — hand-verified) and `spellDamageRoll` (schoolStat-or-WI, `combat.ts:348-349`; Tactics equivalents `hexBattle.ts:551-552,588-589`); support/illusion paths never call a damage roll (`combat.ts:452-474`). So ghoul's CH weakness and the CH resists on dire_wolf/frost_troll/ice_wolf (`enemies.ts`) never fire, and CH's "net −2 affinity" is inert.
- **Prior-doc status:** contradicts the June audit's entire affinity analysis, which treated all entries as live; root cause of BAL-02.
- **Impact:** Any UI showing weaknesses lies to players who bring illusion spells to a "CH-weak" enemy; content authors keep tuning knobs that do nothing. (Related: ARCH-04's mine/forest mitigation fork — recommend adopting the mine formula, which matches the arena convention, when hoisting per ARCH-06.)
- **Recommendation:** Either constrain all `weakTo`/`resistTo` content to {ST,DX,WI}, or make illusion status potency test CH affinity and heals/wards test KN — one multiplier line each at `combat.ts:469` / `hexBattle.ts:872`.

### [BAL-07] CH is the worst stat: breakpoint-only scaling (8/16/24), fewest encounter checks, dead affinity, redundant shrine role (P2, confidence: high)
- **Area:** src/engine/combat.ts, src/content/encounters.ts, src/store/slices/dungeonSlice.ts
- **Observation:** Illusion scaling is `turns + floor(CH/8)` with fixed magnitude (`combat.ts:469`; `arena.ts:858`; `hexBattle.ts:872`) — 22 of 25 possible CH points change nothing in combat. Encounter checks: CH 11 of 120 (lowest non-HP; DX has 22). Shrine checks use `max(WI,CH)` (`dungeonSlice.ts:382`), making CH redundant with the stronger WI. Its enemy affinity is dead data (BAL-06). Remaining surfaces: Royal Court trial, relics (now decent: `relics.ts:25,42,50,59`).
- **Prior-doc status:** confirms June §2's CH verdict; the mechanism (dead affinity, breakpoints) is newly established.
- **Impact:** A player who builds CH habits gets near-zero game return on ~88% of invested points — the sharpest "your real effort didn't transfer" case in the game.
- **Recommendation:** `floor(CH/8)` → `floor(CH/4)` plus magnitude scaling `+floor(CH/6)` on illusion statuses; add ~5 CH encounter checks.

### [BAL-08] Tactics push/blink tooltips advertise CH/KN scaling that does not exist (P2, confidence: high)
- **Area:** src/content/spells.ts, src/engine/hexBattle.ts
- **Observation:** `spells.ts:110` labels push "(Charisma)" and `:119` blink "(Knowledge)", but push is fixed distance 2 / fixed bonus (`hexBattle.ts:819-827`) and blink a fixed-radius teleport (`hexBattle.ts:786-793`) — neither reads any stat.
- **Prior-doc status:** not covered by any prior doc.
- **Impact:** Players told these are their CH/KN payoff in Tactics invest in stats that do nothing there — compounds BAL-07.
- **Recommendation:** Push distance `2+floor(CH/8)`, blink radius `2+floor(KN/8)` — or delete the parentheticals.

### [BAL-09] EN's triple minigame-XP trickle distorts level-up point allocation regardless of player intent (P2, confidence: high)
- **Area:** src/store/shared.ts, src/engine/progression.ts
- **Observation:** EN appears in every passive trickle: Mine ST/EN, Forest DX/EN, Tactics AG/DX/EN (`shared.ts:1142,1176,1275`) plus Arena stamina usage. One active day (mine d5 + forest s5 + tactics t5 win) grants EN ≈ 21 stat-XP — one full Normal habit — with zero EN habits logged. `allocateStatGains` weights raw xpDelta with no source discount (`progression.ts:95-98`), so EN reliably contends for ~1 of the 3 level-up points for any minigame-active player, contradicting the file's own "distributed by … which stats you trained" contract (`progression.ts:3-6`).
- **Prior-doc status:** not covered (trickle system post-dates June).
- **Impact:** Character sheets drift toward EN independent of chosen habits; the "who am I becoming" legibility of level-ups erodes.
- **Recommendation:** Weight trickle XP at 50% in the allocation input (or ledger it separately, excluded from xpDelta); or diversify the third-mode slots (Tactics → AG/DX only).

### [BAL-10] Tactics is strictly dominated on every reward axis with the flattest scaling (P2, confidence: high)
- **Area:** src/engine/hexBattle.ts, src/store/shared.ts
- **Observation:** `tacticsReward = 40×(1+0.15×tier)`, win-only (`hexBattle.ts:1752-1754`): tier 9 ≈ 94g for a ~10-min, 3-energy battle → ~37 g/E and ~11 g/min — at or below every other mode on gold/E, gold/min, and XP/E (13, tied with Arena at a third the run length). It awards zero materials (`cloneMaterials: false`, `shared.ts:1277`); its only unique payout is ~5 AG XP/run.
- **Prior-doc status:** not covered (Tactics post-dates June).
- **Impact:** The reward-motivated player never plays Tactics; the mode goes economically obsolete first as levels rise.
- **Recommendation:** Give Tactics a unique niche — a guaranteed crafting-material bundle on win (the only combat repeatable with none) — and/or raise the tier slope to 0.25.

### [BAL-11] Mine monster `bounty` is dead data — mine kills pay ~1–3g while forest kills pay a guaranteed 2–28g + material (P2, confidence: high)
- **Area:** src/content/mining.ts, src/engine/mining.ts, src/engine/forest.ts
- **Observation:** `content/mining.ts:24,55` documents and defines `bounty: [min,max]` ("gold dropped on death") on all 8 mine monsters, but `killMonster` never reads it (`mining.ts:798-811`): gold is a 1-in-N pool pick whose N grows with floor (2 → 7 entries, `mining.ts:267-276`) — P(gold) *shrinks* as monsters get harder. Forest's `killBeast` pays `def.bounty` guaranteed plus a material (`forest.ts:401-410`).
- **Prior-doc status:** contradicts June §5's mine-vs-forest gold framing (which compared node values only).
- **Impact:** Fighting in the Mine is a time tax vs mining nodes and vs Forest combat; the per-monster tuning knobs the content file advertises do nothing.
- **Recommendation:** Mirror `forest.ts:401` — pay `randInt(def.bounty)` guaranteed, keep the pool pick as the material bonus.

### [BAL-12] Bank-anywhere makes crawler death penalties near-vestigial — risk and reward are inverted across modes (P2, confidence: high)
- **Area:** src/store/slices/miningSlice.ts, forestSlice.ts, src/engine/mining.ts, forest.ts
- **Observation:** `beginBanking`/`beginForestBanking` are unconditional on any active tile (`miningSlice.ts:270-275`, `forestSlice.ts:188-193`) — retreating banks 100% from anywhere, instantly. Death keeps 50% (`mining.ts:85`, `forest.ts:85`) and Mine additionally tombstones the lost half for later recovery (`shared.ts:1153-1167`). Forest's 80% clearing-stash rate (`forest.ts:87`) is undercut by free 100% bank-anywhere. Dungeon, by contrast, is checkpoint-gated (`dungeonSlice.ts:271-277`) with floor-loss keep 25% (`dungeonSlice.ts:31`).
- **Prior-doc status:** not covered by prior docs; the "hurry tax" comment at `shared.ts:1187-1189` shows the design intent the current wiring defeats.
- **Impact:** The safest mode (Mine) is also the best repeatable gold/energy — risk pricing is backwards; pushing deeper carries almost no expected cost.
- **Recommendation:** Gate full-value banking on entrance/clearing tiles; bank-anywhere elsewhere pays the stash rate (80%).

### [BAL-13] Dungeon descent costs no energy — one 3-energy entry buys unlimited floors of XP and loot (P2, confidence: high)
- **Area:** src/store/slices/dungeonSlice.ts, src/engine/dungeon.ts
- **Observation:** Entry costs 3 (`dungeon.ts:10`) but `dungeonDescend` adds floors with no deduction (`dungeonSlice.ts:279-299`). Per-fight char XP (8+hp/10) scales with level via enemy scaling (`enemies.ts:245`); a 5-floor farming run ≈ 150 XP ≈ 50 XP/energy — parity with a perfect trial, but depth-unlimited. Mitigant: ~15–25 real minutes per run keeps per-minute XP low (why this is P2, not P1).
- **Prior-doc status:** not covered; second engine of BAL-01's inversion.
- **Impact:** Energy stops metering the mode precisely for the players (skilled, over-leveled) it should meter most.
- **Recommendation:** Charge 1 energy per descent past floor 3, or cap per-run char-stat XP mirroring the crawler trickle design (`shared.ts:1114-1117`).

### [BAL-14] Generic boss attack scales unbounded while player power caps — L40+ gates become raw-math-unwinnable (P2, confidence: high)
- **Area:** src/engine/bosses.ts
- **Observation:** Fallback atk = `4+round(0.7×t)` uncapped (`bosses.ts:255-257`) vs player damage capped at STAT_CAP 25 + weapon +6 and dodge capped 0.4. At L49: ~18 turns to kill vs ~16 survivable → guaranteed raw loss; every late gate needs heal-chaining or the 3-loss pity.
- **Prior-doc status:** not covered (generic fallback post-dates June).
- **Impact:** The last ~10 levels (already ~50 days each, see BAL-01 numbers) shift from "earned" to "attrition tax."
- **Recommendation:** Flatten attack growth past the cap horizon, e.g. `4+round(0.7×min(t,30)+0.25×max(0,t−30))`.

### [BAL-15] Shop prices for craftable weapons are ~6× recipe cost — decoy purchases that punish shop users (P2, confidence: high)
- **Area:** src/content/weapons.ts, src/content/recipes.ts
- **Observation:** iron_mace: buy 120g vs craft 3 iron_bar + 20g (`weapons.ts:41`, `recipes.ts:83-89`); short_bow: buy 120g vs 2 leather + 1 cloth_roll + 20g (`weapons.ts:53`, `recipes.ts:90-96`). Materials have zero opportunity cost (no sell mechanic; cross-recipe demand ≈ 8 iron_bar/8 leather/6 cloth_roll, saturated in 1–2 runs).
- **Prior-doc status:** not covered by June (it compared bows to each other, not shop-vs-craft).
- **Impact:** New players who buy from the visible shop waste ~100g per weapon vs crafting; the only rational shop weapon is hunting_bow (no recipe).
- **Recommendation:** Cut shop prices of craftables to ~50–60g (a convenience premium), or remove craftable duplicates from the shop.

### [BAL-16] 8 of 14 materials are dead ends — including the highest-frequency drops and the band-guardian trophies (P2, confidence: high)
- **Area:** src/content/materials.ts, recipes.ts, src/engine/mining.ts, forest.ts, dungeon.ts
- **Observation:** gemstone, stone, wood, game_meat, pelt, frost_quartz, obsidian, amber_resin have no recipe or any other sink (`recipes.ts:24-97`; no sell action repo-wide). Every rock yields 1–3 stone (`mining.ts:922-926`), every tree 1–3 wood (`forest.ts:991-997`); dungeon treasure's material roll is uniform over all 14 keys → ~57% dead (`dungeon.ts:44-46,78-79`); frost-band guardians guarantee frost_quartz ×3 / obsidian ×3 (`mining.ts:282-289`) — the trophy for the two hardest mine fights is inventory noise. The recipes.ts header comment (`recipes.ts:17-18`) still lists only the original 6 materials.
- **Prior-doc status:** June P0 #1 confirmed and grown (5 → 8).
- **Impact:** The materials panel fills with meaningless stacks; deep-content rewards feel like loot but aren't.
- **Recommendation:** 2–3 recipes consuming stone/wood/frost_quartz/obsidian/amber_resin (mithril toolkit, an EN armor piece — closing the EN gear gap, BAL-24 — and a consumable). Feed the Forge plan.

### [BAL-17] The gear curve ends at ~floor 7 / stage 4 while content runs to floor 15+ — nothing left to want after week one (P2, confidence: high)
- **Area:** src/content/gear.ts, weapons.ts, recipes.ts
- **Observation:** Best reachable kit (hunting_bow + bronze_plate + trinket + forced stone toolkit, per BAL-03) is fully acquirable from floor-3/stage-1 materials plus ~350g. Enemy contact damage keeps scaling past it (magma_hound 16, magma_colossus 20, `content/mining.ts:168-179`; ancient_guardian 18, `content/forest.ts:164`) and high Tactics tiers pay into a wallet with nothing to buy (BAL-05).
- **Prior-doc status:** not covered by June (content ran shallower then).
- **Impact:** Mid/late content answers no remaining acquisition question; progression motivation collapses onto XP alone.
- **Recommendation:** One late tier per slot gated on band materials (mithril toolkit, obsidian plate ~def 12, resin trinket) — same three recipes as BAL-05/BAL-16.

### [BAL-18] Energy never decays and the 50 cap is an anti-bug ceiling, not a design lever — hoarding decouples play from today's habits (P2, confidence: high)
- **Area:** src/store/shared.ts, src/store/slices/habitsSlice.ts
- **Observation:** Energy writers: +1 on completion, refund on uncomplete, the six entry deductions, devFillEnergy — no decay or reset anywhere in the engine. `MAX_ENERGY = 50` is self-described as a "defensive ceiling against accumulation bugs … never affect normal play" (`shared.ts:1108-1112`). 50 energy = 16 big-mode runs or 25 crawls. At the owner's ~4 habits/day with a 1–2 surplus, a full tank accrues in ~2–5 weeks.
- **Prior-doc status:** June P2 #9 asked for a cap; one was added but as a non-design constant — the binge concern stands.
- **Impact:** A lapsed player returns to a full tank funding ~16–25 runs with zero habits logged — the coupling the spec (line 375) says energy exists to enforce is weakest at the exact re-engagement moment.
- **Recommendation:** Lower the cap to ~2–3 days of typical spend (12–15), or add a weekly carryover limit tied to the still-unbuilt plan2 energy target. One-constant change either way.

### [BAL-19] Level-gate boss battles are free with unlimited retries — record this asymmetry as an intentional decision (P3, confidence: high)
- **Area:** src/store/slices/battleSlice.ts
- **Observation:** `startBattle` checks only `pendingLevelUp && !battle` (`battleSlice.ts:30-37`) — no energy. Losses increment `bossLosses`; the pity system cuts boss HP up to −40% (`combat.ts:144,181-184`); wins pay `boss.rewards` (`battleSlice.ts:76`). Not farmable (one pendingLevelUp per level). The spec's "Boss dungeon = 10 Energy" premium mode was never built (spec:373).
- **Prior-doc status:** not covered; spec-vs-code decision per the section brief: **code is right** — energy-gating level-ups would punish the game's core moment — but it inverts the spec's pricing intent and should be a recorded decision.
- **Impact:** On a 0-habit day, boss retries are the one substantive free grind. Acceptable; worth documenting.
- **Recommendation:** Document as intentional in the design doc; optionally charge 1 energy on retries after the first attempt.

### [BAL-20] completeTrial silently no-ops on gate failure while the modal unconditionally shows the reward screen (P3, confidence: high)
- **Area:** src/store/slices/trialsSlice.ts, src/components/trials/TrialModal.tsx
- **Observation:** All three completion gates `return s` with no signal (`trialsSlice.ts:33,36,40`); `TrialModal` then shows the result stage regardless and computes the displayed reward locally from `trialReward` (`TrialModal.tsx:93-99,106`) — not from what the store banked.
- **Prior-doc status:** not covered. Cross-reference to section 04 (trials UX).
- **Impact:** If energy hits 0 mid-trial (e.g. an uncomplete in another tab) the player sees stars and a reward that were never granted — low frequency, trust-breaking when it fires.
- **Recommendation:** Return a boolean from `completeTrial` (or re-check selectors in the modal) and show a "not banked" state.

### [BAL-21] Backdated completions earn XP and gold but silently zero energy (P3, confidence: high)
- **Area:** src/store/slices/habitsSlice.ts
- **Observation:** The +1 energy sits inside `if (isToday)` (`habitsSlice.ts:213-222`) while XP/gold apply for any day (`:196-197`). Defensible anti-mint choice (cf. HABIT-04), but invisible to the player.
- **Prior-doc status:** not covered.
- **Impact:** Logging yesterday's workout this morning loses the energy portion with no explanation — a legibility gap in the reward chain.
- **Recommendation:** One-line note on backfill completions ("logged late — no energy earned"). No economy change.

### [BAL-22] Energy/day equals habit count, not effort — breadth of trivial habits is the cheapest route to play time (P3, confidence: high)
- **Area:** src/store/slices/habitsSlice.ts
- **Observation:** +1 flat per completion (`habitsSlice.ts:214`, matches spec:371 — not drift) while XP and gold scale with difficulty; habit count is unbounded, so 20 trivial habits = 20 energy/day (to the 50 clamp).
- **Prior-doc status:** June P2 #10 verified; reframed — the flat +1 matches spec, the unbounded count is the actual lever.
- **Impact:** Honesty-enforced only; fine under the Option A trust model for the current single owner. Flag before any multiplayer-visible economy.
- **Recommendation:** No change now; if it matters later, cap energy-earning completions per day (e.g. 8) rather than touching the +1 rule.

### [BAL-23] AG's payoff curves cap well below the 25-point stat cap, and Arena reads AG not at all (P3, confidence: high)
- **Area:** src/engine/combat.ts, hexBattle.ts, src/hooks/useArenaLoop.ts
- **Observation:** dodge caps at AG 20 (`combat.ts:55`), flee at AG 17 (`:56`), Tactics move and climb at AG 16 (`hexBattle.ts:89-94`); only crawler move/dash keep scaling near the cap. Arena has no AG read (`useArenaLoop.ts:41`), the last real-time gap from June's P1 #3.
- **Prior-doc status:** June's blanket claim is fixed; this is the residue.
- **Impact:** The last ~⅓ of AG investment is dead on 3 of its 5 surfaces.
- **Recommendation:** Raise the Tactics move cap to 7 (AG 20) and let Arena scale move interval from AG (one line).

### [BAL-24] The pure-defense stats are under-surfaced: EN has zero gear (making its 14 encounter checks systematically harder) and HP has zero encounter checks (P3, confidence: high)
- **Area:** src/content/gear.ts, src/content/encounters.ts
- **Observation:** No gear grants EN (full scan, `gear.ts:27-128`); encounter rolls add gear bonuses (`encounters.ts:192`), so at stat 10 vs difficulty 6 a gloved DX check passes at 0.93 vs EN's 0.58 (`checkChance`, `encounters.ts:130-132`). Encounter-check distribution (n=120): DX 22, KN 20, ST 19, WI 18, AG 16, EN 14, CH 11, **HP 0**. HP is also never in Arena statUsage and has no live affinity.
- **Prior-doc status:** June noted "no EN gear"; the check-distribution measurement is new.
- **Impact:** EN checks are ~35 points harder than equally-trained geared stats; HP habits yield purely passive return.
- **Recommendation:** One EN trinket (+4) — ideally the BAL-16 band-material recipe; 3–4 HP "endure/withstand" encounter checks.

### [BAL-25] Crawler runs always restart at depth 1 — run-prefix overhead grows with progression while tier-scaled modes have none (P3, confidence: medium)
- **Area:** src/store/slices/miningSlice.ts, forestSlice.ts
- **Observation:** Every run starts at floor/stage 1 (`miningSlice.ts:107-108`, `forestSlice.ts:102-103`); mine floors 1–3 pay ~13–15g each regardless of character power (gold_vein gated to floor 4+, `content/mining.ts:91`) while Arena/Tactics tiers auto-scale with level with zero prefix. ~30–40% of a floor-1→6 run is spent in floors worth <15g.
- **Prior-doc status:** not covered.
- **Impact:** Mine/Forest reward-per-minute decays relative to tier-scaled modes as target depth grows — the long-session modes age worst.
- **Recommendation:** Let a beaten band guardian unlock starting at that band's first floor (boundaries already exist: `MINE_GUARDIAN_FLOORS`, `content/mining.ts:186-189`), keeping the trickle's `deepest` term unchanged.

### [BAL-26] Hunting Bow still strictly dominates Short Bow (P3, confidence: high — carried from June)
- **Area:** src/content/weapons.ts
- **Observation:** +5/cost 1/range 5/170g vs +4/cost 2/range 3/120g-or-craft (`weapons.ts:26-65`) — unchanged since June.
- **Prior-doc status:** confirms June P2 #11.
- **Impact:** Short bow is a transitional item only; minor.
- **Recommendation:** Give short_bow a niche (e.g. stamina cost 1) or accept as a stepping stone and close the item.

### [BAL-27] Advanced classes remain unassignable and advancedClassFor is now fully dead code (P3, confidence: high — carried from June)
- **Area:** src/engine/classes.ts
- **Observation:** 8 of 64 classes have advanced forms (`classes.ts:19-28`); `advancedClassFor` (`classes.ts:37-39`) has zero product callers — grep finds only its own test. June believed it fed CharacterView display; it no longer does.
- **Prior-doc status:** June P2 #14, now slightly worse (display usage gone).
- **Impact:** Reaching end-game with any class has no advancement milestone; dead API misleads readers.
- **Recommendation:** Either wire an advancement moment (level 25+ with class-stat threshold) or delete the lookup until the feature is designed.

## Appendix — cross-minigame parity tables (modeled)

Assumptions: L9 character, key stats ~7, iron-tier weapon, habitBonus 1.0 (parity-neutral — multiplies all modes equally), ~70% floor clear rate, trial score 0.6. **Durations are modeled from engine constants, not playtested (±30%)**; per-energy columns derive purely from source constants (high confidence).

| Mode | Energy | ~Min | Gold/run | StatXP/run | Gold/E | XP/E | Gold/min | Niche |
|------|--------|------|----------|------------|--------|------|----------|-------|
| Trial | 1 | 2 | 42 (60 max) | 32 (46 max) | 42 | 32 | ~21 | daily XP+gold, capped by daily gate |
| Mine | 2 | 11 | ~150 | 22 (ST/EN) | ~75 | 11 | ~14 | gold + crafting materials |
| Forest | 2 | 11 | ~130 | 16 (DX/EN) | ~65 | 8 | ~12 | materials (leather/herbs) |
| Arena | 3 | 3 | 112–130 (**500 at L20**) | 13 | ~37 (**167 at L20**) | 4.3 | ~37 (**~150 at L20**) | speed; broken by BAL-04 |
| Tactics | 3 | 10 | ~110 | 13 | ~37 | 4.3 | ~11 | none — dominated (BAL-10) |
| Dungeon | 3 | 12 | ~170 | ~60 (+~66 def/ward) | ~57 | 20 | ~14 | XP + relics + spellbooks |

Post-rebalance XP-per-energy order: Trials ≈ Dungeon ≫ Mine/Forest > Arena/Tactics. Dominant gold: Mine per-energy, Arena per-minute (outright at named-boss levels). Death/retreat keeps: Mine 0.5 + tombstone recovery, Forest 0.5 (stash 0.8, undercut by bank-anywhere), Arena 0.5×progress, Dungeon 0.25 of unbanked floor loot only.

Time-to-level at a realistic mixed day (~127 + 12.8×L XP/day): L5 ≈ day 10, L10 ≈ day 52, L20 ≈ 7.5 months, L50 ≈ 4.5 years. Habit-only: L19→20 alone ≈ 87 days (see BAL-01).

## Needs manual check

- **Run durations (parity tables):** Mine/Forest ~11 min, Dungeon ~12 min, Tactics ~10 min are modeled from map sizes and structure, not timed. A playtest stopwatch pass would firm up the gold/min column (±30%). (confidence: low)
- **Boss-gate melee walls (BAL-02):** the raw-math losses at L8/L12/L20 assume no potion use and a pure-ST loadout. A melee player mixing heals/potions may pass with attrition — the *severity* (hard wall vs slog) needs a playtest of Drill Rex with an ST build at-level. The math itself is verified. (confidence: medium for player impact)
- **Arena L20 farm rate (BAL-04):** 3-minute wins at ~100% win rate at-level is an estimate; actual sustainable g/hour needs play. The 500g-per-win payout is verified in source. (confidence: medium)
- **EN drift in practice (BAL-09):** whether EN actually captures level-up points on Orion's real save can be read off the Balance Report modal (Settings → Developer) — worth one look before tuning. (confidence: low)
- **Mine kill-gold feel (BAL-11):** the 1-in-N pool math is verified; whether players *notice* mine combat being unrewarding is a playtest question. (confidence: low for perception)
- **Elite-run ledger undercount (ARCH-09):** the Balance Report's dungeon XP figures are known-low until fixed — treat report-derived shares with that caveat when validating BAL-01's percentages against real save data. (carried)
