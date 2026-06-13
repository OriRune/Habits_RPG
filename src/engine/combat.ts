// Turn-based Level-Up Trial combat (design brief Section 7).
// Stats modify combat per the brief's "Stat Effects in Boss Battles" table.
// The engine is pure; randomness is injected so battles are deterministically testable.
import type { StatId } from './stats';
import type { BossDef } from './bosses';
import { getItem } from './items';

export type RNG = () => number;

/** Derived combat profile from per-stat XP. Effort (XP) tapers via sqrt. */
export interface Combatant {
  maxHp: number;
  attack: number; // physical (Strength)
  spell: number; // magical (Knowledge)
  crit: number; // crit chance (Dexterity)
  dodge: number; // dodge chance (Agility)
  reduction: number; // damage reduction (Endurance)
  heal: number; // heal power (Wisdom)
  assist: number; // ally-assist chance (Charisma)
}

function points(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp)));
}

/** Build the player's combat profile from stat XP plus any temporary item buffs. */
export function deriveCombatant(
  statXp: Record<StatId, number>,
  buffs: Partial<Record<StatId, number>> = {},
): Combatant {
  const p = (s: StatId) => points(statXp[s]) + (buffs[s] ?? 0);
  return {
    maxHp: 60 + p('HP') * 8,
    attack: 8 + Math.round(p('ST') * 1.5),
    spell: 6 + Math.round(p('KN') * 1.5),
    crit: Math.min(0.5, p('DX') * 0.02),
    dodge: Math.min(0.4, p('AG') * 0.015),
    reduction: Math.min(0.5, p('EN') * 0.015),
    heal: p('WI') * 2,
    assist: Math.min(0.4, p('CH') * 0.02),
  };
}

export type CombatAction =
  | { kind: 'attack' }
  | { kind: 'skill' }
  | { kind: 'defend' }
  | { kind: 'item'; itemKey: string };

export interface BattleState {
  bossId: string;
  bossName: string;
  bossMaxHp: number;
  bossHp: number;
  bossAttack: number;
  bossDefense: number;
  weakTo: StatId[];
  playerMaxHp: number;
  playerHp: number;
  defending: boolean;
  buffs: Partial<Record<StatId, number>>;
  log: string[];
  status: 'active' | 'won' | 'lost';
  /** Consumed item keys, so the store can decrement inventory after the battle. */
  consumedItems: string[];
}

const ANTI_FRUSTRATION_LOSS_THRESHOLD = 3;

/**
 * Start a trial. After repeated losses the boss HP eases off (brief Section 8,
 * "Anti-Frustration Scaling") so a stuck player isn't hard-blocked.
 */
export function createBattle(
  player: Combatant,
  boss: BossDef,
  lossesBefore = 0,
): BattleState {
  const relief =
    lossesBefore >= ANTI_FRUSTRATION_LOSS_THRESHOLD
      ? Math.min(0.4, (lossesBefore - ANTI_FRUSTRATION_LOSS_THRESHOLD + 1) * 0.1)
      : 0;
  const bossMaxHp = Math.round(boss.baseHp * (1 - relief));
  const log = [`${boss.name} appears!`];
  if (relief > 0) log.push(`The boss looks weakened (you've earned some relief).`);
  return {
    bossId: boss.id,
    bossName: boss.name,
    bossMaxHp,
    bossHp: bossMaxHp,
    bossAttack: boss.attack,
    bossDefense: boss.defense,
    weakTo: boss.weakTo,
    playerMaxHp: player.maxHp,
    playerHp: player.maxHp,
    defending: false,
    buffs: {},
    log,
    status: 'active',
    consumedItems: [],
  };
}

function rollHit(base: number, weak: boolean, crit: number, rng: RNG): { dmg: number; crit: boolean } {
  const isCrit = rng() < crit;
  let dmg = base;
  if (weak) dmg *= 1.25;
  if (isCrit) dmg *= 2;
  // ±15% variance for texture.
  dmg *= 0.85 + rng() * 0.3;
  return { dmg: Math.max(1, Math.round(dmg)), crit: isCrit };
}

/**
 * Apply one player action, then (if the battle is still active) the boss's turn.
 * Returns a new BattleState — never mutates the input.
 */
export function playerAction(
  state: BattleState,
  player: Combatant,
  action: CombatAction,
  rng: RNG = Math.random,
): BattleState {
  if (state.status !== 'active') return state;
  const s: BattleState = {
    ...state,
    log: [...state.log],
    buffs: { ...state.buffs },
    consumedItems: [...state.consumedItems],
  };
  s.defending = false;

  switch (action.kind) {
    case 'attack': {
      const weak = state.weakTo.includes('ST');
      const { dmg, crit } = rollHit(player.attack, weak, player.crit, rng);
      const dealt = Math.max(1, dmg - s.bossDefense);
      s.bossHp -= dealt;
      s.log.push(`You strike for ${dealt}${crit ? ' (CRIT!)' : ''}${weak ? ' — it\'s weak to force!' : ''}.`);
      break;
    }
    case 'skill': {
      const weak = state.weakTo.includes('KN') || state.weakTo.includes('DX');
      const { dmg, crit } = rollHit(player.spell * 1.3, weak, player.crit, rng);
      const dealt = Math.max(1, dmg - Math.floor(s.bossDefense / 2));
      s.bossHp -= dealt;
      s.log.push(`Your skill blasts for ${dealt}${crit ? ' (CRIT!)' : ''}${weak ? ' — super effective!' : ''}.`);
      break;
    }
    case 'defend': {
      s.defending = true;
      const heal = Math.min(player.heal, s.playerMaxHp - s.playerHp);
      if (heal > 0) {
        s.playerHp += heal;
        s.log.push(`You brace and recover ${heal} HP.`);
      } else {
        s.log.push('You brace for the next blow.');
      }
      break;
    }
    case 'item': {
      const item = getItem(action.itemKey);
      if (!item) {
        s.log.push('Nothing happens.');
        break;
      }
      s.consumedItems.push(item.key);
      if (item.effect.healHp) {
        const heal = Math.min(item.effect.healHp, s.playerMaxHp - s.playerHp);
        s.playerHp += heal;
        s.log.push(`You drink ${item.name} and restore ${heal} HP.`);
      }
      if (item.effect.buff) {
        for (const [stat, val] of Object.entries(item.effect.buff)) {
          s.buffs[stat as StatId] = (s.buffs[stat as StatId] ?? 0) + (val ?? 0);
        }
        s.log.push(`${item.name} sharpens your senses for this battle.`);
      }
      break;
    }
  }

  if (s.bossHp <= 0) {
    s.bossHp = 0;
    s.status = 'won';
    s.log.push(`${s.bossName} is defeated! Victory!`);
    return s;
  }

  return bossTurn(s, player, rng);
}

function bossTurn(state: BattleState, player: Combatant, rng: RNG): BattleState {
  const s = state;
  if (rng() < player.dodge) {
    s.log.push(`${s.bossName} attacks — you dodge!`);
    return s;
  }
  let dmg = s.bossAttack * (0.85 + rng() * 0.3);
  dmg *= 1 - player.reduction;
  if (s.defending) dmg *= 0.5;
  const dealt = Math.max(1, Math.round(dmg));
  s.playerHp -= dealt;
  s.log.push(`${s.bossName} hits you for ${dealt}.`);

  if (s.playerHp <= 0) {
    s.playerHp = 0;
    s.status = 'lost';
    s.log.push('You fall... but you keep your XP. Train more and try again.');
  }
  return s;
}
