# Dungeon cycle mutators — design (July 2026)

Plan item 3.4 (DUN-15): the descent loops through all three biomes in 15 floors
(`BIOME_ORDER` × 5). Before this, floors 16+ replayed the same content with only linear
stat scaling — deep descents felt like reruns. Mutators make each *cycle* of the loop a
named, harder, better-paying variant without authoring new biomes.

## Rules (implemented — the first slice)

- A **cycle** is one full pass over `BIOME_ORDER` (15 floors). Cycle 0 is floors 1–15
  (no mutator); cycle N ≥ 1 covers floors `15N+1 … 15N+15` and applies
  `CYCLE_MUTATORS[N-1]` (`src/content/biomes.ts`), clamping to the last entry for very
  deep runs. Resolver: `engine/biomes.ts::cycleMutator(depth)`.
- Mutators multiply **enemy and boss HP/attack at spawn** (`enemyFor`, `bossFor`) on top
  of the existing depth/level scaling, and add a **gold premium** on floor gold rolls
  (treasure + combat/elite/boss wins), stacking with route pricing (D2)'s danger factor.
- The mutator's name is shown in the depth header ("Depth 17 · The Ruins · Sunless",
  blurb on hover) — harder floors are always announced, never silent.

| Cycle | Floors | Mutator | Enemy HP | Enemy ATK | Gold |
| ----- | ------ | ------- | -------- | --------- | ---- |
| 1 | 16–30 | Sunless | ×1.25 | ×1.12 | ×1.25 |
| 2 | 31–45 | Echoing | ×1.5 | ×1.25 | ×1.5 |
| 3+ | 46+ | Hollow | ×1.75 | ×1.4 | ×1.75 |

Tuning intent: the premium tracks the HP multiplier so gold/minute stays roughly flat
across cycles while fights get longer — depth remains a prestige/record chase, not the
optimal farm. Revisit against the Settings › Dungeon economy readout once floors 16+
see real play.

## Deliberate non-goals of the first slice (follow-ups, in order of value)

1. **Enemy affixes** — per-enemy modifiers (e.g. *Thorned*: reflects 10% melee;
   *Winged*: +dodge) rolled on a share of spawns in mutated cycles, shown as a tag on
   the battle card. Adds fight-to-fight texture the flat multipliers don't.
2. **Encounter variants** — depth-tiered alternative outcomes for existing encounters
   (the engine already stiffens checks via `encounterDepthTier`; variants would change
   *text and stakes*, not just numbers).
3. **Boss modifiers** — one extra move or phase behavior per cycle for returning bosses.

Each follow-up is content-first (new fields in `content/`), engine changes minimal.
