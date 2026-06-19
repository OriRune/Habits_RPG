/**
 * useSmoothCamera — unified rAF motion for the Mine and Forest overlays.
 *
 * The hook owns the camera, the player sprite, and every visible mover
 * (beasts / monsters). All are interpolated in absolute world-pixel space so
 * the camera and every entity share one coherent motion curve with no per-step
 * jump and no competing CSS transitions.
 *
 * Architecture:
 *   • worldRef   — the world-container div (all tile/effect layers inside).
 *   • playerRef  — the player sprite div (translated by the hook each frame).
 *   • moverRefs  — a stable Map<id, element> populated by callback refs on
 *                  each beast / monster div. The hook writes the transform.
 *   • layoutRef  — the caller updates this every render with the current player
 *                  position, visible mover list, and snapKey.
 *
 * Motion model (per frame):
 *   1. `pp` (player pixel) advances toward (playerC * CELL, playerR * CELL) at
 *      constant velocity: speed = CELL / glideMs px/ms. It covers exactly one
 *      cell per step interval, producing uniform frame-rate-independent panning.
 *   2. Camera = clamp(pp + CELL/2, BOARD/2, map − BOARD/2) — tracks the player
 *      with the same velocity, so the avatar stays centred with no lag.
 *   3. World container:  translate3d(BOARD/2 − camX + baseC0*CELL, ...)
 *   4. Player element:   translate(pp.x − baseC0*CELL, pp.y − baseR0*CELL)
 *   5. Each mover:       advances independently at moverGlideMs; same formula.
 *
 * All transform values are snapped to the device-pixel grid before writing so
 * pixelated tile art renders crisply at any devicePixelRatio.
 *
 * Because the world-translate's +baseC0*CELL and each sprite's −baseC0*CELL
 * cancel, every element's screen position is purely a function of (interpolated
 * pixel pos, camera). When baseR0/baseC0 jump on a cameraWindow change the
 * cancellation keeps all screen positions continuous — no per-step jerk.
 *
 * Snap conditions (instant, no glide):
 *   • First frame.
 *   • layout.snapKey changed (new floor / stage → map regenerated).
 *   • Player jump > 3 cells (respawn / advance to a new entrance).
 *   • prefers-reduced-motion active.
 */

import { useEffect, useRef } from 'react';
import { shakeOffset } from '@/engine/crawl';

export interface SmoothCameraLayout {
  /** Top-left row of the rendered tile window (baseR0 = cameraR0 − MARGIN). */
  baseR0: number;
  /** Top-left col of the rendered tile window (baseC0 = cameraC0 − MARGIN). */
  baseC0: number;
  /** Player world-row. */
  playerR: number;
  /** Player world-col. */
  playerC: number;
  /** Total map rows (for clamping). */
  rows: number;
  /** Total map cols (for clamping). */
  cols: number;
  /** Visible movers (beasts / monsters) this frame. */
  movers: { id: string; r: number; c: number }[];
  /** Changes whenever the underlying map regenerates — triggers an instant snap. */
  snapKey: number | string;
}

interface Options {
  /** Pixels per tile cell. */
  CELL: number;
  /** Viewport tile count (11 → 572 px board). */
  VIEW: number;
  /**
   * Time in ms to glide across one cell (player).
   * Defaults to 150 — matches MOVE_INTERVAL_MS so the sprite arrives exactly
   * as the next step fires.
   */
  glideMs?: number;
  /**
   * Time in ms to glide across one cell (movers).
   * Defaults to 120 — matches MONSTER_TICK_MS / BEAST_TICK_MS.
   */
  moverGlideMs?: number;
}

/**
 * Advance `cur` toward `target` by at most `maxStep` px. Returns `target`
 * exactly when within range so the entity settles without micro-oscillation.
 */
function moveToward(cur: number, target: number, maxStep: number): number {
  const d = target - cur;
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
}

/**
 * Round a CSS pixel value to the nearest physical (device) pixel.
 * Prevents sub-pixel shimmer on pixelated tile art.
 */
function snapPx(v: number, dpr: number): number {
  return Math.round(v * dpr) / dpr;
}

/**
 * @param worldRef   Ref to the world-container div (translated by the hook).
 * @param playerRef  Ref to the player sprite div (translated by the hook).
 * @param moverRefs  Stable Map ref — overlay populates via callback refs on
 *                   each beast / monster div; hook reads it each frame.
 * @param layoutRef  Updated every render by the overlay with current state.
 * @param options    CELL, VIEW, and optional glide cadences.
 */
/** Opaque handle for triggering camera shake from overlays. */
export interface CameraControls {
  /** Trigger a decaying camera shake. mag is peak pixel offset; durMs defaults to 300. */
  shake: (mag: number, durMs?: number) => void;
}

