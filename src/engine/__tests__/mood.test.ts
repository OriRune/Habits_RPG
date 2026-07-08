import { describe, it, expect } from 'vitest';
import { computeMood, type Mood } from '../mood';

// ARCH-25c: computeMood is a pure feedback fn (backs recomputeMood in store/shared.ts).
// Table-test every branch and its threshold boundaries so a tier cutoff drift is caught.
describe('computeMood (ARCH-25c)', () => {
  // [completions, expected, recentlyRecovered, mood]
  const cases: Array<[number, number, boolean, Mood]> = [
    // recentlyRecovered short-circuits everything, even a perfect ratio
    [10, 10, true, 'recovering'],
    [0, 10, true, 'recovering'],
    // no expected activity → steady (guards the divide-by-zero)
    [0, 0, false, 'steady'],
    [5, 0, false, 'steady'],
    // ratio >= 0.9 → inspired (0.9 boundary inclusive)
    [9, 10, false, 'inspired'],
    [10, 10, false, 'inspired'],
    // 0.6 <= ratio < 0.9 → steady
    [89, 100, false, 'steady'],
    [6, 10, false, 'steady'],
    // 0.3 <= ratio < 0.6 → tired
    [59, 100, false, 'tired'],
    [3, 10, false, 'tired'],
    // 0 < ratio < 0.3 → recovering
    [29, 100, false, 'recovering'],
    [1, 10, false, 'recovering'],
    // ratio == 0 → burned_out
    [0, 10, false, 'burned_out'],
  ];

  it.each(cases)(
    'completions=%i expected=%i recovered=%s → %s',
    (completions, expected, recovered, mood) => {
      expect(computeMood(completions, expected, recovered)).toBe(mood);
    },
  );
});
