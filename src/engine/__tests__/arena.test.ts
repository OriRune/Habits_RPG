import { describe, it, expect } from 'vitest';
import {
  createArena,
  arenaMove,
  arenaMelee,
  arenaRanged,
  arenaCast,
  arenaUseItem,
  arenaTick,
  arenaReward,
  damageProgress,
  rollArenaSetup,
  arenaSpeedFactor,
  ARENA_RADIUS,
  ARENA_UNLOCK_LEVEL,
  type ArenaState,
  type Minion,
} from '../arena';
import { getSpell } from '../spells';
import type { Fighter, Combatant } from '../combat';
import type { BossDef } from '../bosses';
import type { WeaponDef } from '../weapons';

const SWORD: WeaponDef = {
  key: 'test_sword', name: 'Test Sword', attackStat: 'ST', bonus: 5, staminaCost: 2, description: '',
};

function fighter(over: Partial<Combatant> = {}): Fighter {
  const c: Combatant = {
    maxHp: 100, maxMp: 20, maxSta: 10,
    meleePower: 10, rangedPower: 8, dodge: 0, flee: 0,
    damageSpell: 5, supportSpell: 5, illusionPower: 0, defense: 0, ward: 0,
    ...over,
  };
  return { c, weapon: SWORD };
}

function boss(over: Partial<BossDef> = {}): BossDef {
  return {
    id: 'test', name: 'Test Boss', flavor: '', baseHp: 50, attack: 10, defense: 0,
    weakTo: [], resistTo: [], rewards: { gold: 100, items: ['healing_potion'] }, ...over,
  };
}

/** Deterministic rng → variance multiplier of exactly 1.0 (0.85 + 0.5*0.3 = 1.0). */
const HALF = () => 0.5;

function freshRun(f = fighter(), b = boss()): ArenaState {
  const s = createArena(f, b, {
    knownSpells: ['sparks', 'mend', 'bless', 'hex', 'dazzle'],
    inventory: { healing_potion: 1 },
    tier: 5,
    startMs: 0,
  });
  s.bossNextActionMs = Infinity; // freeze boss AI unless a test opts in
  s.bossNextMoveMs = Infinity;
  s.nextSummonMs = Infinity; // no surprise summons in deterministic tests
  s.obstacles = []; // clear the rolled cover so positions are predictable
  s.minions = [];
  return s;
}

function minionAt(s: ArenaState, pos: { x: number; y: number }, hp = 8): Minion {
  const m: Minion = { id: s.seq++, pos, hp, maxHp: hp, attack: 6, nextMoveMs: 0, nextHitMs: 0, frozenUntilMs: 0, poisonDmg: 0, poisonNextTickMs: 0, poisonExpiresMs: 0 };
  s.minions.push(m);
  return m;
}

describe('arena movement', () => {
  it('steps within the board and always updates facing', () => {
    const s = freshRun();
    expect(s.player.pos).toEqual({ x:0, y:ARENA_RADIUS });
    const moved = arenaMove(s, 'up');
    expect(moved.player.facing).toBe('up');
    expect(moved.player.pos).toEqual({ x:0, y:ARENA_RADIUS - 1 });
    // Walking off the bottom edge is blocked, but facing still turns.
    const blocked = arenaMove(s, 'down');
    expect(blocked.player.facing).toBe('down');
    expect(blocked.player.pos).toEqual({ x:0, y:ARENA_RADIUS });
  });
});

describe('arena melee', () => {
  it('only lands when the boss is adjacent', () => {
    const far = freshRun();
    expect(arenaMelee(far, 1000, HALF)).toBe(far); // unchanged reference when out of reach

    const s = freshRun();
    s.player.pos = { x:0, y:-ARENA_RADIUS + 1 }; // adjacent to boss at {0,-R}
    const hit = arenaMelee(s, 1000, HALF);
    expect(hit.bossHp).toBe(50 - (10 + 5)); // meleePower + weapon bonus, variance ×1.0
  });

  it('respects the attack cooldown', () => {
    const s = freshRun();
    s.player.pos = { x:0, y:-ARENA_RADIUS + 1 };
    const first = arenaMelee(s, 1000, HALF);
    const second = arenaMelee(first, 1100, HALF); // still cooling down
    expect(second).toBe(first);
  });

  it('applies a weakness multiplier through the shared damage roll', () => {
    const s = freshRun(fighter(), boss({ weakTo: ['ST'] }));
    s.player.pos = { x:0, y:-ARENA_RADIUS + 1 };
    const hit = arenaMelee(s, 1000, HALF);
    expect(hit.bossHp).toBe(50 - Math.round(15 * 1.25));
  });
});

