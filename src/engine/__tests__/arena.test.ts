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
import { arenaMoveIntervalFor } from '@/hooks/useArenaLoop';
import { getSpell } from '../spells';
import type { Fighter, Combatant } from '../combat';
import type { BossDef } from '../bosses';
import { genericBossReward } from '../bosses';
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
  const m: Minion = { id: s.seq++, pos, hp, maxHp: hp, attack: 6, variant: 'bat', nextMoveMs: 0, nextHitMs: 0, frozenUntilMs: 0, poisonDmg: 0, poisonNextTickMs: 0, poisonExpiresMs: 0 };
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

describe('arena charge telegraph (gap-closer)', () => {
  // Boss far to the north, player at centre; a straight lane drawn between them.
  function withCharge(): ArenaState {
    const s = freshRun();
    s.player.pos = { x:0, y:0 };
    s.bossPos = { x:0, y:-4 };
    s.telegraphs.push({
      id: 1, kind: 'charge',
      tiles: [ {x:0,y:-3}, {x:0,y:-2}, {x:0,y:-1}, {x:0,y:0}, {x:0,y:1}, {x:0,y:2}, {x:0,y:3}, {x:0,y:4} ],
      startedAtMs: 0, firesAtMs: 100, raw: 20, school: 'physical',
    });
    return s;
  }

  it('dashes the boss down the lane and connects when the player holds ground', () => {
    const s = withCharge();
    const after = arenaTick(s, 150, HALF);
    expect(after.bossPos).toEqual({ x:0, y:-1 }); // closed the gap, stops adjacent to the player
    expect(after.hp).toBe(80); // 20 raw, defense 0 → charge connected
    expect(after.telegraphs).toHaveLength(0);
  });

  it('overruns harmlessly when the player steps off the lane', () => {
    const s = withCharge();
    s.player.pos = { x:2, y:0 }; // stepped clear of the charge lane during the windup
    const after = arenaTick(s, 150, HALF);
    expect(after.bossPos).toEqual({ x:0, y:4 }); // still repositions — dashes past to the lane's end
    expect(after.bossPos).not.toEqual({ x:0, y:-4 }); // gap closed even on a whiff
    expect(after.hp).toBe(100); // never became adjacent → no damage
    expect(after.telegraphs).toHaveLength(0);
  });

  it('chooseKind biases toward a charge only when the player is far', () => {
    // Reach chooseKind through a live boss tick: freeze movement, arm the AI, force a far gap.
    const s = freshRun();
    s.player.pos = { x:0, y:4 };
    s.bossPos = { x:0, y:-4 }; // distance 8 — squarely in the kite zone
    s.bossNextActionMs = 0;
    const after = arenaTick(s, 1, () => 0.1); // roll 0.1 < 0.4 → charge branch
    expect(after.telegraphs).toHaveLength(1);
    expect(after.telegraphs[0].kind).toBe('charge');
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
    // Generic curve at tier 5: 40 + 8*5 = 80 gold, no item (5 % 3 !== 0).
    expect(arenaReward(s)).toEqual({ gold: 80, items: [] });
  });

  it('keeps half the earned share on death (no items)', () => {
    const s = freshRun();
    s.status = 'ended';
    s.bossHp = 25; // removed half the 50-HP bar
    expect(damageProgress(s)).toBeCloseTo(0.5);
    expect(arenaReward(s)).toEqual({ gold: 20 }); // floor(80 * 0.5 * 0.5)
  });

  it('keeps the full earned share on a voluntary retreat', () => {
    const s = freshRun();
    s.status = 'banking';
    s.bossHp = 25;
    expect(arenaReward(s)).toEqual({ gold: 40 }); // floor(80 * 0.5 * 1)
  });

  it('pays the generic curve — never the named-boss table — at a named tier', () => {
    // A named boss's own rich reward table (500g + named items) must NOT be
    // farmable through repeatable Arena runs. Arena ignores boss.rewards.
    const named = boss({ rewards: { gold: 500, items: ['recovery_elixir', 'healing_potion'] } });
    const s = createArena(fighter(), named, {
      knownSpells: [],
      inventory: {},
      tier: 20,
      startMs: 0,
    });
    s.status = 'won';
    // Generic curve at tier 20: 40 + 8*20 = 200 gold, no item (20 % 3 !== 0).
    expect(arenaReward(s)).toEqual({ gold: 200, items: [] });
  });
});

