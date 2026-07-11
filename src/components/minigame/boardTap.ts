// Client→tile inversion + tap-gesture tracking for the crawl boards (Mine & Forest).
//
// Three transforms sit between a click and a tile: the FitToWidth CSS scale on the
// board frame (top-left origin, may be <1 on phones or >1 on desktop), the camera
// translate3d that useSmoothCamera writes to the world container every frame, and
// the render-window base offset (tiles are positioned at (r-baseR0)·CELL inside the
// world). Reading both live rects folds all three into one measurement — including
// mid-glide camera interpolation, which matches what the player actually sees.

export interface BoardTapSpec {
  /** The fixed-size board frame (boardW×boardH before FitToWidth scaling). */
  frame: HTMLElement | null;
  /** The camera-translated world container inside the frame. */
  world: HTMLElement | null;
  /** Unscaled board pixel width (min(VIEW, cols) · CELL). */
  boardW: number;
  /** Tile size in unscaled board pixels. */
  cell: number;
  /** Render-window base — the world container's local origin maps to this tile. */
  baseR0: number;
  baseC0: number;
}

/** Invert a client-space point to a world tile, or null when the DOM isn't ready. */
export function clientToTile(
  clientX: number,
  clientY: number,
  spec: BoardTapSpec,
): { r: number; c: number } | null {
  if (!spec.frame || !spec.world) return null;
  const frameRect = spec.frame.getBoundingClientRect();
  // jsdom returns all-zero rects — fall back to 1:1 (the TownCanvas vbPerPx idiom).
  const scale = frameRect.width ? frameRect.width / spec.boardW : 1;
  const wRect = spec.world.getBoundingClientRect();
  return {
    r: spec.baseR0 + Math.floor((clientY - wRect.top) / (spec.cell * scale)),
    c: spec.baseC0 + Math.floor((clientX - wRect.left) / (spec.cell * scale)),
  };
}

/** Movement threshold (client px) separating a tap from a drag/scroll gesture. */
export const TAP_SLOP_PX = 8;

/**
 * Minimal tap detector for a board frame: call `down` from onPointerDown and `up`
 * from onPointerUp; `up` returns the client point when the gesture stayed within
 * TAP_SLOP_PX (a clean tap), else null. One-pointer only — a second pointer going
 * down cancels the gesture so pinch attempts never register as taps.
 */
export function createTapTracker() {
  let start: { id: number; x: number; y: number } | null = null;
  return {
    down(e: { pointerId: number; clientX: number; clientY: number }) {
      start = start === null ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    },
    up(e: { pointerId: number; clientX: number; clientY: number }): { x: number; y: number } | null {
      const s = start;
      start = null;
      if (!s || s.id !== e.pointerId) return null;
      const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      return moved <= TAP_SLOP_PX ? { x: e.clientX, y: e.clientY } : null;
    },
    cancel() {
      start = null;
    },
  };
}