describe('arena ranged', () => {
  it('fires a bolt down the facing line that strikes the boss', () => {
    const s = freshRun();
    s.player.pos = { x:0, y:0 };
    s.bossPos = { x:0, y:-2 };
    s.player.facing = 'up';
    const fired = arenaRanged(s, 1000, HALF);
    expect(fired.projectiles).toHaveLength(1);
    expect(fired.projectiles[0].pos).toEqual({ x:0, y:-1 });
    // Advance the clock enough for the bolt to reach the boss hex.
    const after = arenaTick(fired, 1300, HALF);
    expect(after.projectiles).toHaveLength(0);
    expect(after.bossHp).toBe(50 - 8); // rangedPower 8, no bonus (weapon is melee), variance ×1.0
  });
});

describe('arena spells & items', () => {
  it('gates a cast on MP and spends it on success', () => {
    const poor = freshRun(fighter({ maxMp: 2 }));
    poor.mp = 2;
    expect(arenaCast(poor, 'sparks', 1000, HALF)).toBe(poor); // sparks costs 4 MP

    const s = freshRun();
    const cast = arenaCast(s, 'sparks', 1000, HALF);
    expect(cast.mp).toBe(s.mp - 4);
    expect(cast.bossHp).toBeLessThan(s.bossHp);
  });

  it('heals from a battle potion and consumes it', () => {
    const s = freshRun();
    s.hp = 40;
    const healed = arenaUseItem(s, 'healing_potion', 1000);
    expect(healed.hp).toBe(80); // healing_potion restores 40
    expect(healed.inventory.healing_potion).toBe(0);
  });
});

describe('arena telegraphs (dodging)', () => {
  function withSlam(): ArenaState {
    const s = freshRun();
    s.player.pos = { x:0, y:0 };
    s.telegraphs.push({
      id: 1, kind: 'slam', tiles: [{ x:0, y:0 }], startedAtMs: 0, firesAtMs: 100, raw: 20, school: 'physical',
    });
    return s;
  }

  it('deals damage when the player stays on a marked hex', () => {
    const s = withSlam();
    const after = arenaTick(s, 150, HALF);
    expect(after.hp).toBe(80);
    expect(after.telegraphs).toHaveLength(0);
  });

  it('deals zero damage when the player steps off in time', () => {
    const s = withSlam();
    s.player.pos = { x:1, y:0 }; // stepped off the slam tile
    const after = arenaTick(s, 150, HALF);
    expect(after.hp).toBe(100);
    expect(after.telegraphs).toHaveLength(0);
  });
});

describe('arena outcomes', () => {
  it('advances phases, then declares victory on the final phase', () => {
    const twoPhase = boss({ phases: [
      { hp: 10, attack: 5, defense: 0, weakTo: [] },
      { hp: 10, attack: 5, defense: 0, weakTo: [] },
    ] });
    const s = freshRun(fighter(), twoPhase);
    s.player.pos = { x:0, y:-ARENA_RADIUS + 1 };
    const p1 = arenaMelee(s, 1000, HALF); // 15 dmg > 10 hp
    expect(p1.phaseIndex).toBe(1);
    expect(p1.status).toBe('active');
    expect(p1.bossHp).toBe(10);

    p1.player.pos = { x:0, y:-ARENA_RADIUS + 1 };
    p1.bossPos = { x:0, y:-ARENA_RADIUS };
    const won = arenaMelee(p1, 5000, HALF);
    expect(won.status).toBe('won');
  });

  it('ends the run when the player falls', () => {
    const s = freshRun();
    s.hp = 5;
    s.player.pos = { x:0, y:0 };
    s.telegraphs.push({
      id: 1, kind: 'slam', tiles: [{ x:0, y:0 }], startedAtMs: 0, firesAtMs: 100, raw: 50, school: 'physical',
    });
    const after = arenaTick(s, 150, HALF);
    expect(after.status).toBe('ended');
    expect(after.hp).toBe(0);
  });
});

