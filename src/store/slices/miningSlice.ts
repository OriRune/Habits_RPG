import type { StateCreator } from 'zustand';
import type { MineState, MineTile, Dir } from '@/engine/mining';
import {
  generateMine,
  tryMove,
  tryDash as mineTryDash,
  strike,
  stepMonsters,
  coopClientStep,
  descend,
  castSpell as minecastSpellFn,
  applyBoonChoice as applyMineBoonChoice,
  MINE_ENERGY_COST,
} from '@/engine/mining';
import { dungeonStamina } from '@/engine/crawl';
import { mulberry32, floorSeed } from '@/engine/rng';
import { getGear } from '@/engine/gear';
import { rollBoonChoices } from '@/content/boons';
import {
  type WorldSliceInput,
  applyMineWorldSlice,
  applyMineTileSlice,
  applyMineRemoteAttack,
} from '@/net/coop/reduce';
import type { GameState } from '../shared';
import { fighterFor, gearBonuses, commitMining, commitMineDeath, energySpentPatch } from '../shared';
import { getMineRng, getMineBaseSeed, setMineRun } from '../runRng';

export interface MiningSlice {
  mining: MineState | null;
  deepestMineFloor: number;
  bestMineScore: number;

  beginMining: (seed?: number) => void;
  mineMove: (dir: Dir) => void;
  mineStrike: () => void;
  mineStrikeCharged: () => void;
  mineDash: (dir: Dir, nowMs: number) => void;
  mineTick: (nowMs: number, coPlayers?: ReadonlyArray<{ r: number; c: number }>) => void;
  coopClientTick: (nowMs: number) => void;
  coopApplyWorld: (slice: WorldSliceInput) => void;
  coopApplyTile: (floor: number, r: number, c: number, tile: MineTile) => void;
  coopApplyRemoteAttack: (monsterId: string, dmg: number) => void;
  mineDescend: () => void;
  mineCast: (spellKey: string) => void;
  chooseMineBoon: (key: string) => void;
  beginBanking: () => void;
  endMining: () => void;
}

