// Turn-based combat (Level-Up Trials + dungeon fights share this engine).
// Stats drive a weapon Attack, MP-gated Spells, an Endurance Stamina pool, and the new
// combat-trained Defense/Ward mitigations. Pure; randomness is injected for testing.
import { type StatId } from './stats';
import type { BossDef, BossPhase, EnemyMove } from './bosses';
import { getItem } from './items';
import { getSpell, SCHOOL_STAT, type StatusKey, type SpellSchool, type SpellMechanic } from './spells';
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

/**
 * Build a combat profile from **stat levels** (the post-rework stat values, ~1–25), the
 * character level (a small survivability floor so HP tracks progression), the combat-trained
 * Defense/Ward, and any temporary buffs. Attack is the raw Strength/Dexterity level plus the
 * weapon bonus (added in the attack action), so each point matters and weapons stay relevant.
 */
export function deriveCombatant(
  statLevels: Record<StatId, number>,
  charLevel: number,
  combat: CombatStats,
  buffs: Partial<Record<StatId, number>> = {},
): Combatant {
  const p = (s: StatId) => statLevels[s] + (buffs[s] ?? 0);
  return {
    maxHp: 50 + p('HP') * 7 + charLevel * 3,
    maxMp: 8 + p('KN') * 3,
    maxSta: 12 + p('EN'),
    meleePower: p('ST'),
    rangedPower: p('DX'),
    dodge: Math.min(0.4, p('AG') * 0.02),
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
  bossMaxMp: number;
  bossMp: number;
  bossMaxSta: number;
  bossSta: number;
  weakTo: StatId[];
  resistTo: StatId[];
  /**
   * MINI-39: set true the first time a hit lands tagged weak/resist, so the battle UI can pin
   * the foe's affinity chips only after the player has *discovered* them (no free intel).
   * Optional — absent on legacy mid-battle saves, reads falsy.
   */
  affinityRevealed?: boolean;
  /** Multi-phase script + current stage. Single-phase foes have one entry. */
  phases: BossPhase[];
  phaseIndex: number;
  /** Anti-frustration HP relief, reapplied to each phase's HP. */
  relief: number;
  /**
   * Total boss HP defeated so far — the sum of every cleared phase's max HP. Reward/XP
   * math reads this (not `bossMaxHp`, which only holds the *current* phase) so a multi-phase
   * boss pays out for the whole fight, not just its final form.
   */
  hpDefeated: number;
  playerMaxHp: number;
  playerHp: number;
  playerMaxMp: number;
  playerMp: number;
  playerMaxSta: number;
  playerSta: number;
  playerStatuses: StatusEffect[];
  enemyStatuses: StatusEffect[];
  /** Rune traps placed on the battlefield — fire after their delay expires. */
  pendingRunes: Array<{ kind: 'fire' | 'ice' | 'poison'; turnsLeft: number; power: number }>;
  defending: boolean;
  buffs: Partial<Record<StatId, number>>;
  log: string[];
  status: 'active' | 'won' | 'lost' | 'fled';
  consumedItems: string[];
  /**
   * The move the foe is telegraphing for its next turn (null when the foe has no moveset
   * or immediately after a phase transition). Shown to the player as "intent".
   */
  enemyIntent: EnemyMove | null;
  /** Temporary physical-defense bonus from a 'guard' move — applies to the player's next
   *  physical attack, then resets at the start of the foe's following turn. */
  enemyGuardBonus: number;
  /** Cumulative attack bonus from 'enrage' moves (permanent for the duration of the fight). */
  enemyEnrageBonus: number;
  /**
   * Structured record of the last player action — written by `playerAction` every turn.
   * BattleScene reads this to drive per-spell VFX instead of regexing the log string.
   */
  lastAction?: {
    kind: CombatAction['kind'];
    spellKey?: string;
    school?: SpellSchool;
    mechanic?: SpellMechanic;
    /** 'foe' for damage/illusion spells; 'self' for support spells (mend, bless, teleport). */
    target: 'foe' | 'self';
    amount?: number;
  };
  /**
   * The move the foe actually executed this turn — mirrors `lastAction` for the enemy side.
   * Null when the foe's turn was skipped (frozen, blind-miss) or the battle is over.
   * BattleScene reads this to drive per-kind enemy attack VFX.
   */
  lastEnemyAction?: { kind: EnemyMove['kind']; dealt: number } | null;
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
  // Enemy resource pools — refilled on every (re)apply so phase transitions give fresh resources.
  const basePool = 8 + Math.round(phase.attack * 0.4);
  s.bossMaxMp  = phase.maxMp  ?? basePool;
  s.bossMaxSta = phase.maxSta ?? basePool;
  s.bossMp  = s.bossMaxMp;
  s.bossSta = s.bossMaxSta;
}

export function createBattle(
  fighter: Fighter,
  boss: BossDef,
  opts: CreateBattleOpts = {},
  rng: RNG = Math.random,
): BattleState {
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
            // Pass single-phase BossDef.moveset through to the synthetic phase.
            moveset: boss.moveset,
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
    bossMaxMp: 0,
    bossMp: 0,
    bossMaxSta: 0,
    bossSta: 0,
    enemyWard: 0,
    attackSchool: 'physical',
    weakTo: [],
    resistTo: [],
    phases,
    phaseIndex: 0,
    relief,
    hpDefeated: 0,
    playerMaxHp: c.maxHp,
    playerHp: opts.startingHp != null ? Math.min(opts.startingHp, c.maxHp) : c.maxHp,
    playerMaxMp: c.maxMp,
    playerMp: opts.startingMp != null ? Math.min(opts.startingMp, c.maxMp) : c.maxMp,
    playerMaxSta: c.maxSta,
    playerSta: opts.startingSta != null ? Math.min(opts.startingSta, c.maxSta) : c.maxSta,
    playerStatuses: [],
    enemyStatuses: [],
    pendingRunes: [],
    defending: false,
    buffs: {},
    log,
    status: 'active',
    consumedItems: [],
    enemyIntent: null,
    enemyGuardBonus: 0,
    enemyEnrageBonus: 0,
    lastEnemyAction: null,
  };
  applyPhase(s, phases[0], relief);
  // Telegraph the foe's first move so the player sees intent before they act.
  s.enemyIntent = pickEnemyMove(phases[0], s.bossMp, s.bossSta, rng);
  return s;
}

