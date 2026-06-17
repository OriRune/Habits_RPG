// The only real-time code in the app. It holds no game state — it just decides *when*
// to fire the store's discrete mining actions (move / strike / cast / monster tick) based on a
// requestAnimationFrame clock and which keys/buttons are held. All rules live in the pure
// engine (src/engine/mining.ts); this is purely the "when".
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { canDescend, type Dir } from '@/engine/mining';

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
};

/** How often a held direction advances one cell (ms) — the tile-step cadence. */
const MOVE_INTERVAL_MS = 150;
/** Minimum gap between pick swings (ms) so holding the key doesn't burn stamina at 60fps. */
const SWING_INTERVAL_MS = 240;
/** How often we advance the monster clock (ms). */
const MONSTER_TICK_MS = 120;

export interface MiningControls {
  /** Begin holding a direction (on-screen D-pad press). */
  press: (dir: Dir) => void;
  /** Release a held direction. */
  release: (dir: Dir) => void;
  /** Queue a single pick swing. */
  swing: () => void;
  /** Cast a spell by key (from ability bar buttons). */
  castSpell: (key: string) => void;
}

/** Drives an active Deep Mine run. Mount once inside the run overlay. */
export function useMiningLoop(): MiningControls {
  const held = useRef<Set<Dir>>(new Set());
  const lastDir = useRef<Dir | null>(null);
  const strikeQueued = useRef(false);
  const spellQueue = useRef<string | null>(null);

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
        strikeQueued.current = true;
        e.preventDefault();
        return;
      }
      // Number keys 1-4 cast spell slots
      if (e.key >= '1' && e.key <= '4') {
        const store = useGameStore.getState();
        const run = store.mining;
        if (run) {
          const idx = parseInt(e.key, 10) - 1;
          const spell = run.knownSpells[idx];
          if (spell) spellQueue.current = spell;
        }
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
    let lastSwing = 0;
    let lastTick = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const store = useGameStore.getState();
      const run = store.mining;
      if (!run || run.status !== 'active' || document.hidden) return;

      // Spell cast (instant, gated by spell's own SPELL_CD_MS in the engine)
      if (spellQueue.current) {
        store.mineCast(spellQueue.current);
        spellQueue.current = null;
      }

      if (strikeQueued.current && now - lastSwing >= SWING_INTERVAL_MS) {
        strikeQueued.current = false;
        lastSwing = now;
        // On the shaft, the action key descends instead of swinging at nothing.
        if (canDescend(run)) store.mineDescend();
        else store.mineStrike();
      }
      if (held.current.size && now - lastMove >= MOVE_INTERVAL_MS) {
        // Favour the most recently pressed direction when several are held.
        const dir =
          lastDir.current && held.current.has(lastDir.current)
            ? lastDir.current
            : [...held.current][0];
        store.mineMove(dir);
        lastMove = now;
      }
      if (now - lastTick >= MONSTER_TICK_MS) {
        store.mineTick(now);
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
    swing: () => {
      strikeQueued.current = true;
    },
    castSpell: (key) => {
      spellQueue.current = key;
    },
  };
}