export const createMiningSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  MiningSlice
> = (set) => ({
  mining: null,
  deepestMineFloor: 0,
  bestMineScore: 0,

  beginMining: (seed) =>
    set((s) => {
      // Seed the run's RNG: shared mulberry32 for co-op, Math.random for solo.
      setMineRun(seed !== undefined ? mulberry32(seed) : Math.random, seed);
      const free = s.settings.unlimitedEnergy;
      if (s.mining) return s;
      if (!free && s.character.energy < MINE_ENERGY_COST) return s;

      // Grant the stone_pickaxe if the player has no mining tool yet
      let ownedGear = s.ownedGear;
      let equipment = s.equipment;
      const hasMiningTool = ownedGear.some((k) => {
        const g = getGear(k);
        return g?.mining != null;
      });
      if (!hasMiningTool) {
        ownedGear = [...ownedGear, 'stone_pickaxe'];
        if (!equipment.tool) {
          equipment = { ...equipment, tool: 'stone_pickaxe' };
        }
      }

      // Build the snapshot with the (possibly updated) equipment
      const stateWithGear: typeof s = { ...s, ownedGear, equipment };
      const fighter = fighterFor(stateWithGear);
      const { c } = fighter;

      // Dungeon stamina is much larger than battle stamina (50 + EN from gear)
      const gear = gearBonuses(stateWithGear);
      const enBonus = gear.statBonuses.EN ?? 0;
      const maxSta = dungeonStamina(s.character.statLevels.EN + enBonus);

      // Pickaxe power from equipped tool gear
      const toolKey = equipment.tool;
      const toolGear = toolKey ? getGear(toolKey) : undefined;
      const pickaxePower = toolGear?.mining?.power ?? 0;
      // AG level for dash cooldown + move speed (gear bonuses included via fighter)
      const agBonus = (gearBonuses(stateWithGear).statBonuses.AG ?? 0);
      const agLevel = s.character.statLevels.AG + agBonus;

      const mining = generateMine(
        1,
        {
          meleePower: c.meleePower,
          rangedPower: c.rangedPower,
          damageSpell: c.damageSpell,
          supportSpell: c.supportSpell,
          illusionPower: c.illusionPower,
          defense: c.defense,
          ward: c.ward,
          maxHp: c.maxHp,
          maxSta,
          maxMp: c.maxMp,
          weapon: fighter.weapon,
          knownSpells: s.knownSpells,
          pickaxePower,
          agLevel,
        },
        // Floor 1 from the per-floor seed (co-op) so every client matches; solo
        // falls back to the live mine RNG (Math.random).
        seed !== undefined ? mulberry32(floorSeed(seed, 1)) : getMineRng(),
      );
      return {
        character: {
          ...s.character,
          energy: free ? s.character.energy : s.character.energy - MINE_ENERGY_COST,
        },
        ownedGear,
        equipment,
        mining,
        ...(free ? {} : energySpentPatch(s, MINE_ENERGY_COST)),
      };
    }),

  mineMove: (dir) =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'active') return s;
      const mining = tryMove(s.mining, dir);
      return mining !== s.mining ? { mining } : s;
    }),

  mineStrike: () =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'active') return s;
      const run = s.mining;
      // Boon cache pickup: pressing Strike while standing on a boon tile opens the choice
      // panel instead of swinging. This makes pickup intentional, preventing accidental
      // triggers when sprinting through corridors mid-combat.
      const { r, c } = run.player;
      if (run.tiles[r]?.[c]?.kind === 'boon') {
        const tiles = run.tiles.map((row) => row.slice());
        tiles[r][c] = { kind: 'floor' };
        const choices = rollBoonChoices('mine', run.activeBoons, getMineRng());
        return {
          mining: {
            ...run,
            tiles,
            pendingBoonChoice: choices,
            status: 'choosing' as const,
          },
        };
      }
      return { mining: strike(run, getMineRng()) };
    }),

  mineStrikeCharged: () =>
    set((s) =>
      s.mining && s.mining.status === 'active'
        ? { mining: strike(s.mining, getMineRng(), Date.now(), true) }
        : s,
    ),

  mineDash: (dir, nowMs) =>
    set((s) =>
      s.mining && s.mining.status === 'active'
        ? { mining: mineTryDash(s.mining, dir, nowMs) }
        : s,
    ),

  mineTick: (nowMs, coPlayers) =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'active') return s;
      const mining = stepMonsters(s.mining, nowMs, getMineRng(), coPlayers);
      if (mining === s.mining) return s;
      return { mining };
    }),

  coopClientTick: (nowMs) =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'active') return s;
      const mining = coopClientStep(s.mining, nowMs);
      if (mining === s.mining) return s;
      return { mining };
    }),

  coopApplyWorld: (slice) =>
    set((s) => {
      if (!s.mining) return s;
      return { mining: applyMineWorldSlice(s.mining, slice, { baseSeed: getMineBaseSeed(), rng: getMineRng() }) };
    }),

  coopApplyTile: (floor, r, c, tile) =>
    set((s) => {
      if (!s.mining) return s;
      const mining = applyMineTileSlice(s.mining, floor, r, c, tile);
      return mining !== s.mining ? { mining } : s;
    }),

  coopApplyRemoteAttack: (monsterId, dmg) =>
    set((s) => {
      if (!s.mining) return s;
      const mining = applyMineRemoteAttack(s.mining, monsterId, dmg, getMineRng());
      return mining !== s.mining ? { mining } : s;
    }),

  mineDescend: () =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'active') return s;
      // Generate the next floor from its per-floor seed (co-op parity); solo uses
      // the live mine RNG stream. Independent of seed divergence on earlier floors.
      const nextFloor = s.mining.floor + 1;
      const _mineBaseSeed = getMineBaseSeed();
      const genRng =
        _mineBaseSeed !== undefined ? mulberry32(floorSeed(_mineBaseSeed, nextFloor)) : getMineRng();
      const mining = descend(s.mining, genRng);
      if (mining === s.mining) return s;
      return { mining, deepestMineFloor: Math.max(s.deepestMineFloor, mining.deepest) };
    }),

  mineCast: (spellKey: string) =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'active') return s;
      const mining = minecastSpellFn(s.mining, spellKey, Date.now(), getMineRng());
      if (mining === s.mining) return s;
      return { mining };
    }),

  chooseMineBoon: (key: string) =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'choosing') return s;
      const mining = applyMineBoonChoice(s.mining, key);
      return mining !== s.mining ? { mining } : s;
    }),

  beginBanking: () =>
    set((s) =>
      s.mining && s.mining.status === 'active'
        ? { mining: { ...s.mining, status: 'banking' as const } }
        : s,
    ),

  // Death forfeits half the haul; a confirmed bank keeps it all.
  endMining: () =>
    set((s) =>
      !s.mining
        ? s
        : s.mining.status === 'ended'
          ? commitMineDeath(s, s.mining)
          : commitMining(s, s.mining),
    ),
});