/** Called when bossHp hits 0: advance to the next phase, or declare victory if final. */
function resolveBossDown(s: BattleState): void {
  // Bank the phase we just cleared before applyPhase overwrites bossMaxHp for the next form.
  s.hpDefeated += s.bossMaxHp;
  if (s.phaseIndex < s.phases.length - 1) {
    s.phaseIndex += 1;
    const phase = s.phases[s.phaseIndex];
    applyPhase(s, phase, s.relief);
    s.enemyStatuses = []; // a new form sheds old afflictions
    s.enemyIntent = null; // intent from old phase is stale; null = default attack this turn
    s.log.push(phase.transitionMsg ?? `${s.bossName} shifts into a new form!`);
  } else {
    s.bossHp = 0;
    s.status = 'won';
    s.log.push(`${s.bossName} is defeated! Victory!`);
  }
}

/**
 * Default MP and stamina cost for each move kind.
 * `isMagic` = true when the phase's attackSchool is 'magic'.
 * Per-move overrides via `move.mpCost` / `move.staCost` take precedence.
 */
function enemyMoveCost(move: EnemyMove, isMagic: boolean): { mp: number; sta: number } {
  if (move.mpCost !== undefined || move.staCost !== undefined) {
    return { mp: move.mpCost ?? 0, sta: move.staCost ?? 0 };
  }
  switch (move.kind) {
    case 'attack':  return isMagic ? { mp: 2, sta: 0 } : { mp: 0, sta: 1 };
    case 'heavy':   return isMagic ? { mp: 4, sta: 0 } : { mp: 0, sta: 3 };
    case 'multi':   return isMagic ? { mp: 4, sta: 0 } : { mp: 0, sta: 3 };
    case 'drain':   return isMagic ? { mp: 3, sta: 0 } : { mp: 0, sta: 2 };
    case 'inflict': return { mp: 3, sta: 0 };
    case 'guard':   return { mp: 0, sta: 1 };
    case 'enrage':  return { mp: 0, sta: 2 };
    default:        return { mp: 0, sta: 0 };
  }
}

