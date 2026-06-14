import { describe, it, expect } from 'vitest';
import { emptyStatXP, statPoints, statPower } from '../stats';
import {
  generateDungeon,
  resolveStatRoom,
  restHeal,
  mergeReward,
  ROOM_FAVORED,
  DUNGEON_ENERGY_COST,
} from '../dungeon';
import { type RNG } from '../combat';

const fixed = (v: number): RNG => () => v;

describe('statPoints / statPower', () => {
  it('tapers XP via sqrt', () => {
    expect(statPoints(0)).toBe(0);
    expect(statPoints(100)).toBe(10);
    expect(statPoints(400)).toBe(20);
  });
  it('sums favored stats', () => {
    const xp = emptyStatXP();
    xp.DX = 400; // 20
    xp.AG = 100; // 10
    expect(statPower(xp, ['DX', 'AG'])).toBe(30);
  });
});

describe('ROOM_FAVORED', () => {
  it('matches the brief table', () => {
    expect(ROOM_FAVORED.trap).toEqual(['DX', 'AG']);
    expect(ROOM_FAVORED.combat).toEqual(['ST', 'HP', 'EN']);
    expect(ROOM_FAVORED.puzzle).toEqual(['KN', 'WI']);
    expect(ROOM_FAVORED.treasure).toEqual(['DX', 'KN']);
  });
});

describe('generateDungeon', () => {
  it('builds a 4-room delve with combat, rest, and treasure', () => {
    const rooms = generateDungeon(fixed(0));
    expect(rooms).toHaveLength(4);
    const types = rooms.map((r) => r.type);
    expect(types[0]).toBe('trap'); // first stat room, rng=0 -> pool[0]
    expect(types).toContain('combat');
    expect(types).toContain('rest');
    expect(types[3]).toBe('treasure');
  });

  it('costs 3 energy per the brief', () => {
    expect(DUNGEON_ENERGY_COST).toBe(3);
  });
});

describe('resolveStatRoom', () => {
  it('a strong character succeeds and earns loot, no HP loss', () => {
    const xp = emptyStatXP();
    xp.DX = 400; // 20
    xp.AG = 400; // 20  -> power 40, well above trap threshold
    const res = resolveStatRoom({ type: 'trap' }, xp, 100, fixed(0));
    expect(res.outcome).toBe('success');
    expect(res.hpDelta).toBe(0);
    expect(res.reward.gold).toBeGreaterThan(0);
    expect(Object.keys(res.reward.materials ?? {}).length).toBeGreaterThan(0);
  });

  it('a weak character fails and takes damage', () => {
    const res = resolveStatRoom({ type: 'trap' }, emptyStatXP(), 100, fixed(0.99));
    expect(res.outcome).toBe('fail');
    expect(res.hpDelta).toBeLessThan(0);
    expect(res.reward.gold ?? 0).toBe(0);
  });

  it('treasure rooms grant richer rewards including essence', () => {
    const xp = emptyStatXP();
    xp.DX = 900; // 30
    xp.KN = 900; // 30
    const res = resolveStatRoom({ type: 'treasure' }, xp, 100, fixed(0));
    expect(res.outcome).toBe('success');
    expect(res.reward.gold).toBeGreaterThanOrEqual(80);
    expect(res.reward.materials?.essence).toBe(1);
  });

  it('rest rooms heal and never harm', () => {
    const res = resolveStatRoom({ type: 'rest' }, emptyStatXP(), 100, fixed(0.99));
    expect(res.outcome).toBe('success');
    expect(res.hpDelta).toBe(restHeal(100));
    expect(res.hpDelta).toBeGreaterThan(0);
  });
});

describe('mergeReward', () => {
  it('sums gold, materials, and items', () => {
    const a = { gold: 50, materials: { iron: 1 }, items: ['healing_potion'] };
    const b = { gold: 30, materials: { iron: 2, leather: 1 } };
    const merged = mergeReward(a, b);
    expect(merged.gold).toBe(80);
    expect(merged.materials).toEqual({ iron: 3, leather: 1 });
    expect(merged.items).toEqual(['healing_potion']);
  });
});
