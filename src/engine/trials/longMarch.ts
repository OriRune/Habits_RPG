// Long March trial engine (pure, no React).
// The player traverses MARCH_TILES terrain tiles by choosing a pace for each.
// Stamina is the limiting resource; reaching 0 ends the march early.

export const MARCH_TILES = 16;
export const MARCH_START_STA = 12;
export const MARCH_MAX_STA = 12;

export type TerrainKind = 'clear' | 'rough' | 'mud' | 'spring';
export type MarchPace = 'rest' | 'walk' | 'push';

export interface TerrainTile {
  kind: TerrainKind;
  label: string;
  emoji: string;
}

const TERRAIN_LABELS: Record<TerrainKind, { label: string; emoji: string }> = {
  clear: { label: 'Clear Path', emoji: '🌄' },
  rough: { label: 'Rough Terrain', emoji: '🪨' },
  mud: { label: 'Muddy Track', emoji: '💧' },
  spring: { label: 'Mountain Spring', emoji: '✨' },
};

/** Generate the terrain sequence for a run (deterministic). */
export function generateTerrain(rng: () => number): TerrainTile[] {
  const weights: [TerrainKind, number][] = [
    ['clear', 0.45],
    ['rough', 0.25],
    ['mud', 0.20],
    ['spring', 0.10],
  ];
  return Array.from({ length: MARCH_TILES }, () => {
    const roll = rng();
    let cumulative = 0;
    for (const [kind, w] of weights) {
      cumulative += w;
      if (roll < cumulative) {
        return { kind, ...TERRAIN_LABELS[kind] };
      }
    }
    return { kind: 'clear', ...TERRAIN_LABELS.clear };
  });
}

export interface MarchStepResult {
  /** Distance gained this step (can be negative for mud). */
  distanceDelta: number;
  /** Stamina change this step (negative = cost, positive = gain). */
  staminaDelta: number;
  /** Narrative message for this step. */
  message: string;
}

/**
 * Resolve one tile step, given the current terrain and chosen pace.
 * Stamina is floored at 0 by the caller; the caller also checks for end-of-march.
 */
export function marchStep(tile: TerrainTile, pace: MarchPace): MarchStepResult {
  switch (pace) {
    case 'rest':
      return {
        distanceDelta: 0,
        staminaDelta: tile.kind === 'spring' ? MARCH_MAX_STA : 2, // spring restores full
        message:
          tile.kind === 'spring'
            ? 'You drink from the spring and feel restored.'
            : 'You rest a moment and catch your breath.',
      };
    case 'walk': {
      const staMod = tile.kind === 'spring' ? 1 : tile.kind === 'rough' ? -2 : -1;
      const distMod = tile.kind === 'mud' ? 0 : 1;
      return {
        distanceDelta: distMod,
        staminaDelta: tile.kind === 'spring' ? staMod + 2 : staMod, // spring gives bonus
        message:
          tile.kind === 'rough'
            ? 'The rough ground drains you as you trudge through.'
            : tile.kind === 'mud'
              ? 'The mud clings to your boots; you barely make progress.'
              : tile.kind === 'spring'
                ? 'The spring water refreshes you as you pass.'
                : 'You march at a steady pace.',
      };
    }
    case 'push': {
      const staMod = tile.kind === 'spring' ? -1 : tile.kind === 'rough' ? -4 : -3;
      const distMod = tile.kind === 'mud' ? 1 : 2;
      return {
        distanceDelta: distMod,
        staminaDelta: tile.kind === 'spring' ? staMod + 2 : staMod,
        message:
          tile.kind === 'rough'
            ? 'You push hard through brutal terrain — it costs you dearly.'
            : tile.kind === 'mud'
              ? 'You force your way through the mud at great effort.'
              : tile.kind === 'spring'
                ? 'You gulp from the spring mid-stride.'
                : 'You surge forward, burning hard.',
      };
    }
  }
}

/**
 * Score = tiles completed (where any step taken = 1 tile) / MARCH_TILES.
 * Reaching the end gives a perfect 1.0.
 */
export function marchScore(tilesCompleted: number): number {
  return Math.min(1, tilesCompleted / MARCH_TILES);
}
