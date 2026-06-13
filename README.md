# Habits RPG

A life-progress RPG where real-life habits build your character, and a turn-based
boss battle gates each level-up. Local-first web app (no account, no server) —
all progress is saved to your browser's `localStorage`.

Built from [`habits_rpg_gameplay_design.md`](./habits_rpg_gameplay_design.md),
MVP scope (design Section 16).

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build
npm test           # run the Vitest suite
npm run typecheck  # tsc --noEmit
```

## What's in the MVP

- **Habits** — create yes/no or quantity habits, each assigned to one of 8 stats,
  with difficulty (Easy/Normal/Hard/Epic), frequency, and tags.
- **XP & stats** — completing habits grants XP (quantity scales by completion %,
  capped at 150%; returning after a missed day gives a +10% recovery bonus).
- **Leveling** — total XP across stats sets your *eligible* level
  (`100 × level^1.5`), but you only level up by **winning a Level-Up Trial**.
- **Boss battles** — turn-based combat (Attack / Skill / Defend / Item). Your
  stats drive damage, crits, dodge, healing, and HP. Losing keeps your XP and eases
  the boss after repeated losses (anti-frustration).
- **Classes** — at level 10 your two highest stats decide your class from the 8×8
  chart (ties let you choose). Discovered classes fill a **Class Codex**.
- **Challenges** — local weekly challenges with goals, time limits, and partial
  rewards (e.g. *The Scholar's Week*).
- **Inventory & shop** — potions usable in battle, Streak Freeze to protect a
  streak, buyable with gold from bosses/challenges.
- **Mood & nudges** — character mood reflects recent consistency; a gentle warning
  appears if you pile on too many daily habits.

## Architecture

```
src/
  engine/   Pure, framework-free game rules (fully unit-tested)
  store/    Zustand store (+ persist) orchestrating the engine
  components/, views/   React UI (thin — no game math here)
```

All numeric rules live in `src/engine/*` and are covered by tests under
`src/engine/__tests__` and `src/store/__tests__`. Tech: React 18, TypeScript, Vite,
Tailwind, Zustand, Vitest.

## Not yet built (post-MVP backlog)

Dungeon expeditions, party raids, skill trials, crafting, cosmetics art, seasonal
content, story mode, prestige, and real multiplayer (needs a backend).
