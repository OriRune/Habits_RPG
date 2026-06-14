// Generated placeholder art. Until real sprites/scenes exist, this draws a "framed
// image box" as an inline SVG data-URI: a gold-rimmed, tinted panel with a faint
// picture motif (sun + mountains), a glyph, and a small label — so every art slot
// renders a real <img> that reads unmistakably as "art goes here". Real art later
// overrides these via the SPRITE_REGISTRY / SCENE_REGISTRY seams (no component change).

interface FramedOpts {
  glyph: string;
  color: string;
  label?: string;
  /** Wide (scene banner) instead of square (entity sprite). */
  wide?: boolean;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function trim(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Font size that keeps multi-letter glyphs inside the box. */
function glyphSize(glyph: string): number {
  if (glyph.length >= 3) return 22;
  if (glyph.length === 2) return 30;
  return 42;
}

/** Build an inline SVG data-URI placeholder. Deterministic for a given input. */
export function framedSvg({ glyph, color, label, wide }: FramedOpts): string {
  const svg = wide ? wideSvg(color, label) : squareSvg(glyph, color, label);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function pictureMotif(scale: number, ox: number, oy: number): string {
  // Faint sun + two mountains — the classic "image" silhouette.
  return (
    `<g transform="translate(${ox} ${oy}) scale(${scale})" stroke="#f3e7c9" stroke-opacity="0.22" ` +
    `fill="none" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">` +
    `<circle cx="70" cy="30" r="8"/>` +
    `<path d="M10 80 L38 48 L54 68"/>` +
    `<path d="M42 80 L66 50 L90 80"/>` +
    `</g>`
  );
}

function squareSvg(glyph: string, color: string, label?: string): string {
  const g = escapeXml(glyph);
  const fs = glyphSize(glyph);
  const lbl = label ? trim(label, 16).toUpperCase() : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><radialGradient id="g" cx="50%" cy="42%" r="72%">` +
    `<stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#160c06"/>` +
    `</radialGradient></defs>` +
    `<rect x="3" y="3" width="94" height="94" rx="12" fill="url(#g)" stroke="#c9a227" stroke-width="3"/>` +
    pictureMotif(0.62, 19, 12) +
    `<text x="50" y="${label ? 53 : 58}" text-anchor="middle" dominant-baseline="middle" ` +
    `font-family="Georgia, 'Times New Roman', serif" font-size="${fs}" font-weight="700" ` +
    `fill="#f6edd8" fill-opacity="0.92">${g}</text>` +
    (label
      ? `<rect x="3" y="79" width="94" height="18" rx="0" fill="#160c06" fill-opacity="0.55"/>` +
        `<text x="50" y="89" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="Georgia, serif" font-size="9" letter-spacing="0.6" fill="#f3e7c9" fill-opacity="0.85">${escapeXml(lbl)}</text>`
      : '') +
    `</svg>`
  );
}

function wideSvg(color: string, label?: string): string {
  const cap = label ? trim(label, 30) : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120">` +
    `<defs><radialGradient id="g" cx="50%" cy="40%" r="80%">` +
    `<stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#160c06"/>` +
    `</radialGradient></defs>` +
    `<rect x="3" y="3" width="314" height="114" rx="12" fill="url(#g)" stroke="#c9a227" stroke-width="3"/>` +
    pictureMotif(1.0, 122, 8) +
    `<text x="14" y="20" font-family="Georgia, serif" font-size="9" letter-spacing="1.5" ` +
    `fill="#f3e7c9" fill-opacity="0.6">IMAGE</text>` +
    (cap
      ? `<text x="160" y="70" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="Georgia, serif" font-size="19" font-weight="700" fill="#f6edd8" fill-opacity="0.92">${escapeXml(cap)}</text>`
      : '') +
    `</svg>`
  );
}
