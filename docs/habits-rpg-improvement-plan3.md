# Habits RPG — Improvement Plan 3

> **Current roadmap** as of 2026-07-06. Supersedes `habits-rpg-improvement-plan2.md`
> (2026-06-22; kept for history — its Phases 1–8 shipped and its residuals are carried
> here). Sourced from the 2026-07 project audit: the evidence for every item below lives
> in `docs/audit-2026-07/` under the cited finding ID (ARCH/HABIT/BAL/MINI/MP-NN), with
> `99-synthesis.md` as the merged register. **Read the finding before implementing the
> item** — each one carries file:line evidence and a concrete fix shape.

## Purpose

Plan2's direction — *deepen the habit tracker, don't expand the game* — worked: its
phases shipped and most of the June-era complaints are fixed. The audit found the next
generation of problems: **the app can destroy user data through normal use** (cloud
sync, deep crawler runs), **co-op desyncs in every session shape**, **the "habits
primary" pillar failing numerically from ~level 3**, and **a game whose difficulty
never binds because the player outruns everything**. This plan fixes those in that
order.

## Strategic direction

Unchanged from plan2: a habit coach wrapped in an RPG, not an RPG that happens to have
habits. Two audit-driven amendments:

1. **Data safety outranks everything.** A habit tracker that forgets logged habits
   (MP-01) or bricks a mode (MINI-01) fails at its one job. Phase 1 ships before any
   balance or feature work.
2. **Legibility is the cheapest reward buff.** The owner's interview says rewards
   motivate him only "somewhat" — and the audit found the strongest incentives are
   invisible (HABIT-09), under-reported (HABIT-06), or dishonest (theme 5 in the
   synthesis). Surfacing what already exists comes before tuning numbers.

# Priority summary

## Highest priority

1. Eliminate the four P0s (MP-01, MINI-01, MP-02, MP-03) and the cloud-save data-loss cluster.
2. Fix the timebase class (one convention: engine `nowMs`, wire `Date.now()`, never cross-machine `performance.now()`).
3. Make co-op sessions correct across refresh/rejoin/end (the MP-04…MP-15 block).
4. Restore the habit cue and streak-protection loop (HABIT-02/-03 + milestones).
5. Re-couple progression to habits: scale habit XP (BAL-01), add real gold sinks (BAL-03/-05), kill the Arena farm (BAL-04).
6. Give every combat mode one threat the player can't outrun; fix the anti-melee boss gate (BAL-02, MINI-03..09).
7. Put tests where the bugs live: persist migrate/merge, net hooks, trial components (ARCH-08, MP-28, MINI-33).

## Non-goals (avoid for now)

- **No new minigame except the Forge** (Phase 8) — and the Forge exists to serve the economy (BAL-03/-05/-16/-17), not to add content for its own sake.
- **No server-authoritative saves.** Option A (friendly trust) holds for saves — add only the three cheap server predicates (quest deadline, `p_amount` ceiling, confirm 0009 live). No save validation, no anti-cheat expansion.
- **No host migration or WebRTC transport.** Host-drop-strands-guests stays accepted; fix the *lifecycle* bugs instead (MP-08/-09/-10).
- **No delta-encoding rewrite of the co-op protocol.** Trim the obvious waste (MP-22, MP-29d/e) and measure the free-tier budget first.
- **No habit-system redesign.** The XP/streak formulas need the targeted fixes listed here, not a rethink.
- **Don't merge Mine and Forest into one mode.** Keep one engine (ARCH-06 hoist), push the two identities further apart deliberately (section 04's cross-cutting verdict).

---

# Phase 1 — Data safety ⏳

**Goal:** no sequence of normal actions destroys saved progress or bricks a mode.
Everything here is small, surgical, and independently shippable; do it first and in
roughly this order.

