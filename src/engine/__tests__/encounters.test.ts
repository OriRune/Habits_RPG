import { describe, it, expect } from 'vitest';
import { emptyStatXP } from '../stats';
import { getEncounter, startEncounter, chooseEncounter, checkChance, encounterDepthTier } from '../encounters';
import { type RNG } from '../combat';
import { BIOMES } from '../../content/biomes';

const fixed = (v: number): RNG => () => v;
const strong = (...stats: Array<keyof ReturnType<typeof emptyStatXP>>) => {
  const lv = emptyStatXP();
  for (const s of stats) lv[s] = 30; // high stat level — passes any check
  return lv;
};

describe('checkChance', () => {
  it('clamps to [0.15, 0.95] (raised floor for early-game fairness)', () => {
    expect(checkChance(100, 0)).toBe(0.95);
    // Floor raised from 0.05 → 0.15 so fresh characters aren't near-auto-failing.
    expect(checkChance(-100, 0)).toBe(0.15);
    expect(checkChance(12, 12)).toBeCloseTo(0.3, 5);
    // At stat 1 vs diff 5 (worst early-game case): was 0.05, now 0.15.
    expect(checkChance(1, 5)).toBe(0.15);
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

// MINI-28: deep encounters stiffen and pay more, instead of saturating at 95% with flat loot.
describe('depth scaling (MINI-28)', () => {
  const def = getEncounter('sealed_door')!; // door: KN check, difficulty 5, rewardOnSuccess gold 30
  const kn10 = () => { const lv = emptyStatXP(); lv.KN = 10; return lv; };

  it('encounterDepthTier is one difficulty point per 3 floors', () => {
    expect(encounterDepthTier(0)).toBe(0);
    expect(encounterDepthTier(2)).toBe(0);
    expect(encounterDepthTier(3)).toBe(1);
    expect(encounterDepthTier(15)).toBe(5);
  });

  it('a check that passes shallow can fail deep at the same skill', () => {
    // KN 10 vs difficulty 5 → chance 0.65 shallow; at depth 15 (tier 5 → difficulty 10) → 0.30. rng 0.5.
    const shallow = chooseEncounter(startEncounter(def), def, 0, kn10(), {}, fixed(0.5), undefined, 0);
    const deep = chooseEncounter(startEncounter(def), def, 0, kn10(), {}, fixed(0.5), undefined, 15);
    expect(shallow.state.lastOutcome).toBe('success');
    expect(deep.state.lastOutcome).toBe('fail');
  });

  it('encounter gold scales up with depth on a win', () => {
    const shallow = chooseEncounter(startEncounter(def), def, 0, kn10(), {}, fixed(0.01), undefined, 0);
    const deep = chooseEncounter(startEncounter(def), def, 0, kn10(), {}, fixed(0.01), undefined, 15);
    expect(shallow.step.reward.gold).toBe(30); // tier 0 → unscaled
    expect(deep.step.reward.gold).toBe(53); // 30 * (1 + 5*0.15) = 52.5 → 53
  });
});

// BAL-08: the CH build finally has a social encounter with real Charisma gates.
describe('tense_standoff (Charisma content)', () => {
  const def = getEncounter('tense_standoff')!;

  it('is a registered encounter', () => {
    expect(def).toBeTruthy();
    expect(def.start).toBe('meet');
  });

  it('offers five Charisma checks across its nodes', () => {
    const chChecks = Object.values(def.nodes)
      .flatMap((n) => n.choices ?? [])
      .filter((c) => c.stat === 'CH');
    expect(chChecks).toHaveLength(5);
  });

  it('a silver-tongued hero disarms the standoff and is rewarded', () => {
    const start = startEncounter(def);
    const { state, step } = chooseEncounter(start, def, 0, strong('CH'), {}, fixed(0));
    expect(state.lastOutcome).toBe('success');
    expect(step.reward.gold ?? 0).toBeGreaterThan(0);
  });
});

describe('BAL-24: HP-stat hazard gates', () => {
  // HP was checked in only a handful of nodes; toughness now clears physical hazards.
  it('the four hazard encounters each offer an HP check', () => {
    for (const key of ['sealed_door', 'bone_pit', 'collapsing_bridge', 'frozen_chasm']) {
      const def = getEncounter(key)!;
      const hpChecks = Object.values(def.nodes)
        .flatMap((n) => n.choices ?? [])
        .filter((c) => c.stat === 'HP');
      expect(hpChecks.length, `${key} HP checks`).toBeGreaterThan(0);
    }
  });

  it('a high-HP hero muscles through the bone pit on toughness alone', () => {
    const def = getEncounter('bone_pit')!;
    // Jump straight to the 'sinking' hazard node (reached on a failed crossing).
    const atSinking = { ...startEncounter(def), nodeId: 'sinking', done: false };
    const hpIdx = def.nodes.sinking.choices!.findIndex((c) => c.stat === 'HP');
    expect(hpIdx).toBeGreaterThanOrEqual(0);
    const { state } = chooseEncounter(atSinking, def, hpIdx, strong('HP'), {}, fixed(0));
    expect(state.lastOutcome).toBe('success');
  });
});

// Registration sanity: a biome that lists an unknown encounter key silently drops the event.
describe('biome encounter registration', () => {
  it('every encounter key listed in a biome resolves to a real encounter', () => {
    for (const biome of Object.values(BIOMES)) {
      for (const key of biome.encounters) {
        expect(getEncounter(key), `${biome.key} → ${key}`).toBeTruthy();
      }
    }
  });
});
