// Tiny haptics helper. `navigator.vibrate` is Android-Chrome-only (iOS Safari and most
// desktops lack it), so every call is fully guarded and failure is silent — callers can
// buzz() unconditionally. Keep patterns SHORT (10–40 ms): this is tactile punctuation for
// minigame hits, not notification buzzing. Gate call sites on useIsCoarsePointer() so
// desktop mice never trigger the API at all.

export function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  } catch {
    // Some browsers throw on vibrate() without a user gesture — never let that surface.
  }
}
