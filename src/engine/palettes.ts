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
 * Surfaces are clamped (parchment kept light, wood/ink kept dark) so arbitrary
 * custom palettes can't collapse text-on-parchment contrast. Jewel and stat
 * colors are deliberately omitted — they fall back to the :root baseline / stay
 * fixed, preserving their identity meaning.
 */
export function deriveThemeVars(colors: PaletteColors): Record<string, string> {
  const dark = rgbToHsl(hexToRgb(colors.dark) ?? { r: 36, g: 23, b: 16 });
  const light = rgbToHsl(hexToRgb(colors.light) ?? { r: 243, g: 231, b: 201 });
  const gold = rgbToHsl(hexToRgb(colors.gold) ?? { r: 201, g: 162, b: 39 });
  const ember = rgbToHsl(hexToRgb(colors.ember) ?? { r: 156, g: 58, b: 37 });

  // Keep surfaces in a usable range regardless of the source palette.
  const woodBase: Hsl = { ...dark, l: Math.min(dark.l, 0.22) };
  const parchBase: Hsl = { ...light, l: Math.max(light.l, 0.8) };

  const vars: Record<string, string> = {
    // Parchment — light surfaces (200 == DEFAULT).
    '--c-parchment': channel(shiftL(parchBase, 0)),
    '--c-parchment-100': channel(shiftL(parchBase, 0.05)),
    '--c-parchment-200': channel(shiftL(parchBase, 0)),
    '--c-parchment-300': channel(shiftL(parchBase, -0.08)),
    '--c-parchment-400': channel(shiftL(parchBase, -0.16)),

    // Ink — text on parchment. Derived from the dark role but pinned dark for
    // contrast, with a softened saturation so it reads as warm brown, not black.
    '--c-ink': channel(atL({ ...woodBase, s: Math.min(woodBase.s, 0.5) }, 0.16)),
    '--c-ink-muted': channel(atL({ ...woodBase, s: Math.min(woodBase.s, 0.45) }, 0.32)),
    '--c-ink-light': channel(atL({ ...woodBase, s: Math.min(woodBase.s, 0.4) }, 0.44)),

    // Wood — dark background / dark panels (700 == DEFAULT).
    '--c-wood': channel(shiftL(woodBase, 0)),
    '--c-wood-900': channel(shiftL(woodBase, -0.06)),
    '--c-wood-800': channel(shiftL(woodBase, -0.03)),
    '--c-wood-700': channel(shiftL(woodBase, 0)),
    '--c-wood-600': channel(shiftL(woodBase, 0.08)),
    '--c-wood-500': channel(shiftL(woodBase, 0.16)),

    // Gold — trim & accents.
    '--c-gold': channel(shiftL(gold, 0)),
    '--c-gold-bright': channel(shiftL(gold, 0.15)),
    '--c-gold-deep': channel(shiftL(gold, -0.18)),
    '--c-gold-dim': channel(shiftL(gold, -0.28)),

    // Ember — primary actions / alerts.
    '--c-ember': channel(shiftL(ember, 0)),
    '--c-ember-bright': channel(shiftL(ember, 0.14)),

    // Body backdrop — a touch darker than the darkest wood.
    '--c-body-bg': channel(atL(woodBase, 0.06)),
  };
  return vars;
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

/**
 * Write a palette's derived vars onto :root. For the default palette we clear
 * the inline overrides instead, letting the exact stylesheet baseline show.
 */
export function applyPalette(palette: Palette): void {
  const root = document.documentElement;
  if (palette.id === 'default') {
    for (const key of Object.keys(deriveThemeVars(palette.colors))) {
      root.style.removeProperty(key);
    }
    return;
  }
  const vars = deriveThemeVars(palette.colors);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