describe('arena rewards', () => {
  it('pays the full reward (with items) on a win', () => {
    const s = freshRun();
    s.status = 'won';
    expect(arenaReward(s)).toEqual({ gold: 100, items: ['healing_potion'] });
  });

  it('keeps half the earned share on death (no items)', () => {
    const s = freshRun();
    s.status = 'ended';
    s.bossHp = 25; // removed half the 50-HP bar
    expect(damageProgress(s)).toBeCloseTo(0.5);
    expect(arenaReward(s)).toEqual({ gold: 25 }); // floor(100 * 0.5 * 0.5)
  });

  it('keeps the full earned share on a voluntary retreat', () => {
    const s = freshRun();
    s.status = 'banking';
    s.bossHp = 25;
    expect(arenaReward(s)).toEqual({ gold: 50 }); // floor(100 * 0.5 * 1)
  });
});

describe('arena obstacles', () => {
  it('block movement and absorb ranged bolts', () => {
    const s = freshRun();
    s.player.pos = { x:0, y:0 };
    s.obstacles = [{ x:0, y:-1 }];
    // Moving up onto the obstacle is rejected, but facing still updates.
    const blocked = arenaMove(s, 'up');
    expect(blocked.player.pos).toEqual({ x:0, y:0 });
    expect(blocked.player.facing).toBe('up');

    // A bolt fired into the obstacle is absorbed and never reaches the boss behind it.
    s.bossPos = { x:0, y:-3 };
    s.player.facing = 'up';
    const fired = arenaRanged(s, 1000, HALF);
    const after = arenaTick(fired, 1400, HALF);
    expect(after.projectiles).toHaveLength(0);
    expect(after.bossHp).toBe(50); // unharmed — the bolt hit cover
  });
});

describe('arena minions', () => {
  it('can be killed by a melee swing', () => {
    const s = freshRun();
    s.player.pos = { x:0, y:0 };
    s.player.facing = 'up';
    minionAt(s, { x:0, y:-1 }, 8); // weak minion on the faced hex
    const hit = arenaMelee(s, 1000, HALF); // 15 dmg > 8 hp
    expect(hit.minions).toHaveLength(0);
    expect(hit.bossHp).toBe(50); // boss untouched — melee struck the minion
  });

  it('chip the player on contact', () => {
    const s = freshRun();
    s.player.pos = { x:0, y:0 };
    s.bossPos = { x:0, y:-ARENA_RADIUS };
    minionAt(s, { x:0, y:-1 }, 8); // adjacent, nextHitMs = 0
    const after = arenaTick(s, 1000, HALF);
    expect(after.hp).toBe(100 - 6); // minion attack 6, variance ×1.0, no mitigation
  });
});

describe('arena non-damage spells', () => {
  it('mend restores HP', () => {
    const s = freshRun();
    s.hp = 40;
    const healed = arenaCast(s, 'mend', 1000, HALF);
    const expected = Math.round(getSpell('mend')!.power + s.supportSpell * 1.5);
    expect(healed.hp).toBe(40 + expected);
  });

  it('bless reduces a subsequent hit', () => {
    const s = freshRun();
    s.player.pos = { x:0, y:0 };
    const blessed = arenaCast(s, 'bless', 1000, HALF);
    expect(blessed.playerStatuses.some((x) => x.key === 'bless')).toBe(true);
    blessed.telegraphs.push({
      id: 9, kind: 'slam', tiles: [{ x:0, y:0 }], startedAtMs: 1000, firesAtMs: 1100, raw: 20, school: 'physical',
    });
    const after = arenaTick(blessed, 1200, HALF);
    expect(after.hp).toBe(100 - (20 - 6)); // bless magnitude 6 shaves the hit
  });

  it('hex (weaken) cuts the boss damage', () => {
    const s = freshRun();
    s.player.pos = { x:0, y:0 };
    const hexed = arenaCast(s, 'hex', 1000, HALF);
    expect(hexed.enemyStatuses.some((x) => x.key === 'weaken')).toBe(true);
    hexed.telegraphs.push({
      id: 9, kind: 'slam', tiles: [{ x:0, y:0 }], startedAtMs: 1000, firesAtMs: 1100, raw: 20, school: 'physical',
    });
    const after = arenaTick(hexed, 1200, HALF);
    expect(after.hp).toBe(100 - Math.round(20 * (1 - 0.4))); // weaken 40%
  });
});

describe('arena invincibility', () => {
  it('blocks all incoming damage and keeps resources topped', () => {
    const s = freshRun();
    s.invincible = true;
    s.hp = 100;
    s.player.pos = { x:0, y:0 };
    s.telegraphs.push({
      id: 1, kind: 'slam', tiles: [{ x:0, y:0 }], startedAtMs: 0, firesAtMs: 100, raw: 999, school: 'physical',
    });
    const after = arenaTick(s, 150, HALF);
    expect(after.status).toBe('active');
    expect(after.hp).toBe(after.maxHp);
  });
});

