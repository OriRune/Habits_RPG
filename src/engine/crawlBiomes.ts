// ============================================================================
//  CRAWL BIOMES — depth-band model for the Deep Mine and Wild Forest.
//
//  Each crawler is divided into named "bands" — qualitative depth tiers that
//  gate content, drive the visual palette, and (Phase 4) anchor milestone
//  bosses. Band is *derived* from floor/stage at runtime; nothing persisted.
//
//  Mine:   Rocky Caverns (1–6) → Frozen Depths (7–14) → Magma Core (15+)
//  Forest: Thicket (1–3) → Deepwood Grove (4–7) → Ancient Heart (8+)
// ============================================================================

export type MineBandId = 'rocky' | 'frozen' | 'magma';
export type ForestBandId = 'thicket' | 'deepwood' | 'ancient';

/** RGB-triplet palette used by overlay tile renderers. */
export interface CrawlPalette {
  /** Floor tile base colour [r, g, b]. */
  floor: [number, number, number];
  /** Rock / wall base colour [r, g, b]. */
  rock: [number, number, number];
  /** Accent hex string — shaft glow, ore highlights, band tint. */
  accent: string;
  /** Ambient overlay rgba string — subtle colour wash across the viewport. */
  ambient: string;
}

export interface CrawlBand<Id extends string> {
  id: Id;
  name: string;
  blurb: string;
  /** First floor/stage of this band (inclusive). */
  depthMin: number;
  /** Last floor/stage of this band (inclusive). `Infinity` on the deepest band. */
  depthMax: number;
  palette: CrawlPalette;
}

// ---------------------------------------------------------------------------
// Mine bands
// ---------------------------------------------------------------------------

export const MINE_BANDS: CrawlBand<MineBandId>[] = [
  {
    id: 'rocky',
    name: 'Rocky Caverns',
    blurb: 'Damp limestone caves rich with bronze and iron.',
    depthMin: 1,
    depthMax: 6,
    palette: {
      floor:   [42,  30,  18],
      rock:    [74,  58,  41],
      accent:  '#c9a227',
      ambient: 'rgba(180,140,80,0.06)',
    },
  },
  {
    id: 'frozen',
    name: 'Frozen Depths',
    blurb: 'Glacial tunnels where frost quartz glitters in the walls.',
    depthMin: 7,
    depthMax: 14,
    palette: {
      floor:   [18,  32,  52],
      rock:    [30,  50,  78],
      accent:  '#60c8e8',
      ambient: 'rgba(80,160,220,0.08)',
    },
  },
  {
    id: 'magma',
    name: 'Magma Core',
    blurb: 'Volcanic shafts crackling with heat and obsidian veins.',
    depthMin: 15,
    depthMax: Infinity,
    palette: {
      floor:   [52,  20,   8],
      rock:    [88,  32,  12],
      accent:  '#ff6a00',
      ambient: 'rgba(255,80,0,0.10)',
    },
  },
];

/**
 * Returns the mine band for the given floor number.
 * Clamps to the last band if deeper than its depthMin.
 */
export function bandForFloor(floor: number): CrawlBand<MineBandId> {
  return (
    MINE_BANDS.find((b) => floor >= b.depthMin && floor <= b.depthMax) ??
    MINE_BANDS[MINE_BANDS.length - 1]
  );
}

// ---------------------------------------------------------------------------
// Forest bands
// ---------------------------------------------------------------------------

export const FOREST_BANDS: CrawlBand<ForestBandId>[] = [
  {
    id: 'thicket',
    name: 'Thicket',
    blurb: 'Dense undergrowth alive with prey and wild forage.',
    depthMin: 1,
    depthMax: 3,
    palette: {
      floor:   [58,  46,  30],
      rock:    [18,  34,  14],
      accent:  '#78c04a',
      ambient: 'rgba(60,120,40,0.06)',
    },
  },
  {
    id: 'deepwood',
    name: 'Deepwood Grove',
    blurb: 'Ancient pines shade violet glowcaps and prowling shadow cats.',
    depthMin: 4,
    depthMax: 7,
    palette: {
      floor:   [42,  36,  48],
      rock:    [16,  24,  32],
      accent:  '#a070d0',
      ambient: 'rgba(100,60,180,0.07)',
    },
  },
  {
    id: 'ancient',
    name: 'Ancient Heart',
    blurb: 'Primordial groves where amber resin seeps from heartwood.',
    depthMin: 8,
    depthMax: Infinity,
    palette: {
      floor:   [62,  48,  24],
      rock:    [22,  30,  18],
      accent:  '#e8a020',
      ambient: 'rgba(220,140,20,0.08)',
    },
  },
];

/**
 * Returns the forest band for the given stage number.
 * Clamps to the last band if deeper than its depthMin.
 */
export function bandForStage(stage: number): CrawlBand<ForestBandId> {
  return (
    FOREST_BANDS.find((b) => stage >= b.depthMin && stage <= b.depthMax) ??
    FOREST_BANDS[FOREST_BANDS.length - 1]
  );
}