/**
 * Weighted-randomly select the next move from a phase's moveset, filtered to only
 * moves the foe can currently afford (mp ≤ bossMp and sta ≤ bossSta).
 * Returns null when the phase has no moveset or nothing is affordable — both cases
 * fall back to the free basic-attack in the caller.
 */
function pickEnemyMove(phase: BossPhase, bossMp: number, bossSta: number, rng: RNG): EnemyMove | null {
  const pool = phase.moveset;
  if (!pool || pool.length === 0) return null;
  const isMagic = phase.attackSchool === 'magic';
  const affordable = pool.filter((m) => {
    const cost = enemyMoveCost(m, isMagic);
    return cost.mp <= bossMp && cost.sta <= bossSta;
  });
  if (affordable.length === 0) return null;
  const total = affordable.reduce((a, m) => a + (m.weight ?? 1), 0);
  let r = rng() * total;
  for (const m of affordable) {
    if ((r -= m.weight ?? 1) < 0) return m;
  }
  return affordable[affordable.length - 1];
}

/** Damage-roll multipliers, exported so pre-commit previews (hexBattle) can mirror the exact
 *  roll math — a preview that re-hardcodes these lies to the player the moment they're tuned. */
export const DMG_VARIANCE_MIN = 0.85;
export const DMG_VARIANCE_MAX = 1.15;
export const WEAK_MULT = 1.25;
export const RESIST_MULT = 0.6;
/** Swing without enough stamina — half damage. */
export const EXHAUSTED_MULT = 0.5;

/** ±15% spread on a base magnitude. Exported so the real-time Arena rolls damage identically. */
export function variance(base: number, rng: RNG): number {
  return base * (DMG_VARIANCE_MIN + rng() * (DMG_VARIANCE_MAX - DMG_VARIANCE_MIN));
}

/**
 * Charisma's payoff on an illusion status (Dazzle→blind, Hex→weaken). CH both LENGTHENS the debuff
 * (`turns + floor(CH/4)` — doubled from the old `/8`, so most CH points now move the needle) and
 * DEEPENS it (`magnitude + floor(CH/6)·0.05`). The magnitude term is a *fraction* because
 * `weaken.magnitude` is a 0–1 attack-reduction fraction (base 0.4 → up to 0.6 at CH 24); a flat
 * `+floor(CH/6)` as the audit literally suggested would be dimensionally broken (0.4 → 4.4). Blind's
 * magnitude is never read by its miss roll, so for Dazzle only the duration term bites — that is
 * blind's CH lever. Generic + shared by all three casters (combat/arena/hexBattle) so the formula
 * can't drift between them. (BAL-07)
 */
export function illusionBoost<T extends { turns: number; magnitude: number }>(status: T, illusionPower: number): T {
  return {
    ...status,
    turns: status.turns + Math.floor(illusionPower / 4),
    magnitude: status.magnitude + Math.floor(illusionPower / 6) * 0.05,
  };
}

/**
 * Roll a weapon Attack's damage against a target. Shared by turn-based combat and the Arena so
 * melee/ranged numbers stay identical. `power` is the attack stat (meleePower/rangedPower, buffs
 * already folded in), `bonus` the weapon bonus, `full` whether stamina covered the swing.
 */