export function useSmoothCamera(
  worldRef: React.RefObject<HTMLDivElement | null>,
  playerRef: React.RefObject<HTMLDivElement | null>,
  moverRefs: React.RefObject<Map<string, HTMLDivElement | null>>,
  layoutRef: React.RefObject<SmoothCameraLayout>,
  options: Options,
): CameraControls {
  const { CELL, VIEW, glideMs = 150, moverGlideMs = 120 } = options;
  const BOARD_PX = VIEW * CELL;

  // Interpolated player pixel position (top-left of player cell in world-pixel space).
  const ppRef = useRef<{ x: number; y: number; snapped: boolean }>({ x: 0, y: 0, snapped: false });
  // Per-mover interpolated pixel positions, keyed by entity id.
  const moverPxRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Initialise to a unique symbol so the very first frame detects a "change" and snaps.
  const lastSnapKeyRef = useRef<number | string | symbol>(Symbol('init'));
  // Timestamp of the previous rAF tick — for delta-time computation.
  const lastTimeRef = useRef<number>(-1);

  // --- Phase 6: Screen shake ---
  // Stores current shake parameters. Written by the stable `shake` callback below;
  // read every rAF frame. Using a ref avoids triggering re-renders.
  const shakeStateRef = useRef({ mag: 0, t0: 0, dur: 1 });
  // Stable shake trigger — the inline arrow is only created once (useRef initializer
  // runs once) and closes over shakeStateRef, which is also stable.
  const shake = useRef((mag: number, durMs = 300) => {
    shakeStateRef.current = { mag, t0: performance.now(), dur: durMs };
  }).current;

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const worldEl = worldRef.current;
      const playerEl = playerRef.current;
      const layout = layoutRef.current;
      if (!worldEl || !layout) return;

      // Delta time clamped to [0, 100] ms — prevents a large jump after a tab hide/show.
      const dt = lastTimeRef.current < 0 ? 0 : Math.min(now - lastTimeRef.current, 100);
      lastTimeRef.current = now;

      const dpr = window.devicePixelRatio || 1;

      const { baseR0, baseC0, playerR, playerC, rows, cols, movers, snapKey } = layout;

      // --- Map-change detection (reads from layoutRef, always current) ---
      const snapKeyChanged = lastSnapKeyRef.current !== snapKey;
      if (snapKeyChanged) {
        lastSnapKeyRef.current = snapKey;
        moverPxRef.current.clear(); // snap all movers when map regenerates
      }

      // --- Advance player ---
      const pp = ppRef.current;
      const tpx = playerC * CELL;
      const tpy = playerR * CELL;
      const jumpX = Math.abs(pp.x - tpx);
      const jumpY = Math.abs(pp.y - tpy);
      const shouldSnap =
        !pp.snapped || snapKeyChanged || prefersReduced || jumpX > 3 * CELL || jumpY > 3 * CELL;

      if (shouldSnap) {
        pp.x = tpx;
        pp.y = tpy;
        pp.snapped = true;
      } else {
        const maxStep = (CELL / glideMs) * dt;
        pp.x = moveToward(pp.x, tpx, maxStep);
        pp.y = moveToward(pp.y, tpy, maxStep);
      }

      // --- Camera follows interpolated player — clamped to map bounds ---
      const half = BOARD_PX / 2;
      const camX = Math.max(half, Math.min(cols * CELL - half, pp.x + CELL / 2));
      const camY = Math.max(half, Math.min(rows * CELL - half, pp.y + CELL / 2));

      // --- World container translate (snapped to device pixels) ---
      // Phase 6: add decaying shake offset when active (zero when mag=0 or elapsed≥dur).
      const { sx, sy } = shakeOffset(
        shakeStateRef.current.mag,
        now - shakeStateRef.current.t0,
        shakeStateRef.current.dur,
        Math.random(),
        Math.random(),
      );
      const wx = snapPx(half - camX + baseC0 * CELL + (prefersReduced ? 0 : sx), dpr);
      const wy = snapPx(half - camY + baseR0 * CELL + (prefersReduced ? 0 : sy), dpr);
      worldEl.style.transform = `translate3d(${wx}px,${wy}px,0)`;

      // --- Player sprite translate (world-container space, device-pixel snapped) ---
      if (playerEl) {
        const px = snapPx(pp.x - baseC0 * CELL, dpr);
        const py = snapPx(pp.y - baseR0 * CELL, dpr);
        playerEl.style.transform = `translate(${px}px,${py}px)`;
      }

      // --- Mover translates ---
      const moverPx = moverPxRef.current;
      const moverEls = moverRefs.current;
      const moverMaxStep = (CELL / moverGlideMs) * dt;

      // Remove stale entries whose entities are no longer visible
      const liveIds = new Set(movers.map((m) => m.id));
      for (const id of [...moverPx.keys()]) {
        if (!liveIds.has(id)) moverPx.delete(id);
      }

      for (const mv of movers) {
        const tmx = mv.c * CELL;
        const tmy = mv.r * CELL;

        let mp = moverPx.get(mv.id);
        if (!mp || shouldSnap) {
          // First time this mover is visible, or global snap — start at current position.
          mp = { x: tmx, y: tmy };
          moverPx.set(mv.id, mp);
        } else {
          const mdx = Math.abs(mp.x - tmx);
          const mdy = Math.abs(mp.y - tmy);
          if (mdx > 3 * CELL || mdy > 3 * CELL) {
            // Entity teleported (e.g. respawn) — snap
            mp.x = tmx;
            mp.y = tmy;
          } else {
            mp.x = moveToward(mp.x, tmx, moverMaxStep);
            mp.y = moveToward(mp.y, tmy, moverMaxStep);
          }
        }

        const moverEl = moverEls?.get(mv.id);
        if (moverEl) {
          const mx = snapPx(mp.x - baseC0 * CELL, dpr);
          const my = snapPx(mp.y - baseR0 * CELL, dpr);
          moverEl.style.transform = `translate(${mx}px,${my}px)`;
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CELL, VIEW, BOARD_PX, glideMs, moverGlideMs, worldRef, playerRef, moverRefs, layoutRef]);

  return { shake };
}
