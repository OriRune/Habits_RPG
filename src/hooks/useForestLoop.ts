// The forest's real-time clock. It holds no game state — it just decides *when* to fire the
// store's discrete forest actions (move / act / beast tick) based on a requestAnimationFrame
// clock and which keys/buttons are held. All rules live in the pure engine (src/engine/forest.ts).
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { canAdvance, type Dir } from '@/engine/forest';

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
};

/** How often a held direction advances one cell (ms) — the tile-step cadence. */
const MOVE_INTERVAL_MS = 150;
/** Minimum gap between blade swings / gathers (ms) so holding the key doesn't burn stamina at 60fps. */
const ACT_INTERVAL_MS = 240;
/** How often we advance the beast clock (ms). */
const BEAST_TICK_MS = 120;

export interface ForestControlsApi {
  /** Begin holding a direction (on-screen D-pad press). */
  press: (dir: Dir) => void;
  /** Release a held direction. */
  release: (dir: Dir) => void;
  /** Queue a single act (slash / gather / cut). */
  act: () => void;
}

/** Drives an active Wild Forest run. Mount once inside the run overlay. */
export function useForestLoop(): ForestControlsApi {
  const held = useRef<Set<Dir>>(new Set());
  const lastDir = useRef<Dir | null>(null);
  const actQueued = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const dir = KEY_DIRS[e.key];
      if (dir) {
        held.current.add(dir);
        lastDir.current = dir;
        e.preventDefault();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        actQueued.current = true;
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const dir = KEY_DIRS[e.key];
      if (dir) held.current.delete(dir);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    let raf = 0;
    let lastMove = 0;
    let lastAct = 0;
    let lastTick = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const store = useGameStore.getState();
      const run = store.forest;
      if (!run || run.status !== 'active' || document.hidden) return;

      if (actQueued.current && now - lastAct >= ACT_INTERVAL_MS) {
        actQueued.current = false;
        lastAct = now;
        // On the tree line, the action key pushes deeper instead of slashing thin air.
        if (canAdvance(run)) store.forestAdvance();
        else store.forestAct();
      }
      if (held.current.size && now - lastMove >= MOVE_INTERVAL_MS) {
        // Favour the most recently pressed direction when several are held.
        const dir =
          lastDir.current && held.current.has(lastDir.current)
            ? lastDir.current
            : [...held.current][0];
        store.forestMove(dir);
        lastMove = now;
      }
      if (now - lastTick >= BEAST_TICK_MS) {
        store.forestTick(now);
        lastTick = now;
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      held.current.clear();
    };
  }, []);

  return {
    press: (dir) => {
      held.current.add(dir);
      lastDir.current = dir;
    },
    release: (dir) => held.current.delete(dir),
    act: () => {
      actQueued.current = true;
    },
  };
}
