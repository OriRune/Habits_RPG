// Hex Tactics — post-match rewards: damage-fraction credit (MINI-23) and the win/retreat payout.
import type { Reward } from '../challenges';
import type { HexBattleState } from './state';
import { tacticsSizeBonus } from './generation';

// --- Reward -------------------------------------------------------------------------------------
/**
 * Fraction (0..1) of the enemy force's HP ground down since the skirmish began (MINI-23).
 * `enemyForceMaxHp` is the total as-spawned HP; checkOutcome removes slain enemies from
 * `state.enemies`, so damage dealt = frozen total − HP still standing on survivors. This credits
 * outright kills, not just chip damage. Legacy runs without the frozen total fall back to a
 * survivors-only denominator (conservative; only affects a save mid-run from before this field).
 */
export function tacticsDamageFraction(state: HexBattleState): number {
  const standing = state.enemies.reduce((sum, e) => sum + Math.max(0, e.hp), 0);
  const total = state.enemyForceMaxHp ?? state.enemies.reduce((sum, e) => sum + e.maxHp, 0);
  if (total <= 0) return 0;
  const dealt = total - standing;
  return Math.max(0, Math.min(1, dealt / total));
}

/**
 * Reward for a finished skirmish. Stat XP is added by the store on commit.
 * A win pays tier-and-size-scaled gold plus a guaranteed material bundle; a loss/retreat pays
 * gold proportional to the damage dealt to the enemy force (kills included, per MINI-23).
 */
export function tacticsReward(state: HexBattleState): Reward {
  // Base gold scales with tier AND board size — bigger boards spawn more foes (sizeBonus), so
  // they must pay more (MINI-22). The objective ×1.6 below composes on top of this base.
  const sizeBonus = tacticsSizeBonus(state.radius);
  const baseGold = Math.round(40 * (1 + state.tier * 0.15) * (1 + 0.15 * sizeBonus));

  if (state.status !== 'won') {
    // Loss/retreat pays gold proportional to damage dealt (MINI-23) — no objective ×1.6 flourish,
    // which is win-only. Zero chip damage → zero gold.
    const gold = Math.round(baseGold * tacticsDamageFraction(state));
    return gold > 0 ? { gold } : {};
  }

  const reward: Reward = { gold: baseGold };
  if (state.tier >= 8) reward.items = ['healing_potion']; // potion threshold stays tier-based
  // Completed secondary objective adds +60% gold and guarantees a healing potion.
  if (state.objective?.complete) {
    reward.gold = Math.round(baseGold * 1.6);
    reward.items = ['healing_potion'];
  }
  // Guaranteed tier-scaled material bundle so Tactics is a reliable material source (BAL-10):
  // cloth_roll (light/agile kit) + bronze_bar (martial mid-metal) — both scarce in other modes.
  const bundleQty = 1 + Math.floor(state.tier / 4);
  reward.materials = { cloth_roll: bundleQty, bronze_bar: bundleQty };
  return reward;
}
