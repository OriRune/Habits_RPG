# Ancient Library — Minigame Analysis

## 1. Basic Summary

Ancient Library is the Knowledge (KN) Skill Trial — one of eight daily minigames tied to the game's eight character stats. It is a classic Simon-style memory game: a sequence of emoji glyphs flashes on screen one at a time, then the player must tap them back in the exact same order. Each round the sequence grows by one glyph. The trial ends on the first wrong tap, or after completing all six rounds.

Within the larger game, Skill Trials are daily challenges unlocked at player level 3. Each trial awards stat XP (contributing to the relevant stat's growth) and gold. Ancient Library is the exclusive source of KN XP from trials, and can be completed once per calendar day (or replayed freely if the `repeatMinigames` dev setting is on). It takes roughly 60–90 seconds for a skilled run.

---

## 2. Core Game Loop

### Start
The player navigates to the Skills tab (`tab='skills'`), which renders `TrialsView`. They tap the Ancient Library card (📚, KN Trial). If the trial has already been cleared today, the card is marked "Done" (still tappable if `repeatMinigames` is enabled). Tapping opens `TrialModal` in `intro` stage.

The intro screen shows the trial name, a one-sentence description, and a "Begin Trial" button. Pressing it fires `sfxResume()` to unlock the browser AudioContext, then transitions `TrialModal` to `playing` stage, which mounts `<AncientLibrary onFinish={…} />`.

### Repeating loop per round
1. **Show phase** — glyphs from the master sequence are displayed one at a time, 700 ms per glyph. After the last glyph there is a 400 ms pause.
2. **Input phase** — the 3×2 glyph button grid activates. A row of filled/empty circles shows how many inputs have been given vs. how many remain.
3. **Validate** — each tap is checked immediately against the expected position in the sequence.
   - Correct and sequence complete → `correct` phase (800 ms visual), then either next round (900 ms) or trial finish.
   - Wrong → `wrong` phase (1 s visual), then trial finish.
4. Round counter increments, sequence length increments by 1, loop repeats.

### Challenge / difficulty
The sequence always starts at length 3 (round 1) and grows to length 8 (round 6). There are no power-ups, hints, or extra lives — one wrong tap ends the run. The only help is the per-position progress display (filled circles), which at least confirms correct inputs so far.

### End conditions
- **Fail:** Player taps a wrong glyph. `phase='wrong'`, then `onFinish(libraryScore(roundsCompleted))` fires with whatever rounds were completed before the error.
- **Complete:** Player survives all six rounds. `onFinish(libraryScore(6))` fires (score = 1.0).

### Outcomes
`TrialModal` receives the score and transitions to `result` stage, showing star rating, percentage, and a reward breakdown. The player taps "Claim Reward" which calls `completeTrial(trialId, score01)` in the store. This stamps today's ISO date, updates the best score, and deposits gold + KN XP. The "Done" badge appears on the hub card for the rest of the day.

---

## 3. Player Controls and Interaction

### Input controls
- **Mobile / touch:** Tap glyph buttons. The grid is 3×2, sized for comfortable thumb reach (full-width `max-w-xs`, 3 columns).
- **Desktop / mouse:** Click the same buttons.
- No keyboard input is wired up.

### UI elements
| Element | Appears when | Purpose |
|---|---|---|
| Round counter (`Round X of 6`) | Always | Tracks progress |
| Sequence length indicator | Always | Shows current target length |
| Glyph display box (80px tall) | Always | Shows the active glyph (pulsing), feedback icons, or prompt text |
| Progress tracker (circles) | `input` phase | Filled = correct so far, empty = still needed |
| 3×2 glyph button grid | `input` phase | Tap to make your choices |
| Sequence indicator strip | `showing` phase | Dots showing "shown / active / upcoming" positions |
| Status text line | Always | Narrates current phase in plain English |

### Feedback given to the player
- Correct round: ✅ icon in the display box, status text "Round N complete! Next round…"
- Wrong tap: ❌ icon, status text "Wrong glyph!"
- Trial finished: 📚 icon, status text "Completed N of 6 rounds."
- During show: "Watch the glyphs carefully…"
- During input: "Tap the glyphs in order."

### Menus / overlays
The full modal (`TrialModal`) takes over the screen (`fixed inset-0 z-50`). It has a persistent header with the trial icon, name, stat label, and a close (✕) button. The close button works at any stage, discarding an in-progress run without granting a reward.

---

## 4. Mechanics and Systems

### Scoring (`src/engine/trials/ancientLibrary.ts:22`)
```
score = Math.min(1, roundsCompleted / LIBRARY_MAX_ROUNDS)
```
- 0 rounds completed = 0.0 (failed on first sequence)
- 3 rounds = 0.5
- 6 rounds = 1.0

### Sequence generation (`ancientLibrary.ts:13`)
A single master sequence of 8 glyphs is generated at component mount using `Math.random` as the RNG. Each round uses a prefix of this master sequence (`masterSeq.slice(0, currentLength)`), so subsequent rounds extend the same sequence rather than replacing it — the player must keep memorising further into the same chain, not start a new one each round.

`generateSequence` is deterministic when given a seeded RNG (used in tests), but in-game always uses `Math.random`, so the sequence is random each trial session.

### Glyph set
Six emoji glyphs: 🔥 💧 🌿 ⚡ 🌙 ⭐. All drawn from one set, so repetition within a sequence is possible and intentional.

### Sequence lengths across rounds
| Round | Sequence length |
|---|---|
| 1 | 3 |
| 2 | 4 |
| 3 | 5 |
| 4 | 6 |
| 5 | 7 |
| 6 | 8 |

### Star thresholds (`trials.ts:106`)
| Stars | Score range | Rounds needed |
|---|---|---|
| ⭐ | < 0.40 | 0–2 |
| ⭐⭐ | 0.40–0.74 | 3–4 |
| ⭐⭐⭐ | ≥ 0.75 | 5–6 |

### Reward formula (`trials.ts:124`)
```
multiplier = 0.25 + 0.75 * score
statXp     = round((20 + 8 * level) * multiplier)
gold       = round((15 + 5 * level) * multiplier)
```
- Score-0 (fail immediately): 25% of max reward (participation floor)
- Score-1 (full clear): 100% of max reward
- Both scale linearly with player level

### Timers
All timers are `setTimeout` chains inside React `useEffect` / `useCallback`. There is no game clock, stamina bar, or pressure-based time limit — the player can deliberate as long as they wish during the input phase.

### Win / loss conditions
- **Win:** Complete 6 rounds without error.
- **Loss:** Any single wrong glyph input, at any point. One-strike rule. No lives system.

### Larger-game stats affecting the minigame
The trial does **not** consult any character stat during play. Player KN level, gear, and buffs have no effect on the trial's difficulty or rules. The only interaction is reward scaling by `character.level` (higher level → more XP and gold for the same performance).

### Randomization
The master sequence is generated fresh each session from `Math.random` at component mount. The RNG is not seeded, so runs are not reproducible (except in tests using `seededRng`). No other randomization occurs during play.

### Progression
No in-run progression (no difficulty ramp, power-ups, or bonuses). The only progression hook is the `bestTrialScore` record in the store, which tracks the personal best and drives the star display on the hub card.

---

## 5. Technical Implementation

### File map

| File | Role |
|---|---|
| `src/engine/trials/ancientLibrary.ts` | Pure engine: constants, `generateSequence`, `libraryScore` |
| `src/components/trials/games/AncientLibrary.tsx` | React component: all gameplay UI and state |
| `src/engine/trials/trials.ts` | Trial registry, `trialReward`, `scoreToStars`, daily-reset helpers |
| `src/components/trials/TrialModal.tsx` | Modal shell: intro → playing → result stages |
| `src/views/TrialsView.tsx` | Skills tab view: trial card grid, opens TrialModal |
| `src/store/useGameStore.ts` | Zustand store: `trialsClearedOn`, `bestTrialScore`, `completeTrial` action |
| `src/engine/trials/__tests__/trials.test.ts` | Vitest unit tests for engine functions |

### Key functions

**`generateSequence(rng: () => number): Glyph[]`** (`ancientLibrary.ts:13`)
Produces an 8-element array of glyphs sampled from `GLYPHS` using the supplied RNG. Length = `LIBRARY_START_LENGTH + LIBRARY_MAX_ROUNDS - 1` = 8. Pure function, no side effects.

**`libraryScore(roundsCompleted: number): number`** (`ancientLibrary.ts:22`)
Maps completed rounds to a 0–1 score. Clamped at 1.

**`AncientLibrary({ onFinish })`** (`AncientLibrary.tsx:20`)
The entire minigame lives here. On mount: `masterSeq` generated with `useMemo`. Phase machine:
- `showing` → driven by `useEffect` + `setTimeout` advancing `showIndex`
- `input` → `handleGlyphTap` validates each tap immediately
- `correct` / `wrong` → brief pause, then `finish()` or `startRound(round + 1)`
- `done` → calls `onFinish` with final score

**`completeTrial(trialId, score01)`** (`useGameStore.ts:1834`)
Store action. Guards against double-claiming the same day (unless `repeatMinigames`). Calls `trialReward`, merges reward into state via `applyReward`, then calls `checkLevelUp`.

### State management

All gameplay state is local `useState` inside `AncientLibrary.tsx`:
```ts
masterSeq:       Glyph[]          // fixed at mount
round:           number           // 0-based round index
phase:           Phase            // 'showing' | 'input' | 'wrong' | 'correct' | 'done'
showIndex:       number           // which glyph is currently being displayed
playerInput:     Glyph[]          // player's entries so far this round
roundsCompleted: number           // successful rounds (used for score)
```

No game state is written to the Zustand store during play. The store is only written **once**, when the player taps "Claim Reward" in the result stage.

### Data flow
```
TrialsView → opens TrialModal(trialId='ancient_library')
  TrialModal: intro → playing (mounts AncientLibrary)
    AncientLibrary plays; calls onFinish(score01)
  TrialModal: transitions to result stage (local score/stars/reward state)
  Player taps "Claim Reward"
    → store.completeTrial('ancient_library', score01)
      → trialReward(KN, score01, level) → Reward
      → applyReward(state, reward) → gold + KN XP
      → checkLevelUp(state)
      → trialsClearedOn['ancient_library'] = today
      → bestTrialScore['ancient_library'] = max(prev, score01)
```

### Save/load behavior
`trialsClearedOn` and `bestTrialScore` are persisted in `localStorage` via Zustand's `persist` middleware. They are initialised with `emptyTrialsClearedOn()` / `emptyBestTrialScore()` if not present (introduced in schema version 15). The migration in `useGameStore.ts:2658` back-fills both records from persisted saves that predate v15.

### Configuration
All tuning constants live in `ancientLibrary.ts`:
```ts
GLYPHS             = ['🔥','💧','🌿','⚡','🌙','⭐']  // 6 symbols
LIBRARY_START_LENGTH = 3    // sequence length in round 1
LIBRARY_MAX_ROUNDS   = 6    // total rounds (lengths 3–8)
```

Timing constants are inline in `AncientLibrary.tsx`: `700` ms per glyph, `400` ms pre-input pause, `800` ms correct flash, `900` ms before next round, `1000` ms wrong-flash before finish.

---

## 6. Software, Libraries, and Tools Used

| Concern | Solution |
|---|---|
| Language | TypeScript |
| Framework | React 18 (hooks only — `useState`, `useEffect`, `useMemo`, `useCallback`) |
| Build tool | Vite |
| State management | Zustand with `persist` middleware (localStorage) |
| Styling | Tailwind CSS with custom design tokens (parchment, gold-deep, gold-bright, ink, wood) |
| Rendering | DOM / browser canvas is **not** used; the minigame is purely HTML/CSS |
| Animation | CSS (`animate-pulse` via Tailwind, `transition-opacity`, `active:scale-95`) |
| Timers | Native `setTimeout` / `clearTimeout` |
| Physics | None — no movement or physics |
| Audio | `sfxResume()` from `src/lib/sfx.ts` (Web Audio API unlock); no sounds actually play during the trial |
| Testing | Vitest |
| Asset pipeline | No external assets — all visuals are emoji and CSS |

---

## 7. Assets and Presentation

### Visuals
The minigame is entirely text and CSS — no sprite sheets, canvas drawing, or image files. Visual elements are:
- **Glyphs:** Six emoji (🔥 💧 🌿 ⚡ 🌙 ⭐) displayed at `text-5xl` (active), `text-2xl` (input tracker), `text-xl` (sequence progress strip), and `text-2xl` (buttons)
- **Feedback icons:** ✅ (correct), ❌ (wrong), 📚 (done) at `text-4xl`
- **Parchment theme:** `bg-parchment-100/70`, `border-gold-deep/30`, `border-gold-bright`, `bg-gold-bright/10` — matches the broader Skills tab aesthetic
- **Pulsing active glyph:** Tailwind `animate-pulse` class during show phase
- **Button press:** `active:scale-95` with `transition-transform` on glyph buttons
- **Opacity cascade on progress strip:** current glyph = 100%, past = 30% (replaced by `•`), future = 10%

### Audio
`sfxResume()` is called when "Begin Trial" is tapped (to ungate Web Audio). However, **Ancient Library plays no sound effects** during gameplay — no glyph sounds, no correct/wrong audio, no round-complete feedback. This is unlike several other trials (Rooftop Chase, etc.) that do use sfx.

### Overall style and mood
Scholarly / arcane. The parchment background palette, gold borders, and bookish glyph set (🌿 🌙 ⭐) reinforce a library-in-a-fantasy-world aesthetic. The typography uses `font-display` for labels. The feel is quiet and contemplative rather than action-driven.

---

## 8. Current Player Experience

### What works
- **Clarity of rules:** The mechanic is universally understood (Simon-says). The intro description is accurate and brief. No tutorial is needed.
- **Visual structure:** The round counter, sequence-length indicator, glyph display box, and input progress circles give the player exactly the information they need at each moment.
- **Correct pacing architecture:** The "show one, wait, next" rhythm with a 400 ms pause before input is a good foundation.
- **Parchment aesthetic:** The minigame fits visually within the broader Skills tab and the game's fantasy theme.
- **Reward clarity:** The result screen shows star rating, percentage, and the exact gold/KN XP amount clearly.

### What feels awkward or unfinished
- **No audio whatsoever:** Memory games rely heavily on sound to aid memorisation (each glyph mapped to a tone). The silence here is conspicuous — every other Simon-style implementation uses audio. The browser AudioContext is even unlocked on entry, then never used.
- **No animation on button tap during input:** Pressing a correct glyph gives no confirmation feedback — the only feedback is the progress circle filling, which is subtle. There is no glyph highlight, bounce, color change, or sound.
- **Sequence indicator strip is confusing:** During the show phase, the strip below the display box replaces shown glyphs with `•` dots. This is meant to track progress, but it also reveals the full sequence length (and where you are in it) without showing the actual glyphs — its value is unclear.
- **No "you got it right" moment per glyph:** Correct taps are silent and unacknowledged beyond the circle. Only a complete sequence triggers the ✅. There is no microfeedback encouraging the player during the input phase.
- **700 ms display speed is fixed:** Fast players find this boring; new players may find sequences of 7–8 glyphs move too quickly. There is no warm-up to the speed; round 1 and round 6 run at the same pace.
- **Sequence grows by +1 per round, starting at 3:** This means the first two rounds (lengths 3 and 4) feel easy; the game difficulty spike happens somewhere in rounds 4–6. The early rounds may feel like "waiting for the real game to start."
- **One-strike elimination:** Harsh for a memory game. Most Simon implementations offer 1–3 lives. This may feel punishing to new players, especially given the lack of audio cues.

### Pacing
The `showing` phase timing is fixed at 700 ms/glyph regardless of round. At round 6, displaying 8 glyphs takes at least 5.6 seconds of passive watching before the player can act. This is a long mandatory wait at the end of a run. Combined with the 400 ms pause after display, the player waits ≥ 6 seconds in silence before having to recall an 8-glyph sequence.

### Difficulty fairness
The difficulty is real but well-defined: the sequence grows predictably, the glyph set is fixed, and there are no hidden gotchas. The one-strike rule is strict but consistent. A player who fails round 5 at position 7 of 7 will likely feel frustrated that a single mistake erases all progress. The 25% participation floor in rewards partially offsets this.

---

## 9. Known Issues or Weak Points

1. **No sound effects.** The sfx system is unlocked on entry but never played. This is the most significant missing feature for this game type.
2. **No per-glyph tap feedback.** Correct taps during input phase are silent and visually minimal. Players have no confirmation they pressed the right glyph until the whole sequence is complete.
3. **Sequence progress strip is visually confusing.** The `•` substitution during show phase is an obscure pattern that likely reads as noise to players.
4. **Fixed display speed.** No ramp-up or adjustment across rounds makes early rounds feel slow and late rounds potentially too fast for new players.
5. **Single-use `Math.random` RNG.** The sequence is generated with `useMemo(() => generateSequence(Math.random), [])`. If the component remounts, a new sequence is generated — but there is no in-game reason for remounting, so this is minor.
6. **No undo / cancel during input.** Once a glyph is tapped, it cannot be corrected. There is no "clear" button. This is common for Simon games but worth noting as a design constraint.
7. **No stat relevance.** The player's KN stat level does not affect the game in any way. A level-1 KN character and a maxed KN character play identically. This breaks the thematic loop — the "Knowledge" trial does not reward having Knowledge.
8. **No sense of escalating drama.** There is no visual or audio escalation between round 1 and round 6. The experience feels uniform rather than building tension.
9. **Close button discards run silently.** Tapping ✕ mid-run abandons the trial with no confirmation prompt and no partial reward. The daily gate is not consumed, so the player can re-enter, but this may not be obvious.
10. **Test coverage is minimal.** Tests in `trials.test.ts` cover `generateSequence` and `libraryScore` but nothing about the React component behavior (phase transitions, tap validation, finish callback).

---

## 10. Improvement Opportunities

### Audio
- Map each of the 6 glyphs to a distinct musical tone (pentatonic scale, e.g.). Play the tone when a glyph lights up during show phase, and again when the player taps during input.
- Play a short fanfare on round completion, and a fail sound on wrong tap.
- This single change would transform the experience more than any visual improvement.

### Per-tap feedback during input
- Briefly highlight the tapped button (color flash or scale pop) on each correct tap.
- This provides immediate microfeedback and reduces uncertainty.

### Difficulty curve
- Start at length 2 for the first two rounds, giving a genuine warm-up, then grow to 8 by round 6 or 7.
- Alternatively: add one "free round" at the start (untimed, any length) that plays but doesn't count toward score, to let the player calibrate.
- Consider reducing the display interval slightly each round (700 ms → 600 ms by round 6) to add a pacing element without changing the core mechanic.

### Lives system
- Award 1–2 second chances. A single wrong tap ending an 8-glyph run feels harsh.
- Example: allow one retry per session; using it caps the round score at 2★.

### KN stat integration
- At higher KN stat levels, add a "hint" mechanic: one glyph position in the sequence is briefly double-flashed, or the sequence replays 1 extra time, representing the character's trained memory.
- This would make levelling KN feel meaningful inside the trial itself.

### Remove or redesign the sequence progress strip
- Replace the `•` strip with a simple count ("Showing glyph 3 of 5") or remove it entirely — the display box already communicates the current glyph.

### Close-button confirmation
- Add a brief "Abandon this run?" confirm step if the player taps ✕ during `showing` or `input` phase.

### Code cleanup
- Extract the `setTimeout` timer delays as named constants alongside the other constants in `ancientLibrary.ts` (e.g. `GLYPH_SHOW_MS = 700`, `PRE_INPUT_PAUSE_MS = 400`).
- Add component-level tests using a testing library (e.g. Vitest + React Testing Library) for phase transitions and the finish callback path.

---

## 11. Questions and Unknowns

1. **Were sound effects intentionally omitted or simply not yet added?** The `sfxResume()` call on entry strongly suggests audio was planned. It is unclear whether specific tones were designed but not implemented, or whether audio was deferred entirely.

2. **Is the one-strike rule intentional as a permanent design decision, or a placeholder?** The `Last Stand` trial has a similar "miss too many" mechanic (multiple misses tolerated). Consistency across trials in terms of forgiveness would be worth defining.

3. **Should the player's KN stat level affect gameplay at all?** The current design is purely skill-based with no character stat influence. This is a deliberate design choice for some trials (Armory Break, Last Stand) but may be inconsistent with the RPG framing for others.

4. **What is the intended display speed for high-round sequences?** 700 ms/glyph × 8 glyphs = 5.6 s of watching. Was this timed against playtests, or is it a first-pass value?

5. **Is there a planned visual or thematic upgrade?** The parchment/emoji visual is functional but minimal compared to the Rooftop Chase or Lockpicking visuals. Is a more elaborate presentation (animated runes, scroll motif, etc.) part of the roadmap?

6. **Does the daily gate clear at midnight local time or UTC?** The store uses `toISODate()`. If this returns the player's local date, players crossing midnight will get an unexpected reset; if UTC, players in certain timezones may find the gate resets at odd hours.

7. **Is the `generateSequence` RNG source (`Math.random`) final?** Using `Math.random` means sequences cannot be reproduced for debugging, replays, or potential daily-seed features. The engine already supports injecting an RNG; the component just hard-codes `Math.random` at mount.
