/**
 * Color palettes — the app's themeable "skin".
 *
 * The whole UI is painted through CSS custom properties in *channel* form
 * (`--c-gold: 201 162 39`) that `tailwind.config.js` reads as
 * `rgb(var(--c-gold) / <alpha-value>)`. That means every Tailwind color class —
 * including opacity modifiers like `bg-gold/40` — resolves through these vars,
 * so swapping a palette is just "write new channel strings onto :root".
 *
 * A palette supplies only **five** base colors (role-tagged); the ~20 shade
 * tokens the UI needs are derived from them here. Stat identity colors
 * (engine/stats.ts) and the decorative jewel tones are intentionally NOT themed.
 */

/** The five role-tagged base colors a palette provides. */
export interface PaletteColors {
  /** Darkest — app background / dark wood panels; also seeds ink (text). */
  dark: string;
  /** Lightest — parchment surfaces. */
  light: string;
  /** Trim & accents (gold). */
  gold: string;
  /** Secondary accent (the "sandy"/mid tone). Currently informational only. */
  secondary: string;
  /** Primary action / alert color (ember). */
  ember: string;
}

export interface Palette {
  id: string;
  name: string;
  colors: PaletteColors;
}

/** Whether to render a light (day) or dark (night) theme.
 *  Same palette hues — only lightness targets invert. */
export type ThemeMode = 'light' | 'dark';

interface ModeTargets {
  /** Clamp parchment (surface) base lightness — light mode pushes up, dark mode forces down. */
  parchBaseL: (l: number) => number;
  /** Lightness deltas applied to parchment DEFAULT/100/200/300/400. */
  parchSteps: [number, number, number, number, number];
  /** Absolute lightness for ink/text DEFAULT, muted, light. */
  inkBaseL: number;
  inkMutedL: number;
  inkLightL: number;
  /** Clamp wood (dark bars/backdrop) base lightness. */
  woodBaseL: (l: number) => number;
  /** Lightness deltas for wood DEFAULT/900/800/700/600/500. */
  woodSteps: [number, number, number, number, number, number];
  /** Absolute lightness for body background. */
  bodyL: number;
}

/**
 * Per-mode lightness targets. Light-mode values reproduce the index.css
 * baseline exactly (no rounding drift). Dark mode inverts panel/text lightness
 * while preserving each role's hue, so any palette looks coherent either way.
 */
const MODE_TARGETS: Record<ThemeMode, ModeTargets> = {
  light: {
    parchBaseL: (l) => Math.max(l, 0.8),
    parchSteps: [0, 0.05, 0, -0.08, -0.16],
    inkBaseL: 0.16, inkMutedL: 0.32, inkLightL: 0.44,
    woodBaseL: (l) => Math.min(l, 0.22),
    woodSteps: [0, -0.06, -0.03, 0, 0.08, 0.16],
    bodyL: 0.06,
  },
  dark: {
    // Panels become dark raised surfaces; text becomes light. Hue is preserved.
    parchBaseL: () => 0.18,   // ignore source lightness; force panels dark
    parchSteps: [0, 0.03, 0, -0.04, -0.07],
    inkBaseL: 0.90, inkMutedL: 0.72, inkLightL: 0.58,
    woodBaseL: (l) => Math.min(l, 0.12),
    woodSteps: [0, -0.04, -0.02, 0, 0.05, 0.10],
    bodyL: 0.04,
  },
};