export function attackRoll(
  power: number,
  bonus: number,
  attackStat: StatId,
  weakTo: StatId[],
  resistTo: StatId[],
  full: boolean,
  defense: number,
  rng: RNG,
): { dealt: number; weak: boolean; resist: boolean } {
  const base = power + bonus;
  const weak = weakTo.includes(attackStat);
  const resist = resistTo.includes(attackStat);
  let dmg = variance(base, rng);
  if (weak) dmg *= WEAK_MULT;
  if (resist) dmg *= RESIST_MULT;
  if (!full) dmg *= EXHAUSTED_MULT; // exhausted — weak swing
  const dealt = Math.max(1, Math.round(dmg) - defense);
  return { dealt, weak, resist };
}

/** Roll a damage spell against a target (Wisdom-scaled). Shared with the Arena. */
export function spellDamageRoll(
  power: number,
  damageSpell: number,
  schoolStat: StatId,
  weakTo: StatId[],
  resistTo: StatId[],
  ward: number,
  rng: RNG,
): { dealt: number; weak: boolean; resist: boolean } {
  const base = power + damageSpell * 1.2;
  const weak = weakTo.includes(schoolStat) || weakTo.includes('WI');
  const resist = resistTo.includes(schoolStat) || resistTo.includes('WI');
  let dmg = variance(base, rng);
  if (weak) dmg *= WEAK_MULT;
  if (resist) dmg *= RESIST_MULT;
  const dealt = Math.max(1, Math.round(dmg) - ward);
  return { dealt, weak, resist };
}

