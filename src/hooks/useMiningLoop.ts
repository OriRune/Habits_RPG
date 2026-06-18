// The only real-time code in the app. It holds no game state — it just decides *when*
// to fire the store's discrete mining actions (move / strike / cast / monster tick) based on a
// requestAnimationFrame clock and which keys/buttons are held. All rules live in the pure
// engine (src/engine/mining.ts); this is purely the "when".
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { canDescend, facedCell, facedMonsterId, type Dir } from '@/engine/mining';
import { CHARGE_SWING_COUNT, DASH_BASE_CD_MS } from '@/engine/crawl';
import { boonChargeReduce } from '@/content/boons';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
};

/** Fallback move cadence when run state has no moveIntervalMs (old saves). */
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
  /** Queue a dash in the currently-faced direction. */
  dash: () => void;
  /** Cast a spell by key (from ability bar buttons). */
  castSpell: (key: string) => void;
}

/** Drives an active Deep Mine run. Mount once inside the run overlay. */
export function useMiningLoop(): MiningControls {
  const held = useRef<Set<Dir>>(new Set());
  const lastDir = useRef<Dir | null>(null);
  const strikeQueued = useRef(false);
  const dashQueued = useRef(false);
  const spellQueue = useRef<string | null>(null);
  // Charge tracking: timestamp when Space was first pressed (reset on each new press).
  const spaceDownAt = useRef<number | null>(null);
  const chargeConsumed = useRef(false);

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
        if (spaceDownAt.current === null) {
          // First press this hold: record timestamp and queue a normal swing.
          spaceDownAt.current = performance.now();
          chargeConsumed.current = false;
          strikeQueued.current = true;
        }
        e.preventDefault();
        return;
      }
      // Shift + held direction → dash
      if (e.key === 'Shift') {
        dashQueued.current = true;
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
      if (dir) { held.current.delete(dir); return; }
      if (e.key === ' ' || e.key === 'Enter') {
        spaceDownAt.current = null;
        chargeConsumed.current = false;
      }
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

      // Dash — fires once on Shift press in the current facing direction.
      if (dashQueued.current) {
        dashQueued.current = false;
        const dir = lastDir.current ?? run.player.facing;
        const cd = run.dashCooldownMs ?? DASH_BASE_CD_MS;
        const lastDash = run.lastDashMs ?? -cd;
        if (now - lastDash >= cd) {
          store.mineDash(dir, now);
        }
      }

      // Co-op role for this frame (solo when not joined to a session).
      const coop = useCoopStore.getState();
      const inCoop = coop.joined && !!coop.session;
      const myId = useAuthStore.getState().session?.user?.id;
      const isHost = inCoop && coop.session!.host_id === myId;
      const isGuest = inCoop && !isHost;

      // Charge detection: if Space is still held for effectiveChargeCount intervals, fire a charged swing.
      // The Overcharge boon reduces the required hold count by 1 (minimum 1).
      const chargeReduce = run.activeBoons ? boonChargeReduce(run.activeBoons) : 0;
      const effectiveChargeCount = Math.max(1, CHARGE_SWING_COUNT - chargeReduce);
      if (
        spaceDownAt.current !== null &&
        !chargeConsumed.current &&
        now - spaceDownAt.current >= effectiveChargeCount * SWING_INTERVAL_MS &&
        now - lastSwing >= SWING_INTERVAL_MS
      ) {
        chargeConsumed.current = true;
        lastSwing = now;
        if (canDescend(run) && (!inCoop || isHost)) {
          store.mineDescend();
        } else if (isGuest && facedMonsterId(run)) {
          const dmg = (run.weapon.attackStat === 'DX' ? run.rangedPower : run.meleePower) * 1.75;
          coop.send?.({ type: 'attack', userId: myId ?? 'anon', monsterId: facedMonsterId(run)!, dmg });
        } else {
          const { r, c } = facedCell(run);
          const before = run.tiles[r]?.[c];
          store.mineStrikeCharged();
          if (inCoop) {
            const after = useGameStore.getState().mining?.tiles[r]?.[c];
            if (after && after !== before) {
              coop.send?.({ type: 'tile', userId: myId ?? 'anon', floor: run.floor, r, c, tile: after });
            }
          }
        }
      }

      if (strikeQueued.current && now - lastSwing >= SWING_INTERVAL_MS) {
        strikeQueued.current = false;
        lastSwing = now;
        // The host leads the descent in co-op (guests follow via the world slice);
        // solo descends freely. A guest can never change the floor itself.
        const monsterId = isGuest ? facedMonsterId(run) : null;
        if (canDescend(run) && (!inCoop || isHost)) {
          store.mineDescend();
        } else if (monsterId) {
          // A guest doesn't damage its local monster copy; it sends a melee intent
          // the host resolves (so a kill + loot happen exactly once).
          const dmg = run.weapon.attackStat === 'DX' ? run.rangedPower : run.meleePower;
          coop.send?.({ type: 'attack', userId: myId ?? 'anon', monsterId, dmg });
        } else {
          // Mining a rock/ore (or host/solo hitting a monster). Mine locally, then
          // broadcast the changed cell so the node disappears for the whole party.
          const { r, c } = facedCell(run);
          const before = run.tiles[r]?.[c];
          store.mineStrike();
          if (inCoop) {
            const after = useGameStore.getState().mining?.tiles[r]?.[c];
            if (after && after !== before) {
              coop.send?.({ type: 'tile', userId: myId ?? 'anon', floor: run.floor, r, c, tile: after });
            }
          }
        }
      }

      // AG-scaled move interval from run state (falls back to constant for old saves).
      const moveMs = run.moveIntervalMs ?? MOVE_INTERVAL_MS;
      if (held.current.size && now - lastMove >= moveMs) {
        // Favour the most recently pressed direction when several are held.
        const dir =
          lastDir.current && held.current.has(lastDir.current)
            ? lastDir.current
            : [...held.current][0];
        store.mineMove(dir);
        lastMove = now;
      }
      if (now - lastTick >= MONSTER_TICK_MS) {
        if (isHost) {
          // Host simulates monsters against all players on this floor (nearest-target).
          const coPlayers = Object.values(coop.remotePlayers)
            .filter((p) => p.floor === run.floor)
            .map((p) => ({ r: p.r, c: p.c }));
          store.mineTick(now, coPlayers);
        } else if (isGuest) {
          // Guest advances only its own body; the host owns monster movement.
          store.coopClientTick(now);
        } else {
          store.mineTick(now);
        }
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
      if (spaceDownAt.current === null) {
        spaceDownAt.current = performance.now();
        chargeConsumed.current = false;
      }
    },
    dash: () => { dashQueued.current = true; },
    castSpell: (key) => {
      spellQueue.current = key;
    },
  };
}
