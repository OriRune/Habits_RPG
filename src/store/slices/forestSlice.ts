import type { StateCreator } from 'zustand';
import type { ForestState, ForestTile, Dir } from '@/engine/forest';
import {
  applyBoonChoice as applyForestBoonChoice,
  generateForest,
  tryMove as forestTryMove,
  tryDash as forestTryDash,
  act as forestActFn,
  castSpell as forestCastSpellFn,
  stepBeasts,
  advance as forestAdvanceFn,
  activateShrine as forestActivateShrine,
  coopClientStep as forestCoopClientStep,
  FOREST_ENERGY_COST,
} from '@/engine/forest';
import { dungeonStamina, boonConsolation } from '@/engine/crawl';
import { mulberry32, floorSeed } from '@/engine/rng';
import { getGear } from '@/engine/gear';
import { rollBoonChoices } from '@/content/boons';
import {
  type WorldSliceInput,
  applyForestWorldSlice,
  applyForestTileSlice,
  applyForestTileSnapshot,
  applyForestRemoteAttack,
} from '@/net/coop/reduce';
import type { GameState } from '../shared';
import { fighterFor, gearBonuses, commitForest, commitForestDeath, energySpentPatch, stashForest } from '../shared';
import { getForestRng, getForestBaseSeed, setForestRun, acceptForestWorldT } from '../runRng';

export interface ForestSlice {
  forest: ForestState | null;
  deepestForestStage: number;
  bestForestScore: number;

  beginForest: (seed?: number) => void;
  forestMove: (dir: Dir) => void;
  /** `nowMs` is the caller's rAF-clock timestamp — same timebase as forestTick. */
  forestAct: (nowMs: number) => void;
  /** `nowMs` is the caller's rAF-clock timestamp — same timebase as forestTick. */
  forestActCharged: (nowMs: number) => void;
  forestDash: (dir: Dir, nowMs: number) => void;
  forestTick: (nowMs: number, coPlayers?: ReadonlyArray<{ r: number; c: number }>) => void;
  beginForestBanking: () => void;
  /** Stash 80% of the current haul into the economy mid-run. Only works on clearing tiles. */
  forestStash: () => void;
  forestAdvance: () => void;
  /** `nowMs` is the caller's rAF-clock timestamp — same timebase as forestTick. */
  forestCast: (spellKey: string, nowMs: number) => void;
  forestShrine: (nowMs: number, allowDenSpawn?: boolean) => void;
  chooseForestBoon: (key: string) => void;
  /** Dismiss the boon panel without picking — escape hatch if no option appeals (or none exist). */
  skipForestBoon: () => void;
  coopApplyForestWorld: (slice: WorldSliceInput) => void;
  coopApplyForestTile: (stage: number, r: number, c: number, tile: ForestTile) => void;
  /** MP-25: apply a host's one-shot changed-tiles snapshot when joining mid-run. */
  coopApplyForestTileSnapshot: (stage: number, entries: ReadonlyArray<{ r: number; c: number; tile: ForestTile }>) => void;
  coopApplyForestAttack: (beastId: string, dmg: number) => void;
  coopForestClientTick: (nowMs: number) => void;
  endForest: () => void;
}

