// Turn-based combat (Level-Up Trials + dungeon fights share this engine).
// Stats drive a weapon Attack, MP-gated Spells, an Endurance Stamina pool, and the new
// combat-trained Defense/Ward mitigations. Pure; randomness is injected for testing.
import { statPoints, type StatId } from './stats';
import type { BossDef, BossPhase } from './bosses';
import { getItem } from './items';
import { getSpell, SCHOOL_STAT, type StatusKey } from './spells';
import type { WeaponDef } from './weapons';
import type { CombatStats } from './combatStats';
import { mitigation } from './combatStats';

export type RNG = () => number;

/** Derived combat profile from habit stat XP + combat stats + temporary buffs. */
export interface Combatant {
  maxHp: number;
  maxMp: number;
  maxSta: number;
  meleePower: number; // Strength
  rangedPower: number; // Dexterity
  dodge: number; // Agility
  flee: number; // Agility
  damageSpell: number; // Wisdom
  supportSpell: number; // Knowledge
  illusionPower: number; // Charisma
  defense: number; // combat stat — physical mitigation
  ward: number; // combat stat — magical mitigation
}

/** The acting player: derived stats + equipped weapon. */
export interface Fighter {
  c: Combatant;
  weapon: WeaponDef;
}

export function deriveCombatant(
  statXp: Record<StatId, number>,
  combat: CombatStats,
  buffs: Partial<Record<StatId, number>> = {},
): Combatant {
  const p = (s: StatId) => statPoints(statXp[s]) + (buffs[s] ?? 0);
  return {
    maxHp: 60 + p('HP') * 8,
    maxMp: 10 + p('KN') * 4,
    maxSta: 5 + Math.round(p('EN') * 1.5),
    meleePower: Math.round(p('ST') * 1.5),
    rangedPower: Math.round(p('DX') * 1.5),
    dodge: Math.min(0.4, p('AG') * 0.015),
    flee: Math.min(0.9, 0.4 + p('AG') * 0.03),
    damageSpell: p('WI'),
    supportSpell: p('KN'),
    illusionPower: p('CH'),
    defense: mitigation(combat.defenseXp),
    ward: mitigation(combat.wardXp),
  };
}

export type CombatAction =
  | { kind: 'attack' }
  | { kind: 'spell'; spellKey: string }
  | { kind: 'item'; itemKey: string }
  | { kind: 'defend' }
  | { kind: 'flee' };

export interface StatusEffect {
  key: StatusKey;
  turns: number;
  magnitude: number;
}

export interface BattleState {
  bossId: string;
  bossName: string;
  bossMaxHp: number;
  bossHp: number;
  bossAttack: number;
  bossDefense: number;
  enemyWard: number;
  attackSchool: 'physical' | 'magic';
  weakTo: StatId[];
  resistTo: StatId[];
  /** Multi-phase script + current stage. Single-phase foes have one entry. */
  phases: BossPhase[];
  phaseIndex: number;
  /** Anti-frustration HP relief, reapplied to each phase's HP. */
  relief: number;
  playerMaxHp: number;
  playerHp: number;
  playerMaxMp: number;
  playerMp: number;
  playerMaxSta: number;
  playerSta: number;
  playerStatuses: StatusEffect[];
  enemyStatuses: StatusEffect[];
  defending: boolean;
  buffs: Partial<Record<StatId, number>>;
  log: string[];
  status: 'active' | 'won' | 'lost' | 'fled';
  consumedItems: string[];
}

const ANTI_FRUSTRATION_LOSS_THRESHOLD = 3;

export interface CreateBattleOpts {
  lossesBefore?: number;
  /** Carry a dungeon run's current HP/MP/Stamina into the fight (defaults to full). */
  startingHp?: number;
  startingMp?: number;
  startingSta?: number;
}

/** Load a phase's stats onto the battle (sets a fresh HP bar from its hp, with relief). */
function applyPhase(s: BattleState, phase: BossPhase, relief: number): void {
  const hp = Math.max(1, Math.round(phase.hp * (1 - relief)));
  s.bossMaxHp = hp;
  s.bossHp = hp;
  s.bossAttack = phase.attack;
  s.bossDefense = phase.defense;
  s.enemyWard = phase.ward ?? 0;
  s.attackSchool = phase.attackSchool ?? 'physical';
  s.weakTo = phase.weakTo;
  s.resistTo = phase.resistTo ?? [];
}

