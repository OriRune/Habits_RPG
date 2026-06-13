// Character mood (design brief Section 18). Reflects recent consistency as gentle,
// non-punitive feedback — never blocks progress.
export type Mood = 'inspired' | 'steady' | 'tired' | 'recovering' | 'burned_out';

export const MOOD_META: Record<Mood, { label: string; emoji: string; note: string }> = {
  inspired: { label: 'Inspired', emoji: '✨', note: 'You\'re on a roll!' },
  steady: { label: 'Steady', emoji: '🙂', note: 'Keeping a solid rhythm.' },
  tired: { label: 'Tired', emoji: '😮‍💨', note: 'A lighter stretch — that\'s okay.' },
  recovering: { label: 'Recovering', emoji: '🌱', note: 'Bouncing back. Nice return!' },
  burned_out: { label: 'Burned out', emoji: '😴', note: 'Rest, then ease back in.' },
};

/**
 * Derive mood from recent activity.
 * - `recentlyRecovered` (missed a day, came back) takes priority -> recovering.
 * - Otherwise bucket by completion ratio over the recent window.
 */
export function computeMood(
  completions: number,
  expected: number,
  recentlyRecovered: boolean,
): Mood {
  if (recentlyRecovered) return 'recovering';
  if (expected <= 0) return 'steady';
  const ratio = completions / expected;
  if (ratio >= 0.9) return 'inspired';
  if (ratio >= 0.6) return 'steady';
  if (ratio >= 0.3) return 'tired';
  if (ratio > 0) return 'recovering';
  return 'burned_out';
}
