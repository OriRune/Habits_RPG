// Static art data for the Rooftop Chase renderer.
// Extracted from RooftopChase.tsx to keep the component file focused on rendering logic.
// Arrays are purely declarative — no game logic here.

// ── Far-layer (castle) ────────────────────────────────────────────────────────
// Each entry: [x, width, height, crenellated]
export const CASTLE_TOWERS: ReadonlyArray<[number, number, number, boolean]> = [
  [0,   18, 62, true],
  [36,  12, 45, false],
  [62,  22, 75, true],
  [110, 16, 52, true],
  [150, 28, 90, true],
  [200, 14, 48, false],
  [228, 20, 68, true],
  [270, 12, 40, false],
  [300, 18, 58, true],
  [340, 24, 72, true],
  [390, 14, 46, false],
  [420, 20, 65, true],
  [456, 16, 52, false],
];

// ── Mid-layer buildings ────────────────────────────────────────────────────────
// Each entry: [x, width, height]
export const MID_BUILDINGS: ReadonlyArray<[number, number, number]> = [
  [0,   38, 44],
  [40,  26, 34],
  [68,  48, 54],
  [120, 32, 40],
  [156, 42, 50],
  [202, 28, 36],
  [234, 44, 48],
  [282, 36, 42],
];

// ── Foreground chimney decorations ────────────────────────────────────────────
// Each entry: [cx, baseWidth, capWidth, height]
export const CHIMNEYS: ReadonlyArray<[number, number, number, number]> = [
  [18,  8, 12, 28],
  [60,  6, 10, 22],
  [100, 8, 12, 32],
  [150, 6, 10, 24],
  [190, 8, 12, 28],
];
