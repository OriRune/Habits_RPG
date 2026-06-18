// Royal Court trial engine — pure, no React/store.
// Skill-check resolution for D&D-style Charisma gambits in the Royal Court trial.

// ── DC tiers ───────────────────────────────────────────────────────────────────
// Used when authoring gambit choices in src/content/trials.ts to keep DCs consistent.

export const COURT_DC = {
  /** Easy check — even a low-CH character succeeds more often than not. */
  easy: 10,
  /** Medium check — base CH investment (Lv. 3–4) is roughly even odds. */
  medium: 13,
  /** Hard check — requires meaningful CH investment to pass reliably. */
  hard: 16,
} as const;

// ── Modifier ───────────────────────────────────────────────────────────────────

/**
 * Convert a CH stat level to a d20 roll modifier.
 * 1-to-1 mapping: Lv. 0 = +0, Lv. 5 = +5, etc.
 * Tunable here without touching the component.
 */
export function courtCheckModifier(chLevel: number): number {
  return chLevel;
}

// ── Resolution ─────────────────────────────────────────────────────────────────

export interface CourtCheckResult {
  /** The raw d20 value (1–20). */
  roll: number;
  /** CH modifier applied to the roll. */
  modifier: number;
  /** roll + modifier — the final total compared against DC. */
  total: number;
  /** Whether the check was passed. */
  success: boolean;
  /**
   * Natural-20 crit always succeeds; natural-1 fumble always fails.
   * null when the result was decided by the total vs. DC.
   */
  natural: 'crit' | 'fumble' | null;
}

/**
 * Resolve a Charisma skill-check gambit.
 *
 * Full D&D swing rules:
 *   - Natural 20 → always SUCCESS regardless of DC or modifier.
 *   - Natural  1 → always FAIL   regardless of DC or modifier.
 *   - Otherwise: success = (roll + modifier) >= dc.
 */
export function resolveCourtCheck(
  roll: number,
  chLevel: number,
  dc: number,
): CourtCheckResult {
  const modifier = courtCheckModifier(chLevel);
  const total = roll + modifier;

  let natural: CourtCheckResult['natural'] = null;
  let success: boolean;

  if (roll === 20) {
    natural = 'crit';
    success = true;
  } else if (roll === 1) {
    natural = 'fumble';
    success = false;
  } else {
    success = total >= dc;
  }

  return { roll, modifier, total, success, natural };
}

// ── RNG ────────────────────────────────────────────────────────────────────────

/**
 * Roll a 20-sided die. Isolated here so the rest of the engine stays testable
 * (pass a fixed roll value to resolveCourtCheck in tests instead of calling this).
 */
export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}
