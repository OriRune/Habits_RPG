// Branching, DnD-style text encounters — the narrative half of a dungeon run. Each
// encounter is a small node graph: a node narrates a situation and offers choices; a
// choice may be a stat check that branches to different follow-up nodes (success vs.
// fail), so a decision leads to a consequence beat before resolving. Pure + testable;
// randomness is injected. Editable DATA lives in src/content/encounters.ts.
import { statPower, type StatId } from './stats';
import type { RNG } from './combat';
import type { Reward } from './challenges';
import { ENCOUNTERS } from '@/content/encounters';

export interface EncounterChoice {
  label: string;
  /** When set, the choice is a stat check that branches by roll. */
  stat?: StatId;
  difficulty?: number;
  /** Destination node ids. `go` is unconditional; goSuccess/goFail require `stat`. */
  go?: string;
  goSuccess?: string;
  goFail?: string;
  /** Result line shown after choosing (success/fail variants for stat checks). */
  successText?: string;
  failText?: string;
  /** Loot granted regardless of roll; rewardOnSuccess only on a successful check. */
  reward?: Reward;
  rewardOnSuccess?: Reward;
  /** Resource deltas applied this step regardless of roll. */
  hpDelta?: number;
  staDelta?: number;
  mpDelta?: number;
  /** Extra deltas applied only on a failed check (hpOnFail usually negative)… */
  hpOnFail?: number;
  /** …or only on a successful check (heals/restores from shrines, caches, blessings). */
  hpOnSuccess?: number;
  staOnSuccess?: number;
  mpOnSuccess?: number;
}

export interface EncounterNode {
  id: string;
  text: string;
  /** Absent or empty = terminal node (the encounter ends here). */
  choices?: EncounterChoice[];
}

export interface EncounterDef {
  key: string;
  title: string;
  start: string;
  nodes: Record<string, EncounterNode>;
}

/** Live state of an in-progress encounter (held by the dungeon run). */
export interface EncounterRunState {
  key: string;
  nodeId: string;
  /** Result line of the last choice taken (null at the opening node). */
  lastText: string | null;
  lastOutcome: 'success' | 'fail' | 'neutral' | null;
  done: boolean;
}

/** What a single choice yields, for the caller to apply to run resources + loot. */
export interface EncounterStep {
  reward: Reward;
  hpDelta: number;
  staDelta: number;
  mpDelta: number;
}

// Re-export the editable catalog so importers use `@/engine/encounters`.
export { ENCOUNTERS } from '@/content/encounters';

export function getEncounter(key: string): EncounterDef | undefined {
  return ENCOUNTERS[key];
}

/** Success probability of a stat check. Tuned to the stat-level scale (difficulties ~3–8). */
export function checkChance(power: number, threshold: number): number {
  return Math.min(0.95, Math.max(0.05, 0.3 + (power - threshold) * 0.07));
}

function isTerminal(def: EncounterDef, nodeId: string): boolean {
  const node = def.nodes[nodeId];
  return !node || !node.choices || node.choices.length === 0;
}

export function startEncounter(def: EncounterDef): EncounterRunState {
  return { key: def.key, nodeId: def.start, lastText: null, lastOutcome: null, done: isTerminal(def, def.start) };
}

function mergeInto(target: Reward, add: Reward): void {
  if (add.gold) target.gold = (target.gold ?? 0) + add.gold;
  if (add.materials) {
    target.materials = { ...(target.materials ?? {}) };
    for (const [k, v] of Object.entries(add.materials)) target.materials[k] = (target.materials[k] ?? 0) + (v ?? 0);
  }
  if (add.items) target.items = [...(target.items ?? []), ...add.items];
  if (add.weapons) target.weapons = [...(target.weapons ?? []), ...add.weapons];
  if (add.gear) target.gear = [...(target.gear ?? []), ...add.gear];
}

/**
 * Resolve the player's choice at the current node. Rolls the stat check if any,
 * advances to the next node, and returns the new state plus the step's loot/deltas.
 */
export function chooseEncounter(
  state: EncounterRunState,
  def: EncounterDef,
  choiceIndex: number,
  statLevels: Record<StatId, number>,
  bonuses: Partial<Record<StatId, number>> = {},
  rng: RNG = Math.random,
): { state: EncounterRunState; step: EncounterStep } {
  const node = def.nodes[state.nodeId];
  const choice = node?.choices?.[choiceIndex];
  if (!choice) {
    return { state, step: { reward: {}, hpDelta: 0, staDelta: 0, mpDelta: 0 } };
  }

  const reward: Reward = {};
  mergeInto(reward, choice.reward ?? {});
  let hpDelta = choice.hpDelta ?? 0;
  let staDelta = choice.staDelta ?? 0;
  let mpDelta = choice.mpDelta ?? 0;

  let nextId = choice.go ?? state.nodeId;
  let outcome: EncounterRunState['lastOutcome'] = 'neutral';
  let text = choice.successText ?? null;

  if (choice.stat) {
    const power = statPower(statLevels, [choice.stat]) + (bonuses[choice.stat] ?? 0);
    const success = rng() < checkChance(power, choice.difficulty ?? 5);
    outcome = success ? 'success' : 'fail';
    nextId = (success ? choice.goSuccess : choice.goFail) ?? state.nodeId;
    text = (success ? choice.successText : choice.failText) ?? null;
    if (success) {
      mergeInto(reward, choice.rewardOnSuccess ?? {});
      hpDelta += choice.hpOnSuccess ?? 0;
      staDelta += choice.staOnSuccess ?? 0;
      mpDelta += choice.mpOnSuccess ?? 0;
    } else {
      hpDelta += choice.hpOnFail ?? 0;
    }
  }

  const newState: EncounterRunState = {
    ...state,
    nodeId: nextId,
    lastText: text,
    lastOutcome: outcome,
    done: isTerminal(def, nextId),
  };
  return { state: newState, step: { reward, hpDelta, staDelta, mpDelta } };
}
