// Hex Tactics token art — full-color procedural SVG mini-creatures for the board.
//
// Design language (32×32 viewBox, authored FACING RIGHT): opaque fills, dark outline via
// group stroke + paintOrder:stroke so silhouettes pop on textured tiles at 26–50px, a
// top-left rim-light accent on the main mass, and a ground-shadow ellipse for weight.
// Palettes are per-creature but share family DNA: undead bone+spectral teal, beast
// russet+ivory, construct slate/bark/moss, elemental ice+core glow.
//
// Real PNG art auto-overrides via the existing resolveSpriteImage seam ('boss:<templateId>',
// 'avatar:<classId>') — drop a file in src/assets/sprites/ and the procedural token yields.
import type { CSSProperties, ReactNode } from 'react';
import { resolveSpriteImage } from '@/lib/sprites';

export interface TokenPalette {
  base: string;    // main body mass
  shade: string;   // shadowed underside / secondary mass
  light: string;   // lit highlights / face
  outline: string; // silhouette stroke
  accent: string;  // eyes, glow, weapon — the token's "read me" color
}

const RIM = 'rgba(255,255,255,0.35)';

/** Darken a #rrggbb color by a factor (0..1). Class tints arrive as hex from the stat chart. */
function darkenHex(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (v: number) => Math.round(v * f);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

export const PALETTES: Record<string, TokenPalette> = {
  // Catacombs — undead: bone + spectral teal
  skeleton:       { base: '#e6dcc0', shade: '#b0a37e', light: '#f6efd9', outline: '#241c10', accent: '#7fd8d0' },
  wisp:           { base: '#a8c4f0', shade: '#6f8fd0', light: '#e6f2ff', outline: '#1c2440', accent: '#20263e' },
  ghoul:          { base: '#7a945f', shade: '#556b41', light: '#a3bd85', outline: '#1c2412', accent: '#d3f06a' },
  draugr_mage:    { base: '#35487c', shade: '#243258', light: '#5a6fa8', outline: '#101828', accent: '#a8e0ff' },
  frost_revenant: { base: '#cfe2f0', shade: '#8fb3cc', light: '#eef7ff', outline: '#1c3040', accent: '#57b8e8' },
  // Overgrown Ruins — beasts: russet/green + ivory
  goblin:         { base: '#5d9141', shade: '#41682c', light: '#83b562', outline: '#16240c', accent: '#e8443a' },
  goblin_shaman:  { base: '#4a7a3e', shade: '#33572a', light: '#6fa15a', outline: '#122009', accent: '#c084fc' },
  giant_spider:   { base: '#3a3242', shade: '#241e2c', light: '#5c5270', outline: '#100c16', accent: '#e8443a' },
  dire_wolf:      { base: '#7a7a8e', shade: '#565666', light: '#a5a5ba', outline: '#1c1c26', accent: '#f0a13c' },
  corrupt_huorn:  { base: '#5a4326', shade: '#3c2c18', light: '#7a5f3a', outline: '#160f06', accent: '#e8443a' },
  thornling:      { base: '#4e7d3a', shade: '#365726', light: '#6fa14c', outline: '#101c08', accent: '#e8d44a' },
  // Frozen Caverns — ice beasts / constructs / elementals
  frost_troll:    { base: '#7f9fb8', shade: '#5a7590', light: '#a8c6da', outline: '#141f2c', accent: '#f6efd9' },
  ice_wolf:       { base: '#9fc0da', shade: '#6e93b3', light: '#cde5f5', outline: '#16242f', accent: '#57b8e8' },
  ice_wisp:       { base: '#a5d5ee', shade: '#6ba3c8', light: '#e2f5ff', outline: '#12242e', accent: '#ffffff' },
  stone_sentry:   { base: '#8a8f9a', shade: '#5e636e', light: '#b2b7c2', outline: '#181b20', accent: '#7fd8d0' },
  ice_elemental:  { base: '#8fcbe8', shade: '#5a94b8', light: '#d1eefc', outline: '#10222e', accent: '#ffffff' },
};

// --- Small shared pieces --------------------------------------------------------------------

/** Two round eyes (most creatures) — the accent color is what makes a token instantly readable. */
function eyes(x1: number, x2: number, y: number, r: number, color: string): ReactNode {
  return (
    <g stroke="none">
      <circle cx={x1} cy={y} r={r} fill={color} />
      <circle cx={x2} cy={y} r={r} fill={color} />
    </g>
  );
}

/** Top-left rim-light arc over a roughly circular mass. */
function rim(cx: number, cy: number, r: number): ReactNode {
  return <path d={`M ${cx - r * 0.8} ${cy - r * 0.5} A ${r} ${r} 0 0 1 ${cx + r * 0.25} ${cy - r * 0.95}`} fill="none" stroke={RIM} strokeWidth={1.3} strokeLinecap="round" />;
}

/** Shared wolf rig — a prowling profile, head low and hackles up; dire and ice wolves differ
 *  only in palette + breath accent. */
function wolf(p: TokenPalette, frosty: boolean): ReactNode {
  return (
    <>
      {/* tail — bushy, swept back and up */}
      <path d="M6 18 Q2.5 15.5 3 10.5" fill="none" stroke={p.base} strokeWidth={2.8} strokeLinecap="round" />
      {/* body — sleek line from raised haunch down to the lowered chest */}
      <path d="M5.5 24.5 Q4.5 16.5 11 15 Q16 13 21 14.5 L24 16.5 L23.5 22 Q16 25.5 8 25 Z" fill={p.base} />
      <path d="M7 24.5 Q6.5 19 10.5 17 L11.5 24.8 Z" fill={p.shade} stroke="none" />
      {/* hackles along the spine */}
      <path d="M9.5 15.2 l-0.8 -2 M13 14.2 l-0.5 -2 M16.5 13.8 l-0.2 -2" fill="none" stroke={p.shade} strokeWidth={1.2} strokeLinecap="round" />
      {/* ears — sharp, swept back */}
      <path d="M20 13.5 L18 6.5 L23 10.5 Z" fill={p.base} />
      <path d="M23.5 12 L23.5 6 L27 10.8 Z" fill={p.shade} />
      {/* head — lowered wedge, hunting posture */}
      <path d="M20 13 L27 13.5 L31.5 17.5 L27 19 L21 18 Z" fill={p.base} />
      {/* open jaw + fangs */}
      <path d="M26 19 L31 17.8 L30 21.5 L25.5 21 Z" fill={p.light} />
      <path d="M26 19 L31 17.8 L30.2 20 L25.8 20 Z" fill="#3a1216" stroke="none" />
      <path d="M27 19.3 l0.4 1.2 M28.6 18.9 l0.4 1.2" fill="none" stroke="#f2ead2" strokeWidth={0.85} strokeLinecap="round" />
      {/* nose + slanted predator eye */}
      <circle cx={31} cy={17.3} r={1} fill={p.outline} stroke="none" />
      <path d="M23.2 15 L25.6 15.8" stroke={p.accent} strokeWidth={1.5} strokeLinecap="round" />
      {/* legs — slim, mid-stride */}
      <path d="M8.5 24.5 L7.5 29 M12 25 L12.5 29 M19.5 23.5 L18.5 28.5 M22.5 22.5 L24 28" fill="none" stroke={p.shade} strokeWidth={1.9} strokeLinecap="round" />
      {frosty && <path d="M29 21.5 q2.2 0.4 3 2.2 M28 22.8 q1.6 0.7 2.2 2.2" fill="none" stroke={p.accent} strokeWidth={0.8} strokeLinecap="round" opacity={0.85} />}
      {/* rim light hugging the spine */}
      <path d="M9.5 16.5 Q13 14.2 17.5 14.2" fill="none" stroke={RIM} strokeWidth={1.2} strokeLinecap="round" />
    </>
  );
}

/** Shared hero rig — cloaked adventurer with sword; the cloak takes the class tint. */
function heroRig(cloak: string, cloakShade: string): ReactNode {
  return (
    <>
      {/* cloak sweeping behind */}
      <path d="M10 29 Q7 20 11 12 L16 9 L19 12 Q15 20 15.5 29 Z" fill={cloakShade} />
      {/* legs */}
      <path d="M14 22 L13 29 M18 22 L19 29" fill="none" stroke="#4a3624" strokeWidth={2.6} strokeLinecap="round" />
      {/* torso — leather cuirass */}
      <path d="M12.5 13 L19.5 13 L20.5 22 L12 22 Z" fill="#8a6a42" />
      <path d="M12.5 13 L19.5 13 L20 17 L12.3 17 Z" fill="#a5854f" stroke="none" />
      {/* belt */}
      <path d="M12.2 19.5 L20.2 19.5" stroke="#3c2c18" strokeWidth={1.4} />
      {/* sword arm forward + blade */}
      <path d="M19.5 15 Q23.5 16 25 18.5" fill="none" stroke="#8a6a42" strokeWidth={2.4} strokeLinecap="round" />
      <path d="M25 18.5 L30.5 10.5" stroke="#cfd6de" strokeWidth={1.7} strokeLinecap="round" />
      <path d="M24 16.8 L26.6 19.6" stroke="#7a5f3a" strokeWidth={1.5} strokeLinecap="round" />
      {/* head + hair */}
      <circle cx={16.5} cy={9} r={4.2} fill="#e8bd8f" />
      <path d="M12.5 8 Q13 4.5 17 4.8 Q20.5 5 20.5 8.5 L19 7.2 Q17 6 14.5 7.5 Z" fill="#5a4326" />
      {/* eye looking right */}
      <circle cx={18.2} cy={9} r={0.9} fill="#241c10" stroke="none" />
      {/* cloak clasp over the shoulder */}
      <path d="M12.5 13 Q16 11.5 19.5 13 L19 15.5 Q16 14 13 15.5 Z" fill={cloak} />
      <circle cx={16} cy={13.6} r={0.9} fill="#e8d44a" stroke="none" />
      {rim(16.5, 9, 4.2)}
    </>
  );
}

// --- The bestiary ------------------------------------------------------------------------------

export const TOKEN_ART: Record<string, (p: TokenPalette) => ReactNode> = {
  skeleton: (p) => (
    <>
      {/* legs */}
      <path d="M13.5 22 L12.5 29 M18.5 22 L19.5 29" fill="none" stroke={p.shade} strokeWidth={2} strokeLinecap="round" />
      {/* pelvis + ribcage */}
      <path d="M12.5 20 L19.5 20 L18.5 23 L13.5 23 Z" fill={p.shade} />
      <path d="M12 12.5 L20 12.5 L19 20 L13 20 Z" fill={p.base} />
      <path d="M13 14.5 h6 M13.2 16.5 h5.6 M13.4 18.5 h5.2" fill="none" stroke={p.shade} strokeWidth={0.9} />
      {/* sword arm raised */}
      <path d="M20 14 Q24 12.5 25.5 9.5" fill="none" stroke={p.base} strokeWidth={2} strokeLinecap="round" />
      <path d="M25.5 9.5 L29 3.5" stroke="#9aa8b5" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M24.2 8 L27 11" stroke={p.shade} strokeWidth={1.3} strokeLinecap="round" />
      {/* shield arm */}
      <path d="M12 14 Q9 15 8.5 18" fill="none" stroke={p.base} strokeWidth={2} strokeLinecap="round" />
      {/* skull */}
      <circle cx={16} cy={8.5} r={4.6} fill={p.base} />
      <path d="M14 12.2 L18 12.2 L17.5 14 L14.5 14 Z" fill={p.light} />
      {eyes(14.4, 17.8, 8.2, 1.2, p.outline)}
      <circle cx={14.4} cy={8} r={0.45} fill={p.accent} stroke="none" />
      <circle cx={17.8} cy={8} r={0.45} fill={p.accent} stroke="none" />
      {rim(16, 8.5, 4.6)}
    </>
  ),

  wisp: (p) => (
    <>
      {/* spectral flame body, tapering tail */}
      <path d="M16 3.5 Q23 7 22.5 14.5 Q22 20 18 22.5 Q19.5 25 17.5 28 Q16 25.5 14.5 28 Q13 25 14.5 22.5 Q10 20 9.5 14 Q9.5 7 16 3.5 Z" fill={p.base} />
      <path d="M16 6.5 Q20.5 9 20 14.5 Q19.5 18.5 16.5 20.5 Q13 18.5 12.5 14 Q12.5 9 16 6.5 Z" fill={p.light} stroke="none" />
      {/* wailing face */}
      {eyes(13.8, 18.2, 12.5, 1.4, p.accent)}
      <ellipse cx={16} cy={16.5} rx={1.6} ry={2.4} fill={p.accent} stroke="none" />
      {rim(16, 10, 6.5)}
    </>
  ),

  ghoul: (p) => (
    <>
      {/* hunched body, spine ridge showing */}
      <path d="M9 29 Q6.5 19 13 15.5 Q18.5 12.5 22.5 16 Q25.5 19 24.5 23.5 L24 29 Z" fill={p.base} />
      <path d="M10.5 29 Q9.5 22 13.5 18.5 L15 29 Z" fill={p.shade} stroke="none" />
      <path d="M11.5 16.8 l-0.5 -1.8 M14.5 15.2 l-0.3 -1.8 M17.8 14.6 l0 -1.8" fill="none" stroke={p.shade} strokeWidth={1.1} strokeLinecap="round" />
      {/* exposed ribs on the flank */}
      <path d="M17 19 q3 0.6 5.3 -0.4 M16.5 21.5 q3.2 0.7 5.8 -0.3" fill="none" stroke={p.shade} strokeWidth={1} strokeLinecap="round" />
      {/* head thrust forward — sunken pits with a sickly glow */}
      <circle cx={23.5} cy={11.5} r={4.3} fill={p.base} />
      <circle cx={22} cy={10.8} r={1.7} fill={p.outline} stroke="none" />
      <circle cx={26} cy={11.2} r={1.7} fill={p.outline} stroke="none" />
      <circle cx={22.2} cy={10.8} r={0.75} fill={p.accent} stroke="none" />
      <circle cx={26.2} cy={11.2} r={0.75} fill={p.accent} stroke="none" />
      {/* slack jaw */}
      <path d="M21.5 14.5 l1.2 1.3 l1.5 -1 l1.3 1.2 l1.3 -1.1" fill="none" stroke={p.outline} strokeWidth={0.9} strokeLinecap="round" />
      {/* both claws reaching — hungry */}
      <path d="M22 18.5 Q27.5 19.5 29 23.5" fill="none" stroke={p.base} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M29 23.5 l1.8 -1 M29 23.5 l2 0.5 M29 23.5 l1 1.8" fill="none" stroke={p.light} strokeWidth={1.1} strokeLinecap="round" />
      <path d="M19 20.5 Q23 23 24 26.5" fill="none" stroke={p.shade} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M24 26.5 l1.7 -0.8 M24 26.5 l1.6 0.9" fill="none" stroke={p.light} strokeWidth={1} strokeLinecap="round" />
      {/* rim light along the hump */}
      <path d="M9.5 20.5 Q11 16.8 14.5 15.4" fill="none" stroke={RIM} strokeWidth={1.2} strokeLinecap="round" />
    </>
  ),

  draugr_mage: (p) => (
    <>
      {/* robe cone */}
      <path d="M16 4 L25 29 L7 29 Z" fill={p.base} />
      <path d="M16 4 L20.5 16 L11.5 16 Z" fill={p.light} stroke="none" opacity={0.35} />
      <path d="M10 29 L16 10 L13 29 Z" fill={p.shade} stroke="none" />
      {/* hood cavity + burning eyes */}
      <ellipse cx={16} cy={9.5} rx={3.1} ry={3.6} fill="#0a1020" />
      {eyes(14.8, 17.2, 9.2, 0.9, p.accent)}
      {/* frost orb held forward */}
      <circle cx={23} cy={18} r={3.4} fill="#0e2030" />
      <circle cx={23} cy={18} r={2.3} fill={p.accent} stroke="none" opacity={0.75} />
      <circle cx={22.3} cy={17.2} r={0.9} fill="#ffffff" stroke="none" opacity={0.9} />
      {/* orb motes */}
      <circle cx={26.5} cy={14.5} r={0.6} fill={p.accent} stroke="none" />
      <circle cx={20} cy={13.5} r={0.5} fill={p.accent} stroke="none" />
      {rim(16, 8, 4.5)}
    </>
  ),

  frost_revenant: (p) => (
    <>
      {/* tattered icy shroud */}
      <path d="M16 4 Q23 7 23 15 L24 24 L21 22.5 L20 27 L17.5 24.5 L16 29 L14.5 24.5 L12 27 L11 22.5 L8 24 L9 15 Q9 7 16 4 Z" fill={p.base} />
      <path d="M16 6 Q21 8.5 21 15 L21.5 21 L16 19.5 Z" fill={p.light} stroke="none" opacity={0.6} />
      {/* ice crown */}
      <path d="M12 6.5 L13 3 L14.5 5.5 L16 2.2 L17.5 5.5 L19 3 L20 6.5" fill="none" stroke={p.accent} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" />
      {/* dark visage + eyes */}
      <ellipse cx={16} cy={10.5} rx={3} ry={3.3} fill="#122030" />
      {eyes(14.8, 17.2, 10.2, 0.9, p.accent)}
      {/* frozen heart glow */}
      <circle cx={16} cy={17} r={1.6} fill={p.accent} stroke="none" opacity={0.85} />
      {rim(16, 9, 5)}
    </>
  ),

  goblin: (p) => (
    <>
      {/* body */}
      <path d="M11 29 Q10 20 16 19 Q22 20 21.5 29 Z" fill={p.base} />
      <path d="M12.5 29 Q12 23 15 21 L15.5 29 Z" fill={p.shade} stroke="none" />
      {/* head with big pointed ears */}
      <circle cx={16} cy={13} r={5.2} fill={p.base} />
      <path d="M11.5 11.5 L5.5 8.5 L11 15 Z" fill={p.base} />
      <path d="M20.5 11.5 L26.5 8.5 L21 15 Z" fill={p.base} />
      <path d="M10.8 12 L7.5 10 L10.8 13.8 Z" fill={p.shade} stroke="none" />
      {/* mischievous face */}
      {eyes(14, 18, 12, 1.3, p.accent)}
      <path d="M13.5 15.5 Q16 17.5 18.5 15.5" fill="none" stroke={p.outline} strokeWidth={0.9} strokeLinecap="round" />
      <path d="M14.3 16.3 l0.8 1 M17 16.6 l0.7 -0.9" fill="none" stroke="#f2ead2" strokeWidth={0.8} strokeLinecap="round" />
      {/* dagger arm */}
      <path d="M21 21 Q25 20 26.5 17" fill="none" stroke={p.base} strokeWidth={2.2} strokeLinecap="round" />
      <path d="M26.5 17 L29.5 12.5" stroke="#9aa8b5" strokeWidth={1.5} strokeLinecap="round" />
      {rim(16, 13, 5.2)}
    </>
  ),

  goblin_shaman: (p) => (
    <>
      {/* robed body */}
      <path d="M16 15 L23 29 L9 29 Z" fill={p.shade} />
      <path d="M16 15 L19.5 22 L12.5 22 Z" fill={p.base} stroke="none" />
      {/* head + ears */}
      <circle cx={16} cy={11.5} r={4.6} fill={p.base} />
      <path d="M12 10.5 L6.5 8 L11.5 13 Z" fill={p.base} />
      <path d="M20 10.5 L25.5 8 L20.5 13 Z" fill={p.base} />
      {eyes(14.3, 17.7, 10.8, 1.2, p.accent)}
      {/* bone-totem staff with glowing skull */}
      <path d="M24.5 29 L25.5 12" stroke="#8a6a42" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx={25.7} cy={10} r={2.4} fill="#e6dcc0" />
      <circle cx={25} cy={9.6} r={0.6} fill={p.accent} stroke="none" />
      <circle cx={26.6} cy={9.6} r={0.6} fill={p.accent} stroke="none" />
      <path d="M23 7 q2.7 -2 5.4 0" fill="none" stroke={p.accent} strokeWidth={0.9} strokeLinecap="round" opacity={0.8} />
      {/* feather trim */}
      <path d="M12.5 15.5 l-2 2.5 M14 16.5 l-1.2 2.8" fill="none" stroke={p.accent} strokeWidth={0.9} strokeLinecap="round" />
      {rim(16, 11.5, 4.6)}
    </>
  ),

  giant_spider: (p) => (
    <>
      {/* legs — four per side, high-arched */}
      <path d="M12 18 Q6 13 4 7 M13 20 Q5 18 2.5 14 M13 22 Q6 24 4.5 28 M14.5 23 Q10 27 9.5 30" fill="none" stroke={p.shade} strokeWidth={1.7} strokeLinecap="round" />
      <path d="M20 18 Q26 13 28 7 M19 20 Q27 18 29.5 14 M19 22 Q26 24 27.5 28 M17.5 23 Q22 27 22.5 30" fill="none" stroke={p.shade} strokeWidth={1.7} strokeLinecap="round" />
      {/* abdomen with marking */}
      <ellipse cx={16} cy={21} rx={6.5} ry={5.5} fill={p.base} />
      <path d="M16 17 L18 21 L16 25 L14 21 Z" fill={p.accent} stroke="none" opacity={0.9} />
      {/* cephalothorax */}
      <circle cx={16} cy={12.5} r={4} fill={p.light} />
      {/* eye cluster */}
      {eyes(14.6, 17.4, 11.6, 1.05, p.accent)}
      {eyes(15.2, 16.8, 13.4, 0.7, p.accent)}
      {/* fangs */}
      <path d="M14.8 15.8 l-0.7 1.8 M17.2 15.8 l0.7 1.8" fill="none" stroke="#f2ead2" strokeWidth={1} strokeLinecap="round" />
      {rim(16, 21, 6.5)}
    </>
  ),

  dire_wolf: (p) => wolf(p, false),
  ice_wolf: (p) => wolf(p, true),

  corrupt_huorn: (p) => (
    <>
      {/* root splay + trunk */}
      <path d="M16 29 L10 29 Q12 26 13 23 L12 14 Q12 10 16 9.5 Q20 10 20 14 L19 23 Q20 26 22 29 Z" fill={p.base} />
      <path d="M13.5 27 Q14.5 22 14 15" fill="none" stroke={p.shade} strokeWidth={1.2} strokeLinecap="round" />
      {/* twisted branches */}
      <path d="M13 12 Q8 10 6.5 5.5 M13.5 10.5 Q11 7 11.5 3.5 M18.5 10.5 Q21.5 7 21 3 M19 12 Q24 10.5 26 6" fill="none" stroke={p.shade} strokeWidth={1.9} strokeLinecap="round" />
      {/* sickly foliage clumps */}
      <circle cx={7.5} cy={5} r={2.6} fill="#3f5a2e" />
      <circle cx={11.8} cy={3.5} r={2.4} fill="#4e6e38" />
      <circle cx={20.5} cy={3} r={2.6} fill="#3f5a2e" />
      <circle cx={25.5} cy={5.5} r={2.3} fill="#4e6e38" />
      {/* face hollow — angry glow */}
      <path d="M14 15 L15.5 18.5 L14.2 21.5 Q13 18 14 15 Z" fill="#12080299" stroke="none" />
      {eyes(14.6, 17.6, 15.5, 1.1, p.accent)}
      <path d="M14.5 19.5 Q16 21 17.5 19.5" fill="none" stroke="#120802" strokeWidth={1.1} strokeLinecap="round" />
      {rim(16, 13, 5)}
    </>
  ),

  thornling: (p) => (
    <>
      {/* thorn spikes radiating */}
      <path d="M16 8 L15 3 L18 7 Z M22 10 L26.5 6.5 L23.5 12 Z M25 17 L30 17.5 L25 20 Z M21 24 L24.5 28.5 L19.5 25.5 Z M10 24 L7 28.5 L12.5 25.5 Z M7 17 L2 17.5 L7 20 Z M10 10 L5.5 6.5 L8.5 12 Z" fill={p.shade} />
      {/* bramble ball body */}
      <circle cx={16} cy={17.5} r={8.2} fill={p.base} />
      <path d="M10.5 14 Q13 12 16 13.5 M18 21 Q21 21.5 23 19.5 M11 20 Q12.5 22 15 22.5" fill="none" stroke={p.shade} strokeWidth={1.1} strokeLinecap="round" />
      {/* bright warning eyes */}
      {eyes(13.5, 18.5, 16.5, 1.5, p.accent)}
      <circle cx={13.9} cy={16.1} r={0.5} fill={p.outline} stroke="none" />
      <circle cx={18.9} cy={16.1} r={0.5} fill={p.outline} stroke="none" />
      {/* small snarl */}
      <path d="M14.5 20.5 Q16 21.8 17.5 20.5" fill="none" stroke={p.outline} strokeWidth={0.9} strokeLinecap="round" />
      {rim(16, 17.5, 8.2)}
    </>
  ),

  frost_troll: (p) => (
    <>
      {/* stumpy legs */}
      <path d="M10 25 L15 25 L14.5 29 L10.5 29 Z" fill={p.shade} />
      {/* massive hunched torso — hump at the back, head set low at the front */}
      <path d="M7.5 26 Q4.5 15 11 9.5 Q17 5 22.5 9 L24 12 L26 22 Q22 26.5 14 26.5 Z" fill={p.base} />
      <path d="M9.5 25.5 Q7.5 17 12 12 L13.5 25.8 Z" fill={p.shade} stroke="none" />
      {/* ice spines along the hump */}
      <path d="M11 9.8 L10 5.5 L13.5 8.2 Z M15.5 7.4 L16 3.2 L18.8 7.2 Z M20.5 8.2 L23 5 L23.5 9.5 Z" fill={p.accent} stroke={p.outline} strokeWidth={0.7} />
      {/* long knuckle-walking arm planted ahead, boulder fist */}
      <path d="M23 13 Q29 15.5 29.5 22 L30 26.5 L25.5 27 L25 21.5 Q24.5 17 22 15.5 Z" fill={p.base} />
      <path d="M24.5 25 Q24.5 22.5 27 22.3 Q30.5 22.3 30.5 25.3 Q30.5 28 27.5 28 Q24.8 28 24.5 25 Z" fill={p.shade} />
      {/* low-set face — heavy brow, mean little eyes, underbite tusks */}
      <path d="M17 11.5 Q21.5 10 24.5 12.5 L24 17.5 Q20.5 19 17.5 17 Z" fill={p.light} />
      <path d="M17 12.3 L24.3 13.2" stroke={p.shade} strokeWidth={1.8} strokeLinecap="round" />
      {eyes(19, 22.5, 14.5, 0.85, '#152430')}
      <path d="M18.5 17.6 L18 14.8 M23.2 18 L23.8 15.2" stroke="#f2ead2" strokeWidth={1.4} strokeLinecap="round" />
      <path d="M18.5 16.8 Q21 18.2 23.2 17.2" fill="none" stroke={p.shade} strokeWidth={0.9} strokeLinecap="round" />
      {/* rim light along the hump */}
      <path d="M8 18 Q9.5 12 14 9.5" fill="none" stroke={RIM} strokeWidth={1.3} strokeLinecap="round" />
    </>
  ),

  ice_wisp: (p) => (
    <>
      {/* orbiting shards */}
      <path d="M6.5 12 L4.5 10 L7.5 9.5 Z" fill={p.base} />
      <path d="M26 11 L28.5 9 L27.5 13 Z" fill={p.base} />
      <path d="M8 22 L5.5 23.5 L8.5 24.8 Z" fill={p.base} />
      {/* main crystal — hovering, no legs */}
      <path d="M16 3.5 L22.5 12 L19.5 24 L16 27 L12.5 24 L9.5 12 Z" fill={p.base} />
      <path d="M16 3.5 L19 12 L16 24 L13 12 Z" fill={p.light} stroke="none" />
      <path d="M16 3.5 L22.5 12 L19.5 24" fill="none" stroke={p.shade} strokeWidth={0.9} />
      {/* core glow */}
      <circle cx={16} cy={13.5} r={2.3} fill={p.accent} stroke="none" opacity={0.95} />
      <circle cx={16} cy={13.5} r={4} fill={p.accent} stroke="none" opacity={0.25} />
      {/* cold face */}
      {eyes(14.6, 17.4, 18, 0.8, '#12242e')}
      {rim(16, 10, 5.5)}
    </>
  ),

  stone_sentry: (p) => (
    <>
      {/* legs — squat stone blocks */}
      <path d="M10 24 L14 24 L13.5 29 L10 29 Z M18 24 L22 24 L22 29 L18.5 29 Z" fill={p.shade} />
      {/* torso slab */}
      <path d="M9 12.5 L23 12.5 L22 24 L10 24 Z" fill={p.base} />
      <path d="M9.5 13 L12 13 L11.5 23.5 L10.2 23.5 Z" fill={p.light} stroke="none" />
      {/* shoulder boulders + arms */}
      <circle cx={8.5} cy={14.5} r={2.8} fill={p.shade} />
      <circle cx={23.5} cy={14.5} r={2.8} fill={p.shade} />
      <path d="M7.5 17 L7 23 L9.5 23.5 M24.5 17 L25.5 23 L23 23.5" fill="none" stroke={p.shade} strokeWidth={2.4} strokeLinecap="round" />
      {/* head slab */}
      <path d="M12 6 L20 6 L20.5 12.5 L11.5 12.5 Z" fill={p.light} />
      {/* glowing rune eye-slit */}
      <path d="M13.5 9.5 L18.5 9.5" stroke={p.accent} strokeWidth={1.6} strokeLinecap="round" />
      {/* carved rune on the chest + moss */}
      <path d="M15 16 L17.5 16 L16 18.5 L17.5 20.5" fill="none" stroke={p.accent} strokeWidth={1} strokeLinecap="round" opacity={0.9} />
      <path d="M20 12.8 q1.6 1.8 0.4 3.6" fill="none" stroke="#5c8f3f" strokeWidth={1.2} strokeLinecap="round" opacity={0.8} />
      {rim(16, 9, 4.5)}
    </>
  ),

  ice_elemental: (p) => (
    <>
      {/* jagged crystalline body */}
      <path d="M16 3 L23 9 L21.5 16 L25 22 L20 28.5 L16 26 L12 28.5 L7 22 L10.5 16 L9 9 Z" fill={p.base} />
      <path d="M16 3 L19.5 9.5 L17 16 L16 26 L13.5 16 L12.5 9.5 Z" fill={p.light} stroke="none" />
      <path d="M16 3 L23 9 L21.5 16 M10.5 16 L9 9" fill="none" stroke={p.shade} strokeWidth={0.9} />
      {/* shard arms */}
      <path d="M9.5 13 L3.5 15.5 L9 17.5 Z" fill={p.base} />
      <path d="M22.5 13 L28.5 15.5 L23 17.5 Z" fill={p.base} />
      {/* glowing core + face */}
      <circle cx={16} cy={12} r={2} fill={p.accent} stroke="none" opacity={0.95} />
      <circle cx={16} cy={12} r={3.6} fill={p.accent} stroke="none" opacity={0.22} />
      {eyes(14.4, 17.6, 8.5, 0.85, '#10222e')}
      {rim(16, 9, 5.5)}
    </>
  ),
};

/** Does a procedural token exist for this template? (Callers fall back to the emoji glyph.) */
export function hasToken(templateId: string): boolean {
  return templateId in TOKEN_ART && templateId in PALETTES;
}

// --- Token components ----------------------------------------------------------------------------

function flipStyle(facing: 'left' | 'right'): CSSProperties {
  return {
    transform: facing === 'left' ? 'scaleX(-1)' : 'none',
    transition: 'transform 160ms ease-out',
    overflow: 'visible',
  };
}

/**
 * One board creature. `hitId` remounts the inner group (key) so the tx-hit flash keyframe
 * restarts on every fresh damage floater. PNG art wins when present (SPRITE_REGISTRY seam).
 */
export function CreatureToken({ templateId, sizePx, facing = 'right', hitId }: {
  templateId: string;
  sizePx: number;
  facing?: 'left' | 'right';
  hitId?: number;
}) {
  const png = resolveSpriteImage(`boss:${templateId}`);
  if (png) {
    return <img src={png} width={sizePx} height={sizePx} data-token={templateId} style={flipStyle(facing)} draggable={false} alt="" />;
  }
  if (!hasToken(templateId)) return null;
  const p = PALETTES[templateId];
  return (
    <svg viewBox="0 0 32 32" width={sizePx} height={sizePx} data-token={templateId} style={flipStyle(facing)} aria-hidden="true">
      <ellipse cx={16} cy={29} rx={9} ry={2.4} fill="rgba(0,0,0,0.35)" />
      <g className="tx-breathe" style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <g
          key={hitId ?? 'idle'}
          className={hitId !== undefined ? 'tx-hit' : undefined}
          stroke={p.outline}
          strokeWidth={0.9}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {TOKEN_ART[templateId](p)}
        </g>
      </g>
    </svg>
  );
}

/** The player (class-tinted cloak) or a co-op ally (fixed emerald hood). */
export function HeroToken({ variant, classId, cloakColor, sizePx, facing = 'right', hitId }: {
  variant: 'player' | 'ally';
  classId?: string | null;
  /** Class tint from avatarCrest — the player's cloak takes it; allies stay emerald. */
  cloakColor?: string;
  sizePx: number;
  facing?: 'left' | 'right';
  hitId?: number;
}) {
  const png = resolveSpriteImage(`avatar:${classId ?? 'adventurer'}`);
  if (png) {
    return <img src={png} width={sizePx} height={sizePx} data-token={`hero-${variant}`} style={flipStyle(facing)} draggable={false} alt="" />;
  }
  const cloak = variant === 'ally' ? '#2f9e6b' : (cloakColor ?? '#4c7ac9');
  const cloakShade = variant === 'ally' ? '#1f6b47' : darkenHex(cloak, 0.62);
  return (
    <svg viewBox="0 0 32 32" width={sizePx} height={sizePx} data-token={`hero-${variant}`} style={flipStyle(facing)} aria-hidden="true">
      <ellipse cx={16} cy={29} rx={8} ry={2.2} fill="rgba(0,0,0,0.35)" />
      <g className="tx-breathe" style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}>
        <g
          key={hitId ?? 'idle'}
          className={hitId !== undefined ? 'tx-hit' : undefined}
          stroke="#1c140a"
          strokeWidth={0.9}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {heroRig(cloak, cloakShade)}
        </g>
      </g>
    </svg>
  );
}
