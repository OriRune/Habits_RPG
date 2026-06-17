/**
 * useSmoothCamera — unified rAF motion for the Mine and Forest overlays.
 *
 * The hook owns the camera, the player sprite, and every visible mover
 * (beasts / monsters). All are interpolated in absolute world-pixel space so
 * the camera and every entity share one coherent easing curve with no per-step
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
 *   1. `pp` (player pixel) eases toward (playerC * CELL, playerR * CELL).
 *   2. Camera = clamp(pp + CELL/2, BOARD/2, map − BOARD/2) — tracks the player
 *      with the same interpolation, so the avatar stays centred with no lag.
 *   3. World container:  translate3d(BOARD/2 − camX + baseC0*CELL, ...)
 *   4. Player element:   translate(pp.x − baseC0*CELL, pp.y − baseR0*CELL)
 *   5. Each mover:       eases independently; same translate formula.
 *
 * Because the world-translate's +baseC0*CELL and each sprite's −baseC0*CELL
 * cancel, every element's screen position is purely a function of (interpolated
 * pixel pos, camera). When baseR0/baseC0 jump on a cameraWindow change the
 * cancellation keeps all screen positions continuous — no per-step jerk.
 *
 * Snap conditions (instant, no easing):
 *   • First frame.
 *   • layout.snapKey changed (new floor / stage → map regenerated).
 *   • Player jump > 3 cells (respawn / advance to a new entrance).
 *   • prefers-reduced-motion active.
 */

import { useEffect, useRef } from 'react';

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
}

/**
 * @param worldRef   Ref to the world-container div (translated by the hook).
 * @param playerRef  Ref to the player sprite div (translated by the hook).
 * @param moverRefs  Stable Map ref — overlay populates via callback refs on
 *                   each beast / monster div; hook reads it each frame.
 * @param layoutRef  Updated every render by the overlay with current state.
 * @param options    CELL and VIEW (stable constants).
 */
export function useSmoothCamera(
  worldRef: React.RefObject<HTMLDivElement | null>,
  playerRef: React.RefObject<HTMLDivElement | null>,
  moverRefs: React.RefObject<Map<string, HTMLDivElement | null>>,
  layoutRef: React.RefObject<SmoothCameraLayout>,
  options: Options,
): void {
  const { CELL, VIEW } = options;
  const BOARD_PX = VIEW * CELL;
  const EASE = 0.22; // fraction of remaining distance closed per frame (~13 frames to settle)

  // Interpolated player pixel position (top-left of player cell in world-pixel space).
  const ppRef = useRef<{ x: number; y: number; snapped: boolean }>({ x: 0, y: 0, snapped: false });
  // Per-mover interpolated pixel positions, keyed by entity id.
  const moverPxRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Initialise to a unique symbol so the very first frame detects a "change" and snaps.
  const lastSnapKeyRef = useRef<number | string | symbol>(Symbol('init'));

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const worldEl = worldRef.current;
      const playerEl = playerRef.current;
      const layout = layoutRef.current;
      if (!worldEl || !layout) return;

      const { baseR0, baseC0, playerR, playerC, rows, cols, movers, snapKey } = layout;

      // --- Map-change detection (reads from layoutRef, always current) ---
      const snapKeyChanged = lastSnapKeyRef.current !== snapKey;
      if (snapKeyChanged) {
        lastSnapKeyRef.current = snapKey;
        moverPxRef.current.clear(); // snap all movers when map regenerates
      }

      // --- Interpolate player ---
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
        pp.x += (tpx - pp.x) * EASE;
        pp.y += (tpy - pp.y) * EASE;
      }

      // --- Camera follows interpolated player — clamped to map bounds ---
      const half = BOARD_PX / 2;
      const camX = Math.max(half, Math.min(cols * CELL - half, pp.x + CELL / 2));
      const camY = Math.max(half, Math.min(rows * CELL - half, pp.y + CELL / 2));

      // --- World container translate ---
      worldEl.style.transform = `translate3d(${half - camX + baseC0 * CELL}px,${half - camY + baseR0 * CELL}px,0)`;

      // --- Player sprite translate (world-container space) ---
      if (playerEl) {
        playerEl.style.transform = `translate(${pp.x - baseC0 * CELL}px,${pp.y - baseR0 * CELL}px)`;
      }

      // --- Mover translates ---
      const moverPx = moverPxRef.current;
      const moverEls = moverRefs.current;

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
            mp.x += (tmx - mp.x) * EASE;
            mp.y += (tmy - mp.y) * EASE;
          }
        }

        const moverEl = moverEls?.get(mv.id);
        if (moverEl) {
          moverEl.style.transform = `translate(${mp.x - baseC0 * CELL}px,${mp.y - baseR0 * CELL}px)`;
        }
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [CELL, VIEW, BOARD_PX, worldRef, playerRef, moverRefs, layoutRef]);
}
