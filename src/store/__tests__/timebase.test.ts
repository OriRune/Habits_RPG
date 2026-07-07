// Regression tests for the timebase convention pass (plan3 item 2.1, MINI-02).
//
// The crawler engines run on the rAF clock (ms since page load, ~1e5), injected
// as `nowMs` by the loop hooks. Before the fix, the charged-strike and cast
// store actions injected `Date.now()` (~1.78e12) instead, so every engine
// timestamp they stamped (freeze stagger, rune expiry, spell cooldown) sat
// ~56 years ahead of the tick clock — freezes never expired and buffs were
// permanent. These tests pin the store actions to the injected rAF `nowMs`.
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../useGameStore';
import { resetRunRng } from '../runRng';
import { STAGGER_MS } from '@/engine/crawl';
import { getWeapon, STARTER_WEAPON } from '@/engine/weapons';
import type { MineState, MineTile } from '@/engine/mining';
import type { ForestState, ForestTile } from '@/engine/forest';

const WEAPON = getWeapon(STARTER_WEAPON);

/** 7×7 mine clearing: bedrock border, floor interior, player centred facing right. */
function makeMine(over: Partial<MineState> = {}): MineState {
  const rows = 7;
  const cols = 7;
  const tiles: MineTile[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: MineTile[] = [];
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      row.push(border ? { kind: 'bedrock' } : { kind: 'floor' });
    }
    tiles.push(row);
  }
  return {
    floor: 1,
    rows,
    cols,
    tiles,
    player: { r: 3, c: 3, facing: 'right' },
    hp: 50,
    maxHp: 50,
    sta: 55,
    maxSta: 55,
    mp: 8,
    maxMp: 8,
    staNextRegenMs: 0,
    mpNextRegenMs: 0,
    meleePower: 5,
    rangedPower: 3,
    damageSpell: 2,
    supportSpell: 2,
    illusionPower: 1,
    defense: 0,
    ward: 0,
    weapon: WEAPON,
    knownSpells: [],
    pickaxePower: 1,
    monsters: [],
    haul: {},
    status: 'active',
    lastHitAtMs: -1000,
    deepest: 1,
    killsThisFloor: 0,
    score: 0,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -1000,
    nextRuneId: 1,
    lastDashMs: -2000,
    dashCooldownMs: 2000,
    moveIntervalMs: 150,
    agLevel: 0,
    activeBoons: [],
    pendingBoonChoice: null,
    ...over,
  };
}

/** 7×7 forest clearing: thicket border, trail interior, player centred facing right. */
function makeForest(over: Partial<ForestState> = {}): ForestState {
  const rows = 7;
  const cols = 7;
  const tiles: ForestTile[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: ForestTile[] = [];
    for (let c = 0; c < cols; c++) {
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      row.push(border ? { kind: 'thicket' } : { kind: 'trail' });
    }
    tiles.push(row);
  }
  const seen: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(true));
  return {
    stage: 1,
    rows,
    cols,
    tiles,
    seen,
    player: { r: 3, c: 3, facing: 'right' },
    hp: 50,
    maxHp: 50,
    sta: 55,
    maxSta: 55,
    mp: 8,
    maxMp: 8,
    staNextRegenMs: 0,
    mpNextRegenMs: 0,
    meleePower: 5,
    rangedPower: 3,
    damageSpell: 2,
    supportSpell: 2,
    illusionPower: 1,
    defense: 0,
    ward: 0,
    weapon: WEAPON,
    knownSpells: [],
    chopPower: 1,
    beasts: [],
    haul: {},
    status: 'active',
    lastHitAtMs: -1000,
    deepest: 1,
    killsThisStage: 0,
    score: 0,
    runes: [],
    ringOfFire: null,
    ringNextHitMs: {},
    playerStatuses: [],
    lastSpellMs: -1000,
    nextRuneId: 1,
    lastDashMs: -2000,
    dashCooldownMs: 2000,
    moveIntervalMs: 150,
    agLevel: 0,
    activeBoons: [],
    pendingBoonChoice: null,
    ...over,
  };
}

beforeEach(() => {
  resetRunRng();
  useGameStore.setState({ mining: null, forest: null });
});

describe('mine actions run on the injected rAF clock (MINI-02)', () => {
  it('mineStrikeCharged(nowMs) staggers the hit monster relative to nowMs, not Date.now()', () => {
    useGameStore.setState({
      mining: makeMine({
        monsters: [{ id: 'a', key: 'cave_slug', r: 3, c: 4, hp: 50, maxHp: 50, readyAtMs: 0 }],
      }),
    });
    useGameStore.getState().mineStrikeCharged(2000);
    const m = useGameStore.getState().mining!.monsters[0];
    expect(m.hp).toBeLessThan(50); // the swing landed
    expect(m.frozenUntilMs).toBe(2000 + STAGGER_MS); // rAF domain: expires on a later tick
  });

  it('mineCast(key, nowMs) stamps the spell cooldown and rune expiry from nowMs', () => {
    useGameStore.setState({ mining: makeMine({ knownSpells: ['ice_rune'] }) });
    useGameStore.getState().mineCast('ice_rune', 2000);
    const mining = useGameStore.getState().mining!;
    expect(mining.lastSpellMs).toBe(2000);
    expect(mining.runes[0]?.expiresAtMs).toBe(2000 + 30000);
  });
});

describe('forest actions run on the injected rAF clock (MINI-02)', () => {
  it('forestActCharged(nowMs) staggers the hit beast relative to nowMs, not Date.now()', () => {
    useGameStore.setState({
      forest: makeForest({
        beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 4, hp: 50, maxHp: 50, readyAtMs: 0, asleep: false }],
      }),
    });
    useGameStore.getState().forestActCharged(4000);
    const b = useGameStore.getState().forest!.beasts[0];
    expect(b.hp).toBeLessThan(50);
    expect(b.frozenUntilMs).toBe(4000 + STAGGER_MS);
  });

  it('forestCast(key, nowMs) stamps the spell cooldown and rune expiry from nowMs', () => {
    useGameStore.setState({ forest: makeForest({ knownSpells: ['ice_rune'] }) });
    useGameStore.getState().forestCast('ice_rune', 4000);
    const forest = useGameStore.getState().forest!;
    expect(forest.lastSpellMs).toBe(4000);
    expect(forest.runes[0]?.expiresAtMs).toBe(4000 + 30000);
  });

  it('forestAct(nowMs) threads nowMs so a ranged shot tracer is stamped on the rAF clock (ARCH-25a)', () => {
    useGameStore.setState({
      forest: makeForest({
        weapon: getWeapon('short_bow'),
        beasts: [{ id: 'a', key: 'wild_boar', r: 3, c: 5, hp: 50, maxHp: 50, readyAtMs: 0, asleep: false }],
      }),
    });
    useGameStore.getState().forestAct(4000);
    expect(useGameStore.getState().forest!.lastShot?.at).toBe(4000);
  });
});
