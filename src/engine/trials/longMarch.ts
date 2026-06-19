// Long March trial engine (pure, no React).
// The player traverses MARCH_TILES terrain tiles by choosing a pace for each.
// Stamina is the limiting resource; reaching 0 ends the march early.

export const MARCH_TILES = 16;
export const MARCH_START_STA = 12;
export const MARCH_MAX_STA = 12;
// Theoretical maximum distance: all Push on Clear tiles.
export const MARCH_MAX_DISTANCE = MARCH_TILES * 2;

export type TerrainKind = 'clear' | 'rough' | 'mud' | 'spring';
export type MarchPace = 'rest' | 'walk' | 'push';

export interface TerrainTile {
  kind: TerrainKind;
  label: string;
  emoji: string;
}

// Exported so the component can show live per-pace previews without calling marchStep.
export const PACE_COSTS: Record<MarchPace, Record<TerrainKind, { sta: number; dist: number }>> = {
  rest:  { clear: { sta:  2, dist: 0 }, rough: { sta: 2, dist: 0 }, mud: { sta: 2, dist: 0 }, spring: { sta: 6, dist: 0 } },
  walk:  { clear: { sta: -1, dist: 1 }, rough: { sta: -2, dist: 1 }, mud: { sta: -1, dist: 0 }, spring: { sta: 3, dist: 1 } },
  push:  { clear: { sta: -3, dist: 2 }, rough: { sta: -4, dist: 2 }, mud: { sta: -3, dist: 1 }, spring: { sta: 1, dist: 2 } },
};

const TERRAIN_LABELS: Record<TerrainKind, { label: string; emoji: string }> = {
  clear:  { label: 'Clear Path',      emoji: '🌄' },
  rough:  { label: 'Rough Terrain',   emoji: '🪨' },
  mud:    { label: 'Muddy Track',     emoji: '💧' },
  spring: { label: 'Mountain Spring', emoji: '✨' },
};

// Weights must sum to 1.
export const TERRAIN_WEIGHTS: [TerrainKind, number][] = [
  ['clear',  0.45],
  ['rough',  0.25],
  ['mud',    0.20],
  ['spring', 0.10],
];

/** Generate the terrain sequence for a run. Pass a seeded rng for determinism. */
export function generateTerrain(rng: () => number): TerrainTile[] {
  return Array.from({ length: MARCH_TILES }, () => {
    const roll = rng();
    let cumulative = 0;
    for (const [kind, w] of TERRAIN_WEIGHTS) {
      cumulative += w;
      if (roll < cumulative) return { kind, ...TERRAIN_LABELS[kind] };
    }
    return { kind: 'clear', ...TERRAIN_LABELS.clear };
  });
}

export interface MarchStepResult {
  distanceDelta: number;
  staminaDelta: number;
  message: string;
}

const STEP_MESSAGES: Record<MarchPace, Record<TerrainKind, string>> = {
  rest: {
    clear:  'You rest a moment and catch your breath.',
    rough:  'You rest a moment and catch your breath.',
    mud:    'You rest a moment and catch your breath.',
    spring: 'You drink from the spring — your body recovers.',
  },
  walk: {
    clear:  'You march at a steady pace.',
    rough:  'The rough ground drains you as you trudge through.',
    mud:    'The mud clings to your boots; you barely make progress.',
    spring: 'The spring water refreshes you as you pass.',
  },
  push: {
    clear:  'You surge forward, burning hard.',
    rough:  'You push hard through brutal terrain — it costs you dearly.',
    mud:    'You force your way through the mud at great effort.',
    spring: 'You gulp from the spring mid-stride.',
  },
};

/**
 * Resolve one tile step given the current terrain and chosen pace.
 * Stamina is floored at 0 and capped at MARCH_MAX_STA by the caller.
 */
export function marchStep(tile: TerrainTile, pace: MarchPace): MarchStepResult {
  const { sta, dist } = PACE_COSTS[pace][tile.kind];
  return {
    staminaDelta: sta,
    distanceDelta: dist,
    message: STEP_MESSAGES[pace][tile.kind],
  };
}

/**
 * Starting stamina for a run given the player's EN stat level.
 * EN investment grants a small bonus — capped at +6 above the base.
 */
export function marchStartStamina(enLevel: number): number {
  return Math.min(MARCH_START_STA + 6, MARCH_START_STA + Math.floor(enLevel / 3));
}

/**
 * Compute a 0–1 run score.
 * 70% weight on tile completion, 30% on distance efficiency.
 * Both components are individually capped so a full completion + zero distance
 * still scores 0.70, rewarding persistence even with a cautious pace.
 */
export function marchScore(tilesCompleted: number, distance: number): number {
  const tileScore = Math.min(1, tilesCompleted / MARCH_TILES);
  const distScore = Math.min(1, distance / MARCH_MAX_DISTANCE);
  return 0.7 * tileScore + 0.3 * distScore;
}
