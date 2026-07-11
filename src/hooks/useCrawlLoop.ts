// The generic real-time input loop shared by the Deep Mine and the Wild Forest.
// Holds no game state — it just decides *when* to fire a crawler's discrete store
// actions (move / strike / cast / dash / tap-act / monster-tick) based on a
// requestAnimationFrame clock and which keys/buttons are held. All rules live in the
// pure engine; this is purely the "when". Game-specific bits (store action names, run
// field access, tuning constants) come in through `CrawlLoopCaps` — see useMiningLoop.ts
// and useForestLoop.ts for the two instantiations. Forest-only seams are the optional
// caps: `ownTile` (shrines), `intentTargetId` (ranged guest intents), and
// `face`/`rangedTapDir` (tap-to-shoot aiming).
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Dir } from '@/engine/crawl';
import { CHARGE_SWING_COUNT, DASH_BASE_CD_MS, CHARGE_DAMAGE_MULT, boonChargeReduce } from '@/engine/crawl';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
};

export interface CrawlLoopControls {
  /** Begin holding a direction (on-screen D-pad press). */
  press: (dir: Dir) => void;
  /** Release a held direction. */
  release: (dir: Dir) => void;
  /** Queue a single strike. */
  swing: () => void;
  /** Release a held charge (touch pointer-up/leave/cancel) — mirrors the keyboard keyup
   *  reset so touch players can deliberately charge instead of firing one phantom heavy
   *  swing (MINI-18). */
  releaseCharge: () => void;
  /** Queue a dash in the currently-faced direction. */
  dash: () => void;
  /** Cast a spell by key (from ability bar buttons). */
  castSpell: (key: string) => void;
  /** Tap a board tile: own tile = the Space context action, adjacent = face + strike
   *  or step, farther = ranged shot when the caps support it. Invalid taps are
   *  ignored; cadence gates match held keys so tapping can never out-pace them. */
  tapAct: (r: number, c: number) => void;
  /** Live charge progress for the overlay's charge indicator: mine's pip UI reads
   *  `swings`/`max`, forest's smooth bar reads `progress01`. Read-only ref, updated every rAF frame. */
  chargeRef: MutableRefObject<{ active: boolean; swings: number; max: number; progress01: number }>;
  /** rAF-clock timestamp of the most recent strike (normal or charged) — drives an
   *  avatar swing animation. Read-only ref; the overlay polls it, not React state, so a
   *  strike doesn't force a re-render. */
  swingAtRef: MutableRefObject<number>;
}

/** Game-specific seam a crawler's loop plugs into — see useMiningLoop.ts for the mine's caps. */
export interface CrawlLoopCaps<TRun> {
  /** Read the current run from the store (mine: s.mining). */
  getRun: () => TRun | null;
  isActive: (run: TRun) => boolean;
  player: (run: TRun) => { r: number; c: number; facing: Dir };
  knownSpells: (run: TRun) => string[];
  activeBoons: (run: TRun) => string[];
  dashCooldownMs: (run: TRun) => number | undefined;
  lastDashMs: (run: TRun) => number | undefined;
  moveIntervalMs: (run: TRun) => number | undefined;
  weaponAttackStat: (run: TRun) => string;
  meleePower: (run: TRun) => number;
  rangedPower: (run: TRun) => number;
  floor: (run: TRun) => number;
  tileAt: (run: TRun, r: number, c: number) => unknown;

  canDescend: (run: TRun) => boolean;
  facedCell: (run: TRun) => { r: number; c: number };
  /** The id of the unit (monster/beast) in the faced cell — guards descend priority. */
  facedTargetId: (run: TRun) => string | null;
  /** Co-op guest attack-intent target — defaults to facedTargetId. Forest widens it
   *  to include the first beast down the faced ranged line (rangedBeastId). */
  intentTargetId?: (run: TRun) => string | null;
  /** Should a tap on this cell strike (mine/attack) rather than walk? */
  tapStrikeable: (run: TRun, r: number, c: number) => boolean;
  /** Optional own-tile context action (forest shrines) — tried after descend and the
   *  guest attack intent, before the generic strike. The loop broadcasts the consumed
   *  tile to the co-op party, mirroring the strike path's tile diffing. */
  ownTile?: { isOn: (run: TRun) => boolean; act: (nowMs: number, isGuest: boolean) => void };
  /** Turn in place without stepping (ranged tap aiming). */
  face?: (dir: Dir) => void;
  /** Ranged tap resolution: direction to face + fire for a beyond-adjacent tap, or null to ignore. */
  rangedTapDir?: (run: TRun, r: number, c: number) => Dir | null;