export function createBattle(fighter: Fighter, boss: BossDef, opts: CreateBattleOpts = {}): BattleState {
  const { c } = fighter;
  const lossesBefore = opts.lossesBefore ?? 0;
  const relief =
    lossesBefore >= ANTI_FRUSTRATION_LOSS_THRESHOLD
      ? Math.min(0.4, (lossesBefore - ANTI_FRUSTRATION_LOSS_THRESHOLD + 1) * 0.1)
      : 0;
  const phases: BossPhase[] =
    boss.phases && boss.phases.length > 0
      ? boss.phases
      : [
          {
            hp: boss.baseHp,
            attack: boss.attack,
            defense: boss.defense,
            ward: boss.ward,
            attackSchool: boss.attackSchool,
            weakTo: boss.weakTo,
            resistTo: boss.resistTo,
          },
        ];
  const log = [`${boss.name} appears!`];
  if (relief > 0) log.push(`The foe looks weakened (you've earned some relief).`);
  const s: BattleState = {
    bossId: boss.id,
    bossName: boss.name,
    bossMaxHp: 0,
    bossHp: 0,
    bossAttack: 0,
    bossDefense: 0,
    enemyWard: 0,
    attackSchool: 'physical',
    weakTo: [],
    resistTo: [],
    phases,
    phaseIndex: 0,
    relief,
    playerMaxHp: c.maxHp,
    playerHp: opts.startingHp != null ? Math.min(opts.startingHp, c.maxHp) : c.maxHp,
    playerMaxMp: c.maxMp,
    playerMp: opts.startingMp != null ? Math.min(opts.startingMp, c.maxMp) : c.maxMp,
    playerMaxSta: c.maxSta,
    playerSta: opts.startingSta != null ? Math.min(opts.startingSta, c.maxSta) : c.maxSta,
    playerStatuses: [],
    enemyStatuses: [],
    defending: false,
    buffs: {},
    log,
    status: 'active',
    consumedItems: [],
  };
  applyPhase(s, phases[0], relief);
  return s;
}

/** Called when bossHp hits 0: advance to the next phase, or declare victory if final. */
function resolveBossDown(s: BattleState): void {
  if (s.phaseIndex < s.phases.length - 1) {
    s.phaseIndex += 1;
    const phase = s.phases[s.phaseIndex];
    applyPhase(s, phase, s.relief);
    s.enemyStatuses = []; // a new form sheds old afflictions
    s.log.push(phase.transitionMsg ?? `${s.bossName} shifts into a new form!`);
  } else {
    s.bossHp = 0;
    s.status = 'won';
    s.log.push(`${s.bossName} is defeated! Victory!`);
  }
}

function variance(base: number, rng: RNG): number {
  return base * (0.85 + rng() * 0.3);
}

function hasStatus(list: StatusEffect[], key: StatusKey): StatusEffect | undefined {
  return list.find((s) => s.key === key);
}

/**
 * Apply one player action, then (if still active) the foe's turn and status ticks.
 * Returns a new BattleState — never mutates the input.
 */