/** Heal amount for a support spell (Knowledge-scaled). Shared with the Arena. */
export function spellHealAmount(power: number, supportSpell: number): number {
  return Math.round(power + supportSpell * 1.5);
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
    pendingRunes: state.pendingRunes.map((r) => ({ ...r })),
    playerStatuses: state.playerStatuses.map((x) => ({ ...x })),
    enemyStatuses: state.enemyStatuses.map((x) => ({ ...x })),
  };
  s.defending = false;

  // Player-weaken reduces all outgoing damage for this turn.
  const playerWeaken = hasStatus(s.playerStatuses, 'weaken');
  const weakenFactor = playerWeaken ? Math.max(0, 1 - playerWeaken.magnitude) : 1;

  switch (action.kind) {
    case 'attack': {
      const full = s.playerSta >= weapon.staminaCost;
      s.playerSta = Math.max(0, s.playerSta - weapon.staminaCost);
      // Apply player-weaken and enemy guard-bonus to this attack.
      const rawPower = weapon.attackStat === 'DX' ? c.rangedPower : c.meleePower;
      const power = rawPower * weakenFactor;
      const { dealt, weak, resist } = attackRoll(
        power, weapon.bonus, weapon.attackStat, state.weakTo, state.resistTo, full,
        s.bossDefense + s.enemyGuardBonus, rng,
      );
      s.bossHp -= dealt;
      if (weak || resist) s.affinityRevealed = true; // MINI-39: player has now seen the affinity
      const tag = weak ? ' — weak to it!' : resist ? ' — resisted' : '';
      const guardTag = s.enemyGuardBonus > 0 ? ' (guarded)' : '';
      s.log.push(`You attack with ${weapon.name} for ${dealt}${tag}${guardTag}${full ? '' : ' (exhausted)'}.`);
      s.lastAction = { kind: 'attack', target: 'foe', amount: dealt };
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
      // Apply player-weaken to magic damage too.
      const weakenedDamageSpell = c.damageSpell * weakenFactor;

      // --- Special mechanic spells ---
      if (spell.mechanic === 'rune-fire' || spell.mechanic === 'rune-ice' || spell.mechanic === 'rune-poison') {
        const kind = spell.mechanic.slice(5) as 'fire' | 'ice' | 'poison';
        const { dealt } = spellDamageRoll(spell.power, weakenedDamageSpell, schoolStat, state.weakTo, state.resistTo, s.enemyWard, rng);
        const delay = 1 + Math.floor(rng() * 3);
        s.pendingRunes.push({ kind, turnsLeft: delay, power: dealt });
        s.log.push(`${spell.name} is inscribed on the ground. It triggers in ${delay} turn${delay > 1 ? 's' : ''}!`);
        s.lastAction = { kind: 'spell', spellKey: action.spellKey, school: spell.school, mechanic: spell.mechanic, target: 'foe' };
      } else if (spell.mechanic === 'ring-of-fire') {
        const magnitude = Math.max(2, Math.round(c.damageSpell * weakenFactor * 0.4 + spell.power * 0.3));
        applyStatus(s.enemyStatuses, { key: 'burn', turns: 3, magnitude });
        s.log.push(`${spell.name} engulfs the foe in a ring of flame.`);
        s.lastAction = { kind: 'spell', spellKey: action.spellKey, school: spell.school, mechanic: spell.mechanic, target: 'foe' };
      } else if (spell.mechanic === 'teleport') {
        const ward = Math.max(2, Math.round(c.supportSpell * 0.5));
        applyStatus(s.playerStatuses, { key: 'bless', turns: 2, magnitude: ward });
        s.log.push(`${spell.name} — you blink evasively, gaining a defensive ward.`);
        s.lastAction = { kind: 'spell', spellKey: action.spellKey, school: spell.school, mechanic: spell.mechanic, target: 'self' };
      } else if (spell.school === 'damage') {
        const { dealt, weak, resist } = spellDamageRoll(
          spell.power, weakenedDamageSpell, schoolStat, state.weakTo, state.resistTo, s.enemyWard, rng,
        );
        s.bossHp -= dealt;
        if (weak || resist) s.affinityRevealed = true; // MINI-39: player has now seen the affinity
        const tag = weak ? ' — super effective!' : resist ? ' — resisted' : '';
        s.log.push(`${spell.name} sears the foe for ${dealt}${tag}.`);
        if (spell.status) applyStatus(s.enemyStatuses, spell.status);
        s.lastAction = { kind: 'spell', spellKey: action.spellKey, school: spell.school, mechanic: spell.mechanic, target: 'foe', amount: dealt };
      } else if (spell.school === 'support') {
        let supportAmount: number | undefined;
        if (spell.power > 0) {
          const heal = spellHealAmount(spell.power, c.supportSpell);
          const gained = Math.min(heal, s.playerMaxHp - s.playerHp);
          s.playerHp += gained;
          s.log.push(`${spell.name} restores ${gained} HP.`);
          supportAmount = gained;
        }
        if (spell.status) {
          applyStatus(s.playerStatuses, spell.status);
          s.log.push(`${spell.name} wraps you in a protective ward.`);
        }
        s.lastAction = { kind: 'spell', spellKey: action.spellKey, school: spell.school, mechanic: spell.mechanic, target: 'self', amount: supportAmount };
      } else {
        // illusion — apply a debuff to the foe, potency boosted by Charisma
        if (spell.status) {
          const boosted = illusionBoost(spell.status, c.illusionPower);
          applyStatus(s.enemyStatuses, boosted);
          s.log.push(`${spell.name} bewilders the foe.`);
        }
        s.lastAction = { kind: 'spell', spellKey: action.spellKey, school: spell.school, mechanic: spell.mechanic, target: 'foe' };
      }
      break;
    }
    case 'defend': {
      s.defending = true;
      const regain = Math.round(s.playerMaxSta * 0.5);
      s.playerSta = Math.min(s.playerMaxSta, s.playerSta + regain);
      s.log.push(`You brace, recovering ${regain} stamina.`);
      s.lastAction = { kind: 'defend', target: 'self', amount: regain };
      break;
    }
    case 'item': {
      const item = getItem(action.itemKey);
      if (!item) {
        s.log.push('Nothing happens.');
        break;
      }
      s.consumedItems.push(item.key);
      let itemHeal = 0;
      if (item.effect.healHp) {
        const heal = Math.min(item.effect.healHp, s.playerMaxHp - s.playerHp);
        s.playerHp += heal;
        itemHeal = heal;
        s.log.push(`You drink ${item.name} and restore ${heal} HP.`);
      }
      if (item.effect.buff) {
        for (const [stat, val] of Object.entries(item.effect.buff)) {
          s.buffs[stat as StatId] = (s.buffs[stat as StatId] ?? 0) + (val ?? 0);
        }
        s.log.push(`${item.name} sharpens your senses for this battle.`);
      }
      s.lastAction = { kind: 'item', target: 'self', amount: itemHeal || undefined };
      break;
    }
    case 'flee': {
      if (rng() < c.flee) {
        s.status = 'fled';
        s.lastAction = { kind: 'flee', target: 'self' };
        s.log.push('You slip away and escape the fight!');
        return s;
      }
      s.log.push("You can't escape! The foe presses in.");
      s.lastAction = { kind: 'flee', target: 'self' };
      break;
    }
  }

  if (s.bossHp <= 0) {
    resolveBossDown(s);
    if (s.status === 'won') {
      s.lastEnemyAction = null; // enemy never acts on its kill turn — clear stale value from last turn
      return s;
    }
    // A phase fell but the foe fights on in a new form — it still gets its turn.
  }

  enemyTurn(s, c, rng);
  if (s.status !== 'active') return s;
  tickStatuses(s, rng);
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

