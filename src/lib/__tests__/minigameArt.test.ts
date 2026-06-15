import { describe, it, expect } from 'vitest';
import {
  forestThicketTree,
  forestFloorTile,
  forestNodeSprite,
  mineRockSprite,
  mineFloorTile,
  mineOreSprite,
} from '../minigameArt';

describe('minigame art mapping', () => {
  it('resolves forest tiles and decor', () => {
    expect(forestThicketTree(1, 1)).toBeTruthy();
    expect(forestFloorTile('trail', 1, 1)).toBeTruthy();
    expect(forestFloorTile('clearing', 2, 4)).toBeTruthy();
    expect(forestNodeSprite('flower_bush')).toBeTruthy();
    expect(forestNodeSprite('flax_plant')).toBeTruthy();
    expect(forestNodeSprite('crystal_find')).toBeTruthy();
  });

  it('resolves mine tiles and ores', () => {
    expect(mineRockSprite(3, 5)).toBeTruthy();
    expect(mineFloorTile(3, 5)).toBeTruthy();
    expect(mineOreSprite('iron_vein')).toBeTruthy();
    expect(mineOreSprite('crystal_node')).toBeTruthy();
    expect(mineOreSprite('bronze_vein')).toBeTruthy();
  });

  it('returns undefined for entities with no art (caller keeps its glyph)', () => {
    expect(forestNodeSprite('spring')).toBeUndefined();
    expect(mineOreSprite('gold_vein')).toBeUndefined();
    expect(mineOreSprite('rubble')).toBeUndefined();
    expect(mineOreSprite('energy_gem')).toBeUndefined();
  });

  it('picks a stable variant for a given cell', () => {
    expect(forestThicketTree(7, 9)).toBe(forestThicketTree(7, 9));
    expect(mineRockSprite(7, 9)).toBe(mineRockSprite(7, 9));
  });
});
