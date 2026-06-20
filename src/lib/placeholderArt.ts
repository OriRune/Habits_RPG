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
  /** Scene key to select distinct themed art instead of the generic motif. */
  sceneKey?: string;
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
export function framedSvg({ glyph, color, label, wide, sceneKey }: FramedOpts): string {
  const svg =
    wide && sceneKey ? themedWideSvg(sceneKey, color, label) :
    wide ? wideSvg(color, label) :
    squareSvg(glyph, color, label);
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

/** Themed motif shapes for each scene key — drawn inside the 314×114 banner interior. */
function sceneMotif(key: string): string {
  switch (key) {
    case 'room:treasure':
      return (
        // Chest body + lid + coin stacks
        `<rect x="105" y="62" width="110" height="38" rx="5" fill="none" stroke="#c9a227" stroke-opacity="0.5" stroke-width="2"/>` +
        `<rect x="105" y="52" width="110" height="16" rx="5" fill="none" stroke="#c9a227" stroke-opacity="0.6" stroke-width="2"/>` +
        `<circle cx="160" cy="82" r="5" fill="#c9a227" fill-opacity="0.5"/>` +
        `<ellipse cx="225" cy="90" rx="12" ry="4" fill="#c9a227" fill-opacity="0.25"/>` +
        `<ellipse cx="225" cy="86" rx="12" ry="4" fill="#c9a227" fill-opacity="0.30"/>` +
        `<ellipse cx="225" cy="82" rx="12" ry="4" fill="#c9a227" fill-opacity="0.35"/>` +
        `<line x1="160" y1="52" x2="160" y2="62" stroke="#c9a227" stroke-opacity="0.4" stroke-width="2"/>`
      );
    case 'room:shrine':
      return (
        // Altar steps + crystal flame + light rays
        `<rect x="120" y="82" width="80" height="12" rx="2" fill="#f3e7c9" fill-opacity="0.12"/>` +
        `<rect x="130" y="70" width="60" height="14" rx="2" fill="#f3e7c9" fill-opacity="0.14"/>` +
        `<rect x="140" y="55" width="40" height="17" rx="2" fill="#f3e7c9" fill-opacity="0.17"/>` +
        `<polygon points="160,22 147,53 173,53" fill="#6b3fa0" fill-opacity="0.55" stroke="#c9a227" stroke-width="1.5" stroke-opacity="0.7"/>` +
        `<line x1="160" y1="16" x2="160" y2="6" stroke="#c9a227" stroke-opacity="0.45" stroke-width="1.5"/>` +
        `<line x1="147" y1="28" x2="138" y2="19" stroke="#c9a227" stroke-opacity="0.35" stroke-width="1.5"/>` +
        `<line x1="173" y1="28" x2="182" y2="19" stroke="#c9a227" stroke-opacity="0.35" stroke-width="1.5"/>` +
        `<line x1="136" y1="36" x2="124" y2="34" stroke="#c9a227" stroke-opacity="0.25" stroke-width="1"/>` +
        `<line x1="184" y1="36" x2="196" y2="34" stroke="#c9a227" stroke-opacity="0.25" stroke-width="1"/>`
      );
    case 'room:combat':
    case 'room:boss':
    case 'room:elite':
      return (
        // Crossed blades + guards + pommel dots
        `<line x1="105" y1="20" x2="215" y2="100" stroke="#f3e7c9" stroke-width="4" stroke-opacity="0.35" stroke-linecap="round"/>` +
        `<line x1="215" y1="20" x2="105" y2="100" stroke="#f3e7c9" stroke-width="4" stroke-opacity="0.35" stroke-linecap="round"/>` +
        `<line x1="142" y1="50" x2="178" y2="70" stroke="#c9a227" stroke-width="3.5" stroke-opacity="0.55" stroke-linecap="round"/>` +
        `<line x1="142" y1="70" x2="178" y2="50" stroke="#c9a227" stroke-width="3.5" stroke-opacity="0.55" stroke-linecap="round"/>` +
        (key === 'room:boss'
          ? `<circle cx="160" cy="12" r="10" fill="none" stroke="#f3e7c9" stroke-opacity="0.3" stroke-width="2"/>` +
            `<circle cx="160" cy="12" r="5" fill="#9c3a25" fill-opacity="0.6"/>`
          : key === 'room:elite'
            ? `<path d="M145,10 Q148,2 160,8 Q172,2 175,10 Q178,20 160,16 Q142,20 145,10Z" fill="#c97a2e" fill-opacity="0.5"/>`
            : '')
      );
    case 'room:rest':
      return (
        // Log base + campfire flame
        `<ellipse cx="160" cy="94" rx="38" ry="7" fill="#6b3a1e" fill-opacity="0.35"/>` +
        `<ellipse cx="145" cy="97" rx="28" ry="5" fill="#8a5a2e" fill-opacity="0.3" transform="rotate(-12 145 97)"/>` +
        `<path d="M146,90 Q143,68 153,52 Q158,68 168,56 Q162,74 157,90Z" fill="#c9a227" fill-opacity="0.45"/>` +
        `<path d="M153,90 Q151,75 158,62 Q165,75 163,90Z" fill="#f3e7c9" fill-opacity="0.35"/>` +
        `<circle cx="90" cy="70" r="2.5" fill="#c9a227" fill-opacity="0.4"/>` +
        `<circle cx="82" cy="55" r="1.5" fill="#c9a227" fill-opacity="0.3"/>` +
        `<circle cx="235" cy="62" r="2" fill="#c9a227" fill-opacity="0.35"/>`
      );
    case 'room:encounter':
      return (
        // Open scroll + quill
        `<rect x="128" y="18" width="64" height="82" rx="4" fill="#8a6a3a" fill-opacity="0.25" stroke="#c9a227" stroke-opacity="0.4" stroke-width="1.5"/>` +
        `<rect x="128" y="18" width="64" height="10" rx="4" fill="#c9a227" fill-opacity="0.15"/>` +
        `<rect x="128" y="90" width="64" height="10" rx="4" fill="#c9a227" fill-opacity="0.15"/>` +
        `<line x1="140" y1="40" x2="180" y2="40" stroke="#f3e7c9" stroke-opacity="0.3" stroke-width="1.5"/>` +
        `<line x1="140" y1="50" x2="180" y2="50" stroke="#f3e7c9" stroke-opacity="0.3" stroke-width="1.5"/>` +
        `<line x1="140" y1="60" x2="176" y2="60" stroke="#f3e7c9" stroke-opacity="0.25" stroke-width="1.5"/>` +
        `<line x1="140" y1="70" x2="172" y2="70" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="1.5"/>` +
        `<path d="M186,32 Q198,12 210,8 Q194,24 192,52" fill="none" stroke="#c9a227" stroke-opacity="0.45" stroke-width="1.5" stroke-linecap="round"/>`
      );
    case 'room:merchant':
      return (
        // Balance scales
        `<line x1="115" y1="45" x2="205" y2="45" stroke="#f3e7c9" stroke-opacity="0.35" stroke-width="2"/>` +
        `<line x1="160" y1="25" x2="160" y2="95" stroke="#c9a227" stroke-opacity="0.45" stroke-width="2"/>` +
        `<circle cx="160" cy="25" r="4" fill="#c9a227" fill-opacity="0.5"/>` +
        // Left pan
        `<path d="M115,45 Q115,68 95,68 Q75,68 75,45" fill="none" stroke="#f3e7c9" stroke-opacity="0.3" stroke-width="1.5"/>` +
        `<ellipse cx="95" cy="68" rx="20" ry="5" fill="#f3e7c9" fill-opacity="0.1"/>` +
        `<circle cx="95" cy="63" r="8" fill="#c9a227" fill-opacity="0.4"/>` +
        // Right pan (slightly lower for drama)
        `<path d="M205,45 Q207,62 225,62 Q243,62 245,45" fill="none" stroke="#f3e7c9" stroke-opacity="0.3" stroke-width="1.5"/>` +
        `<ellipse cx="225" cy="62" rx="20" ry="5" fill="#f3e7c9" fill-opacity="0.1"/>`
      );
    case 'dungeon:entrance':
      return (
        // Arched doorway with dark interior
        `<path d="M100,102 L100,48 Q100,14 160,14 Q220,14 220,48 L220,102" fill="none" stroke="#f3e7c9" stroke-opacity="0.3" stroke-width="2.5" stroke-linejoin="round"/>` +
        `<path d="M108,102 L108,50 Q108,22 160,22 Q212,22 212,50 L212,102" fill="#160c06" fill-opacity="0.45"/>` +
        `<line x1="100" y1="102" x2="220" y2="102" stroke="#f3e7c9" stroke-opacity="0.25" stroke-width="2.5"/>` +
        // Door frame details
        `<line x1="100" y1="102" x2="80" y2="102" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="1.5"/>` +
        `<line x1="220" y1="102" x2="240" y2="102" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="1.5"/>` +
        // Glowing eye hint inside doorway
        `<ellipse cx="160" cy="62" rx="6" ry="4" fill="#c9a227" fill-opacity="0.25"/>`
      );
    case 'dungeon:checkpoint':
      return (
        // Tent peak + campfire
        `<polygon points="160,12 100,100 220,100" fill="none" stroke="#2e8a5e" stroke-opacity="0.4" stroke-width="2"/>` +
        `<line x1="160" y1="12" x2="160" y2="100" stroke="#f3e7c9" stroke-opacity="0.15" stroke-width="1"/>` +
        `<path d="M148,95 Q147,80 154,68 Q158,80 166,72 Q162,84 156,95Z" fill="#c9a227" fill-opacity="0.35"/>` +
        `<ellipse cx="155" cy="97" rx="20" ry="5" fill="#6b3a1e" fill-opacity="0.3"/>`
      );
    case 'dungeon:cleared':
      return (
        // Crown
        `<path d="M100,92 L115,40 L140,65 L160,22 L180,65 L205,40 L220,92Z" fill="none" stroke="#c9a227" stroke-opacity="0.6" stroke-width="2.5" stroke-linejoin="round"/>` +
        `<circle cx="100" cy="92" r="4" fill="#c9a227" fill-opacity="0.6"/>` +
        `<circle cx="220" cy="92" r="4" fill="#c9a227" fill-opacity="0.6"/>` +
        `<circle cx="160" cy="22" r="6" fill="#c9a227" fill-opacity="0.7"/>` +
        `<circle cx="94" cy="36" r="3" fill="#c9a227" fill-opacity="0.4"/>` +
        `<circle cx="226" cy="36" r="3" fill="#c9a227" fill-opacity="0.4"/>`
      );
    case 'dungeon:retreat':
      return (
        // Waving retreat flag on pole
        `<line x1="140" y1="20" x2="140" y2="100" stroke="#f3e7c9" stroke-opacity="0.35" stroke-width="2.5"/>` +
        `<path d="M140,25 Q170,30 165,44 Q170,58 140,62" fill="#6b6b6b" fill-opacity="0.4" stroke="#f3e7c9" stroke-opacity="0.3" stroke-width="1.5"/>` +
        `<line x1="130" y1="100" x2="150" y2="100" stroke="#f3e7c9" stroke-opacity="0.3" stroke-width="2"/>`
      );
    case 'outcome:success':
      return (
        // Radiant star burst + sparkles
        `<circle cx="160" cy="58" r="28" fill="none" stroke="#c9a227" stroke-opacity="0.35" stroke-width="1.5"/>` +
        `<circle cx="160" cy="58" r="18" fill="#c9a227" fill-opacity="0.2"/>` +
        // Rays
        `${[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
          const r = deg * Math.PI / 180;
          const x1 = 160 + Math.round(Math.cos(r) * 22); const y1 = 58 + Math.round(Math.sin(r) * 22);
          const x2 = 160 + Math.round(Math.cos(r) * 36); const y2 = 58 + Math.round(Math.sin(r) * 36);
          return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c9a227" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round"/>`;
        }).join('')}` +
        `<circle cx="100" cy="30" r="5" fill="#c9a227" fill-opacity="0.4"/>` +
        `<circle cx="215" cy="25" r="4" fill="#c9a227" fill-opacity="0.35"/>` +
        `<circle cx="88" cy="70" r="3" fill="#c9a227" fill-opacity="0.3"/>`
      );
    case 'outcome:fail':
      return (
        // Cracked X / shatter effect
        `<line x1="108" y1="22" x2="212" y2="98" stroke="#9c3a25" stroke-width="5" stroke-opacity="0.45" stroke-linecap="round"/>` +
        `<line x1="212" y1="22" x2="108" y2="98" stroke="#9c3a25" stroke-width="5" stroke-opacity="0.45" stroke-linecap="round"/>` +
        // Cracks radiating from center
        `<path d="M160,60 L155,28 L163,48 L174,18" fill="none" stroke="#f3e7c9" stroke-opacity="0.25" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M160,60 L185,30 L172,50 L195,40" fill="none" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round"/>` +
        `<path d="M160,60 L142,92 L154,74 L138,95" fill="none" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="1.5" stroke-linecap="round"/>`
      );
    case 'outcome:partial':
      return (
        // Half-filled circle — "a partial result"
        `<circle cx="160" cy="60" r="36" fill="none" stroke="#b8860b" stroke-opacity="0.45" stroke-width="2"/>` +
        `<path d="M160,24 A36,36 0 0,1 196,60 L160,60Z" fill="#b8860b" fill-opacity="0.3"/>` +
        `<circle cx="160" cy="60" r="5" fill="#b8860b" fill-opacity="0.5"/>` +
        `<line x1="160" y1="24" x2="160" y2="96" stroke="#b8860b" stroke-opacity="0.3" stroke-width="1.5" stroke-dasharray="4 3"/>`
      );
    case 'combat:victory':
      return (
        // Trophy cup
        `<rect x="145" y="90" width="30" height="8" rx="2" fill="#c9a227" fill-opacity="0.4"/>` +
        `<rect x="150" y="75" width="20" height="17" rx="1" fill="#c9a227" fill-opacity="0.3"/>` +
        `<path d="M130,35 L130,62 Q130,82 160,82 Q190,82 190,62 L190,35Z" fill="none" stroke="#c9a227" stroke-opacity="0.55" stroke-width="2.5"/>` +
        `<path d="M130,40 Q112,40 112,58 Q112,74 130,68" fill="none" stroke="#c9a227" stroke-opacity="0.4" stroke-width="2"/>` +
        `<path d="M190,40 Q208,40 208,58 Q208,74 190,68" fill="none" stroke="#c9a227" stroke-opacity="0.4" stroke-width="2"/>` +
        `<circle cx="160" cy="28" r="8" fill="#c9a227" fill-opacity="0.35"/>`
      );
    case 'combat:defeat':
      return (
        // Skull
        `<circle cx="160" cy="50" r="30" fill="none" stroke="#f3e7c9" stroke-opacity="0.28" stroke-width="2"/>` +
        `<rect x="143" y="72" width="34" height="16" rx="4" fill="none" stroke="#f3e7c9" stroke-opacity="0.28" stroke-width="2"/>` +
        `<ellipse cx="151" cy="49" rx="7" ry="6.5" fill="#160c06" fill-opacity="0.55"/>` +
        `<ellipse cx="169" cy="49" rx="7" ry="6.5" fill="#160c06" fill-opacity="0.55"/>` +
        `<line x1="150" y1="73" x2="150" y2="86" stroke="#f3e7c9" stroke-opacity="0.35" stroke-width="2"/>` +
        `<line x1="160" y1="73" x2="160" y2="86" stroke="#f3e7c9" stroke-opacity="0.35" stroke-width="2"/>` +
        `<line x1="170" y1="73" x2="170" y2="86" stroke="#f3e7c9" stroke-opacity="0.35" stroke-width="2"/>`
      );
    case 'biome:catacombs':
      return (
        // Bone arch silhouettes — two flanking arches + scattered bones
        `<path d="M68,102 L68,60 Q68,28 108,28 Q148,28 148,60 L148,102" fill="none" stroke="#f3e7c9" stroke-opacity="0.18" stroke-width="2" stroke-linejoin="round"/>` +
        `<path d="M172,102 L172,60 Q172,28 212,28 Q252,28 252,60 L252,102" fill="none" stroke="#f3e7c9" stroke-opacity="0.18" stroke-width="2" stroke-linejoin="round"/>` +
        // Scattered bone fragments on the ground
        `<ellipse cx="160" cy="98" rx="24" ry="4" fill="#f3e7c9" fill-opacity="0.1"/>` +
        `<line x1="134" y1="96" x2="145" y2="100" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="2" stroke-linecap="round"/>` +
        `<line x1="173" y1="97" x2="186" y2="100" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="2" stroke-linecap="round"/>` +
        // Glowing eye-socket hints in the dark archways
        `<ellipse cx="108" cy="60" rx="5" ry="3" fill="#9a6bce" fill-opacity="0.22"/>` +
        `<ellipse cx="212" cy="60" rx="5" ry="3" fill="#9a6bce" fill-opacity="0.22"/>`
      );
    case 'biome:ruins':
      return (
        // Broken column stumps + vine draped across them
        `<rect x="88" y="52" width="18" height="50" rx="3" fill="none" stroke="#2e8a5e" stroke-opacity="0.25" stroke-width="2"/>` +
        `<rect x="88" y="44" width="18" height="12" rx="2" fill="#2e8a5e" fill-opacity="0.15" stroke="#2e8a5e" stroke-opacity="0.3" stroke-width="1.5"/>` +
        `<rect x="214" y="64" width="18" height="38" rx="3" fill="none" stroke="#2e8a5e" stroke-opacity="0.25" stroke-width="2"/>` +
        `<rect x="214" y="56" width="18" height="12" rx="2" fill="#2e8a5e" fill-opacity="0.15" stroke="#2e8a5e" stroke-opacity="0.3" stroke-width="1.5"/>` +
        // Vine swooping between columns
        `<path d="M106,50 Q140,28 160,32 Q180,36 214,60" fill="none" stroke="#3aa66a" stroke-opacity="0.35" stroke-width="3" stroke-linecap="round"/>` +
        // Hanging vine tendrils
        `<line x1="138" y1="30" x2="133" y2="48" stroke="#3aa66a" stroke-opacity="0.28" stroke-width="1.5"/>` +
        `<line x1="160" y1="32" x2="156" y2="52" stroke="#3aa66a" stroke-opacity="0.28" stroke-width="1.5"/>` +
        `<line x1="183" y1="36" x2="180" y2="54" stroke="#3aa66a" stroke-opacity="0.28" stroke-width="1.5"/>` +
        // Cobblestone ground hint
        `<ellipse cx="160" cy="104" rx="80" ry="6" fill="#2f5a3a" fill-opacity="0.2"/>`
      );
    case 'biome:frozen':
      return (
        // Ice spike cluster silhouettes
        `<polygon points="100,102 108,52 116,102" fill="#a8d8ea" fill-opacity="0.14" stroke="#a8d8ea" stroke-opacity="0.28" stroke-width="1.5"/>` +
        `<polygon points="114,102 125,34 136,102" fill="#a8d8ea" fill-opacity="0.18" stroke="#a8d8ea" stroke-opacity="0.32" stroke-width="1.5"/>` +
        `<polygon points="128,102 135,62 142,102" fill="#a8d8ea" fill-opacity="0.13" stroke="#a8d8ea" stroke-opacity="0.24" stroke-width="1.5"/>` +
        `<polygon points="176,102 183,58 190,102" fill="#a8d8ea" fill-opacity="0.13" stroke="#a8d8ea" stroke-opacity="0.24" stroke-width="1.5"/>` +
        `<polygon points="188,102 199,30 210,102" fill="#a8d8ea" fill-opacity="0.18" stroke="#a8d8ea" stroke-opacity="0.32" stroke-width="1.5"/>` +
        `<polygon points="204,102 212,56 220,102" fill="#a8d8ea" fill-opacity="0.14" stroke="#a8d8ea" stroke-opacity="0.28" stroke-width="1.5"/>` +
        // Aurora band — faint horizontal shimmer
        `<rect x="0" y="8" width="320" height="22" rx="0" fill="#33586b" fill-opacity="0.15"/>` +
        `<ellipse cx="160" cy="18" rx="100" ry="8" fill="#6bd4ea" fill-opacity="0.1"/>` +
        // Ice crystal sparkle hints
        `<circle cx="120" cy="20" r="2" fill="#a8d8ea" fill-opacity="0.5"/>` +
        `<circle cx="200" cy="14" r="1.5" fill="#a8d8ea" fill-opacity="0.45"/>` +
        `<circle cx="155" cy="24" r="1.5" fill="#a8d8ea" fill-opacity="0.4"/>`
      );
    default:
      return pictureMotif(1.0, 122, 8);
  }
}

// ── Per-biome full-bleed battlefield SVG ─────────────────────────────────────

/**
 * Returns an inline SVG data-URI for the battle background.
 * Designed for a 320×208 container (the h-52 battlefield div).
 * Each biome is a multi-layer scene: sky/cavern gradient, mid silhouettes, floor.
 */
export function biomeBattlefieldSvg(biomeKey?: string): string {
  let svg: string;
  switch (biomeKey) {
    case 'catacombs':
      svg = catacombsBattlefieldSvg();
      break;
    case 'ruins':
      svg = ruinsBattlefieldSvg();
      break;
    case 'frozen':
      svg = frozenBattlefieldSvg();
      break;
    default:
      svg = defaultBattlefieldSvg();
  }
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function defaultBattlefieldSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 208" preserveAspectRatio="xMidYMid slice">` +
    // Sky gradient — warm dungeon amber-brown
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#1c0f07"/>` +
    `<stop offset="55%" stop-color="#2d1a0a"/>` +
    `<stop offset="100%" stop-color="#3e2510"/>` +
    `</linearGradient>` +
    `<radialGradient id="torch" cx="50%" cy="30%" r="60%">` +
    `<stop offset="0%" stop-color="#c9a227" stop-opacity="0.08"/>` +
    `<stop offset="100%" stop-color="#c9a227" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="320" height="208" fill="url(#sky)"/>` +
    `<rect width="320" height="208" fill="url(#torch)"/>` +
    // Mid wall — rough stone blocks
    `<rect x="0" y="88" width="320" height="8" fill="#1a0e05" fill-opacity="0.6"/>` +
    // Brick-hint lines
    `${[0,32,64,96,128,160,192,224,256,288].map(x =>
      `<line x1="${x}" y1="88" x2="${x+28}" y2="88" stroke="#c9a227" stroke-opacity="0.06" stroke-width="1"/>`
    ).join('')}` +
    // Floor band
    `<rect x="0" y="160" width="320" height="48" fill="#160c04" fill-opacity="0.7"/>` +
    `<line x1="0" y1="160" x2="320" y2="160" stroke="#c9a227" stroke-opacity="0.25" stroke-width="1.5"/>` +
    // Torch flame hints on the walls
    `<ellipse cx="60" cy="82" rx="5" ry="8" fill="#c9a227" fill-opacity="0.25"/>` +
    `<ellipse cx="60" cy="78" rx="3" ry="5" fill="#f3c97a" fill-opacity="0.2"/>` +
    `<ellipse cx="260" cy="82" rx="5" ry="8" fill="#c9a227" fill-opacity="0.25"/>` +
    `<ellipse cx="260" cy="78" rx="3" ry="5" fill="#f3c97a" fill-opacity="0.2"/>` +
    // Vignette
    `<rect width="320" height="208" fill="black" fill-opacity="0.22"/>` +
    `</svg>`
  );
}

function catacombsBattlefieldSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 208" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#0e0616"/>` +
    `<stop offset="50%" stop-color="#1a0d28"/>` +
    `<stop offset="100%" stop-color="#2a1540"/>` +
    `</linearGradient>` +
    `<radialGradient id="glow1" cx="28%" cy="42%" r="32%">` +
    `<stop offset="0%" stop-color="#7a3fa0" stop-opacity="0.18"/>` +
    `<stop offset="100%" stop-color="#7a3fa0" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="glow2" cx="72%" cy="38%" r="28%">` +
    `<stop offset="0%" stop-color="#9a6bce" stop-opacity="0.15"/>` +
    `<stop offset="100%" stop-color="#9a6bce" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    // Sky
    `<rect width="320" height="208" fill="url(#sky)"/>` +
    `<rect width="320" height="208" fill="url(#glow1)"/>` +
    `<rect width="320" height="208" fill="url(#glow2)"/>` +
    // Far back: faint arch outlines
    `<path d="M40,165 L40,100 Q40,62 80,62 Q120,62 120,100 L120,165" fill="none" stroke="#9a6bce" stroke-opacity="0.1" stroke-width="1.5"/>` +
    `<path d="M200,165 L200,100 Q200,62 240,62 Q280,62 280,100 L280,165" fill="none" stroke="#9a6bce" stroke-opacity="0.1" stroke-width="1.5"/>` +
    // Mid: large gothic arch left
    `<path d="M0,165 L0,110 Q0,55 50,55 Q100,55 100,110 L100,165" fill="#0e0616" fill-opacity="0.7" stroke="#c9a227" stroke-opacity="0.2" stroke-width="2"/>` +
    // Mid: large gothic arch right
    `<path d="M220,165 L220,110 Q220,55 270,55 Q320,55 320,110 L320,165" fill="#0e0616" fill-opacity="0.7" stroke="#c9a227" stroke-opacity="0.2" stroke-width="2"/>` +
    // Eye-socket glows in arches
    `<ellipse cx="45" cy="110" rx="7" ry="5" fill="#9a6bce" fill-opacity="0.3"/>` +
    `<ellipse cx="38" cy="110" rx="3" ry="2.5" fill="#c8aaff" fill-opacity="0.4"/>` +
    `<ellipse cx="275" cy="110" rx="7" ry="5" fill="#9a6bce" fill-opacity="0.3"/>` +
    `<ellipse cx="282" cy="110" rx="3" ry="2.5" fill="#c8aaff" fill-opacity="0.4"/>` +
    // Bone pillar stumps center
    `<rect x="132" y="105" width="14" height="60" fill="#2a1540" fill-opacity="0.5" stroke="#f3e7c9" stroke-opacity="0.08" stroke-width="1"/>` +
    `<rect x="174" y="115" width="14" height="50" fill="#2a1540" fill-opacity="0.5" stroke="#f3e7c9" stroke-opacity="0.08" stroke-width="1"/>` +
    // Scattered bones on floor
    `<line x1="80" y1="160" x2="98" y2="166" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="87" y1="164" x2="91" y2="155" stroke="#f3e7c9" stroke-opacity="0.15" stroke-width="1.5" stroke-linecap="round"/>` +
    `<line x1="215" y1="158" x2="234" y2="163" stroke="#f3e7c9" stroke-opacity="0.2" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="160" cy="162" r="4" fill="#f3e7c9" fill-opacity="0.1"/>` +
    // Fog wisps
    `<ellipse cx="80" cy="148" rx="50" ry="10" fill="#6b3fa0" fill-opacity="0.08"/>` +
    `<ellipse cx="240" cy="152" rx="55" ry="9" fill="#6b3fa0" fill-opacity="0.07"/>` +
    `<ellipse cx="160" cy="145" rx="70" ry="12" fill="#2a1540" fill-opacity="0.15"/>` +
    // Floor
    `<rect x="0" y="163" width="320" height="45" fill="#0a0212" fill-opacity="0.85"/>` +
    `<line x1="0" y1="163" x2="320" y2="163" stroke="#9a6bce" stroke-opacity="0.3" stroke-width="1.5"/>` +
    // Flagstone cracks
    `<line x1="55" y1="163" x2="55" y2="208" stroke="#f3e7c9" stroke-opacity="0.05" stroke-width="1"/>` +
    `<line x1="110" y1="163" x2="115" y2="208" stroke="#f3e7c9" stroke-opacity="0.05" stroke-width="1"/>` +
    `<line x1="160" y1="163" x2="158" y2="208" stroke="#f3e7c9" stroke-opacity="0.05" stroke-width="1"/>` +
    `<line x1="210" y1="163" x2="212" y2="208" stroke="#f3e7c9" stroke-opacity="0.05" stroke-width="1"/>` +
    `<line x1="265" y1="163" x2="263" y2="208" stroke="#f3e7c9" stroke-opacity="0.05" stroke-width="1"/>` +
    `<line x1="0" y1="185" x2="320" y2="185" stroke="#f3e7c9" stroke-opacity="0.04" stroke-width="1"/>` +
    // Soul motes
    `<circle cx="105" cy="130" r="2.5" fill="#c8aaff" fill-opacity="0.45"/>` +
    `<circle cx="218" cy="120" r="2" fill="#c8aaff" fill-opacity="0.4"/>` +
    `<circle cx="155" cy="108" r="1.5" fill="#c8aaff" fill-opacity="0.35"/>` +
    `<circle cx="72" cy="138" r="1.5" fill="#9a6bce" fill-opacity="0.5"/>` +
    `<circle cx="248" cy="135" r="2" fill="#9a6bce" fill-opacity="0.45"/>` +
    // Vignette
    `<rect width="320" height="208" fill="black" fill-opacity="0.3"/>` +
    `</svg>`
  );
}

function ruinsBattlefieldSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 208" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#0a1808"/>` +
    `<stop offset="45%" stop-color="#142a10"/>` +
    `<stop offset="100%" stop-color="#1e3e18"/>` +
    `</linearGradient>` +
    `<radialGradient id="sun" cx="50%" cy="15%" r="40%">` +
    `<stop offset="0%" stop-color="#8aaa6a" stop-opacity="0.22"/>` +
    `<stop offset="100%" stop-color="#8aaa6a" stop-opacity="0"/>` +
    `</radialGradient>` +
    `</defs>` +
    // Sky
    `<rect width="320" height="208" fill="url(#sky)"/>` +
    `<rect width="320" height="208" fill="url(#sun)"/>` +
    // God-ray shafts from upper left
    `<polygon points="60,0 90,0 220,165 190,165" fill="#8aaa6a" fill-opacity="0.04"/>` +
    `<polygon points="100,0 120,0 260,165 240,165" fill="#8aaa6a" fill-opacity="0.03"/>` +
    // Collapsed column far left
    `<rect x="8" y="72" width="22" height="93" fill="#1e3e18" fill-opacity="0.7" stroke="#3aa66a" stroke-opacity="0.18" stroke-width="1.5"/>` +
    `<rect x="4" y="66" width="30" height="12" rx="2" fill="#2f5a3a" fill-opacity="0.5" stroke="#3aa66a" stroke-opacity="0.25" stroke-width="1.5"/>` +
    // Column left — partial, broken top
    `<rect x="52" y="88" width="24" height="77" fill="#1e3e18" fill-opacity="0.65" stroke="#3aa66a" stroke-opacity="0.2" stroke-width="1.5"/>` +
    `<rect x="48" y="82" width="32" height="10" rx="2" fill="#2f5a3a" fill-opacity="0.45" stroke="#3aa66a" stroke-opacity="0.22" stroke-width="1.5"/>` +
    // Broken chunk fallen beside it
    `<rect x="46" y="148" width="30" height="16" rx="3" fill="#1e3e18" fill-opacity="0.55" stroke="#3aa66a" stroke-opacity="0.15" stroke-width="1"/>` +
    // Column right — taller, leaning
    `<rect x="244" y="76" width="24" height="89" fill="#1e3e18" fill-opacity="0.65" stroke="#3aa66a" stroke-opacity="0.2" stroke-width="1.5" transform="rotate(1.5 256 165)"/>` +
    `<rect x="240" y="70" width="32" height="10" rx="2" fill="#2f5a3a" fill-opacity="0.45" stroke="#3aa66a" stroke-opacity="0.22" stroke-width="1.5"/>` +
    // Column far right — stump
    `<rect x="290" y="110" width="22" height="55" fill="#1e3e18" fill-opacity="0.6" stroke="#3aa66a" stroke-opacity="0.18" stroke-width="1.5"/>` +
    // Vine draped across the left columns (long swooping curve)
    `<path d="M8,75 Q30,42 52,55 Q80,35 108,50 Q136,30 160,38" fill="none" stroke="#3aa66a" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round"/>` +
    // Vine across right columns
    `<path d="M160,38 Q185,28 215,40 Q244,30 270,48 Q295,52 312,72" fill="none" stroke="#3aa66a" stroke-opacity="0.45" stroke-width="2.5" stroke-linecap="round"/>` +
    // Hanging vine tendrils from left vine
    `<line x1="40" y1="52" x2="35" y2="78" stroke="#3aa66a" stroke-opacity="0.35" stroke-width="1.5"/>` +
    `<line x1="75" y1="40" x2="70" y2="64" stroke="#3aa66a" stroke-opacity="0.3" stroke-width="1.5"/>` +
    `<line x1="110" y1="48" x2="106" y2="72" stroke="#3aa66a" stroke-opacity="0.3" stroke-width="1.5"/>` +
    `<line x1="140" y1="35" x2="136" y2="58" stroke="#3aa66a" stroke-opacity="0.28" stroke-width="1.5"/>` +
    // Hanging vine tendrils from right vine
    `<line x1="190" y1="33" x2="186" y2="56" stroke="#3aa66a" stroke-opacity="0.28" stroke-width="1.5"/>` +
    `<line x1="230" y1="36" x2="226" y2="60" stroke="#3aa66a" stroke-opacity="0.3" stroke-width="1.5"/>` +
    `<line x1="260" y1="43" x2="258" y2="66" stroke="#3aa66a" stroke-opacity="0.28" stroke-width="1.5"/>` +
    // Foliage clumps on the floor
    `<ellipse cx="88" cy="160" rx="22" ry="7" fill="#2a5a2a" fill-opacity="0.45"/>` +
    `<ellipse cx="85" cy="157" rx="14" ry="5" fill="#3aa66a" fill-opacity="0.2"/>` +
    `<ellipse cx="230" cy="158" rx="20" ry="7" fill="#2a5a2a" fill-opacity="0.45"/>` +
    `<ellipse cx="235" cy="155" rx="12" ry="5" fill="#3aa66a" fill-opacity="0.2"/>` +
    `<ellipse cx="160" cy="155" rx="16" ry="5" fill="#3aa66a" fill-opacity="0.12"/>` +
    // Mossy cobble floor
    `<rect x="0" y="160" width="320" height="48" fill="#0d1f0a" fill-opacity="0.85"/>` +
    `<line x1="0" y1="160" x2="320" y2="160" stroke="#3aa66a" stroke-opacity="0.35" stroke-width="1.5"/>` +
    // Cobble crack hints
    `<line x1="45" y1="163" x2="52" y2="208" stroke="#3aa66a" stroke-opacity="0.06" stroke-width="1"/>` +
    `<line x1="105" y1="163" x2="100" y2="208" stroke="#3aa66a" stroke-opacity="0.06" stroke-width="1"/>` +
    `<line x1="165" y1="163" x2="163" y2="208" stroke="#3aa66a" stroke-opacity="0.06" stroke-width="1"/>` +
    `<line x1="220" y1="163" x2="224" y2="208" stroke="#3aa66a" stroke-opacity="0.06" stroke-width="1"/>` +
    `<line x1="275" y1="163" x2="272" y2="208" stroke="#3aa66a" stroke-opacity="0.06" stroke-width="1"/>` +
    // Vignette
    `<rect width="320" height="208" fill="black" fill-opacity="0.28"/>` +
    `</svg>`
  );
}

function frozenBattlefieldSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 208" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#050e18"/>` +
    `<stop offset="40%" stop-color="#0e2035"/>` +
    `<stop offset="100%" stop-color="#162840"/>` +
    `</linearGradient>` +
    `<radialGradient id="aurora" cx="50%" cy="20%" r="55%">` +
    `<stop offset="0%" stop-color="#2ad4c8" stop-opacity="0.15"/>` +
    `<stop offset="60%" stop-color="#6bd4ea" stop-opacity="0.06"/>` +
    `<stop offset="100%" stop-color="#6bd4ea" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="#1e3550"/>` +
    `<stop offset="100%" stop-color="#0a1828"/>` +
    `</linearGradient>` +
    `</defs>` +
    // Sky
    `<rect width="320" height="208" fill="url(#sky)"/>` +
    `<rect width="320" height="208" fill="url(#aurora)"/>` +
    // Aurora ribbon bands
    `<ellipse cx="160" cy="30" rx="200" ry="18" fill="#2ad4c8" fill-opacity="0.08"/>` +
    `<ellipse cx="120" cy="48" rx="160" ry="10" fill="#7be8f8" fill-opacity="0.05"/>` +
    `<ellipse cx="200" cy="22" rx="130" ry="8" fill="#b0f0e8" fill-opacity="0.06"/>` +
    // Background stalactites (hanging from ceiling)
    `<polygon points="20,0 28,40 36,0"   fill="#a8d8ea" fill-opacity="0.08"/>` +
    `<polygon points="55,0 65,55 75,0"   fill="#a8d8ea" fill-opacity="0.1"/>` +
    `<polygon points="90,0 98,35 106,0"  fill="#a8d8ea" fill-opacity="0.07"/>` +
    `<polygon points="140,0 150,48 160,0" fill="#a8d8ea" fill-opacity="0.09"/>` +
    `<polygon points="185,0 193,38 201,0" fill="#a8d8ea" fill-opacity="0.08"/>` +
    `<polygon points="228,0 238,52 248,0" fill="#a8d8ea" fill-opacity="0.1"/>` +
    `<polygon points="268,0 276,42 284,0" fill="#a8d8ea" fill-opacity="0.08"/>` +
    `<polygon points="295,0 305,35 315,0" fill="#a8d8ea" fill-opacity="0.07"/>` +
    // Mid ice spike clusters LEFT
    `<polygon points="0,165 14,88 28,165"  fill="#a8d8ea" fill-opacity="0.2" stroke="#a8d8ea" stroke-opacity="0.3" stroke-width="1"/>` +
    `<polygon points="18,165 30,112 42,165" fill="#c8eef8" fill-opacity="0.15" stroke="#c8eef8" stroke-opacity="0.25" stroke-width="1"/>` +
    `<polygon points="34,165 44,128 54,165" fill="#a8d8ea" fill-opacity="0.18" stroke="#a8d8ea" stroke-opacity="0.28" stroke-width="1"/>` +
    `<polygon points="48,165 56,145 64,165" fill="#a8d8ea" fill-opacity="0.12"/>` +
    // Mid ice spike clusters RIGHT
    `<polygon points="256,165 264,142 272,165" fill="#a8d8ea" fill-opacity="0.12"/>` +
    `<polygon points="268,165 278,128 288,165" fill="#a8d8ea" fill-opacity="0.18" stroke="#a8d8ea" stroke-opacity="0.28" stroke-width="1"/>` +
    `<polygon points="282,165 294,110 306,165" fill="#c8eef8" fill-opacity="0.15" stroke="#c8eef8" stroke-opacity="0.25" stroke-width="1"/>` +
    `<polygon points="298,165 312,86 320,165" fill="#a8d8ea" fill-opacity="0.2" stroke="#a8d8ea" stroke-opacity="0.3" stroke-width="1"/>` +
    // Smaller center ground spikes
    `<polygon points="142,165 149,148 156,165" fill="#a8d8ea" fill-opacity="0.12"/>` +
    `<polygon points="164,165 170,144 176,165" fill="#a8d8ea" fill-opacity="0.1"/>` +
    // Ice floor
    `<rect x="0" y="163" width="320" height="45" fill="url(#floor)" fill-opacity="0.9"/>` +
    `<line x1="0" y1="163" x2="320" y2="163" stroke="#a8d8ea" stroke-opacity="0.4" stroke-width="1.5"/>` +
    // Ice sheen reflection band
    `<rect x="0" y="163" width="320" height="6" fill="#6bd4ea" fill-opacity="0.1"/>` +
    // Frost crack lines on floor
    `<line x1="60" y1="163" x2="75" y2="208" stroke="#a8d8ea" stroke-opacity="0.08" stroke-width="1"/>` +
    `<line x1="120" y1="163" x2="115" y2="208" stroke="#a8d8ea" stroke-opacity="0.07" stroke-width="1"/>` +
    `<line x1="165" y1="163" x2="162" y2="208" stroke="#a8d8ea" stroke-opacity="0.08" stroke-width="1"/>` +
    `<line x1="210" y1="163" x2="215" y2="208" stroke="#a8d8ea" stroke-opacity="0.07" stroke-width="1"/>` +
    `<line x1="258" y1="163" x2="252" y2="208" stroke="#a8d8ea" stroke-opacity="0.08" stroke-width="1"/>` +
    // Snowflake/crystal sparkle points
    `<circle cx="82" cy="55" r="2.5" fill="#c8eef8" fill-opacity="0.6"/>` +
    `<circle cx="145" cy="38" r="2" fill="#c8eef8" fill-opacity="0.55"/>` +
    `<circle cx="200" cy="60" r="2" fill="#c8eef8" fill-opacity="0.5"/>` +
    `<circle cx="240" cy="44" r="1.5" fill="#c8eef8" fill-opacity="0.6"/>` +
    `<circle cx="108" cy="72" r="1.5" fill="#a8d8ea" fill-opacity="0.5"/>` +
    `<circle cx="178" cy="50" r="1.5" fill="#a8d8ea" fill-opacity="0.45"/>` +
    `<circle cx="295" cy="65" r="2" fill="#c8eef8" fill-opacity="0.5"/>` +
    // Vignette
    `<rect width="320" height="208" fill="black" fill-opacity="0.25"/>` +
    `</svg>`
  );
}

/** Generates a wide scene banner with a theme-specific SVG motif instead of the generic landscape. */
function themedWideSvg(sceneKey: string, color: string, label?: string): string {
  const cap = label ? trim(label, 30) : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120">` +
    `<defs><radialGradient id="g" cx="50%" cy="40%" r="80%">` +
    `<stop offset="0%" stop-color="${color}"/><stop offset="100%" stop-color="#160c06"/>` +
    `</radialGradient></defs>` +
    `<rect x="3" y="3" width="314" height="114" rx="12" fill="url(#g)" stroke="#c9a227" stroke-width="3"/>` +
    sceneMotif(sceneKey) +
    (cap
      ? `<rect x="0" y="96" width="320" height="27" rx="0" fill="#160c06" fill-opacity="0.5"/>` +
        `<text x="160" y="111" text-anchor="middle" dominant-baseline="middle" ` +
        `font-family="Georgia, serif" font-size="10" letter-spacing="1.5" fill="#f3e7c9" fill-opacity="0.88">${escapeXml(cap.toUpperCase())}</text>`
      : '') +
    `</svg>`
  );
}