/**
 * Compute and apply a melee/magic strike from the foe. Returns the damage dealt so
 * callers (drain, multi) can use it. Does NOT set `status = 'lost'` — check playerHp <= 0
 * after calling.
 */
function enemyStrike(s: BattleState, c: Combatant, mult: number, rng: RNG): number {
  const weaken = hasStatus(s.enemyStatuses, 'weaken');
  let dmg = variance(s.bossAttack * mult, rng);
  if (weaken) dmg *= 1 - weaken.magnitude;
  // Mitigate by the matching defense, then Defend, then Bless.
  const mit = s.attackSchool === 'magic' ? c.ward : c.defense;
  dmg = Math.max(1, dmg - mit);
  if (s.defending) dmg *= 0.5;
  const bless = hasStatus(s.playerStatuses, 'bless');
  if (bless) dmg = Math.max(1, dmg - bless.magnitude);
  const dealt = Math.max(1, Math.round(dmg));
  s.playerHp -= dealt;
  return dealt;
}

/** Execute the foe's telegraphed (or default) move. Death check is handled by the caller. */
function executeEnemyMove(s: BattleState, c: Combatant, intent: EnemyMove | null, rng: RNG): void {
  const kind = intent?.kind ?? 'attack';
  // `act.dealt` records how much HP was actually removed this turn so the UI can drive
  // the player-hit reaction independently of any post-action HP restoration (e.g. Invincibility).
  const act: { kind: EnemyMove['kind']; dealt: number } = { kind, dealt: 0 };
  s.lastEnemyAction = act;

  // Deduct resource cost for a real telegraphed move (not the free-fallback null move).
  if (intent) {
    const isMagic = s.attackSchool === 'magic';
    const cost = enemyMoveCost(intent, isMagic);
    s.bossMp  = Math.max(0, s.bossMp  - cost.mp);
    s.bossSta = Math.max(0, s.bossSta - cost.sta);
  }

  switch (kind) {
    case 'attack': {
      if (rng() < c.dodge) { s.log.push(`${s.bossName} attacks — you dodge!`); return; }
      const dealt = enemyStrike(s, c, 1.0, rng);
      act.dealt = dealt;
      s.log.push(`${s.bossName} hits you for ${dealt}.`);
      break;
    }
    case 'heavy': {
      const mult = intent?.mult ?? 1.6;
      // Heavy blows are harder to dodge — player's dodge chance is halved.
      if (rng() < c.dodge * 0.5) {
        s.log.push(`${s.bossName} ${intent?.label ?? 'winds up a heavy blow'} — you barely dodge it!`);
        return;
      }
      const dealt = enemyStrike(s, c, mult, rng);
      act.dealt = dealt;
      s.log.push(`${s.bossName} ${intent?.label ?? 'winds up a heavy blow'} and hits for ${dealt}!`);
      break;
    }
    case 'multi': {
      const hits = intent?.hits ?? 2;
      s.log.push(`${s.bossName} ${intent?.label ?? 'attacks rapidly'}!`);
      for (let h = 0; h < hits; h++) {
        if (s.playerHp <= 0) break;
        if (rng() < c.dodge) { s.log.push(`  Hit ${h + 1}: you dodge!`); continue; }
        const dealt = enemyStrike(s, c, 0.6, rng);
        act.dealt += dealt;
        s.log.push(`  Hit ${h + 1}: ${dealt} damage.`);
        if (s.playerHp <= 0) break;
      }
      break;
    }
    case 'guard': {
      const bonus = intent?.bonus ?? 4;
      s.enemyGuardBonus = bonus;
      s.log.push(`${s.bossName} ${intent?.label ?? 'braces defensively'} (+${bonus} guard until next turn).`);
      return;
    }
    case 'inflict': {
      const key = (intent?.inflictKey ?? 'weaken') as StatusKey;
      const turns = intent?.inflictTurns ?? 3;
      const mag = intent?.inflictMag != null
        ? intent.inflictMag
        : Math.max(1, Math.round(s.bossAttack * 0.3));
      applyStatus(s.playerStatuses, { key, turns, magnitude: mag });
      s.log.push(`${s.bossName} ${intent?.label ?? 'afflicts you'}! (${key} ×${turns})`);
      return;
    }
    case 'drain': {
      if (rng() < c.dodge) {
        s.log.push(`${s.bossName} tries to drain you — you pull away!`);
        return;
      }
      const dealt = enemyStrike(s, c, 1.0, rng);
      act.dealt = dealt;
      const healed = Math.min(s.bossMaxHp - s.bossHp, Math.round(dealt * (intent?.drainRatio ?? 0.5)));
      if (healed > 0) s.bossHp += healed;
      s.log.push(`${s.bossName} ${intent?.label ?? 'drains your vitality'} for ${dealt}${healed > 0 ? `, healing ${healed}` : ''}.`);
      break;
    }
    case 'enrage': {
      const bonus = intent?.bonus ?? 3;
      s.bossAttack += bonus;
      s.enemyEnrageBonus += bonus;
      s.log.push(`${s.bossName} ${intent?.label ?? 'enrages'}! Attack +${bonus}.`);
      return;
    }
  }
}