// ── Iteration 4 tests ─────────────────────────────────────────────────────────

describe('BFS pathfinding routes around obstacle walls', () => {
  it('minion reaches player through an L-shaped wall', () => {
    // Wall: two obstacles blocking the direct approach, forcing a detour
    const s = freshRun();
    s.player.pos = { x: 0, y: 0 };
    s.bossPos = { x: 0, y: -ARENA_RADIUS }; // keep boss out of the way
    s.obstacles = [
      { x: -1, y: -1 },
      { x:  0, y: -1 },
      { x:  1, y: -1 },
    ];
    const m = minionAt(s, { x: 0, y: -2 }, 50);
    m.nextMoveMs = 0;
    // After several ticks the minion should close in — it was stuck with greedy step
    let cur = s;
    for (let i = 0; i < 10; i++) cur = arenaTick(cur, 1000 + i * 200, HALF);
    const minion = cur.minions[0];
    // Must have moved from {0,-2} — if still there it means it's stuck
    expect(minion).toBeDefined();
    const dist = Math.max(Math.abs(minion!.pos.x), Math.abs(minion!.pos.y));
    expect(dist).toBeLessThan(2); // got close to player at {0,0}
  });
});

describe('rune spells', () => {
  const runeRun = () => {
    const s = freshRun(
      fighter(),
      boss(),
    );
    s.knownSpells = ['fire_rune', 'ice_rune', 'poison_rune'];
    s.mp = 99;
    return s;
  };

  it('fire rune is placed adjacent and damages an enemy that steps on it', () => {
    const s = runeRun();
    s.player.pos = { x: 0, y: 0 };
    s.player.facing = 'up';
    // Place rune on {0,-1}
    const placed = arenaCast(s, 'fire_rune', 1000, HALF, { target: { x: 0, y: -1 } });
    expect(placed.runes).toHaveLength(1);
    expect(placed.runes[0]!.pos).toEqual({ x: 0, y: -1 });
    expect(placed.runes[0]!.kind).toBe('fire');
    // Move boss to the rune tile
    placed.bossPos = { x: 0, y: -1 };
    const triggered = arenaTick(placed, 1100, HALF);
    // Rune consumed
    expect(triggered.runes).toHaveLength(0);
    // Boss took damage
    expect(triggered.bossHp).toBeLessThan(50);
  });

  it('rune target beyond adjacent range is clamped to adjacent tile', () => {
    const s = runeRun();
    s.player.pos = { x: 0, y: 0 };
    // Target 3 cells away — should clamp to 1 step
    const placed = arenaCast(s, 'fire_rune', 1000, HALF, { target: { x: 0, y: -3 } });
    expect(placed.runes).toHaveLength(1);
    const pos = placed.runes[0]!.pos;
    const d = Math.max(Math.abs(pos.x - 0), Math.abs(pos.y - 0));
    expect(d).toBeLessThanOrEqual(1);
  });

  it('ice rune freezes the boss for ~3s', () => {
    const s = runeRun();
    s.player.pos = { x: 0, y: 0 };
    s.player.facing = 'up';
    const placed = arenaCast(s, 'ice_rune', 1000, HALF, { target: { x: 0, y: -1 } });
    placed.bossPos = { x: 0, y: -1 };
    const triggered = arenaTick(placed, 1100, HALF);
    expect(triggered.runes).toHaveLength(0);
    expect(triggered.bossFrozenUntilMs).toBeGreaterThan(1100);
  });

  it('ice rune freezes a minion (not the boss) if a minion steps on it', () => {
    const s = runeRun();
    s.player.pos = { x: 0, y: 0 };
    s.player.facing = 'up';
    s.bossPos = { x: 0, y: -ARENA_RADIUS }; // boss far away
    const placed = arenaCast(s, 'ice_rune', 1000, HALF, { target: { x: 0, y: -1 } });
    const m = minionAt(placed, { x: 0, y: -1 }, 30);
    m.nextMoveMs = Infinity; // pin it so it stays on the rune tile
    const triggered = arenaTick(placed, 1100, HALF);
    const mn = triggered.minions.find((x) => x.id === m.id);
    expect(mn?.frozenUntilMs).toBeGreaterThan(1100);
  });

  it('poison rune applies poison DoT to a minion that steps on it', () => {
    const s = runeRun();
    s.player.pos = { x: 0, y: 0 };
    s.player.facing = 'up';
    s.bossPos = { x: 0, y: -ARENA_RADIUS };
    const placed = aranaCastFixed(s, 'poison_rune', { x: 0, y: -1 });
    const m = minionAt(placed, { x: 0, y: -1 }, 30);
    m.nextMoveMs = Infinity;
    const triggered = arenaTick(placed, 1100, HALF);
    const mn = triggered.minions.find((x) => x.id === m.id);
    expect(mn?.poisonDmg).toBeGreaterThan(0);
    expect(mn?.poisonExpiresMs).toBeGreaterThan(1100);
  });

  it('expired rune disappears without triggering', () => {
    const s = runeRun();
    s.player.pos = { x: 0, y: 0 };
    const placed = arenaCast(s, 'fire_rune', 1000, HALF, { target: { x: 0, y: -1 } });
    // Tick past expiry without any unit on the rune tile
    s.bossPos = { x: 0, y: ARENA_RADIUS };
    const late = arenaTick(placed, 1000 + 15000, HALF);
    expect(late.runes).toHaveLength(0);
    expect(late.bossHp).toBe(50); // no damage
  });
});