// ---------------------------------------------------------------------------
// Color math (no dependencies). Works in HSL for perceptual lighten/darken.
// ---------------------------------------------------------------------------

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Parse #rgb / #rrggbb / #rrggbbaa (alpha ignored). Returns null if invalid. */
export function hexToRgb(hex: string): Rgb | null {
  const m = hex.trim().replace(/^#/, '');
  let r: number, g: number, b: number;
  if (/^[0-9a-fA-F]{3}$/.test(m)) {
    r = parseInt(m[0] + m[0], 16);
    g = parseInt(m[1] + m[1], 16);
    b = parseInt(m[2] + m[2], 16);
  } else if (/^[0-9a-fA-F]{6}$/.test(m) || /^[0-9a-fA-F]{8}$/.test(m)) {
    r = parseInt(m.slice(0, 2), 16);
    g = parseInt(m.slice(2, 4), 16);
    b = parseInt(m.slice(4, 6), 16);
  } else {
    return null;
  }
  return { r, g, b };
}

/** Normalize any accepted hex to canonical lowercase `#rrggbb` (drops alpha). */
export function normalizeHex(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(hue(h + 1 / 3) * 255),
    g: Math.round(hue(h) * 255),
    b: Math.round(hue(h - 1 / 3) * 255),
  };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Channel string Tailwind expects, e.g. "201 162 39". */
function channel(rgb: Rgb): string {
  return `${rgb.r} ${rgb.g} ${rgb.b}`;
}

/** Return `hex` with its HSL lightness shifted by `dl` (absolute, e.g. +0.08). */
function shiftL(hsl: Hsl, dl: number): Rgb {
  return hslToRgb({ ...hsl, l: clamp01(hsl.l + dl) });
}

/** Return `hsl` with lightness forced to `l`. */
function atL(hsl: Hsl, l: number): Rgb {
  return hslToRgb({ ...hsl, l: clamp01(l) });
}

/** Perceived luminance (0..255) for sorting/role assignment. */
function luminance(rgb: Rgb): number {
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

// ---------------------------------------------------------------------------
// Derivation: 5 base colors -> the full channel-form token map.
// ---------------------------------------------------------------------------

/**
 * Map a palette's five base colors to every themeable `--c-*` var (channel form).
 *
 * In light mode (default) the exact index.css baseline values are reproduced.
 * In dark mode panel/text lightness targets invert while hues are preserved,
 * so any palette produces a coherent dark theme with zero per-component changes.
 *
 * Jewel and stat colors are deliberately omitted — they stay fixed, preserving
 * their identity meaning.
 */
export function deriveThemeVars(colors: PaletteColors, mode: ThemeMode = 'light'): Record<string, string> {
  const t = MODE_TARGETS[mode];
  const dark = rgbToHsl(hexToRgb(colors.dark) ?? { r: 36, g: 23, b: 16 });
  const light = rgbToHsl(hexToRgb(colors.light) ?? { r: 243, g: 231, b: 201 });
  const gold = rgbToHsl(hexToRgb(colors.gold) ?? { r: 201, g: 162, b: 39 });
  const ember = rgbToHsl(hexToRgb(colors.ember) ?? { r: 156, g: 58, b: 37 });

  // Wood base = darkest bars and backdrop — clamped darker in dark mode.
  const woodBase: Hsl = { ...dark, l: t.woodBaseL(dark.l) };
  // Parch base = panel surfaces — uses the `light` role's hue clamped by mode.
  // Light mode: forced very light. Dark mode: forced dark so panels read as
  // raised surfaces against the even-darker body, while palette hue shows.
  const parchBase: Hsl = { ...light, l: t.parchBaseL(light.l) };
  // Ink base = text — seeded from `dark`'s hue; lightness pinned per mode below.
  const inkBase: Hsl = { ...woodBase };

  const [p0, p1, p2, p3, p4] = t.parchSteps;
  const [w0, w9, w8, w7, w6, w5] = t.woodSteps;

  return {
    // Parchment — panel surfaces.
    '--c-parchment':     channel(shiftL(parchBase, p0)),
    '--c-parchment-100': channel(shiftL(parchBase, p1)),
    '--c-parchment-200': channel(shiftL(parchBase, p2)),
    '--c-parchment-300': channel(shiftL(parchBase, p3)),
    '--c-parchment-400': channel(shiftL(parchBase, p4)),

    // Ink — text on panels. Saturation capped so it reads as warm brown/cream,
    // not pure black/white. Lightness pinned per mode.
    '--c-ink':       channel(atL({ ...inkBase, s: Math.min(inkBase.s, 0.50) }, t.inkBaseL)),
    '--c-ink-muted': channel(atL({ ...inkBase, s: Math.min(inkBase.s, 0.45) }, t.inkMutedL)),
    '--c-ink-light': channel(atL({ ...inkBase, s: Math.min(inkBase.s, 0.40) }, t.inkLightL)),

    // Wood — dark bars and backdrop (700 == DEFAULT).
    '--c-wood':     channel(shiftL(woodBase, w0)),
    '--c-wood-900': channel(shiftL(woodBase, w9)),
    '--c-wood-800': channel(shiftL(woodBase, w8)),
    '--c-wood-700': channel(shiftL(woodBase, w7)),
    '--c-wood-600': channel(shiftL(woodBase, w6)),
    '--c-wood-500': channel(shiftL(woodBase, w5)),

    // Gold & Ember — identity colors, unchanged across modes.
    '--c-gold':        channel(shiftL(gold, 0)),
    '--c-gold-bright': channel(shiftL(gold, 0.15)),
    '--c-gold-deep':   channel(shiftL(gold, -0.18)),
    '--c-gold-dim':    channel(shiftL(gold, -0.28)),
    '--c-ember':        channel(shiftL(ember, 0)),
    '--c-ember-bright': channel(shiftL(ember, 0.14)),

    // Body backdrop — darkest surface.
    '--c-body-bg': channel(atL(woodBase, t.bodyL)),

    // "On-wood" text — always light (l≈0.80) in both modes so icons/labels on
    // dark wood surfaces (header, nav bar, wood panels) remain readable even when
    // the parchment-* surface tokens invert to dark in dark mode.
    '--c-on-wood': channel(atL(light, 0.80)),
  };
}

// ---------------------------------------------------------------------------
// Premade palettes (default + the four authored in colorschemes.txt).
// ---------------------------------------------------------------------------

/**
 * The existing hand-tuned theme. Its five colors are only used for the swatch
 * preview — when "default" is active we clear inline vars and let the exact
 * :root baseline (in index.css) show through, so there's zero rounding drift.
 */
export const DEFAULT_PALETTE: Palette = {
  id: 'default',
  name: 'Default',
  colors: {
    dark: '#241710',
    light: '#f3e7c9',
    gold: '#c9a227',
    secondary: '#3f6b4a',
    ember: '#9c3a25',
  },
};

export const PREMADE_PALETTES: Palette[] = [
  DEFAULT_PALETTE,
  {
    id: 'golden-summer',
    name: 'Golden Summer Glow',
    colors: {
      dark: '#0d3b66',
      light: '#faf0ca',
      gold: '#f4d35e',
      secondary: '#ee964b',
      ember: '#f95738',
    },
  },
  {
    id: 'golden-glow',
    name: 'Golden Glow',
    colors: {
      dark: '#7c6a0a',
      light: '#ffdac6',
      gold: '#fa9500',
      secondary: '#babd8d',
      ember: '#eb6424',
    },
  },
  {
    id: 'sunset-symphony',
    name: 'Sunset Symphony',
    colors: {
      dark: '#485696',
      light: '#e7e7e7',
      gold: '#f9c784',
      secondary: '#fc7a1e',
      ember: '#f24c00',
    },
  },
  {
    id: 'sunset-coral',
    name: 'Sunset Coral Hues',
    colors: {
      dark: '#2b3a67',
      light: '#fffd82',
      gold: '#ff9b71',
      secondary: '#b56b45',
      ember: '#e84855',
    },
  },
];

// ---------------------------------------------------------------------------
// Custom palette helpers.
// ---------------------------------------------------------------------------

/**
 * Assign five unordered hexes to roles by luminance + hue, so a pasted/picked
 * set produces a sane theme: darkest -> dark, lightest -> light, and the three
 * mids split into ember (most red/orange), gold (most yellow), secondary (rest).
 */
export function rolesFromHexes(hexes: string[]): PaletteColors {
  const valid = hexes.map(normalizeHex).filter((h): h is string => h !== null);
  // Fall back to the default for any short input so we never throw.
  const five = valid.length >= 5 ? valid.slice(0, 5) : [
    ...valid,
    ...[DEFAULT_PALETTE.colors.dark, DEFAULT_PALETTE.colors.light, DEFAULT_PALETTE.colors.gold,
      DEFAULT_PALETTE.colors.secondary, DEFAULT_PALETTE.colors.ember].slice(valid.length),
  ];

  const withMeta = five.map((hex) => {
    const rgb = hexToRgb(hex)!;
    return { hex, lum: luminance(rgb), hsl: rgbToHsl(rgb) };
  });
  const byLum = [...withMeta].sort((a, b) => a.lum - b.lum);
  const dark = byLum[0].hex;
  const light = byLum[byLum.length - 1].hex;
  const mids = byLum.slice(1, -1); // the three middle entries

  // hueDist to a target hue on the color wheel.
  const dist = (h: number, target: number) => {
    const d = Math.abs(((h - target + 180) % 360) - 180);
    return Math.abs(d);
  };
  const emberPick = [...mids].sort((a, b) => dist(a.hsl.h, 15) - dist(b.hsl.h, 15))[0];
  const rest = mids.filter((m) => m !== emberPick);
  const goldPick = [...rest].sort((a, b) => dist(a.hsl.h, 50) - dist(b.hsl.h, 50))[0];
  const secondaryPick = rest.filter((m) => m !== goldPick)[0];

  return {
    dark,
    light,
    gold: goldPick.hex,
    secondary: secondaryPick.hex,
    ember: emberPick.hex,
  };
}

/**
 * Pull hex colors out of pasted text — supports the colorschemes.txt format
 * (`--name: #rrggbbff;`) and plain hex lines. Returns exactly five normalized
 * `#rrggbb` colors, or null if the text doesn't contain exactly five.
 */
export function parseHexInput(text: string): string[] | null {
  const matches = text.match(/#?\b([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) ?? [];
  const colors = matches
    .map(normalizeHex)
    .filter((h): h is string => h !== null);
  return colors.length === 5 ? colors : null;
}

// ---------------------------------------------------------------------------
// Resolve + apply.
// ---------------------------------------------------------------------------

/** Minimal slice of settings this module needs (avoids a store import cycle). */
export interface PaletteSettings {
  paletteId: string;
  customPalette: PaletteColors | null;
}

export function resolvePalette(settings: PaletteSettings): Palette {
  if (settings.paletteId === 'custom' && settings.customPalette) {
    return { id: 'custom', name: 'Custom', colors: settings.customPalette };
  }
  return PREMADE_PALETTES.find((p) => p.id === settings.paletteId) ?? DEFAULT_PALETTE;
}

// `applyPalette` (the :root DOM write) moved to @/lib/palettes to keep engine/ pure (ARCH-12).
