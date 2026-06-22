import type { StateCreator } from 'zustand';
import type { ArenaState, ArenaSpeed } from '@/engine/arena';
import {
  createArena,
  arenaMove as arenaMoveFn,
  arenaAct as arenaActFn,
  arenaMelee as arenaMeleeFn,
  arenaRanged as arenaRangedFn,
  arenaCast as arenaCastFn,
  arenaUseItem as arenaUseItemFn,
  arenaTick as arenaTickFn,
  rollArenaSetup,
  arenaSpeedFactor,
  ARENA_ENERGY_COST,
  ARENA_UNLOCK_LEVEL,
} from '@/engine/arena';
import { bossForLevel } from '@/engine/bosses';
import { MAX_LEVEL } from '@/engine/progression';
import type { Dir as GridDir, Cell as GridCell } from '@/engine/grid';
import type { GameState } from '../shared';
import { fighterFor, commitArena, energySpentPatch } from '../shared';

// ArenaSpeed is re-exported for convenience (settings uses it).
export type { ArenaSpeed };

export interface ArenaSlice {
  arena: ArenaState | null;
  deepestArenaTier: number;

  beginArena: () => void;
  arenaMove: (dir: GridDir) => void;
  arenaAct: (nowMs: number, dir?: GridDir) => void;
  arenaMelee: (nowMs: number, dir?: GridDir) => void;
  arenaRanged: (nowMs: number, dir?: GridDir) => void;
  arenaCast: (spellKey: string, nowMs: number, opts?: { dir?: GridDir; target?: GridCell }) => void;
  arenaUseItem: (itemKey: string, nowMs: number) => void;
  arenaTick: (nowMs: number) => void;
  beginArenaBanking: () => void;
  endArena: () => void;
}

export const createArenaSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  ArenaSlice
> = (set) => ({
  arena: null,
  deepestArenaTier: 0,

  beginArena: () =>
    set((s) => {
      const free = s.settings.unlimitedEnergy;
      if (s.arena || s.character.level < ARENA_UNLOCK_LEVEL) return s;
      if (!free && s.character.energy < ARENA_ENERGY_COST) return s;
      const tier = Math.max(ARENA_UNLOCK_LEVEL, Math.min(MAX_LEVEL, s.character.level));
      const setup = rollArenaSetup(tier, Math.random);
      const arena = createArena(fighterFor(s), bossForLevel(tier), {
        knownSpells: s.knownSpells,
        inventory: s.inventory,
        tier,
        startMs: performance.now(),
        rng: Math.random,
        radius: setup.radius,
        density: setup.density,
        startMinions: setup.startMinions,
        speed: arenaSpeedFactor(s.settings.arenaSpeed, s.character.level),
        invincible: s.settings.invincible,
      });
      return {
        character: {
          ...s.character,
          energy: free ? s.character.energy : s.character.energy - ARENA_ENERGY_COST,
        },
        arena,
        ...(free ? {} : energySpentPatch(s, ARENA_ENERGY_COST)),
      };
    }),

  arenaMove: (dir) =>
    set((s) =>
      s.arena && s.arena.status === 'active' ? { arena: arenaMoveFn(s.arena, dir) } : s,
    ),

  arenaAct: (nowMs, dir) =>
    set((s) => {
      if (!s.arena || s.arena.status !== 'active') return s;
      const arena = arenaActFn(s.arena, nowMs, Math.random, dir);
      return arena === s.arena ? s : { arena };
    }),

  arenaMelee: (nowMs, dir) =>
    set((s) => {
      if (!s.arena || s.arena.status !== 'active') return s;
      const arena = arenaMeleeFn(s.arena, nowMs, Math.random, dir);
      return arena === s.arena ? s : { arena };
    }),

  arenaRanged: (nowMs, dir) =>
    set((s) => {
      if (!s.arena || s.arena.status !== 'active') return s;
      const arena = arenaRangedFn(s.arena, nowMs, Math.random, dir);
      return arena === s.arena ? s : { arena };
    }),

  arenaCast: (spellKey, nowMs, opts) =>
    set((s) => {
      if (!s.arena || s.arena.status !== 'active') return s;
      const arena = arenaCastFn(s.arena, spellKey, nowMs, Math.random, opts);
      return arena === s.arena ? s : { arena };
    }),

  arenaUseItem: (itemKey, nowMs) =>
    set((s) => {
      if (!s.arena || s.arena.status !== 'active') return s;
      const arena = arenaUseItemFn(s.arena, itemKey, nowMs);
      return arena === s.arena ? s : { arena };
    }),

  arenaTick: (nowMs) =>
    set((s) => {
      if (!s.arena || s.arena.status !== 'active') return s;
      const arena = arenaTickFn(s.arena, nowMs, Math.random);
      return arena === s.arena ? s : { arena };
    }),

  beginArenaBanking: () =>
    set((s) =>
      s.arena && s.arena.status === 'active'
        ? { arena: { ...s.arena, status: 'banking' as const } }
        : s,
    ),

  endArena: () => set((s) => (s.arena ? commitArena(s, s.arena) : s)),
});