export const createForestSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  ForestSlice
> = (set) => ({
  forest: null,
  deepestForestStage: 0,
  bestForestScore: 0,

  beginForest: (seed) =>
    set((s) => {
      // Seed the run's RNG: shared mulberry32 for co-op, Math.random for solo.
      setForestRun(seed !== undefined ? mulberry32(seed) : Math.random, seed);
      const free = s.settings.unlimitedEnergy;
      // Solo re-entry keeps an in-progress run; a co-op join (explicit `seed`) must
      // replace any leftover/orphan run — keeping the stale map would merge it against
      // the shared co-op seed and desync the party (MP-12). If the joiner can't afford
      // entry, clear the orphan too so they don't linger on a stale run — the runless
      // guard in useCoopSession then leaves the session (as for any energy-gated join).
      if (s.forest && seed === undefined) return s;
      if (!free && s.character.energy < FOREST_ENERGY_COST) return s.forest ? { ...s, forest: null } : s;

      // Grant the stone_pickaxe (toolkit) if the player has no tool yet
      let ownedGear = s.ownedGear;
      let equipment = s.equipment;
      const hasAnyTool = ownedGear.some((k) => {
        const g = getGear(k);
        return g?.chopping != null || g?.mining != null;
      });
      if (!hasAnyTool) {
        ownedGear = [...ownedGear, 'stone_pickaxe'];
        if (!equipment.tool) {
          equipment = { ...equipment, tool: 'stone_pickaxe' };
        }
      }

      const stateWithGear: typeof s = { ...s, ownedGear, equipment };
      const fighter = fighterFor(stateWithGear);
      const { c } = fighter;
      const gear = gearBonuses(stateWithGear);
      const enBonus = gear.statBonuses.EN ?? 0;
      const maxSta = dungeonStamina(s.character.statLevels.EN + enBonus);

      // Chopping power from equipped tool gear
      const toolKey = equipment.tool;
      const toolGear = toolKey ? getGear(toolKey) : undefined;
      const chopPower = toolGear?.chopping?.power ?? 0;
      // AG level for dash cooldown + move speed
      const agBonusF = (gearBonuses(stateWithGear).statBonuses.AG ?? 0);
      const agLevelF = s.character.statLevels.AG + agBonusF;

      const forest = generateForest(
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
          chopPower,
          agLevel: agLevelF,
        },
        // Stage 1 from the per-stage seed (co-op parity); solo uses live forest RNG.
        seed !== undefined ? mulberry32(floorSeed(seed, 1)) : getForestRng(),
      );
      return {
        character: {
          ...s.character,
          energy: free ? s.character.energy : s.character.energy - FOREST_ENERGY_COST,
        },
        ownedGear,
        equipment,
        forest,
        ...(free ? {} : energySpentPatch(s, FOREST_ENERGY_COST)),
      };
    }),

  forestMove: (dir) =>
    set((s) => {
      if (!s.forest || s.forest.status !== 'active') return s;
      const forest = forestTryMove(s.forest, dir);
      // Boon cache pickup: walking onto a 'boon' tile triggers the choice panel.
      if (forest !== s.forest) {
        const { r, c } = forest.player;
        if (forest.tiles[r]?.[c]?.kind === 'boon') {
          const tiles = forest.tiles.map((row) => row.slice());
          tiles[r][c] = { kind: 'trail' };
          const choices = rollBoonChoices('forest', forest.activeBoons, getForestRng());
          // Exhausted pool rolls [] — consolation instead of an unpickable panel.
          if (choices.length === 0) return { forest: boonConsolation({ ...forest, tiles }) };
          return {
            forest: {
              ...forest,
              tiles,
              pendingBoonChoice: choices,
              status: 'choosing' as const,
            },
          };
        }
      }
      return forest !== s.forest ? { forest } : s;
    }),

  forestAct: (nowMs) =>
    set((s) =>
      s.forest && s.forest.status === 'active' ? { forest: forestActFn(s.forest, getForestRng(), nowMs) } : s,
    ),

  forestActCharged: (nowMs) =>
    set((s) =>
      s.forest && s.forest.status === 'active'
        ? { forest: forestActFn(s.forest, getForestRng(), nowMs, true) }
        : s,
    ),

  forestDash: (dir, nowMs) =>
    set((s) =>
      s.forest && s.forest.status === 'active'
        ? { forest: forestTryDash(s.forest, dir, nowMs) }
        : s,
    ),

  forestTick: (nowMs, coPlayers) =>
    set((s) => {
      if (!s.forest || s.forest.status !== 'active') return s;
      const forest = stepBeasts(s.forest, nowMs, getForestRng(), coPlayers);
      if (forest === s.forest) return s;
      // Death flips status to 'ended' but doesn't commit — the overlay shows the forfeit
      // first, then endForest banks the kept half (mirrors the mine's banking flow).
      return { forest };
    }),

  beginForestBanking: () =>
    set((s) =>
      s.forest && s.forest.status === 'active'
        ? { forest: { ...s.forest, status: 'banking' as const } }
        : s,
    ),

  forestStash: () =>
    set((s) => {
      const run = s.forest;
      if (!run || run.status !== 'active') return s;
      // Only stashable on a clearing tile — clearings are the natural safe harbours.
      const { r, c } = run.player;
      if (run.tiles[r]?.[c]?.kind !== 'clearing') return s;
      return stashForest(s, run);
    }),

  forestAdvance: () =>
    set((s) => {
      if (!s.forest || s.forest.status !== 'active') return s;
      // Next stage from its per-stage seed (co-op parity); solo uses forest RNG.
      const nextStage = s.forest.stage + 1;
      const _forestBaseSeed = getForestBaseSeed();
      const genRng =
        _forestBaseSeed !== undefined ? mulberry32(floorSeed(_forestBaseSeed, nextStage)) : getForestRng();
      const forest = forestAdvanceFn(s.forest, genRng);
      if (forest === s.forest) return s;
      return { forest, deepestForestStage: Math.max(s.deepestForestStage, forest.deepest) };
    }),

  forestCast: (spellKey, nowMs) =>
    set((s) => {
      if (!s.forest || s.forest.status !== 'active') return s;
      const forest = forestCastSpellFn(s.forest, spellKey, nowMs, getForestRng());
      if (forest === s.forest) return s;
      return { forest };
    }),

  forestShrine: (nowMs: number, allowDenSpawn = true) =>
    set((s) => {
      if (!s.forest || s.forest.status !== 'active') return s;
      const forest = forestActivateShrine(s.forest, nowMs, getForestRng(), allowDenSpawn);
      if (forest === s.forest) return s;
      return { forest };
    }),

  chooseForestBoon: (key: string) =>
    set((s) => {
      if (!s.forest || s.forest.status !== 'choosing') return s;
      const forest = applyForestBoonChoice(s.forest, key);
      return forest !== s.forest ? { forest } : s;
    }),

  skipForestBoon: () =>
    set((s) =>
      s.forest && s.forest.status === 'choosing'
        ? { forest: { ...s.forest, pendingBoonChoice: null, status: 'active' as const } }
        : s,
    ),

  coopApplyForestWorld: (slice) =>
    set((s) => {
      if (!s.forest) return s;
      if (!acceptForestWorldT(slice.t)) return s;
      return { forest: applyForestWorldSlice(s.forest, slice, { baseSeed: getForestBaseSeed(), rng: getForestRng() }) };
    }),

  coopApplyForestTile: (stage, r, c, tile) =>
    set((s) => {
      if (!s.forest) return s;
      const forest = applyForestTileSlice(s.forest, stage, r, c, tile as ForestTile);
      return forest !== s.forest ? { forest } : s;
    }),

  coopApplyForestTileSnapshot: (stage, entries) =>
    set((s) => {
      if (!s.forest) return s;
      const forest = applyForestTileSnapshot(s.forest, stage, entries);
      return forest !== s.forest ? { forest } : s;
    }),

  coopApplyForestAttack: (beastId, dmg) =>
    set((s) => {
      if (!s.forest) return s;
      const forest = applyForestRemoteAttack(s.forest, beastId, dmg, getForestRng());
      return forest !== s.forest ? { forest } : s;
    }),

  coopForestClientTick: (nowMs) =>
    set((s) => {
      if (!s.forest || s.forest.status !== 'active') return s;
      const forest = forestCoopClientStep(s.forest, nowMs);
      if (forest === s.forest) return s;
      return { forest };
    }),

  // Death forfeits half the haul; a confirmed bank keeps it all.
  endForest: () =>
    set((s) =>
      !s.forest
        ? s
        : s.forest.status === 'ended'
          ? commitForestDeath(s, s.forest)
          : commitForest(s, s.forest),
    ),
});
