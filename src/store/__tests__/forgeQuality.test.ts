/**
 * Forge quality plumbing (Phase 8, M1) — craft tier storage + upgrade rule, and the two
 * combat seams (gearFor / equippedWeaponDef) that apply quality scaling. Absent quality
 * entries must behave byte-identically to pre-Forge saves.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '../useGameStore';
import { gearFor, gearBonuses, equippedWeaponDef, fighterFor } from '../shared';
import { getGear } from '@/engine/gear';
import { getWeapon } from '@/engine/weapons';
import { scaleTierStat, CRUDE, NORMAL, FINE, MASTERWORK } from '@/engine/crafting';

const get = () => useGameStore.getState();

beforeEach(() => {
  get().resetGame();
  useGameStore.setState({
    materials: { iron_bar: 99, crystals: 99, leather: 99, cloth_roll: 99 },
    character: { ...get().character, gold: 9999 },
  });
});

describe('craft quality storage', () => {
  it('first craft stores its earned tier, Crude included (revision-1 regression)', () => {
    get().craft('scholars_lantern', 0.1);
    expect(get().gearQuality['scholars_lantern']).toBe(CRUDE);
  });

  it('re-craft can only upgrade, never downgrade', () => {
    get().craft('scholars_lantern', 0.1);
    get().craft('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBe(MASTERWORK);
    get().craft('scholars_lantern', 0.5);
    expect(get().gearQuality['scholars_lantern']).toBe(MASTERWORK);
  });

  it('craft with no score stores Normal (identical to the one-click path today)', () => {
    get().craft('scholars_lantern');
    expect(get().gearQuality['scholars_lantern']).toBe(NORMAL);
  });

  it('weapon crafts write weaponQuality, not gearQuality', () => {
    get().craft('iron_mace', 0.5);
    expect(get().weaponQuality['iron_mace']).toBe(FINE);
    expect(get().gearQuality['iron_mace']).toBeUndefined();
  });

  it('a failed craft (unaffordable) writes no quality entry', () => {
    useGameStore.setState({ materials: {} });
    get().craft('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBeUndefined();
  });
});

describe('combat seams', () => {
  it('gearFor scales defense/statBonuses by stored tier; xpBonus stays raw', () => {
    get().craft('scholars_lantern', 0.9); // Masterwork
    get().equipGear('scholars_lantern');
    const raw = getGear('scholars_lantern')!;
    const equipped = gearFor(get()).find((g) => g.key === 'scholars_lantern')!;
    expect(equipped.statBonuses!.KN).toBe(scaleTierStat(raw.statBonuses!.KN!, MASTERWORK));
    expect(equipped.xpBonus).toEqual(raw.xpBonus);
    expect(gearBonuses(get()).statBonuses.KN).toBe(scaleTierStat(raw.statBonuses!.KN!, MASTERWORK));
  });

  it('absent quality entry leaves gearFor output identical to the raw catalog def', () => {
    useGameStore.setState({ ownedGear: ['leather_vest'] });
    get().equipGear('leather_vest');
    const equipped = gearFor(get()).find((g) => g.key === 'leather_vest')!;
    expect(equipped).toBe(getGear('leather_vest')); // same reference — no copy, no change
  });

  it('equippedWeaponDef scales bonus only, and fighterFor uses it', () => {
    get().craft('iron_mace', 0.9); // Masterwork
    get().equipWeapon('iron_mace');
    const raw = getWeapon('iron_mace');
    const scaled = equippedWeaponDef(get());
    expect(scaled.bonus).toBe(scaleTierStat(raw.bonus, MASTERWORK));
    expect(scaled.staminaCost).toBe(raw.staminaCost);
    expect(fighterFor(get()).weapon.bonus).toBe(scaled.bonus);
  });

  it('absent weapon quality (shop/loot weapon) resolves the raw def', () => {
    useGameStore.setState({ ownedWeapons: [...get().ownedWeapons, 'iron_mace'] });
    get().equipWeapon('iron_mace');
    expect(equippedWeaponDef(get())).toBe(getWeapon('iron_mace'));
  });
});

describe('reforge (§5 repeatable gold sink)', () => {
  // scholars_lantern: { iron_bar:1, crystals:1, gold:30 }, anchor = iron_bar, reforgeCost = 100.
  it('upgrades an owned Fine item to Masterwork, spending exactly gold + 1 anchor', () => {
    get().craft('scholars_lantern', 0.5); // Fine, now owned
    expect(get().gearQuality['scholars_lantern']).toBe(FINE);
    const gold0 = get().character.gold;
    const iron0 = get().materials['iron_bar'];
    get().reforge('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBe(MASTERWORK);
    expect(get().character.gold).toBe(gold0 - 100);
    expect(get().materials['iron_bar']).toBe(iron0 - 1);
  });

  it('rejects when gold is below the re-forge cost (state unchanged)', () => {
    get().craft('scholars_lantern', 0.5);
    useGameStore.setState({ character: { ...get().character, gold: 50 } });
    const iron0 = get().materials['iron_bar'];
    get().reforge('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBe(FINE);
    expect(get().character.gold).toBe(50);
    expect(get().materials['iron_bar']).toBe(iron0);
  });

  it('rejects when the anchor material is missing (state unchanged)', () => {
    get().craft('scholars_lantern', 0.5);
    useGameStore.setState({ materials: { ...get().materials, iron_bar: 0 } });
    const gold0 = get().character.gold;
    get().reforge('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBe(FINE);
    expect(get().character.gold).toBe(gold0);
  });

  it('rejects an already-Masterwork item (no cost spent)', () => {
    get().craft('scholars_lantern', 0.9); // Masterwork
    const gold0 = get().character.gold;
    const iron0 = get().materials['iron_bar'];
    get().reforge('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBe(MASTERWORK);
    expect(get().character.gold).toBe(gold0);
    expect(get().materials['iron_bar']).toBe(iron0);
  });

  it('a worse run spends the cost but keeps the higher tier', () => {
    get().craft('scholars_lantern', 0.5); // Fine
    const gold0 = get().character.gold;
    const iron0 = get().materials['iron_bar'];
    get().reforge('scholars_lantern', 0.1); // would be Crude
    expect(get().gearQuality['scholars_lantern']).toBe(FINE); // unchanged
    expect(get().character.gold).toBe(gold0 - 100); // cost still spent
    expect(get().materials['iron_bar']).toBe(iron0 - 1);
  });

  it('rejects an item the player does not own', () => {
    const gold0 = get().character.gold;
    get().reforge('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBeUndefined();
    expect(get().character.gold).toBe(gold0);
  });

  it('works on an owned item with no quality entry (bought item ⇒ Normal)', () => {
    // leather_vest: { leather:3 }, anchor = leather, reforgeCost = 100 (no gold on recipe).
    useGameStore.setState({ ownedGear: ['leather_vest'] });
    expect(get().gearQuality['leather_vest']).toBeUndefined();
    const gold0 = get().character.gold;
    const leather0 = get().materials['leather'];
    get().reforge('leather_vest', 0.9);
    expect(get().gearQuality['leather_vest']).toBe(MASTERWORK);
    expect(get().character.gold).toBe(gold0 - 100);
    expect(get().materials['leather']).toBe(leather0 - 1);
  });

  it('unlimitedGold bypasses gold but still requires the anchor material', () => {
    get().craft('scholars_lantern', 0.5); // Fine, owned
    useGameStore.setState({
      settings: { ...get().settings, unlimitedGold: true },
      character: { ...get().character, gold: 0 },
      materials: { ...get().materials, iron_bar: 0 },
    });
    get().reforge('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBe(FINE); // rejected — no anchor
    useGameStore.setState({ materials: { ...get().materials, iron_bar: 1 } });
    get().reforge('scholars_lantern', 0.9);
    expect(get().gearQuality['scholars_lantern']).toBe(MASTERWORK);
    expect(get().character.gold).toBe(0); // gold bypassed
    expect(get().materials['iron_bar']).toBe(0); // anchor still consumed
  });
});

describe('craft with Fuel & Flux boosts (§6 material sink)', () => {
  it('subtracts fuel + flux materials exactly once alongside the recipe cost', () => {
    useGameStore.setState({ materials: { ...get().materials, wood: 5, gemstone: 3 } });
    const gold0 = get().character.gold;
    get().craft('scholars_lantern', 0.9, { fuel: 'wood', flux: true });
    expect(get().gearQuality['scholars_lantern']).toBe(MASTERWORK);
    expect(get().materials['wood']).toBe(3); // 5 - 2
    expect(get().materials['gemstone']).toBe(2); // 3 - 1
    expect(get().materials['iron_bar']).toBe(98); // recipe still consumed
    expect(get().materials['crystals']).toBe(98);
    expect(get().character.gold).toBe(gold0 - 30);
  });

  it('rejects the whole craft when a boost material is short (recipe untouched)', () => {
    useGameStore.setState({ materials: { ...get().materials, wood: 1, gemstone: 3 } });
    const gold0 = get().character.gold;
    get().craft('scholars_lantern', 0.9, { fuel: 'wood', flux: true });
    expect(get().gearQuality['scholars_lantern']).toBeUndefined();
    expect(get().materials['iron_bar']).toBe(99); // recipe materials untouched
    expect(get().materials['wood']).toBe(1); // no partial consumption
    expect(get().materials['gemstone']).toBe(3);
    expect(get().character.gold).toBe(gold0);
  });
});