function enemyTurn(s: BattleState, c: Combatant, rng: RNG): void {
  // The guard bonus from the foe's previous turn expires now.
  s.enemyGuardBonus = 0;

  const currentPhase = s.phases[s.phaseIndex];
  const intent = s.enemyIntent; // the move that was telegraphed last turn

  // Status checks — apply regardless of move type.
  const freeze = hasStatus(s.enemyStatuses, 'freeze');
  if (freeze) {
    s.log.push(`${s.bossName} is frozen solid and cannot act!`);
    s.lastEnemyAction = null;
    // Small regen on skipped turns so the foe doesn't stall indefinitely.
    s.bossMp  = Math.min(s.bossMaxMp,  s.bossMp  + 1);
    s.bossSta = Math.min(s.bossMaxSta, s.bossSta + 2);
    s.enemyIntent = pickEnemyMove(currentPhase, s.bossMp, s.bossSta, rng);
    return;
  }
  const blind = hasStatus(s.enemyStatuses, 'blind');
  if (blind && rng() < 0.4) {
    s.log.push(`${s.bossName} swings blindly and misses!`);
    s.lastEnemyAction = null;
    s.bossMp  = Math.min(s.bossMaxMp,  s.bossMp  + 1);
    s.bossSta = Math.min(s.bossMaxSta, s.bossSta + 2);
    s.enemyIntent = pickEnemyMove(currentPhase, s.bossMp, s.bossSta, rng);
    return;
  }

  executeEnemyMove(s, c, intent, rng);

  // Check player death after any damaging move.
  if (s.playerHp <= 0 && s.status === 'active') {
    s.playerHp = 0;
    s.status = 'lost';
    s.log.push('You fall... but you keep your XP. Train more and try again.');
  }

  // Per-turn resource regen — keeps the foe from permanently drying out.
  s.bossMp  = Math.min(s.bossMaxMp,  s.bossMp  + 1);
  s.bossSta = Math.min(s.bossMaxSta, s.bossSta + 2);

  // Queue the next intent for the player to see before their turn.
  s.enemyIntent = pickEnemyMove(currentPhase, s.bossMp, s.bossSta, rng);
}

