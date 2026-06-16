// A small pure-CSS animated avatar for the crawl minigames (Mine & Forest).
// No art assets — just stacked divs + keyframes (see src/index.css: crawler-*).
// Modeled on RooftopChase's HeroSprite. The avatar idles (gentle breathe) and
// switches to a leg-swinging walk cycle while `moving`. It flips horizontally to
// face left, and tilts its tool when facing up/down so the direction reads.

import type { Dir } from '@/engine/crawl';

export interface CrawlerAvatarProps {
  /** 'forager' carries an axe (Forest); 'miner' carries a pickaxe (Mine). */
  variant: 'forager' | 'miner';
  facing: Dir;
  moving: boolean;
  dead?: boolean;
  /** Pixel size of the bounding cell; the avatar is drawn ~80% of this. */
  cell: number;
}

/** Per-variant palette so the forager reads green/leather and the miner reads earthy/steel. */
const PALETTE = {
  forager: {
    cloak: 'linear-gradient(135deg, #1f4d2a 60%, #2f7a40)',
    torso: '#3f7d3a',
    belt: '#5a3a1c',
    skin: '#e0b070',
    hat: '#6b4a22',
    hatBrim: '#4a3216',
    legF: '#3a2a16',
    legB: '#2a1d0f',
    boot: '#241308',
    toolHandle: '#7a5226',
    toolHead: '#b8c0c6',
  },
  miner: {
    cloak: 'linear-gradient(135deg, #3a2c1c 60%, #5a4326)',
    torso: '#9c5a2a',
    belt: '#3a2410',
    skin: '#e0b070',
    hat: '#b8862b',
    hatBrim: '#8a6320',
    legF: '#3a3530',
    legB: '#2a2520',
    boot: '#1a1410',
    toolHandle: '#7a5226',
    toolHead: '#c0c6cc',
  },
} as const;

export function CrawlerAvatar({ variant, facing, moving, dead, cell }: CrawlerAvatarProps) {
  const p = PALETTE[variant];
  // Base sprite is authored at 24×34; scale to fit ~80% of the cell.
  const scale = (cell * 0.82) / 34;
  const faceLeft = facing === 'left';

  if (dead) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ width: cell, height: cell, fontSize: cell * 0.6, lineHeight: 1 }}
      >
        <span style={{ filter: 'drop-shadow(0 0 5px rgba(255,240,200,0.5))' }}>💀</span>
      </div>
    );
  }

  const walk = moving ? 'crawler-walk 0.34s ease-in-out infinite' : 'crawler-idle 1.8s ease-in-out infinite';
  const legF = moving ? 'crawler-leg-f 0.34s ease-in-out infinite' : undefined;
  const legB = moving ? 'crawler-leg-b 0.34s ease-in-out infinite' : undefined;

  return (
    <div
      className="crawler-avatar"
      style={{
        width: cell,
        height: cell,
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        transform: faceLeft ? 'scaleX(-1)' : undefined,
      }}
    >
      <div
        style={{
          width: 24,
          height: 34,
          position: 'relative',
          transform: `scale(${scale})`,
          transformOrigin: 'bottom center',
          filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.75))',
          animation: walk,
        }}
      >
        {/* Cloak / back */}
        <div style={{
          position: 'absolute', bottom: 9, left: 1, width: 20, height: 19,
          background: p.cloak, borderRadius: '3px 3px 9px 7px',
        }} />
        {/* Tool — handle + head, slung over the shoulder */}
        <div style={{
          position: 'absolute', bottom: 6, left: 17, width: 3, height: 26,
          backgroundColor: p.toolHandle, borderRadius: 2,
          transform: 'rotate(18deg)', transformOrigin: 'bottom center',
        }} />
        {variant === 'miner' ? (
          // Pick head — a thin angled bar with two tips
          <div style={{
            position: 'absolute', bottom: 27, left: 14, width: 14, height: 3,
            backgroundColor: p.toolHead, borderRadius: 2,
            transform: 'rotate(-24deg)',
            boxShadow: 'inset 0 -1px 0 rgba(0,0,0,0.35)',
          }} />
        ) : (
          // Axe head — a small wedge
          <div style={{
            position: 'absolute', bottom: 25, left: 19, width: 7, height: 8,
            backgroundColor: p.toolHead, borderRadius: '2px 4px 4px 1px',
            transform: 'rotate(12deg)',
            boxShadow: 'inset -1px 0 0 rgba(0,0,0,0.3)',
          }} />
        )}
        {/* Torso / tabard */}
        <div style={{
          position: 'absolute', bottom: 13, left: 5, width: 14, height: 14,
          backgroundColor: p.torso, borderRadius: 3,
        }} />
        {/* Belt */}
        <div style={{
          position: 'absolute', bottom: 13, left: 5, width: 14, height: 3,
          backgroundColor: p.belt,
        }} />
        {/* Head */}
        <div style={{
          position: 'absolute', bottom: 25, left: 6, width: 12, height: 12,
          backgroundColor: p.skin, borderRadius: '50% 50% 42% 42%',
        }} />
        {/* Hat / cap */}
        <div style={{
          position: 'absolute', bottom: 33, left: 4, width: 16, height: 6,
          backgroundColor: p.hat, borderRadius: '4px 4px 0 0',
          borderBottom: `2px solid ${p.hatBrim}`,
        }} />
        {/* Front leg */}
        <div style={{
          position: 'absolute', bottom: 0, left: 6, width: 5, height: 14,
          backgroundColor: p.legF, borderRadius: '0 0 3px 3px',
          transformOrigin: 'top center',
          animation: legF,
        }} />
        {/* Back leg */}
        <div style={{
          position: 'absolute', bottom: 0, left: 12, width: 5, height: 14,
          backgroundColor: p.legB, borderRadius: '0 0 3px 3px',
          transformOrigin: 'top center',
          animation: legB,
        }} />
        {/* Boots */}
        <div style={{ position: 'absolute', bottom: 0, left: 4, width: 8, height: 4, backgroundColor: p.boot, borderRadius: '0 0 3px 3px' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 12, width: 8, height: 4, backgroundColor: p.boot, borderRadius: '0 0 3px 3px' }} />
      </div>
    </div>
  );
}
