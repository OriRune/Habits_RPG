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
  placeTombstone,
  MINE_ENERGY_COST,
} from '@/engine/mining';
import { dungeonStamina, boonConsolation } from '@/engine/crawl';
import { mulberry32, floorSeed } from '@/engine/rng';
import { getGear } from '@/engine/gear';
import { rollBoonChoices } from '@/content/boons';
import {
  type WorldSliceInput,
  applyMineWorldSlice,
  applyMineTileSlice,
  applyMineTileSnapshot,
  applyMineRemoteAttack,
} from '@/net/coop/reduce';
import type { Reward } from '@/engine/challenges';
import { mergeReward } from '@/engine/dungeon';
import type { GameState } from '../shared';
import { fighterFor, gearBonuses, commitMining, commitMineDeath, energySpentPatch } from '../shared';
import { getMineRng, getMineBaseSeed, setMineRun, acceptMineWorldT } from '../runRng';

export interface MiningSlice {
  mining: MineState | null;
  deepestMineFloor: number;
  bestMineScore: number;
  /** Lost haul from the most recent death — recovered by reaching the tombstone tile. */
  mineTombstone: { floor: number; haul: Reward } | null;

  beginMining: (seed?: number) => void;
  mineMove: (dir: Dir) => void;
  mineStrike: () => void;
  /** `nowMs` is the caller's rAF-clock timestamp — same timebase as mineTick. */
  mineStrikeCharged: (nowMs: number) => void;
  mineDash: (dir: Dir, nowMs: number) => void;
  mineTick: (nowMs: number, coPlayers?: ReadonlyArray<{ r: number; c: number }>) => void;
  coopClientTick: (nowMs: number) => void;
  coopApplyWorld: (slice: WorldSliceInput) => void;
  coopApplyTile: (floor: number, r: number, c: number, tile: MineTile) => void;
  /** MP-25: apply a host's one-shot changed-tiles snapshot when joining mid-run. */
  coopApplyTileSnapshot: (floor: number, entries: ReadonlyArray<{ r: number; c: number; tile: MineTile }>) => void;
  coopApplyRemoteAttack: (monsterId: string, dmg: number) => void;
  mineDescend: () => void;
  /** `nowMs` is the caller's rAF-clock timestamp — same timebase as mineTick. */
  mineCast: (spellKey: string, nowMs: number) => void;
  chooseMineBoon: (key: string) => void;
  /** Dismiss the boon panel without picking — escape hatch if no option appeals (or none exist). */
  skipMineBoon: () => void;
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
  mineTombstone: null,

  beginMining: (seed) =>
    set((s) => {
      // Seed the run's RNG: shared mulberry32 for co-op, Math.random for solo.
      setMineRun(seed !== undefined ? mulberry32(seed) : Math.random, seed);
      const free = s.settings.unlimitedEnergy;
      // Solo re-entry keeps an in-progress run; a co-op join (explicit `seed`) must
      // replace any leftover/orphan run — keeping the stale map would merge it against
      // the shared co-op seed and desync the party (MP-12). If the joiner can't afford
      // entry, clear the orphan too so they don't linger on a stale run — the runless
      // guard in useCoopSession then leaves the session (as for any energy-gated join).
      if (s.mining && seed === undefined) return s;
      if (!free && s.character.energy < MINE_ENERGY_COST) return s.mining ? { ...s, mining: null } : s;

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

      let mining = generateMine(
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
      // If a tombstone exists for floor 1, place it on the generated map.
      if (s.mineTombstone && s.mineTombstone.floor === 1) {
        mining = placeTombstone(mining, getMineRng());
      }
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
      const { r, c } = run.player;
      // Tombstone recovery: pressing Strike on a tombstone merges the lost haul back
      // into the current run and clears the tombstone record.
      if (run.tiles[r]?.[c]?.kind === 'tombstone' && s.mineTombstone) {
        const tiles = run.tiles.map((row) => row.slice());
        tiles[r][c] = { kind: 'floor' };
        return {
          mining: { ...run, tiles, haul: mergeReward(run.haul, s.mineTombstone.haul) },
          mineTombstone: null,
        };
      }
      // Boon cache pickup: pressing Strike while standing on a boon tile opens the choice
      // panel instead of swinging. This makes pickup intentional, preventing accidental
      // triggers when sprinting through corridors mid-combat.
      if (run.tiles[r]?.[c]?.kind === 'boon') {
        const tiles = run.tiles.map((row) => row.slice());
        tiles[r][c] = { kind: 'floor' };
        const choices = rollBoonChoices('mine', run.activeBoons, getMineRng());
        // Exhausted pool rolls [] — consolation instead of an unpickable panel.
        if (choices.length === 0) return { mining: boonConsolation({ ...run, tiles }) };
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

  mineStrikeCharged: (nowMs) =>
    set((s) =>
      s.mining && s.mining.status === 'active'
        ? { mining: strike(s.mining, getMineRng(), nowMs, true) }
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
      if (!acceptMineWorldT(slice.t)) return s;
      return { mining: applyMineWorldSlice(s.mining, slice, { baseSeed: getMineBaseSeed(), rng: getMineRng() }) };
    }),

  coopApplyTile: (floor, r, c, tile) =>
    set((s) => {
      if (!s.mining) return s;
      const mining = applyMineTileSlice(s.mining, floor, r, c, tile);
      return mining !== s.mining ? { mining } : s;
    }),

  coopApplyTileSnapshot: (floor, entries) =>
    set((s) => {
      if (!s.mining) return s;
      const mining = applyMineTileSnapshot(s.mining, floor, entries);
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
      let mining = descend(s.mining, genRng);
      if (mining === s.mining) return s;
      // If a tombstone exists for this floor, place it on the newly generated map.
      if (s.mineTombstone && s.mineTombstone.floor === nextFloor) {
        mining = placeTombstone(mining, getMineRng());
      }
      return { mining, deepestMineFloor: Math.max(s.deepestMineFloor, mining.deepest) };
    }),

  mineCast: (spellKey, nowMs) =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'active') return s;
      const mining = minecastSpellFn(s.mining, spellKey, nowMs, getMineRng());
      if (mining === s.mining) return s;
      return { mining };
    }),

  chooseMineBoon: (key: string) =>
    set((s) => {
      if (!s.mining || s.mining.status !== 'choosing') return s;
      const mining = applyMineBoonChoice(s.mining, key);
      return mining !== s.mining ? { mining } : s;
    }),

  skipMineBoon: () =>
    set((s) =>
      s.mining && s.mining.status === 'choosing'
        ? { mining: { ...s.mining, pendingBoonChoice: null, status: 'active' as const } }
        : s,
    ),

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