  // Actions — each resolves the current run from the store internally.
  move: (dir: Dir) => void;
  strike: (nowMs: number) => void;
  strikeCharged: (nowMs: number) => void;
  dash: (dir: Dir, nowMs: number) => void;
  cast: (spellKey: string, nowMs: number) => void;
  tick: (nowMs: number, coPlayers?: ReadonlyArray<{ r: number; c: number }>) => void;
  coopClientTick: (nowMs: number) => void;
  descend: () => void;

  /** Broadcast a locally-mined/harvested tile change to the co-op party. */
  broadcastTile: (floor: number, r: number, c: number, tile: unknown) => void;

  /** Fallback move cadence when run state has no moveIntervalMs (old saves). */
  moveIntervalFallbackMs: number;
  /** Minimum gap between strikes (ms) so holding the key doesn't burn stamina at 60fps. */
  swingIntervalMs: number;
  /** How often to advance the monster/beast clock (ms). */
  monsterTickMs: number;
}

/** Drives an active crawler run. Mount once inside the run overlay. */
export function useCrawlLoop<TRun>(caps: CrawlLoopCaps<TRun>): CrawlLoopControls {
  const held = useRef<Set<Dir>>(new Set());
  const lastDir = useRef<Dir | null>(null);
  const strikeQueued = useRef(false);
  const dashQueued = useRef(false);
  const spellQueue = useRef<string | null>(null);
  // Board tap awaiting resolution — processed in the loop against the live run.
  const tapQueue = useRef<{ r: number; c: number } | null>(null);
  // Charge tracking: timestamp when Space was first pressed (reset on each new press).
  const spaceDownAt = useRef<number | null>(null);
  const chargeConsumed = useRef(false);
  // Exposed to the overlay for the charge-progress indicator.
  const chargeProgressRef = useRef<{ active: boolean; swings: number; max: number; progress01: number }>({ active: false, swings: 0, max: 2, progress01: 0 });
  // Exposed to the overlay for the avatar swing animation.
  const swingAtRef = useRef<number>(0);

  // Keep the latest caps visible to the rAF loop's closure without re-mounting the
  // event listeners on every render (mirrors useMiningLoop's original empty-deps effect).
  const capsRef = useRef(caps);
  capsRef.current = caps;

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
        const run = capsRef.current.getRun();
        if (run) {
          const idx = parseInt(e.key, 10) - 1;
          const spell = capsRef.current.knownSpells(run)[idx];
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
    // Alt-tab/window blur can drop a keyup, leaving a direction stuck held (auto-walk on return).
    const onBlur = () => { held.current.clear(); lastDir.current = null; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let raf = 0;
    let lastMove = 0;
    let lastSwing = 0;
    let lastTick = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const c = capsRef.current;
      let run = c.getRun();
      if (!run || !c.isActive(run) || document.hidden) {
        chargeProgressRef.current = { active: false, swings: 0, max: 2, progress01: 0 };
        tapQueue.current = null; // a tap must never fire into a later game state
        return;
      }

      // Spell cast (instant, gated by spell's own cooldown in the engine)
      if (spellQueue.current) {
        c.cast(spellQueue.current, now);
        spellQueue.current = null;
      }

      // Dash — fires once on Shift press in the currently-held direction, falling back to facing.
      // Manual-QA: holding a direction + Shift dashes that way; nothing held dashes toward facing.
      if (dashQueued.current) {
        dashQueued.current = false;
        const heldDir =
          lastDir.current && held.current.has(lastDir.current)
            ? lastDir.current
            : held.current.size > 0
              ? [...held.current][0]
              : null;
        const dir = heldDir ?? c.player(run).facing;
        const cd = c.dashCooldownMs(run) ?? DASH_BASE_CD_MS;
        const lastDash = c.lastDashMs(run) ?? -cd;
        if (now - lastDash >= cd) {
          c.dash(dir, now);
        }
      }

      // AG-scaled move interval from run state (falls back to constant for old saves).
      const moveMs = c.moveIntervalMs(run) ?? c.moveIntervalFallbackMs;

      // Tap-to-act: resolve a queued board tap into face / step / strike using the
      // same cadence gates as held keys, so tapping can never out-pace holding them.
      if (tapQueue.current) {
        const t = tapQueue.current;
        const p = c.player(run);
        const dr = t.r - p.r;
        const dc = t.c - p.c;
        const man = Math.abs(dr) + Math.abs(dc);
        if (man === 0) {
          // Own tile — exactly a Space press: the strike block below applies the
          // descend / own-tile / strike precedence.
          tapQueue.current = null;
          strikeQueued.current = true;
        } else if (man === 1) {
          if (now - lastMove >= moveMs) {
            tapQueue.current = null;
            const dir: Dir = dr === 1 ? 'down' : dr === -1 ? 'up' : dc === 1 ? 'right' : 'left';
            // Decide strike-vs-step from the tapped tile BEFORE moving (an ice slide
            // can carry the player away; the intent is what was under the finger).
            const strikeable = c.tapStrikeable(run, t.r, t.c);
            c.move(dir); // bump semantics: steps onto open ground, otherwise turns to face
            lastMove = now;
            const after = c.getRun();
            if (!after || !c.isActive(after)) return;
            run = after;
            if (strikeable) strikeQueued.current = true;
          }
          // else: stays queued and fires when the move cadence next allows (≤150ms).
        } else {
          // Beyond adjacency: only a ranged tap (forest bows) can resolve it.
          tapQueue.current = null;
          const dir = c.rangedTapDir?.(run, t.r, t.c);
          if (dir && c.face) {
            c.face(dir);
            const after = c.getRun();
            if (after && c.isActive(after)) {
              run = after;
              strikeQueued.current = true;
            }
          }
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
      const activeBoons = c.activeBoons(run) ?? [];
      const chargeReduce = boonChargeReduce(activeBoons);
      const effectiveChargeCount = Math.max(1, CHARGE_SWING_COUNT - chargeReduce);

      // Update charge-progress ref for the overlay indicator (mine reads the discrete
      // swings/max pips; forest reads the smooth progress01 bar).
      {
        const chargeActive = spaceDownAt.current !== null && !chargeConsumed.current;
        const heldFor = now - (spaceDownAt.current ?? now);
        chargeProgressRef.current = {
          active: chargeActive,
          swings: chargeActive
            ? Math.min(effectiveChargeCount, Math.floor(heldFor / c.swingIntervalMs))
            : 0,
          max: effectiveChargeCount,
          progress01: chargeActive ? Math.min(1, heldFor / (effectiveChargeCount * c.swingIntervalMs)) : 0,
        };
      }
      if (
        spaceDownAt.current !== null &&
        !chargeConsumed.current &&
        now - spaceDownAt.current >= effectiveChargeCount * c.swingIntervalMs &&
        now - lastSwing >= c.swingIntervalMs
      ) {
        chargeConsumed.current = true;
        lastSwing = now;
        // A monster/beast in the faced cell takes priority over auto-descend — otherwise
        // standing on the shaft while fighting silently swaps Space's attack for a descend.
        const chargedIntent = isGuest ? (c.intentTargetId ?? c.facedTargetId)(run) : null;
        if (c.canDescend(run) && !c.facedTargetId(run) && (!inCoop || isHost)) {
          c.descend();
        } else if (chargedIntent) {
          swingAtRef.current = now;
          const dmg = (c.weaponAttackStat(run) === 'DX' ? c.rangedPower(run) : c.meleePower(run)) * CHARGE_DAMAGE_MULT;
          coop.send?.({ type: 'attack', userId: myId ?? 'anon', monsterId: chargedIntent, dmg });
        } else if (c.ownTile?.isOn(run)) {
          // Own-tile context action (forest shrines): consume it and broadcast the
          // changed tile so co-op peers can't re-activate it.
          const { r: pr, c: pc } = c.player(run);
          const before = c.tileAt(run, pr, pc);
          c.ownTile.act(now, isGuest);
          if (inCoop) {
            const after0 = c.getRun();
            const after = after0 ? c.tileAt(after0, pr, pc) : undefined;
            if (after && after !== before) {
              c.broadcastTile(c.floor(run), pr, pc, after);
            }
          }
        } else {
          swingAtRef.current = now;
          const { r, c: fc } = c.facedCell(run);
          const before = c.tileAt(run, r, fc);
          c.strikeCharged(now);
          if (inCoop) {
            const after0 = c.getRun();
            const after = after0 ? c.tileAt(after0, r, fc) : undefined;
            if (after && after !== before) {
              c.broadcastTile(c.floor(run), r, fc, after);
            }
          }
        }
      }

      if (strikeQueued.current && now - lastSwing >= c.swingIntervalMs) {
        strikeQueued.current = false;
        lastSwing = now;
        // The host leads the descent in co-op (guests follow via the world slice);
        // solo descends freely. A guest can never change the floor itself.
        const targetId = isGuest ? (c.intentTargetId ?? c.facedTargetId)(run) : null;
        if (c.canDescend(run) && !c.facedTargetId(run) && (!inCoop || isHost)) {
          c.descend();
        } else if (targetId) {
          // A guest doesn't damage its local copy; it sends an attack intent the host
          // resolves (so a kill + loot happen exactly once).
          swingAtRef.current = now;
          const dmg = c.weaponAttackStat(run) === 'DX' ? c.rangedPower(run) : c.meleePower(run);
          coop.send?.({ type: 'attack', userId: myId ?? 'anon', monsterId: targetId, dmg });
        } else if (c.ownTile?.isOn(run)) {
          // Own-tile context action (forest shrines): consume it and broadcast the
          // changed tile so co-op peers can't re-activate it.
          const { r: pr, c: pc } = c.player(run);
          const before = c.tileAt(run, pr, pc);
          c.ownTile.act(now, isGuest);
          if (inCoop) {
            const after0 = c.getRun();
            const after = after0 ? c.tileAt(after0, pr, pc) : undefined;
            if (after && after !== before) {
              c.broadcastTile(c.floor(run), pr, pc, after);
            }
          }
        } else {
          // Mining/harvesting (or host/solo hitting a monster/beast). Act locally, then
          // broadcast the changed cell so the node disappears for the whole party.
          swingAtRef.current = now;
          const { r, c: fc } = c.facedCell(run);
          const before = c.tileAt(run, r, fc);
          c.strike(now);
          if (inCoop) {
            const after0 = c.getRun();
            const after = after0 ? c.tileAt(after0, r, fc) : undefined;
            if (after && after !== before) {
              c.broadcastTile(c.floor(run), r, fc, after);
            }
          }
        }
      }

      if (held.current.size && now - lastMove >= moveMs) {
        // Favour the most recently pressed direction when several are held.
        const dir =
          lastDir.current && held.current.has(lastDir.current)
            ? lastDir.current
            : [...held.current][0];
        c.move(dir);
        lastMove = now;
      }
      if (now - lastTick >= c.monsterTickMs) {
        if (isHost) {
          // Host simulates monsters/beasts against all players on this floor (nearest-target).
          const coPlayers = Object.values(coop.remotePlayers)
            .filter((p) => p.floor === c.floor(run))
            .map((p) => ({ r: p.r, c: p.c }));
          c.tick(now, coPlayers);
        } else if (isGuest) {
          // Guest advances only its own body; the host owns monster/beast movement.
          c.coopClientTick(now);
        } else {
          c.tick(now);
        }
        lastTick = now;
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
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
    releaseCharge: () => {
      spaceDownAt.current = null;
      chargeConsumed.current = false;
    },
    dash: () => { dashQueued.current = true; },
    castSpell: (key) => {
      spellQueue.current = key;
    },
    tapAct: (r, c) => {
      tapQueue.current = { r, c };
    },
    chargeRef: chargeProgressRef,
    swingAtRef,
  };
}
