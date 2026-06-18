// The Arena's real-time clock. Like useForestLoop it holds no game state — it just decides *when*
// to fire the store's discrete arena actions (move / act / boss tick) off a requestAnimationFrame
// clock and which keys/buttons are held. All rules live in the pure engine (src/engine/arena.ts).
//
// Keyboard movement uses the four W/A/S/D (or arrow) axis keys: each moves one cardinal direction
// on its own, and holding two adjacent keys moves diagonally — W+A = upLeft, W+D = upRight,
// S+A = downLeft, S+D = downRight. Opposing keys cancel. Space/Enter = context attack. Spells/items
// fire on press (they self-gate on MP / qty / cooldown). The on-screen ArenaControls pad bypasses
// all this and presses a direction directly.
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import type { Dir } from '@/engine/grid';
import type { Cell } from '@/engine/grid';

type Axis = 'up' | 'down' | 'left' | 'right';

const KEY_AXES: Record<string, Axis> = {
  w: 'up', s: 'down', a: 'left', d: 'right',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

/** Turn the currently-held axis keys into a square-grid direction (null = no valid move). */
function dirFromAxes(axes: Set<Axis>): Dir | null {
  // Opposing keys cancel each other out.
  const up = axes.has('up') && !axes.has('down');
  const down = axes.has('down') && !axes.has('up');
  const left = axes.has('left') && !axes.has('right');
  const right = axes.has('right') && !axes.has('left');
  if (up && left) return 'upLeft';
  if (up && right) return 'upRight';
  if (down && left) return 'downLeft';
  if (down && right) return 'downRight';
  if (up) return 'up';
  if (down) return 'down';
  if (left) return 'left';
  if (right) return 'right';
  return null;
}

/** How often a held direction advances one hex (ms). */
const MOVE_INTERVAL_MS = 150;
/** Minimum gap between Act presses (the engine also enforces a per-action cooldown). */
const ACT_INTERVAL_MS = 200;
/** How often we advance the boss/telegraph/projectile clock (ms). */
const TICK_MS = 90;

export interface ArenaControlsApi {
  press: (dir: Dir) => void;
  release: (dir: Dir) => void;
  /** Queue a single context attack (melee / ranged bolt). Optional dir pre-sets facing. */
  act: (dir?: Dir) => void;
  /** Explicit melee swing. Optional dir pre-sets facing. */
  melee: (dir?: Dir) => void;
  /** Explicit ranged bolt. Optional dir pre-sets facing. */
  ranged: (dir?: Dir) => void;
  /** Cast a known spell immediately. Optional dir pre-sets facing; target used for rune placement. */
  cast: (spellKey: string, opts?: { dir?: Dir; target?: Cell }) => void;
  /** Use a battle item immediately. */
  useItem: (itemKey: string) => void;
}

/** Drives an active Arena run. Mount once inside the run overlay. */
export function useArenaLoop(): ArenaControlsApi {
  const heldAxes = useRef<Set<Axis>>(new Set()); // keyboard
  const heldDirs = useRef<Set<Dir>>(new Set()); // on-screen pad
  const lastTouchDir = useRef<Dir | null>(null);
  const actQueued = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const axis = KEY_AXES[e.key];
      if (axis) {
        heldAxes.current.add(axis);
        e.preventDefault();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        actQueued.current = true;
        e.preventDefault();
        return;
      }
      // Digit keys 1–9: quick-fire spells (in knownSpells order) then items.
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const store = useGameStore.getState();
        const run = store.arena;
        if (!run || run.status !== 'active') return;
        const idx = parseInt(e.key) - 1;
        const itemKeys = Object.entries(run.inventory).filter(([, n]) => n > 0).map(([k]) => k);
        if (idx < run.knownSpells.length) {
          store.arenaCast(run.knownSpells[idx], performance.now());
        } else {
          const itemIdx = idx - run.knownSpells.length;
          if (itemIdx < itemKeys.length) store.arenaUseItem(itemKeys[itemIdx], performance.now());
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const axis = KEY_AXES[e.key];
      if (axis) heldAxes.current.delete(axis);
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
      const run = store.arena;
      if (!run || run.status !== 'active' || document.hidden) return;

      if (actQueued.current && now - lastAct >= ACT_INTERVAL_MS) {
        actQueued.current = false;
        lastAct = now;
        store.arenaAct(now);
      }
      if (now - lastMove >= MOVE_INTERVAL_MS) {
        // A held touch direction wins; otherwise derive from the keyboard axis keys.
        const touch =
          lastTouchDir.current && heldDirs.current.has(lastTouchDir.current)
            ? lastTouchDir.current
            : heldDirs.current.size
              ? [...heldDirs.current][0]
              : null;
        const dir = touch ?? dirFromAxes(heldAxes.current);
        if (dir) {
          store.arenaMove(dir);
          lastMove = now;
        }
      }
      if (now - lastTick >= TICK_MS) {
        store.arenaTick(now);
        lastTick = now;
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      heldAxes.current.clear();
      heldDirs.current.clear();
    };
  }, []);

  return {
    press: (dir) => {
      heldDirs.current.add(dir);
      lastTouchDir.current = dir;
    },
    release: (dir) => heldDirs.current.delete(dir),
    act: (dir) => {
      if (dir) {
        // Fire immediately with the given direction — do NOT also queue or the loop fires it again
        // dir-less on the next tick, which would double-attack and drain stamina twice.
        useGameStore.getState().arenaAct(performance.now(), dir);
      } else {
        actQueued.current = true;
      }
    },
    melee: (dir) => useGameStore.getState().arenaMelee(performance.now(), dir),
    ranged: (dir) => useGameStore.getState().arenaRanged(performance.now(), dir),
    cast: (spellKey, opts) => useGameStore.getState().arenaCast(spellKey, performance.now(), opts),
    useItem: (itemKey) => useGameStore.getState().arenaUseItem(itemKey, performance.now()),
  };
}