export function playerAction(
  state: BattleState,
  fighter: Fighter,
  action: CombatAction,
  rng: RNG = Math.random,
): BattleState {
  if (state.status !== 'active') return state;
  const { c, weapon } = fighter;
  const s: BattleState = {
    ...state,
    log: [...state.log],
    buffs: { ...state.buffs },
    consumedItems: [...state.consumedItems],
    playerStatuses: state.playerStatuses.map((x) => ({ ...x })),
    enemyStatuses: state.enemyStatuses.map((x) => ({ ...x })),
  };
  s.defending = false;

  switch (action.kind) {
    case 'attack': {
      const full = s.playerSta >= weapon.staminaCost;
      s.playerSta = Math.max(0, s.playerSta - weapon.staminaCost);
      const base = (weapon.attackStat === 'DX' ? c.rangedPower : c.meleePower) + weapon.bonus;
      const weak = state.weakTo.includes(weapon.attackStat);
      const resist = state.resistTo.includes(weapon.attackStat);
      let dmg = variance(base, rng);
      if (weak) dmg *= 1.25;
      if (resist) dmg *= 0.6;
      if (!full) dmg *= 0.5; // exhausted — weak swing
      const dealt = Math.max(1, Math.round(dmg) - s.bossDefense);
      s.bossHp -= dealt;
      const tag = weak ? ' — weak to it!' : resist ? ' — resisted' : '';
      s.log.push(`You attack with ${weapon.name} for ${dealt}${tag}${full ? '' : ' (exhausted)'}.`);
      break;
    }
    case 'spell': {
      const spell = getSpell(action.spellKey);
      if (!spell) {
        s.log.push('The spell fizzles.');
        break;
      }
      if (s.playerMp < spell.mpCost) {
        return state; // not enough MP — no turn spent (UI also disables)
      }
      s.playerMp -= spell.mpCost;
      const schoolStat = SCHOOL_STAT[spell.school];
      if (spell.school === 'damage') {
        const base = spell.power + c.damageSpell * 1.2;
        const weak = state.weakTo.includes(schoolStat) || state.weakTo.includes('WI');
        const resist = state.resistTo.includes(schoolStat) || state.resistTo.includes('WI');
        let dmg = variance(base, rng);
        if (weak) dmg *= 1.25;
        if (resist) dmg *= 0.6;
        const dealt = Math.max(1, Math.round(dmg) - s.enemyWard);
        s.bossHp -= dealt;
        const tag = weak ? ' — super effective!' : resist ? ' — resisted' : '';
        s.log.push(`${spell.name} sears the foe for ${dealt}${tag}.`);
        if (spell.status) applyStatus(s.enemyStatuses, spell.status);
      } else if (spell.school === 'support') {
        if (spell.power > 0) {
          const heal = Math.round(spell.power + c.supportSpell * 1.5);
          const gained = Math.min(heal, s.playerMaxHp - s.playerHp);
          s.playerHp += gained;
          s.log.push(`${spell.name} restores ${gained} HP.`);
        }
        if (spell.status) {
          applyStatus(s.playerStatuses, spell.status);
          s.log.push(`${spell.name} wraps you in a protective ward.`);
        }
      } else {
        // illusion — apply a debuff to the foe, potency boosted by Charisma
        if (spell.status) {
          const boosted = { ...spell.status, turns: spell.status.turns + Math.floor(c.illusionPower / 8) };
          applyStatus(s.enemyStatuses, boosted);
          s.log.push(`${spell.name} bewilders the foe.`);
        }
      }
      break;
    }
    case 'defend': {
      s.defending = true;
      const regain = Math.round(s.playerMaxSta * 0.5);
      s.playerSta = Math.min(s.playerMaxSta, s.playerSta + regain);
      s.log.push(`You brace, recovering ${regain} stamina.`);
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
    case 'flee': {
      if (rng() < c.flee) {
        s.status = 'fled';
        s.log.push('You slip away and escape the fight!');
        return s;
      }
      s.log.push("You can't escape! The foe presses in.");
      break;
    }
  }

  if (s.bossHp <= 0) {
    resolveBossDown(s);
    if (s.status === 'won') return s;
    // A phase fell but the foe fights on in a new form — it still gets its turn.
  }

  enemyTurn(s, c, rng);
  if (s.status !== 'active') return s;
  tickStatuses(s);
  return s;
}

function applyStatus(list: StatusEffect[], status: StatusEffect): void {
  const existing = list.find((x) => x.key === status.key);
  if (existing) {
    existing.turns = Math.max(existing.turns, status.turns);
    existing.magnitude = Math.max(existing.magnitude, status.magnitude);
  } else {
    list.push({ ...status });
  }
}

function enemyTurn(s: BattleState, c: Combatant, rng: RNG): void {
  const blind = hasStatus(s.enemyStatuses, 'blind');
  if (blind && rng() < 0.4) {
    s.log.push(`${s.bossName} swings blindly and misses!`);
    return;
  }
  if (rng() < c.dodge) {
    s.log.push(`${s.bossName} attacks — you dodge!`);
    return;
  }
  let dmg = variance(s.bossAttack, rng);
  const weaken = hasStatus(s.enemyStatuses, 'weaken');
  if (weaken) dmg *= 1 - weaken.magnitude;
  // Mitigate by the matching defense, then Defend, then Bless.
  const mit = s.attackSchool === 'magic' ? c.ward : c.defense;
  dmg = Math.max(1, dmg - mit);
  if (s.defending) dmg *= 0.5;
  const bless = hasStatus(s.playerStatuses, 'bless');
  if (bless) dmg = Math.max(1, dmg - bless.magnitude);
  const dealt = Math.max(1, Math.round(dmg));
  s.playerHp -= dealt;
  s.log.push(`${s.bossName} hits you for ${dealt}.`);
  if (s.playerHp <= 0) {
    s.playerHp = 0;
    s.status = 'lost';
    s.log.push('You fall... but you keep your XP. Train more and try again.');
  }
}

/** End-of-round: apply damage-over-time, then decrement/expire all statuses. */
function tickStatuses(s: BattleState): void {
  const enemyBurn = hasStatus(s.enemyStatuses, 'burn');
  if (enemyBurn) {
    const d = Math.round(enemyBurn.magnitude);
    s.bossHp -= d;
    s.log.push(`The foe burns for ${d}.`);
    if (s.bossHp <= 0) resolveBossDown(s);
  }
  const playerBurn = hasStatus(s.playerStatuses, 'burn');
  if (playerBurn && s.status === 'active') {
    const d = Math.round(playerBurn.magnitude);
    s.playerHp -= d;
    s.log.push(`You burn for ${d}.`);
    if (s.playerHp <= 0) {
      s.playerHp = 0;
      s.status = 'lost';
    }
  }
  s.enemyStatuses = s.enemyStatuses.map((x) => ({ ...x, turns: x.turns - 1 })).filter((x) => x.turns > 0);
  s.playerStatuses = s.playerStatuses.map((x) => ({ ...x, turns: x.turns - 1 })).filter((x) => x.turns > 0);
}
