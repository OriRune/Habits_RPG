// Shared co-op remote-player layer for the crawl minigames (Mine & Forest).
// Positions arrive over the broadcast channel (~10 Hz); each remote body is
// registered as a mover so the rAF loop interpolates it in world-pixel space
// (smooth cell-to-cell glide) and keeps the baseC0/baseR0 offset cancelled, so
// they stay locked to their cell as the camera scrolls — same path as monsters.
//
// Divergences between the two overlays are props, not hardcoded (ARCH-15):
//   - currentDepth: mine compares against `mine.floor`, forest against `forest.stage`.
//   - variant: 'miner' (pickaxe) vs 'forager' (axe).
//   - zIndex: mine draws remotes at z 9, forest at z 10 (a REAL stacking difference —
//     mine's own player is z 9, forest's own player is z 11).

import type React from 'react';
import type { PlayerSlice } from '@/net/coop/protocol';
import { CrawlerAvatar } from './CrawlerAvatar';

type RemotePlayer = PlayerSlice & { lastSeen: number };

export function RemoteCrawlers({
  remotePlayers,
  currentDepth,
  baseR0,
  baseC0,
  RENDER_VIEW,
  CELL,
  moverRefs,
  nameFor,
  variant,
  zIndex,
}: {
  remotePlayers: Record<string, RemotePlayer>;
  currentDepth: number;
  baseR0: number;
  baseC0: number;
  RENDER_VIEW: number;
  CELL: number;
  moverRefs: React.MutableRefObject<Map<string, HTMLDivElement | null>>;
  nameFor: (userId: string, username: string) => string;
  variant: 'miner' | 'forager';
  zIndex: number;
}) {
  return (
    <>
      {Object.values(remotePlayers).map((p) => {
        if (p.floor !== currentDepth) return null;
        const vj = p.c - baseC0;
        const vi = p.r - baseR0;
        if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
        return (
          <div
            key={p.userId}
            ref={(el) => {
              const id = `rp:${p.userId}`;
              if (el) moverRefs.current.set(id, el);
              else moverRefs.current.delete(id);
            }}
            className="pointer-events-none absolute"
            style={{
              width: CELL,
              height: CELL,
              zIndex,
              transform: `translate(${vj * CELL}px, ${vi * CELL}px)`,
            }}
          >
            <CrawlerAvatar variant={variant} facing={p.facing} moving dead={p.hp <= 0} cell={CELL} />
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/60 px-1 font-display text-[9px] text-gold-bright">
              {nameFor(p.userId, p.username)}
            </span>
          </div>
        );
      })}
    </>
  );
}