/** End-of-round: apply damage-over-time, fire pending runes, then decrement/expire all statuses. */
function tickStatuses(s: BattleState, rng: RNG): void {
  const enemyBurn = hasStatus(s.enemyStatuses, 'burn');
  if (enemyBurn) {
    const d = Math.round(enemyBurn.magnitude);
    s.bossHp -= d;
    s.log.push(`The foe burns for ${d}.`);
    if (s.bossHp <= 0) resolveBossDown(s);
  }
  if (s.status === 'active') {
    const enemyPoison = hasStatus(s.enemyStatuses, 'poison');
    if (enemyPoison) {
      const d = Math.round(enemyPoison.magnitude);
      s.bossHp -= d;
      s.log.push(`The foe suffers ${d} poison damage.`);
      if (s.bossHp <= 0) resolveBossDown(s);
    }
  }
  const playerBurn = hasStatus(s.playerStatuses, 'burn');
  if (playerBurn && s.status === 'active') {
    const d = Math.round(playerBurn.magnitude);
    s.playerHp -= d;
    s.log.push(`You burn for ${d}.`);
    if (s.playerHp <= 0) { s.playerHp = 0; s.status = 'lost'; }
  }
  if (s.status === 'active') {
    const playerPoison = hasStatus(s.playerStatuses, 'poison');
    if (playerPoison) {
      const d = Math.round(playerPoison.magnitude);
      s.playerHp -= d;
      s.log.push(`You take ${d} poison damage.`);
      if (s.playerHp <= 0) { s.playerHp = 0; s.status = 'lost'; }
    }
  }

  // Pending runes tick down; at 0 they trigger on the foe (with a small backfire chance).
  const stillPending: typeof s.pendingRunes = [];
  for (const rune of s.pendingRunes) {
    const left = rune.turnsLeft - 1;
    if (left > 0) { stillPending.push({ ...rune, turnsLeft: left }); continue; }
    if (rng() < 0.15) {
      // Backfire — hits the player instead.
      const selfDmg = Math.max(1, Math.round(rune.power * 0.35));
      s.playerHp -= selfDmg;
      s.log.push(`The ${rune.kind} rune backfires, dealing ${selfDmg} damage to you!`);
      if (s.playerHp <= 0) { s.playerHp = 0; s.status = 'lost'; }
    } else {
      switch (rune.kind) {
        case 'fire':
          s.bossHp -= rune.power;
          s.log.push(`The fire rune detonates on ${s.bossName} for ${rune.power}!`);
          applyStatus(s.enemyStatuses, { key: 'burn', turns: 2, magnitude: Math.max(1, Math.round(rune.power * 0.3)) });
          if (s.bossHp <= 0) resolveBossDown(s);
          break;
        case 'ice':
          s.log.push(`The ice rune freezes ${s.bossName}!`);
          applyStatus(s.enemyStatuses, { key: 'freeze', turns: 2, magnitude: 1 }); // decremented once this tick; effective for 1 turn
          break;
        case 'poison':
          s.log.push(`The poison rune poisons ${s.bossName}!`);
          applyStatus(s.enemyStatuses, { key: 'poison', turns: 3, magnitude: Math.max(1, Math.round(rune.power * 0.3)) });
          break;
      }
    }
  }
  s.pendingRunes = stillPending;

  s.enemyStatuses = s.enemyStatuses.map((x) => ({ ...x, turns: x.turns - 1 })).filter((x) => x.turns > 0);
  s.playerStatuses = s.playerStatuses.map((x) => ({ ...x, turns: x.turns - 1 })).filter((x) => x.turns > 0);
}
