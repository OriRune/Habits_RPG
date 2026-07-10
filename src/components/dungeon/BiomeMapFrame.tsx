// Per-biome decoration for the floor map (plan 4.2 / DUN-13 follow-through):
// corner flourishes, a tinted double hairline frame, and a faint watermark motif
// behind the node grid. Pure decoration — aria-hidden, pointer-events-none —
// in the same code-native SVG language as DungeonSceneArt. Each biome gets a
// distinct motif so regions read apart at a glance: bone arches (Catacombs),
// creeping vines (Ruins), ice shards (Frozen Caverns).
import type { ReactNode } from 'react';
import { getBiome } from '@/engine/biomes';

/** Corner ornament, authored for the top-left; other corners mirror it. */
function CornerArt({ biomeKey }: { biomeKey: string }): ReactNode {
  if (biomeKey === 'ruins') {
    // A vine curling out of the corner, with leaves.
    return (
      <g data-motif="vine">
        <path d="M3 46 Q6 24 20 14 Q32 6 46 4" fill="none" strokeWidth="2.4" />
        <path d="M8 34 q7-2 9 5 q-8 3-9-5 Z M16 20 q8 0 7 8 q-8 1-7-8 Z M30 9 q7-3 9 4 q-7 4-9-4 Z" strokeWidth="1.6" />
        <path d="M5 44 q4-1 5 3" fill="none" strokeWidth="1.6" />
      </g>
    );
  }
  if (biomeKey === 'frozen') {
    // Ice shards radiating from the corner, with sparkles.
    return (
      <g data-motif="ice">
        <path d="M2 2 L18 6 L8 18 Z" strokeWidth="1.8" />
        <path d="M4 22 L16 26 L9 36 Z" strokeWidth="1.6" />
        <path d="M22 3 L34 7 L26 16 Z" strokeWidth="1.6" />
        <path d="M40 4 l0 8 M36 8 l8 0 M6 42 l0 6 M3 45 l6 0" fill="none" strokeWidth="1.4" />
      </g>
    );
  }
  // Catacombs (default): bone-lined arch bricks and a small skull.
  return (
    <g data-motif="skull">
      <path d="M2 34 A32 32 0 0 1 34 2" fill="none" strokeWidth="2.4" />
      <path d="M2 46 A44 44 0 0 1 46 2" fill="none" strokeWidth="1.6" />
      <path d="M9 21 l7 7 M20 12 l5 5 M33 6 l3 6 M5 32 l8 4" fill="none" strokeWidth="1.4" />
      <path d="M10 6 a5 5 0 0 1 10 0 q0 3-2 4 l0 3 -6 0 0-3 q-2-1-2-4 Z" strokeWidth="1.5" />
      <circle cx="13" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
    </g>
  );
}

/** Large, very faint emblem behind the node grid. */
function WatermarkArt({ biomeKey }: { biomeKey: string }): ReactNode {
  if (biomeKey === 'ruins') {
    // A great leaf over a fallen column.
    return (
      <g data-motif="vine">
        <path d="M48 8 Q74 28 68 60 Q64 78 48 88 Q32 78 28 60 Q22 28 48 8 Z" strokeWidth="3" />
        <path d="M48 16 Q50 50 48 82 M48 34 l-11 8 M48 34 l11 8 M48 52 l-13 9 M48 52 l13 9" strokeWidth="2.2" />
      </g>
    );
  }
  if (biomeKey === 'frozen') {
    // A six-armed snowflake.
    return (
      <g data-motif="ice" strokeWidth="2.6">
        <path d="M48 8 V88 M13 28 L83 68 M83 28 L13 68" />
        <path d="M48 20 l-8-8 M48 20 l8-8 M48 76 l-8 8 M48 76 l8 8" />
        <path d="M24 34 l-11-2 M24 34 l-2-11 M72 62 l11 2 M72 62 l2 11" />
        <path d="M72 34 l11-2 M72 34 l2-11 M24 62 l-11 2 M24 62 l-2 11" />
      </g>
    );
  }
  // Catacombs: a large skull.
  return (
    <g data-motif="skull">
      <path d="M48 10 a26 26 0 0 1 26 26 q0 14-10 20 l0 14 -32 0 0-14 q-10-6-10-20 a26 26 0 0 1 26-26 Z" strokeWidth="3" />
      <circle cx="38" cy="38" r="6.5" strokeWidth="2.6" />
      <circle cx="58" cy="38" r="6.5" strokeWidth="2.6" />
      <path d="M48 46 l-4 8 8 0 Z M40 70 l0 8 M48 70 l0 8 M56 70 l0 8" fill="none" strokeWidth="2.6" />
    </g>
  );
}

const CORNERS = [
  '', // top-left: as authored
  'right-0 -scale-x-100',
  'bottom-0 -scale-y-100',
  'bottom-0 right-0 -scale-x-100 -scale-y-100',
];

/** Absolute overlay — the host panel must be `relative overflow-hidden`, and the
 *  panel's interactive content must sit in a positioned (`relative`) sibling so it
 *  paints above this layer. */
export function BiomeMapFrame({ biomeKey }: { biomeKey: string }) {
  const tint = getBiome(biomeKey).tint;
  return (
    <div
      aria-hidden="true"
      data-biome-frame={biomeKey}
      className="pointer-events-none absolute inset-0"
      style={{ color: tint }}
    >
      {/* double hairline frame in the biome tint */}
      <div className="absolute inset-1 rounded-md border" style={{ borderColor: tint, opacity: 0.45 }} />
      <div className="absolute inset-2 rounded border" style={{ borderColor: tint, opacity: 0.2 }} />
      {/* watermark emblem behind the grid */}
      <svg
        viewBox="0 0 96 96"
        className="absolute left-1/2 top-1/2 h-36 w-36 -translate-x-1/2 -translate-y-1/2"
        style={{ opacity: 0.12 }}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <WatermarkArt biomeKey={biomeKey} />
      </svg>
      {/* corner flourishes */}
      {CORNERS.map((pos) => (
        <svg
          key={pos}
          viewBox="0 0 48 48"
          className={`absolute h-12 w-12 ${pos}`}
          style={{ opacity: 0.4 }}
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <CornerArt biomeKey={biomeKey} />
        </svg>
      ))}
    </div>
  );
}
