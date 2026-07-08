// Skill Trials — eight short, stat-specific daily challenges (design brief §7.4).
// One trial per stat; playable once per calendar day (costs 1 energy); reward scales with score.
// Pure data + helpers — no React, no store imports.

import type { StatId } from '@/engine/stats';
import type { Reward } from '@/engine/challenges';

/**
 * Result of attempting to begin a trial. `beginTrial` evaluates the daily-clear,
 * energy, and stat gates before charging energy; the reason lets the UI explain a refusal.
 * `practice` is set only when a Homestead Training Yard lets the player replay a trial
 * already cleared today — a free run (no energy, no reward) so the UI can flag it.
 */
export type TrialBeginResult = { ok: true; practice?: boolean } | { ok: false; reason: 'cleared' | 'energy' | 'stat' };

// ── Trial registry ─────────────────────────────────────────────────────────────

export type TrialId =
  | 'lockpicking'
  | 'rooftop_chase'
  | 'armory_break'
  | 'long_march'
  | 'spirit_grove'
  | 'royal_court'
  | 'ancient_library'
  | 'last_stand';

export interface TrialDef {
  id: TrialId;
  /** The main stat this trial exercises. */
  stat: StatId;
  name: string;
  /** One-line summary shown on the hub card. */
  blurb: string;
  /** Emoji glyph used for the hub card icon. */
  glyph: string;
}

export const TRIALS: TrialDef[] = [
  {
    id: 'lockpicking',
    stat: 'DX',
    name: 'Lockpicking',
    blurb: 'Rotate the pick to find the sweet spot, then turn the lock — before you snap all your picks.',
    glyph: '🔑',
  },
  {
    id: 'rooftop_chase',
    stat: 'AG',
    name: 'Rooftop Chase',
    blurb: 'Sprint the rooftops — leap hazards and gaps, stomp the watch, outrun your pursuer.',
    glyph: '🏃',
  },
  {
    id: 'armory_break',
    stat: 'ST',
    name: 'Armory Break',
    blurb: 'Charge a power strike and release it at the peak of three locks.',
    glyph: '⚒️',
  },
  {
    id: 'long_march',
    stat: 'EN',
    name: 'Long March',
    blurb: 'Pace yourself across treacherous terrain — push too hard and you collapse.',
    glyph: '🥾',
  },
  {
    id: 'spirit_grove',
    stat: 'WI',
    name: 'Spirit Grove',
    blurb: 'Read the omen and choose the blessing the spirit is truly offering.',
    glyph: '🌿',
  },
  {
    id: 'royal_court',
    stat: 'CH',
    name: 'Royal Court',
    blurb: 'Navigate the politics of the court — choose your words to earn the queen\'s favour.',
    glyph: '👑',
  },
  {
    id: 'ancient_library',
    stat: 'KN',
    name: 'Ancient Library',
    blurb: 'Memorise the glyph sequence, then repeat it from memory as it grows.',
    glyph: '📚',
  },
  {
    id: 'last_stand',
    stat: 'HP',
    name: 'Last Stand',
    blurb: 'Block wave after wave of incoming strikes — hold the line as long as you can.',
    glyph: '🛡️',
  },
];

const TRIAL_BY_ID: Record<TrialId, TrialDef> = Object.fromEntries(
  TRIALS.map((t) => [t.id, t]),
) as Record<TrialId, TrialDef>;

export function getTrial(id: TrialId): TrialDef {
  return TRIAL_BY_ID[id];
}

// ── Level gate ─────────────────────────────────────────────────────────────────

/** Level at which the Skills tab unlocks. */
export const TRIALS_UNLOCK_LEVEL = 3;

/** Energy cost per trial run (§6.1 — ties Trials to the habit→energy loop). */
export const TRIAL_ENERGY_COST = 1;

// ── Scoring helpers ────────────────────────────────────────────────────────────

/** Map a normalised score (0..1) to a 1–3 star rating. */
export function scoreToStars(score01: number): 1 | 2 | 3 {
  if (score01 >= 0.75) return 3;
  if (score01 >= 0.40) return 2;
  return 1;
}

// ── Reward scaling ─────────────────────────────────────────────────────────────

/**
 * Convert a trial result into a Reward that flows through the store's `applyReward`.
 *
 * Scaling:
 *   statXp = round((10 + 4 * level) * (0.25 + 0.75 * score01))   ← halved vs. pre-3.2
 *   gold   = round((15 + 5 * level) * (0.25 + 0.75 * score01))
 *
 * The 0.25 floor means even a zero score gives ~25% of the full reward (participation
 * bonus — rewards the act of doing a daily, not just perfecting it).
 * XP was reduced in Stage 3 so Trials are a supplement to habits, not a replacement.
 * Gold is unchanged — gold gating healthy minigame purchases.
 */
export function trialReward(stat: StatId, score01: number, level: number): Reward {
  const s = Math.max(0, Math.min(1, score01));
  const multiplier = 0.25 + 0.75 * s;
  const statXp = Math.round((10 + 4 * level) * multiplier);
  const gold = Math.round((15 + 5 * level) * multiplier);
  return {
    gold,
    statXp: { [stat]: statXp } as Partial<Record<StatId, number>>,
  };
}

// ── Empty daily-clear records (used by the store's initial state) ──────────────

export function emptyTrialsClearedOn(): Record<TrialId, string> {
  return Object.fromEntries(TRIALS.map((t) => [t.id, ''])) as Record<TrialId, string>;
}

export function emptyBestTrialScore(): Record<TrialId, number> {
  return Object.fromEntries(TRIALS.map((t) => [t.id, 0])) as Record<TrialId, number>;
}