| # | Item | Findings | Status |
|---|---|---|---|
| 1.1 | Startup sync: persist `lastSyncedVersion` + dirty flag; when cloud is unchanged and local differs, **push** local instead of pulling | MP-01 (P0) | ✅ |
| 1.2 | Crawler soft-lock: skip the `'choosing'` transition when the boon roll returns `[]` (consolation heal/gold); add a Skip button to the boon panel | MINI-01 (P0) | ✅ |
| 1.3 | First sign-in with a non-trivial local save + existing cloud row: prompt keep-local vs keep-cloud (or keep newer by `lastActiveISO`); fix the test at `cloudSave.test.ts:317` that asserts the clobber | MP-06 | ✅ |
| 1.4 | `pushCloudSave` returns success/failure; sign-out confirms before wiping on a failed flush; fix the untrue "nothing is lost" comment path | MP-07 | ⏳ |
| 1.5 | CAS conflict: surface a visible "another device won; progress reverted" notice; fix the lying comment; optionally field-wise max-merge monotonic fields | MP-05 | ⏳ |
| 1.6 | Single in-flight push promise — coalesce the debounce/interval/visibility triggers | MP-26 | ⏳ |
| 1.7 | `resetGame`: add `ownedGear`/`equipment` to the reset object + a deep-equals-initial-state test | ARCH-01 | ⏳ |
| 1.8 | Clock hardening: `Number.isFinite` guard on the server-now payload; re-sync on visibilitychange + hourly | MP-16, MP-17 | ⏳ |
| 1.9 | Fixture tests for the persist `migrate`/`merge` chain (v3/v6/v24-era JSON through `migrate`; merge's live-run rule) — the highest-blast-radius untested code in the project | ARCH-08 | ⏳ |

**Acceptance:** offline session → close → relaunch keeps the offline progress; a
depth-20 run with all boons held can always bank; sign-out offline warns instead of
wiping; migrate chain has regression fixtures.

# Phase 2 — Co-op correctness ⏳

**Goal:** a co-op session survives refresh, rejoin, background, and end without
desync or contamination. Fix shapes are specified per finding in `05-multiplayer.md`.

| # | Item | Findings | Status |
|---|---|---|---|
| 2.1 | **Timebase convention pass** (fixes a P0 + P1 class in one sweep): thread the rAF `now` into `mineStrikeCharged`/`forestActCharged`/cast actions; render frozen/windup from `performance.now()`; rebase persisted run timestamps on rehydrate; stamp wire slices with `Date.now()`; replace the Tactics staleness guard with the monotonic high-water-mark pattern | MINI-02 (P1), MP-03 (P0), MP-04, ARCH-25a | ⏳ |
| 2.2 | Forest guest ranged kills through the AttackIntent path; widen `WorldSliceInput` with `key`/`maxHp` and make the world merge host-authoritative (rebuild, don't intersect) | MP-02 (P0) | ⏳ |
| 2.3 | Session lifecycle: reset `joined` when the session disappears/changes id; reap orphaned own sessions at discovery + age cutoff; HeroJoin onto an existing board resends current state | MP-08, MP-09, MP-10 | ⏳ |
| 2.4 | Intent validation: replace wire `dmg` with `{charged}` computed host-side (interim: clamp); reject Tactics intents whose `heroId` isn't in `players`; hoist the re-anchor above `computeTargetable` in `playerAttack`/`playerCastSpell` | MP-11, MP-23, MP-13 | ⏳ |
| 2.5 | Join hygiene: clear any existing run in `joinCoop` before `beginRun`; add `PROTOCOL_VERSION` to the session row and refuse mismatched joins; one-shot changed-tiles snapshot when a new player appears | MP-12, MP-24, MP-25 | ⏳ |
| 2.6 | Party layer: quest reporter re-baselines on hydration with a high-water mark; chat loads newest-100; `party_members` realtime + surfaced send failures; depend on `session.user.id` not the session object | MP-14, MP-15, MP-19, MP-20 | ⏳ |
| 2.7 | Server predicates (the whole anti-abuse budget): quest-deadline check in `increment_party_quest`, `p_amount` ceiling, verify 0009 is live in production | MP-18, MP-27, trust-model | ⏳ |
| 2.8 | Broadcast hygiene: skip selection-only Tactics broadcasts and strip/tail the `log`; `hostPaused` flag for hidden hosts; the MP-29 one-liners (send-after-SUBSCRIBED, discovery guard, floor-mismatch merge guard) | MP-21, MP-22, MP-29 | ⏳ |
| 2.9 | Tests where the bugs were: extract + test the tactics message handler, `session.ts` transitions, `useCoopSession` routing, cloudSave conflict/offline scenarios, quest-reporter delta loop (MP-28's ranked list) | MP-28 | ⏳ |
| 2.10 | Refresh `docs/trust-model.md`: document 0009, the grown leaderboard surface, quest forgery paths, clock caveats; restate Option A for saves | MP-27 | ⏳ |
| 2.11 | Fix TacticsOverlay weak/resist hints to read the per-hero weapon | ARCH-16 | ⏳ |

**Acceptance:** host refresh mid-run doesn't freeze guests; a guest can rejoin Tactics;
ending a raid detaches everyone; a party of two on different app versions can't corrupt
a shared world; chat shows recent messages.

# Phase 3 — Habit loop: cue, streaks, reward legibility ⏳

**Goal:** close the owner's three stated gaps — remembering to open the app, streak
protection that works after a miss, and rewards he can feel.

| # | Item | Findings | Status |
|---|---|---|---|
| 3.1 | **PWA path**: `vite-plugin-pwa` manifest (installable = passive daily cue) + minimal service worker so notifications work on mobile; one-time dashboard card offering to enable the existing reminder after a missed day. Interim, zero-code: tell Orion the Settings → daily reminder toggle exists | HABIT-03 (P1) | ⏳ |
| 3.2 | **Streak freeze redesign**: allow repairing the most recent missed scheduled day; refuse to consume when live streak is 0; show live `currentStreak` (not the cache) in the Protect panel and everywhere else; wire `recovery_elixir` as the retroactive-repair item (or pull it from the shop) | HABIT-02 (P1), HABIT-17, HABIT-15 | ⏳ |
| 3.3 | Streak-at-risk that actually fires: sort at-risk by live streak desc, promote above generic prompts when top streak ≥ 7 and hour ≥ ~18, mention owned freezes | HABIT-11 | ⏳ |
| 3.4 | Streak milestones at 7/30/100 — distinct toast + small reward at the already-computed spot in `completeHabit` | HABIT-13 | ⏳ |
| 3.5 | One "reward receipt" toast from actual granted values (`+12 XP · +5g · +1⚡`) for both binary and quantity paths; fix/drop the dialog preview; note on backdated completions ("logged late — no energy") | HABIT-06, BAL-21 | ⏳ |
| 3.6 | Surface `habitBonus` on every run-banking summary and beside the dashboard energy counter ("Streak bonus ×1.15 — 3 of 4 habits on streak") | HABIT-09 | ⏳ |
| 3.7 | Weekly loop closure: report evaluates the plan's focus habits (`focusResults` block first); render the review's structured actions as one-tap buttons; list the weekly challenge rotation inside PlanWeekModal; two motivational Balance-Report tiles in the review | HABIT-10, HABIT-14, HABIT-23, HABIT-24 | ⏳ |
| 3.8 | Economy-integrity trio: clamp the custom-challenge reward override to `suggestReward` bounds; per-completion "energy granted" marker (fixes both the mint and the cap-deduct edge); recovery bonus only fires when a scheduled day in the gap was actually missed | HABIT-01 (P1), HABIT-04, HABIT-16, HABIT-05 | ⏳ |
| 3.9 | Onboarding block (plan2's carried gap, now concrete): quick-start auto-allocates the 5 points + grants a spell (or discloses); retag the default template to 4 distinct stats; "Choose a weapon and spell to begin" helper on the dead CTA; WelcomeCard points at reachable content; soft warning past 2 template groups; fix the "no XP cap" label; guest/offline link on LoginView | HABIT-07, HABIT-08, HABIT-19, HABIT-18, HABIT-20, HABIT-21, HABIT-12 | ⏳ |
| 3.10 | Dashboard closure ritual: show `all_done` when today is finished (energy hint appended); delete the dead `load_warning` branch | HABIT-22 | ⏳ |

**Acceptance:** app-open has an external cue path; a missed day is repairable and the
UI never baits wasting an item; day 7/30/100 feel different from day 2; every reward
moment shows what was actually granted.

# Phase 4 — Economy: sinks, faucets, habits-primary ⏳

**Goal:** habit effort is the best long-term progression path again, and gold means
something after week one. Numbers in `03-balance.md`; re-model after each step.

| # | Item | Findings | Status |
|---|---|---|---|
| 4.1 | **Scale habit XP with level** (e.g. `base × (1 + 0.15×(L−1))`) — the one knob that fixes both the share inversion and mid-game pacing. Fallback: the plan2 §4.2 daily minigame-XP cap | BAL-01 (P1) | ⏳ |
| 4.2 | Arena pays the generic gold curve at every tier; named-boss reward tables reserved for the one-shot level-up battle; no item re-farm on named tiers | BAL-04 (P1), MINI-06 item half | ⏳ |
| 4.3 | Gear shop section + `buyGear` action (makes iron_pickaxe's dead price live); mithril toolkit via magma-band recipe | BAL-03 (P1) | ⏳ |
| 4.4 | Three late-tier recipes consuming the dead-end band materials (mithril toolkit, obsidian plate ~def 12, resin trinket with +EN) — one stroke closes the sink gap, the material dead ends, the gear-curve stall, and the EN-gear gap. Design them now; the Forge (Phase 8) becomes their crafting *experience* | BAL-05 (P1), BAL-16, BAL-17, BAL-24 | ⏳ |
| 4.5 | Mine kills pay guaranteed `bounty` like forest (keep the pool pick as bonus); kill-loot uses the wielded attack stat | BAL-11, MINI-19 | ⏳ |
| 4.6 | Dungeon: combat rooms pay depth-scaled gold (~half a treasure room); descent past floor 3 costs 1 energy (or per-run XP cap); flee keeps 0.6 of floor loot (or one attempt per fight) | MINI-05 (P1), BAL-13, MINI-30 | ⏳ |
| 4.7 | Crawler risk pricing: full-value banking only on entrance/clearing tiles, stash rate elsewhere; beaten band guardians unlock deeper starts | BAL-12, BAL-25 | ⏳ |
| 4.8 | Tactics reward rescue: tier selector clamped [4, level]; loss/retreat pays proportional gold (fix the lying tooltip); board-size gold multiplier; guaranteed material bundle on win | MINI-08 (P1), MINI-23, MINI-22, BAL-10 | ⏳ |
| 4.9 | Trickle-allocation fairness: weight minigame trickle XP at 50% in `allocateStatGains` (or ledger separately); Arena tallies EN at 0.25 | BAL-09, MINI-25 | ⏳ |
| 4.10 | Decisions to record (change one constant or write one paragraph): energy cap as design lever (12–15?) vs hoarding; free boss retries stay free; shop premium on craftables cut to ~50–60g; Short Bow niche or accepted stepping stone | BAL-18, BAL-19, BAL-15, BAL-26 | ⏳ |

**Acceptance:** at L10–L20 a realistic day's XP is majority-habit; there is always
something worth ≥500g to want; no mode strictly dominates section 03's parity table.

# Phase 5 — Combat fairness and challenge ⏳

**Goal:** difficulty binds — every mode has a threat the player can't ignore, and every
build can pass the boss gate.

| # | Item | Findings | Status |
|---|---|---|---|
| 5.1 | Boss gate de-rigging: constrain all `weakTo`/`resistTo` content to the damage-capable stats {ST, DX, WI}; give Drill Rex or Comfort Blob an ST weakness and one Burnout Golem phase ST/DX; flatten generic boss attack growth past the stat-cap horizon | BAL-02 (P1), BAL-06, BAL-14 | ⏳ |
| 5.2 | Author movesets: 3 moves per named boss + a shared Trial Guardian set (data-only; engine already runs it for trash mobs) | MINI-03 (P1) | ⏳ |
| 5.3 | Biome bosses: cut phase HP ~35%, add depth-scaled gold, pass the run's loss count so pity relief applies; add the "realistic build wins by round N" balance test; accumulate multi-phase HP for XP/damage stats | MINI-04 (P1), MINI-29 | ⏳ |
| 5.4 | Break the speed invariant, one threat per mode: Arena boss gap-closer + speed ramp past 1.2×; Tactics charger lunge or soft turn cap; one sub-300 ms (or lunging) late-band enemy per crawler; uncap crawler count/damage scaling past the current caps | MINI-06 (P1), MINI-09 (P1), MINI-20, MINI-21 | ⏳ |
| 5.5 | Arena spell integrity: boss freeze immunity window after ice_rune; runes/ring respect boss ward; minion affinities rolled at impact | MINI-07 (P1), MINI-26, MINI-37a | ⏳ |
| 5.6 | Charge verb: mine contact damage respects frozen (parity with forest); `CHARGE_DAMAGE_MULT` ≥ 2.25; pointer-up release so touch players can charge | MINI-17, MINI-18 | ⏳ |
| 5.7 | CH/KN honesty: illusion scaling `floor(CH/4)` + magnitude; ~5 CH encounter checks; push/blink actually scale (or delete the parentheticals); shrine no longer `max(WI,CH)` | BAL-07, BAL-08 | ⏳ |
| 5.8 | Dungeon depth: relic bonuses reach encounter/shrine checks; encounter difficulty/payout scale with depth; owned-weapon drops reroll to gold; affinity chip in battle UI; beacon auto-completes on decisive wins | MINI-27, MINI-28, MINI-39, MINI-24 | ⏳ |
| 5.9 | Small stat-parity items: Tactics move cap → AG 20; Arena move interval reads AG; 3–4 HP encounter checks; mine lantern boon `game:'both'` + tombstone compass | BAL-23, BAL-24, MINI-31 | ⏳ |

**Acceptance:** an ST build beats every gate at-level without pity; attack-spam loses
to at least one named-boss move; a kiter dies sometimes in every mode.

# Phase 6 — Trials integrity ⏳

**Goal:** each trial tests its stat, honest play is optimal, and the daily gate holds.

| # | Item | Findings | Status |
|---|---|---|---|
| 6.1 | Anti-mash: ~200 ms lockout on empty blocks in Last Stand | MINI-10 (P1) | ⏳ |
| 6.2 | Retry policy: per-attempt seeds (`dailySeed ^ attemptNonce`) for Library and Grove; adopt Rooftop's explicit Run-Again framing everywhere | MINI-11 (P1) | ⏳ |
| 6.3 | Stat wiring: AG → Rooftop dash cooldown; HP → the dormant `blockWindowForWave`; ST → Armory zone width; add the missing TrialModal stat boxes | MINI-12 | ⏳ |
| 6.4 | Long March: `max(MARCH_MAX_STA, startStamina)` clamp so the EN buffer depletes; renormalize distance score (or Rest doesn't advance); then reconsider the deferred hard mode | MINI-13 | ⏳ |
| 6.5 | Royal Court: gambit payoffs +5/+6 (break-even ≈ CH 3–5); no dominated gambits; timer cleanup on unmount | MINI-14, MINI-34 | ⏳ |
| 6.6 | Ceilings: cap Lockpicking tolerance at 2× base; bias Grove drafts to unseen rounds + mastery gold ×1.15 | MINI-15, MINI-16 | ⏳ |
| 6.7 | Gate honesty: `completeTrial` returns success and the modal shows a not-banked state; fix the "free attempt" copy (or make the first attempt actually free — decide); Long March done-screen; Armory power interpolation | BAL-20, MINI-40 | ⏳ |
| 6.8 | Rooftop: crossbowman gets a jumpable telegraphed bolt; dash costs something at the margin | MINI-35 | ⏳ |

**Acceptance:** no trial is 3★-able without engaging its mechanic; abandoning and
retrying yields a fresh challenge at the same price.

# Phase 7 — Structure, tests, and docs ⏳

**Goal:** stop the drift machines. Do 7.1 before touching crawler features.

| # | Item | Findings | Status |
|---|---|---|---|
| 7.1 | **Hoist the crawler twins into `crawl.ts`** (start: `applyBoonChoice`, `coopClientStep`, `damageXById`; then `castSpell`/`triggerRunes`) — structurally closes the rune-expiry, spell-guard, and mitigation forks (decide the mitigation rule once, mine's formula, and document it); check `newOccupied` or delete it | ARCH-06, ARCH-02, ARCH-03, ARCH-04, ARCH-05 | ⏳ |
| 7.2 | Crawler UI extraction (`useCrawlRunFx`, shared Gauge/BoonPanel/RemoteCrawlers/SpellBar); mine gets engine `sightRadiusFor` + `splitHaul`; torch glow follows sight radius; dash/blur/score asymmetries unified | ARCH-15, ARCH-14, MINI-38 | ⏳ |
| 7.3 | Persist performance: trailing-debounce storage adapter (profile first per 01's manual check) | ARCH-07 | ⏳ |
| 7.4 | Layer hygiene: boon reducers + `rollBoonChoices` → engine; extend the layering test (content is data-only; engine touches no DOM/globals); `applyPalette` → lib; extract `stepLockpick` into the engine; split `shared.ts` along its seams (types / engine rules / commit orchestration) | ARCH-11, ARCH-12, ARCH-13, ARCH-10 | ⏳ |
| 7.5 | Targeted test debt (beyond 1.9/2.9): empty-boon transition + timebase specs; TacticsOverlay/LastStand/LongMarch component smokes; encounter-graph integrity test; `computeMood`/combatStats tables; hexBattle split (tactics 5A) + overlay test (5B) | MINI-33, ARCH-17, ARCH-25, tactics plan | ⏳ |
| 7.6 | Small-defect batch: elite `earnedXp` spread fix; battle-action/earnings-clone/begin-preamble dedup; sfx mute edge; SPELLBOOK_KEYS derived from items; dead exports pruned; selectors used by DungeonView/AccountSummary/DayOfWeekChart; forest.ts:923 `nowMs`; enrage case in tactics; objective chime | ARCH-09, ARCH-21, ARCH-22, ARCH-23, ARCH-19, ARCH-20, ARCH-25, MINI-36 | ⏳ |
| 7.7 | Doc pass: update CLAUDE.md/AGENTS.md (all six energy costs, 12-slice store, `net/coop/reduce.ts`); INDEX drift fixed at synthesis — keep it current; archive proposals below | ARCH-18 | ⏳ |

# Phase 8 — The Forge ⏳

**Goal:** the one sanctioned new minigame, built because the economy needs it: it is
the delivery vehicle for Phase 4.4's recipes and the game's first repeatable
quality-tier gold/material sink.

| # | Item | Findings | Status |
|---|---|---|---|
| 8.1 | Apply the plan corrections before building: `shared.ts:647` is the single weapon-lookup seam (no bare `getWeapon` in slices); PaperDoll path; refreshed line refs | MINI-41 | ⏳ |
| 8.2 | Add the dead-end materials (BAL-16 list) to the recipe-design inputs so Forge recipes consume them | BAL-16 | ⏳ |
| 8.3 | Build per `docs/forge-minigame-development-plan.md` (two-phase DX/ST hammering, Crude/Normal/Fine/Masterwork tiers) | forge plan | ⏳ |

---

# Work status

All items ⏳ as of 2026-07-06. Update markers in place as work lands; when a phase
completes, note the date beside its heading (plan2 convention).

## Still open / deferred

Consciously deferred — tracked so they aren't lost, with the deciding context:

| Item | Details | Priority |
|---|---|---|
| Dungeon death loot loss | Discrete loot (spellbooks/weapons) lost on dungeon death may feel disproportionate. Carried from plan2; still a design call — decide alongside 4.6's flee/keep changes so death vs flee vs bank prices are set together. | Design call |
| `pendingLevelUp` mid-dungeon edge case | Carried from plan2; no new evidence in this audit. Revisit if a repro appears. | Edge case |
| Guided onboarding *sequence* | The full enforced first-habit→first-reward walkthrough. Phase 3.9 ships the discrete fixes; the tutorial flow itself stays deferred until those land and are observed. | UX gap |
| Arena co-op | Dropped from MULTIPLAYER_PLAN without a recorded rationale (05 fact-check row 1). Decision now recorded: stays dropped — Arena is single-player-tuned and the co-op budget goes to fixing the three shipped modes. | Decided |
| Host migration | Host drop strands guests (documented in game-analysis). Accepted under friends-and-family scale. | Accepted |
| Co-op delta protocol / free-tier budget | Full-world broadcasting stands until the message budget is *measured* (05 needs-manual-check). If measurement shows pressure, revisit after Phase 2.8's trims. | Measure first |
| Long March hard mode (lm plan 2.2) | Pointless until 6.4's scoring fix lands; re-evaluate after. | Subordinate |
| Trials hub streak (lm plan 6.3) | Moved to the behavioral backlog (section 02 territory — pairs with HABIT-13's milestone system). | Backlog |
| Spirit Grove ambient audio (§4.1) | Still absent; pure polish. | P3 |
| Dungeon BoonChoice timing + scene art | Section 04 dungeon-plan leftovers. | P3 |
| Energy decay / weekly carryover | 4.10 decides the cap; active decay stays out unless hoarding is observed on real saves. | Deferred |
| plan2 Phase 9 (habit chains, real-life bosses, seasonal events, class habit bonuses, smarter recommendations) | Carried forward unchanged — still deferred until the habit core and economy work above is stable. | Deferred |

# Success criteria

1. **No data-loss path survives:** the Phase 1 acceptance scenarios pass, with tests.
2. Two-client co-op sessions survive refresh, rejoin, and end on both sides without desync.
3. At L10 and L20, a realistic day's XP is majority-habit (verify via the Balance Report after ARCH-09's fix).
4. Gold has a purpose in week 4: some purchasable/craftable target always exists.
5. Every combat mode can kill an inattentive kiter; an ST build clears every boss gate at-level.
6. Every trial's namesake stat visibly changes its trial; no trial is 3★-able by mashing or transcription.
7. The owner reports the app *reminds him* to log — the cue exists outside an open tab.
8. `src/hooks/` and the persist migrate chain are no longer zero-test.
9. Docs match the app: trust-model refreshed, CLAUDE.md/AGENTS.md energy table correct, INDEX current.