describe('genericBossReward', () => {
  it('pays 40 + 8*tier gold and drops a potion only on tiers divisible by 3', () => {
    expect(genericBossReward(1)).toEqual({ gold: 48, items: [] });
    expect(genericBossReward(3)).toEqual({ gold: 64, items: ['healing_potion'] });
    expect(genericBossReward(5)).toEqual({ gold: 80, items: [] });
    expect(genericBossReward(20)).toEqual({ gold: 200, items: [] });
    expect(genericBossReward(30)).toEqual({ gold: 280, items: ['healing_potion'] });
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

describe('MINI-07/26/37a arena spell integrity', () => {
  // MINI-07 — ice_rune must not stunlock a boss forever. One freeze lands, then the boss is
  // immune to re-freeze for FREEZE_IMMUNITY_MS past the thaw, so 1.8 MP/s regen can't sustain
  // a permanent lock. A rune stepped onto during immunity still chips but cannot re-lock.
  const iceRun = () => {
    const s = freshRun();
    s.knownSpells = ['ice_rune'];
    s.mp = 999;
    s.player.pos = { x: 0, y: 0 };
    s.player.facing = 'up';
    return s;
  };

  it('MINI-07: a second ice_rune within the immunity window cannot re-freeze the boss', () => {
    const s = iceRun();
    const c1 = arenaCast(s, 'ice_rune', 1000, HALF, { target: { x: 0, y: -1 } });
    c1.bossPos = { x: 0, y: -1 };
    const st1 = arenaTick(c1, 1100, HALF);
    const frozenUntil1 = st1.bossFrozenUntilMs;
    expect(frozenUntil1).toBeGreaterThan(1100); // first freeze landed
    expect(st1.bossFreezeImmuneUntilMs).toBeGreaterThan(frozenUntil1); // immunity outlasts the thaw
    // Second ice_rune during immunity — it fires (rune consumed) but must not re-lock the boss.
    st1.player.pos = { x: 0, y: 0 };
    st1.mp = 999;
    const c2 = arenaCast(st1, 'ice_rune', 2000, HALF, { target: { x: 0, y: -1 } });
    c2.bossPos = { x: 0, y: -1 };
    const st2 = arenaTick(c2, 2100, HALF);
    expect(st2.runes).toHaveLength(0); // the rune did trigger…
    expect(st2.bossFrozenUntilMs).toBe(frozenUntil1); // …but the freeze window is unchanged
  });

  it('MINI-07: once the immunity window passes, ice_rune can freeze the boss again', () => {
    const s = iceRun();
    const c1 = arenaCast(s, 'ice_rune', 1000, HALF, { target: { x: 0, y: -1 } });
    c1.bossPos = { x: 0, y: -1 };
    const st1 = arenaTick(c1, 1100, HALF);
    const immuneUntil = st1.bossFreezeImmuneUntilMs;
    const t = immuneUntil + 1000; // well past expiry
    st1.player.pos = { x: 0, y: 0 };
    st1.mp = 999;
    const c2 = arenaCast(st1, 'ice_rune', t - 100, HALF, { target: { x: 0, y: -1 } });
    c2.bossPos = { x: 0, y: -1 };
    const st2 = arenaTick(c2, t, HALF);
    expect(st2.bossFrozenUntilMs).toBeGreaterThan(t); // re-froze
    expect(st2.bossFrozenUntilMs).toBeGreaterThan(immuneUntil);
  });

  // MINI-26 — runes and ring_of_fire must respect the boss ward like direct spells do.
  it('MINI-26: fire_rune damage on the boss is reduced by the ward', () => {
    const fireRuneDrop = (wardVal: number) => {
      const s = freshRun(fighter(), boss({ ward: wardVal }));
      s.knownSpells = ['fire_rune'];
      s.mp = 999;
      s.player.pos = { x: 0, y: 0 };
      s.player.facing = 'up';
      const cast = arenaCast(s, 'fire_rune', 1000, HALF, { target: { x: 0, y: -1 } });
      const hp0 = cast.bossHp;
      cast.bossPos = { x: 0, y: -1 };
      const st = arenaTick(cast, 1100, HALF);
      return hp0 - st.bossHp;
    };
    const plain = fireRuneDrop(0);
    const warded = fireRuneDrop(4);
    expect(plain).toBeGreaterThan(4); // not clamped to the floor
    expect(plain - warded).toBe(4); // the ward subtracts exactly
  });

  it('MINI-26: ring of fire damage on the boss is reduced by the ward', () => {
    const ringDrop = (wardVal: number) => {
      const s = freshRun(fighter(), boss({ ward: wardVal }));
      s.knownSpells = ['ring_of_fire'];
      s.mp = 999;
      s.player.pos = { x: 0, y: 0 };
      s.bossPos = { x: 1, y: 0 }; // adjacent
      const cast = arenaCast(s, 'ring_of_fire', 1000, HALF);
      const hp0 = cast.bossHp;
      const after = arenaTick(cast, 1700, HALF); // one ring tick past the hit CD
      return hp0 - after.bossHp;
    };
    const plain = ringDrop(0);
    const warded = ringDrop(4);
    expect(plain).toBeGreaterThan(4);
    expect(plain - warded).toBe(4);
  });

  // MINI-37a — a ranged bolt rolls affinity at impact by target kind. A minion never inherits
  // the boss's weak/resist (it has no affinity fields of its own); the boss still does.
  it('MINI-37a: a bolt applies the boss DX affinity only to the boss, never to a minion', () => {
    const fireBolt = (target: 'boss' | 'minion') => {
      const s = freshRun(fighter(), boss({ weakTo: ['DX'] }));
      s.player.pos = { x: 0, y: 0 };
      s.player.facing = 'up';
      s.sta = 10; // full swing (no exhaustion halving)
      if (target === 'boss') {
        s.bossPos = { x: 0, y: -1 };
        const fired = arenaRanged(s, 1000, HALF, 'up');
        const hp0 = fired.bossHp;
        const after = arenaTick(fired, 3000, HALF);
        return hp0 - after.bossHp;
      }
      s.bossPos = { x: 0, y: 2 }; // boss behind the player, out of the bolt's path
      const m = minionAt(s, { x: 0, y: -1 }, 30);
      m.nextMoveMs = Infinity;
      const fired = arenaRanged(s, 1000, HALF, 'up');
      const after = arenaTick(fired, 3000, HALF);
      return 30 - after.minions.find((x) => x.id === m.id)!.hp;
    };
    expect(fireBolt('minion')).toBe(8); // rangedPower 8, variance 1.0, NO affinity
    expect(fireBolt('boss')).toBe(10); // 8 × 1.25 DX-weakness — boss only
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
    // Ramp keeps climbing past the old 1.2 cap — L23 hits 1.2, L43 hits the new 1.6 ceiling.
    expect(arenaSpeedFactor('auto', 23)).toBeCloseTo(1.2);
    expect(arenaSpeedFactor('auto', 43)).toBeCloseTo(1.6);
    expect(arenaSpeedFactor('auto', 43)).toBeGreaterThan(1.2);
    expect(arenaSpeedFactor('auto', 60)).toBe(1.6); // capped at the new high ceiling
  });

  it('higher speed shortens the boss/summon clock', () => {
    const slow = createArena(fighter(), boss(), { knownSpells: [], inventory: {}, tier: 5, startMs: 0, radius: 5, speed: 1 });
    const fast = createArena(fighter(), boss(), { knownSpells: [], inventory: {}, tier: 5, startMs: 0, radius: 5, speed: 2 });
    expect(fast.nextSummonMs).toBeLessThan(slow.nextSummonMs);

    // A late-arena boss ramped past the old cap moves faster still: at speed 1.6 the summon
    // clock is shorter than at the former 1.2 ceiling.
    const capped = createArena(fighter(), boss(), { knownSpells: [], inventory: {}, tier: 5, startMs: 0, radius: 5, speed: 1.2 });
    const ramped = createArena(fighter(), boss(), { knownSpells: [], inventory: {}, tier: 5, startMs: 0, radius: 5, speed: arenaSpeedFactor('auto', 43) });
    expect(ramped.nextSummonMs).toBeLessThan(capped.nextSummonMs);
  });
});

describe('BAL-23: Agility quickens the Arena step', () => {
  it('tapers the move interval from 150ms to a 90ms floor at AG 20', () => {
    expect(arenaMoveIntervalFor(0)).toBe(150); // no AG = the old flat cadence
    expect(arenaMoveIntervalFor(10)).toBe(120);
    expect(arenaMoveIntervalFor(20)).toBe(90); // floor reached
    expect(arenaMoveIntervalFor(30)).toBe(90); // never dips below the floor
  });

  it('a higher-AG fighter genuinely out-steps a sluggish one', () => {
    expect(arenaMoveIntervalFor(15)).toBeLessThan(arenaMoveIntervalFor(5));
  });
});

// ── Phase 0 — correctness & quick-win tests ─────────────────────────────────

describe('usage-based stat tracking', () => {
  it('melee increments ST and EN', () => {
    const s = freshRun();
    s.player.pos = { x: 0, y: -ARENA_RADIUS + 1 };
    const hit = arenaMelee(s, 1000, HALF);
    expect(hit.statUsage.ST).toBe(1);
    expect(hit.statUsage.EN).toBe(0.25);
    expect(hit.statUsage.DX).toBeUndefined();
  });

  it('ranged increments DX and EN', () => {
    const s = freshRun();
    s.player.pos = { x: 0, y: 0 };
    s.bossPos = { x: 0, y: -2 };
    s.player.facing = 'up';
    const fired = arenaRanged(s, 1000, HALF);
    expect(fired.statUsage.DX).toBe(1);
    expect(fired.statUsage.EN).toBe(0.25);
    expect(fired.statUsage.ST).toBeUndefined();
  });

  it('damage spell increments WI', () => {
    const s = freshRun();
    const cast = arenaCast(s, 'sparks', 1000, HALF);
    expect(cast.statUsage.WI).toBe(1);
    expect(cast.statUsage.KN).toBeUndefined();
  });

  it('support spell increments KN', () => {
    const s = freshRun();
    const cast = arenaCast(s, 'mend', 1000, HALF);
    expect(cast.statUsage.KN).toBe(1);
    expect(cast.statUsage.WI).toBeUndefined();
  });

  it('illusion spell increments CH', () => {
    const s = freshRun();
    const cast = arenaCast(s, 'hex', 1000, HALF);
    expect(cast.statUsage.CH).toBe(1);
  });

  it('successful dodge increments AG and sets lastDodgedAtMs', () => {
    const s = freshRun();
    s.dodge = 1.0; // always dodge
    s.player.pos = { x: 0, y: 0 };
    s.telegraphs.push({
      id: 1, kind: 'slam', tiles: [{ x: 0, y: 0 }],
      startedAtMs: 0, firesAtMs: 100, raw: 20, school: 'physical',
    });
    const after = arenaTick(s, 150, HALF);
    expect(after.hp).toBe(100); // not damaged
    expect(after.statUsage.AG).toBe(1);
    expect(after.lastDodgedAtMs).toBe(150);
  });

  it('accumulates usage across multiple actions', () => {
    const s = freshRun();
    s.player.pos = { x: 0, y: -ARENA_RADIUS + 1 };
    const a1 = arenaMelee(s, 1000, HALF);
    // Let cooldown pass
    a1.player.pos = { x: 0, y: -ARENA_RADIUS + 1 };
    const a2 = arenaMelee(a1, 2000, HALF);
    expect(a2.statUsage.ST).toBe(2);
    expect(a2.statUsage.EN).toBe(0.5);
  });
});

describe('independent spell cooldown', () => {
  it('a spell cast does NOT block a subsequent attack', () => {
    const s = freshRun();
    s.player.pos = { x: 0, y: -ARENA_RADIUS + 1 };
    const after_cast = arenaCast(s, 'sparks', 1000, HALF);
    // Immediately try a melee swing — attack cooldown is independent
    after_cast.player.pos = { x: 0, y: -ARENA_RADIUS + 1 };
    const after_melee = arenaMelee(after_cast, 1001, HALF);
    expect(after_melee).not.toBe(after_cast); // accepted — not blocked
    expect(after_melee.bossHp).toBeLessThan(after_cast.bossHp);
  });

  it('a melee attack does NOT block a subsequent spell cast', () => {
    const s = freshRun();
    s.player.pos = { x: 0, y: -ARENA_RADIUS + 1 };
    const after_melee = arenaMelee(s, 1000, HALF);
    // Immediately try a spell — spell cooldown is independent of attack cooldown
    const after_cast = arenaCast(after_melee, 'sparks', 1001, HALF);
    expect(after_cast).not.toBe(after_melee); // accepted — not blocked
    expect(after_cast.mp).toBeLessThan(after_melee.mp);
  });

  it('two spells within the spell cooldown window are blocked', () => {
    const s = freshRun();
    const first = arenaCast(s, 'sparks', 1000, HALF);
    const second = arenaCast(first, 'sparks', 1100, HALF); // within 520ms spell CD
    expect(second).toBe(first); // rejected — unchanged reference
  });
});

describe('phase transition minion rescaling', () => {
  it('minions spawned in phase 2 use phase-2 stats', () => {
    const scaledBoss = boss({ phases: [
      { hp: 10, attack: 10, defense: 0, weakTo: [] },
      { hp: 100, attack: 100, defense: 0, weakTo: [] },
    ] });
    const s = freshRun(fighter(), scaledBoss);
    // Advance to phase 2 by killing phase 1
    s.player.pos = { x: 0, y: -ARENA_RADIUS + 1 };
    const transitioned = arenaMelee(s, 1000, HALF); // 15 dmg > 10 hp
    expect(transitioned.phaseIndex).toBe(1);
    // minionHp and minionAttack should now reflect phase-2 stats
    const expectedHp = Math.max(1, Math.round(100 * 0.18));
    const expectedAtk = Math.max(1, Math.round(100 * 0.35));
    expect(transitioned.minionHp).toBe(expectedHp);
    expect(transitioned.minionAttack).toBe(expectedAtk);
  });
});

describe('projectile defense applied per-target', () => {
  it('a bolt against a defended boss deals less damage than against a minion', () => {
    const defendedBoss = boss({ baseHp: 100, attack: 10, defense: 5, weakTo: [] });

    // vs boss (defense 5)
    const sb = freshRun(fighter(), defendedBoss);
    sb.player.pos = { x: 0, y: 0 };
    sb.bossPos = { x: 0, y: -2 };
    sb.player.facing = 'up';
    const firedB = arenaRanged(sb, 1000, HALF);
    const afterB = arenaTick(firedB, 1400, HALF);
    const bossDmg = 100 - afterB.bossHp; // 8 pre-defense − 5 = 3

    // vs minion (no defense) same attack roll
    const sm = freshRun(fighter(), defendedBoss);
    sm.player.pos = { x: 0, y: 0 };
    sm.bossPos = { x: 0, y: -ARENA_RADIUS };
    sm.player.facing = 'up';
    const m = minionAt(sm, { x: 0, y: -2 }, 50);
    sm.player.facing = 'up';
    const firedM = arenaRanged(sm, 1000, HALF);
    const afterM = arenaTick(firedM, 1400, HALF);
    const minionHp = afterM.minions.find((x) => x.id === m.id)?.hp ?? 50;
    const minionDmg = 50 - minionHp; // 8 pre-defense, minion has 0 defense

    expect(bossDmg).toBeLessThan(minionDmg);
    expect(bossDmg).toBe(Math.max(1, 8 - 5)); // 3
    expect(minionDmg).toBe(8);                 // full 8
  });
});
