# Audit 2026-07 — Synthesis

**Date run:** 2026-07-06 · **Branch:** `feature/multiplayer` · **Inputs:** all five section docs (01–05), `habits-rpg-improvement-plan2.md`, the active per-minigame plan open-item lists (as adjudicated in section 04), and Orion's section-02 interview.

This document merges the 149 findings from the five audit sections into one severity-ranked register, calls out the cross-section themes, and records the disposition of every previously tracked open item. The actionable roadmap built from this register is **`docs/habits-rpg-improvement-plan3.md`** — that doc is what to work from; this one is the evidence map behind it.

**Spin-out decision (per the audit charter's rule of thumb):** three sections individually exceed the ≥8-findings-at-P2+ density threshold for a separate per-area plan doc. No separate plan docs were written: each section doc already contains per-finding fix shapes at cited lines, so the section docs *are* the per-area analyses, and plan3 references finding IDs rather than restating them. A separate plan layer would be triple bookkeeping.

## Executive summary

- **Four P0s.** Two destroy real user data through normal use: the startup cloud pull deterministically rolls back an offline session on a single device (MP-01), and boon-pool exhaustion soft-locks a deep crawler run with no escape short of a full save wipe (MINI-01). Two are hard co-op desyncs: forest guest ranged kills diverge permanently because the world merge can never resurrect an entity (MP-02), and the Tactics staleness guard compares two machines' unrelated `performance.now()` clocks, freezing the guest's board for a whole match (MP-03).
- **The single biggest recurring root cause is timebase confusion** — `Date.now()`, `performance.now()`, and the rAF clock treated as interchangeable. It independently produces MINI-02 (permafrozen monsters, permanent buffs, the forest telegraph never rendering), MP-03, MP-04, the persisted-run stall on reload, and ARCH-25's stray stamp. One conventions pass ("engine time is the injected `nowMs`; wire time is `Date.now()`; never compare across machines") fixes five findings and prevents the class.
- **The app's stated first pillar — habits primary — fails numerically from ~level 3** (BAL-01): habit XP is flat while trial/dungeon XP scales with level, gold goes post-scarcity in under a week against ~2,030g of reachable sinks (BAL-05), and the strongest habit→game incentive (`habitBonus`) is invisible in the UI (HABIT-09). The owner's interview corroborates: rewards motivate him only "somewhat."
- **Every combat mode shares one dominant strategy: the player permanently outruns every threat** (MINI-06/-09/-20/-21 + flee/bank-anywhere BAL-12/MINI-30). Difficulty never binds, so build choices, defense stats, and the boss gate's drama are all undermined — compounded by the boss gate being rigged against melee (BAL-02) and flagship bosses having no movesets (MINI-03).
- **Test coverage is inverted relative to risk everywhere:** the pure engine/reducer layers are well covered while every P0/P1 in this audit lives in untested orchestration — the persist migrate/merge chain (ARCH-08), the co-op/cloud hooks and `session.ts` (MP-28), and component-side trial logic (MINI-33).

## Severity distribution

| Section | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| 01 Architecture | – | 1 | 16 | 8 | 25 |
| 02 Habit core | – | 3 | 12 | 9 | 24 |
| 03 Balance | – | 5 | 13 | 9 | 27 |
| 04 Minigames | 1 | 10 | 22 | 8 | 41 |
| 05 Multiplayer | 3 | 12 | 13 | 3 batches | 31 |
| **Total** | **4** | **31** | **76** | **37+** | **~149** |

Cross-section supersessions (already reflected above): MINI-32 → split into MP-02 (P0) + MP-11 (P1); ARCH-24 → MP-12 (P1); plan2's staleness-guard row → MP-03 (P0).

## P0 register

| ID | Finding | Why P0 | Fix shape (detail at the ID) |
|---|---|---|---|
| MP-01 | Startup cloud pull unconditionally overwrites local — an offline session is silently rolled back on a single device | Deterministic loss of logged habits — worst-case failure for a habit tracker | Persist `lastSyncedVersion` + dirty flag; push instead of pull when cloud is unchanged and local differs |
| MINI-01 | Boon-pool exhaustion enters `'choosing'` with zero options — run and mode soft-locked until `resetGame` | Data loss with no recovery path; hits the most engaged players (~floor 16–20) | Skip the transition when `choices.length === 0`; add a Skip button |
| MP-02 | Forest guest ranged kill diverges permanently — world merge is intersection-only, `WorldSliceInput` can't rebuild a beast | Permanent world divergence + loot duplication in normal co-op play | Route guest ranged through AttackIntent; widen the slice and make the merge host-authoritative |
| MP-03 | Tactics staleness guard compares host `msg.t` to guest `performance.now()` — guest board frozen all match | Total one-way desync of a whole match in a common pairing | Replace with the monotonic high-water-mark pattern from `runRng.ts` |

## P1 register

Ordered by cluster, then severity of consequence. "Links" notes merges, supersessions, and tracked-item mappings.

| ID | Finding | Links |
|---|---|---|
| **Data safety** | | |
| MP-05 | CAS conflict silently discards the losing device's changes; code comment claims a merge that doesn't exist | New; compound case wipes a just-banked run |
| MP-06 | First sign-in clobbers a rich pre-account save whenever any cloud row exists; a test locks the clobber in | Contradicts MULTIPLAYER_PLAN:126-127's import/merge intent |
| MP-07 | Sign-out wipes local even when the final flush failed (push errors swallowed) | New |
| ARCH-01 | `resetGame` omits `ownedGear`/`equipment` — a fresh start keeps all previous gear | New |
| **Co-op correctness** | | |
| MP-04 | Host refresh resets the world-slice `t` epoch — guests drop every slice, world freezes | Sibling of MP-03 (timebase theme) |
| MP-08 | `joined` never resets on remote session end — guests auto-attach to the next raid; live solo runs get overwritten | New |
| MP-09 | Host tab-close orphans `coop_sessions` rows — zombie raids resurface as joinable | New |
| MP-10 | HeroJoin onto an existing board is a silent no-op — rejoin/second guest hangs on a null board forever | New |
| MP-11 | Guest attack intents carry raw client damage; host applies with zero validation | Supersedes MINI-32's melee half |
| MP-12 | `joinCoop` keeps an orphaned persisted run — same-floor slices merge across different maps | Supersedes ARCH-24 (upgraded from P3) |
| MP-13 | Guest Tactics attacks validated against the host's anchored hero — dropped once host acted; range-checked from the wrong hex | New |
| MP-14 | Party-quest reporter double-counts on cloud rehydrate and on uncomplete→recomplete | Extends trust-model's quest exposure to honest clients |
| MP-15 | Chat loads the *oldest* 100 messages | New; breaks chat outright for active parties |
| **Habit core (owner-priority)** | | |
| HABIT-01 | Custom-challenge reward override bypasses all clamps — one habit tap mints arbitrary XP/gold from a normal UI surface | New |
| HABIT-02 | Streak freeze is proactive-only; UI baits burning the 80g item on an already-dead streak | Second-generation hole in a June fix; pairs with HABIT-15/17 |
| HABIT-03 | The habit cue is structurally missing: reminder is foreground-only, default-off, undiscoverable; no PWA path | Owner's #1 stated friction |
| **Economy / progression** | | |
| BAL-01 | Habit XP flat while trial/dungeon XP scales — "habits primary" inverts at ~L3; planned daily cap never built | Supersedes plan2 §4.2's ✅; spec pillar 1 violated |
| BAL-02 | Boss weaknesses use undamageable stats; no boss is weak to ST — melee raw-loses L8/L12/L20 gates | Root cause BAL-06; pairs with MINI-03 |
| BAL-03 | Iron and Mithril Toolkits both unobtainable — tool progression dead at power 1 | Extends June P0 #2; feeds Forge plan |
| BAL-04 | Arena repeatably pays one-time boss reward tables — 500g per 3-min win at L20 | New; item side in MINI-06 |
| BAL-05 | Gold post-scarcity in under a week — ~2,030g total sinks vs 300–900g/day faucets, no repeatable sink | Inverts June's "early-game bottleneck"; feeds Forge plan |
| **Minigame integrity** | | |
| MINI-02 | Mixed timebases permafreeze monsters, make buffs permanent, and delete the forest windup telegraph | Timebase theme; masks MINI-17 |
| MINI-03 | No named level-gate boss has a moveset — flagship fights are decision-free attack-spam (engine supports it; data gap) | Pairs with BAL-02, BAL-19 |
| MINI-04 | Biome bosses ~7× over-curve, pay zero loot, no pity relief — depth ladder walls at floor 4 | New |
| MINI-05 | Normal dungeon combat rooms award zero loot — treasure strictly dominates routing | New |
| MINI-06 | Arena: player permanently outruns every threat; kiting + ranged risk-free; named-boss item re-farm | Speed-invariant theme |
| MINI-07 | Arena: ice_rune sustains near-permanent boss lockdown | New |
| MINI-08 | Tactics tier forced to character level with unbounded enemy scaling vs stat-capped players | Contradicts tactics2 doc; strongest abandonment driver |
| MINI-09 | Tactics: ranged kiting damage-free; 10 of 16 enemy templates can never reach a bow player; overwatch fires after the fact | Speed-invariant theme |
| MINI-10 | Last Stand 3★-able by penalty-free eyes-closed mashing | New |
| MINI-11 | Trials charge energy/daily-gate only on completion — free abandonment turns per-trial RNG policy into retry exploits | Sibling of BAL-20 |

## P2 register (grouped by theme)

Full detail at each ID in the section docs.

**Save/persistence robustness:** ARCH-07 (full save serialized at tick rate), ARCH-08 (migrate/merge chain v2→v27 zero tests — P0-class blast radius), MP-16 (NaN clock offset would poison date keys), MP-26 (three uncoordinated push triggers self-conflict), MP-17 (clock syncs exactly once — spoof vector reopened), MP-18 (party-quest `ends_at` never enforced).

**Crawler twin drift (root cause ARCH-06):** ARCH-02 (forest runes never expire), ARCH-03 (forest `castSpell` missing knownSpells guard), ARCH-04 (different contact-damage mitigation formulas), ARCH-05 (dead `newOccupied` set — unit stacking), ARCH-06 (the hoist itself — ~9 mirrored functions), ARCH-14/ARCH-15 (UI-layer twin drift: sight radius, death-split, ~500 copy-paste lines), MINI-17 (charge throughput-negative; mine contact ignores frozen), MINI-18 (touch players lose the charge verb), MINI-19 (mine kill loot inversely scales with combat investment), MINI-20 (crawler difficulty flat while rewards scale), MINI-31 (mine fog no memory; tombstone a blind lottery), BAL-11 (mine `bounty` dead data), BAL-12 (bank-anywhere defeats risk pricing).

**Combat/stat fairness:** BAL-06 (weak/resist dead for CH/AG/EN/KN), BAL-07 (CH worst stat), BAL-08 (push/blink tooltips advertise scaling that doesn't exist), BAL-09 (EN trickle distorts level-up allocation) + MINI-25 (arena EN over-attribution), BAL-13 (free dungeon descent), BAL-14 (L40+ generic bosses raw-unwinnable), BAL-15 (shop prices 6× recipe cost), BAL-16 (8 of 14 materials dead ends), BAL-17 (gear curve ends at ~floor 7), BAL-18 (energy hoarding decouples play from today's habits), MINI-21 (arena flat L23–50), MINI-26 (runes bypass boss ward), MINI-27 (relic bonuses never reach encounter/shrine checks), MINI-28 (encounters flat vs depth), MINI-29 (multi-phase fights pay final-phase XP only), MINI-30 (retryable flee ≈ free bank).

**Tactics rescue package:** MINI-22 (bigger boards pay nothing extra), MINI-23 (losses/retreats pay zero while the tooltip promises partial rewards), MINI-24 (beacon never contested; fast wins void it), MP-22 (full state + unbounded log broadcast per click), MP-23 (unknown heroId falls back to host's hero), ARCH-16 (co-op weak/resist hints read the wrong weapon).

**Trials integrity:** MINI-12 (Rooftop/Armory/Last Stand never read their own stat), MINI-13 (Long March EN bonus clamped away; rest-spam floor), MINI-14 (Royal Court gambits −EV at realistic CH), MINI-15 (Lockpicking unfailable by ~L15), MINI-16 (Spirit Grove pool decays to recall in ~2 weeks), BAL-20 (completeTrial silent no-op vs unconditional reward screen).

**Habit loop legibility:** HABIT-04 (complete→spend→uncomplete mints energy), HABIT-05 (recovery bonus fires without a miss — permanent 1.1× for gapped schedules), HABIT-06 (reward moment under-reports), HABIT-07 (quick-start silently forfeits 5 points + spell), HABIT-08 (default template trains 2 of 8 stats), HABIT-09 (habitBonus invisible), HABIT-10 (weekly report never evaluates the plan), HABIT-11 (streak-at-risk masked, midnight-fired, arbitrary pick), HABIT-12 (mandatory account wall pre-value), HABIT-13 (no streak milestones), HABIT-14 (review's structured actions discarded), HABIT-15 (recovery_elixir purchasable but inert).

**Layering/structure:** ARCH-09 (elite earnedXp ledger undercount), ARCH-10 (shared.ts accreting engine rules), ARCH-11 (boon logic in content, invisible to the CI guard), ARCH-12 (palettes.ts DOM mutation), ARCH-13 (Lockpicking rules in the component), ARCH-17 (no encounter-graph integrity test), MINI-33 + MP-28 (test coverage inverted — ranked target lists in both).

**Net/party hygiene:** MP-19 (no party_members realtime — kicks invisible), MP-20 (hourly token refresh churns the channel), MP-21 (backgrounded host: frozen world + false eviction), MP-24 (no protocol version on the wire), MP-25 (no tile snapshot for late joiners), MP-27 (trust-model.md stale both directions).

## P3 register (batched)

- **Docs/dead code:** ARCH-18 (INDEX/CLAUDE.md/AGENTS.md drift — INDEX fixed by this synthesis; CLAUDE.md/AGENTS.md energy + store shape still to update), ARCH-19 (dead exports), ARCH-20 (milestone table ×3; selector bypass), ARCH-21 (store-layer duplication), ARCH-22 (sfx mute edge), ARCH-23 (SPELLBOOK_KEYS drift — also plan2 tracked), ARCH-25 (engine micro-issues), BAL-27 (advancedClassFor dead).
- **Economy footnotes:** BAL-19 (free boss retries — record as intentional), BAL-21 (backdated completions silently earn no energy), BAL-22 (energy = habit count not effort — accepted under Option A), BAL-23 (AG payoff caps), BAL-24 (EN gear / HP checks absent), BAL-25 (crawlers always restart at depth 1), BAL-26 (Hunting Bow dominates Short Bow).
- **Habit polish:** HABIT-16 (uncomplete at MAX_ENERGY deducts ungranted energy), HABIT-17 (stale cached streak display), HABIT-18–22 (WelcomeCard/CTA/template-count/copy/dead recommendation branches), HABIT-23 (weekly rotation disconnected from planning), HABIT-24 (balance report slice hidden in dev panel).
- **Minigame polish:** MINI-34 (Royal Court timer leak completes after abandon), MINI-35 (crossbowman reskin; uncatchable chaser), MINI-36 (tactics: enrage no-op, uniform pool, reused cue), MINI-37 (arena: minion affinities, connectivity, instant retreat), MINI-38 (crawler UX asymmetries), MINI-39 (dungeon dead weapon drops; affinities unsurfaced), MINI-40 ("free" copy vs 1-energy charge; Long March done-screen; Armory frame ceiling), MINI-41 (Forge plan corrections — pre-build).
- **Net polish batches:** MP-29 (co-op lifecycle), MP-30 (party/chat), MP-31 (clock/persistence observability).

## Cross-section themes

1. **Timebase confusion** (5+ findings, 2 of them P0-adjacent): MINI-02, MP-03, MP-04, ARCH-25a, the persisted rAF-timestamp reload stall. One convention fixes the class: engine functions consume only their injected `nowMs`; anything crossing a machine boundary or a reload uses `Date.now()`; nothing ever compares one machine's `performance.now()` to another's.
2. **The player outruns everything**: MINI-06 (Arena), MINI-09 (Tactics), MINI-20 (both crawlers), MINI-21, plus escape valves BAL-12 (bank-anywhere), MINI-30 (retryable flee). Every mode needs exactly one threat that breaks the "player speed ≥ threat speed forever" invariant.
3. **Twin-engine drift**: mine/forest divergence at engine (ARCH-02/03/04), UI (ARCH-14/15), and reward (BAL-11/MINI-19) layers. The ARCH-06 hoist is the highest-leverage refactor in the codebase — it structurally closes ~6 findings and prevents recurrence.
4. **Habits-primary inversion**: BAL-01 (the number), HABIT-09/-06 (the invisible/underreported reward), BAL-05 (gold worthlessness), MINI-11/-15/-10 (trial score inflation feeding the same imbalance). Fixing BAL-01's knob without the legibility fixes (or vice versa) only half-restores the pillar.
5. **Advertised-but-false mechanics** (trust erosion): item text lies (HABIT-02 freeze, HABIT-15 elixir), tooltips lie (BAL-08 push/blink, MINI-23 retreat rewards, MINI-40 "free" trials, HABIT-21 "no cap"), indicators lie (ARCH-16 wrong weapon, MINI-27 relic bonuses, BAL-06 dead weaknesses), comments lie (MP-05 merge, MP-07 "nothing is lost"). Cheap to fix individually; corrosive collectively.
6. **Orchestration is untested exactly where the bugs are**: ARCH-08 (persist), MP-28 (net hooks/session), MINI-33 (trial components, co-op glue). All four P0s and most P1s live in zero-test files while adjacent pure layers are green.
7. **Dead data as design debt**: `bounty` (BAL-11), 8 dead materials (BAL-16), dead weak/resist entries (BAL-06), `WorldSlice.status`/`'lobby'` (MP-29), `recovery` effect (HABIT-15), `price: 200` on unbuyable gear (BAL-03). Each is a knob someone will "tune" with zero effect.

## Disposition of previously tracked items

**plan2 "Still open / deferred" table** — all seven rows adjudicated:

| plan2 item | Disposition |
|---|---|
| Co-op staleness guard (`useTacticsCoopSession.ts:68-71`) | **Closed into MP-03 (P0)** — fix shape specified |
| 5 dead Tactics spells | Already ✅ in plan2 (verified) |
| 5 spellbooks missing from `SPELLBOOK_KEYS` | Still open → **ARCH-23** (P3) |
| Guided onboarding sequence | Still open → plan3 Phase 3 onboarding block (HABIT-07/08/18/19/20 are the concrete pieces; full tutorial stays deferred) |
| Co-op desync edge cases / integration tests | **Superseded by MP-28's ranked list** (plan2:856's "most common desync cases have tests" was stale) |
| Dungeon death loot loss (design call) | Still open — carried to plan3 deferred table |
| `pendingLevelUp` mid-dungeon edge case | Still open, no new evidence either way — carried to plan3 deferred table |

**Per-minigame plan open items** — section 04's rulings stand (04-minigames.md "Open-item dispositions" table): Tactics 5A/5B/6C keep (P3/small), 5C/2B/1A close, 4C folded into MINI-36; Long March 2.2 subordinate to MINI-13, 6.3 moved to the behavioral backlog; Spirit Grove §4.1 audio keeps as P3; dungeon-plan shipped items closed, BoonChoice timing + scene art keep as P3; Forge proceeds after MINI-41 corrections.

**Cross-section handoffs** — all discharged: MINI-32 → MP-02 (P0) + MP-11 (P1); ARCH-24 → MP-12 (P1); ARCH-04 → BAL-06 note (adopt mine formula when hoisting); ARCH-09 → caveat recorded in 03's appendix; ARCH-16 → MP/Tactics family.

**Trust model:** Option A (friendly trust) **holds for saves** — no finding argues for save validation. The shared surfaces need three cheap server-side guards: the quest-deadline predicate (MP-18), a `p_amount` ceiling on `increment_party_quest`, and confirmation that migration 0009's XP-rate trigger is live. Refresh `docs/trust-model.md` per MP-27.

## Needs manual check (carried forward, consolidated)

The five section docs' appendices remain authoritative; the ones that gate roadmap decisions:

- **Is migration 0009 applied to the live Supabase project?** Gates the trust-model refresh wording (05).
- **Boon-exhaustion onset depth** — ship the MINI-01 guard regardless (04).
- **Biome-boss felt severity** and **boss-gate melee walls** — playtest before final tuning numbers (03/04).
- **localStorage write cost at tick rate** — profile before building the ARCH-07 debounce (01).
- **Supabase Realtime ordering / SUBSCRIBED-refire semantics** — verify before relying on the MP-03/MP-04 guard rewrite (05).
- **Owner's reminder setting** — tell Orion the daily reminder exists today; it's a zero-code partial mitigation of HABIT-03 (02).