function aranaCastFixed(s: ReturnType<typeof freshRun>, key: string, target?: { x: number; y: number }) {
  return arenaCast(s, key, 1000, HALF, target ? { target } : undefined);
}

describe('ring of fire spell', () => {
  it('sets ringOfFire and damages an adjacent enemy each tick', () => {
    const s = freshRun();
    s.knownSpells = ['ring_of_fire'];
    s.mp = 99;
    s.player.pos = { x: 0, y: 0 };
    s.bossPos = { x: 1, y: 0 }; // adjacent (distance 1)
    const cast = arenaCast(s, 'ring_of_fire', 1000, HALF);
    expect(cast.ringOfFire).not.toBeNull();
    const tickMs = 1000 + 700; // after ring-hit CD
    const after = arenaTick(cast, tickMs, HALF);
    expect(after.bossHp).toBeLessThan(50);
  });

  it('ring does not hit an enemy outside distance 1', () => {
    const s = freshRun();
    s.knownSpells = ['ring_of_fire'];
    s.mp = 99;
    s.player.pos = { x: 0, y: 0 };
    s.bossPos = { x: 2, y: 0 }; // distance 2 — outside ring
    const cast = arenaCast(s, 'ring_of_fire', 1000, HALF);
    const after = arenaTick(cast, 1700, HALF);
    expect(after.bossHp).toBe(50);
  });
});

describe('teleport spell', () => {
  it('moves the player to an open cell 3-5 cells away', () => {
    const s = freshRun();
    s.knownSpells = ['chaotic_blink'];
    s.mp = 99;
    s.player.pos = { x: 0, y: 0 };
    const after = arenaCast(s, 'chaotic_blink', 1000, HALF);
    const { pos } = after.player;
    const d = Math.max(Math.abs(pos.x), Math.abs(pos.y));
    expect(d).toBeGreaterThanOrEqual(3);
    expect(d).toBeLessThanOrEqual(5);
  });
});

describe('arena setup & speed rolls', () => {
  it('rollArenaSetup yields valid sizes/densities and matching minion counts', () => {
    const small = rollArenaSetup(3, () => 0);
    expect(small.radius).toBe(3);
    expect(small.density).toBe('light');
    expect(small.startMinions).toBe(0);

    const large = rollArenaSetup(12, () => 0.999);
    expect(large.radius).toBe(5);
    expect(large.density).toBe('heavy');
    expect(large.startMinions).toBe(2);
  });

  it('arenaSpeedFactor maps presets and scales with level on auto', () => {
    expect(arenaSpeedFactor('slow', 10)).toBe(0.85);
    expect(arenaSpeedFactor('normal', 10)).toBe(1);
    expect(arenaSpeedFactor('fast', 10)).toBe(1.2);
    expect(arenaSpeedFactor('auto', ARENA_UNLOCK_LEVEL)).toBeCloseTo(0.85); // floor at unlock
    expect(arenaSpeedFactor('auto', 50)).toBe(1.2); // capped high
  });

  it('higher speed shortens the boss/summon clock', () => {
    const slow = createArena(fighter(), boss(), { knownSpells: [], inventory: {}, tier: 5, startMs: 0, radius: 5, speed: 1 });
    const fast = createArena(fighter(), boss(), { knownSpells: [], inventory: {}, tier: 5, startMs: 0, radius: 5, speed: 2 });
    expect(fast.nextSummonMs).toBeLessThan(slow.nextSummonMs);
  });
});
