import { describe, it, expect } from 'vitest';
import { emptyStatXP } from '../stats';
import { getEncounter, startEncounter, chooseEncounter, checkChance } from '../encounters';
import { type RNG } from '../combat';

const fixed = (v: number): RNG => () => v;
const strong = (...stats: Array<keyof ReturnType<typeof emptyStatXP>>) => {
  const xp = emptyStatXP();
  for (const s of stats) xp[s] = 900; // 30 points
  return xp;
};

describe('checkChance', () => {
  it('clamps to [0.05, 0.95]', () => {
    expect(checkChance(100, 0)).toBe(0.95);
    expect(checkChance(-100, 0)).toBe(0.05);
    expect(checkChance(12, 12)).toBeCloseTo(0.3, 5);
  });
});

describe('chooseEncounter', () => {
  const def = getEncounter('sealed_door')!;

  it('a passed check branches to success and grants its reward', () => {
    const start = startEncounter(def);
    const { state, step } = chooseEncounter(start, def, 0, strong('KN'), {}, fixed(0));
    expect(state.lastOutcome).toBe('success');
    expect(state.nodeId).toBe('opened');
    expect(state.done).toBe(true);
    expect(step.reward.gold).toBe(30);
    expect(step.reward.materials?.crystals).toBe(1);
  });

  it('a failed check branches to the follow-up node and deals damage', () => {
    const start = startEncounter(def);
    const { state, step } = chooseEncounter(start, def, 0, emptyStatXP(), {}, fixed(0.99));
    expect(state.lastOutcome).toBe('fail');
    expect(state.nodeId).toBe('locked');
    expect(state.done).toBe(false); // 'locked' has a follow-up choice (multi-step)
    expect(step.hpDelta).toBe(-8);
  });

  it('an unconditional choice advances without a roll', () => {
    const atLocked = { ...startEncounter(def), nodeId: 'locked' };
    const { state } = chooseEncounter(atLocked, def, 1, emptyStatXP(), {}, fixed(0.99));
    expect(state.lastOutcome).toBe('neutral');
    expect(state.nodeId).toBe('giveup');
    expect(state.done).toBe(true);
  });

  it('gear/stat bonuses raise the effective power of a check', () => {
    const start = startEncounter(def);
    // Weak KN but a big +KN bonus pushes the success chance above the rng threshold.
    const { state } = chooseEncounter(start, def, 0, emptyStatXP(), { KN: 40 }, fixed(0.5));
    expect(state.lastOutcome).toBe('success');
  });

  it('an onSuccess heal restores resources', () => {
    const shrine = getEncounter('starving_dark')!;
    const start = startEncounter(shrine);
    const { state, step } = chooseEncounter(start, shrine, 0, strong('KN'), {}, fixed(0));
    expect(state.lastOutcome).toBe('success');
    expect(step.hpDelta).toBe(15); // hpOnSuccess
    expect(step.reward.materials?.herbs).toBe(2);
  });
});
