import type { StateCreator } from 'zustand';
import { toISODate } from '@/engine/date';
import {
  freshTown,
  queueBuild,
  queueUpgrade,
  cancelProject,
  applyLabor,
  settleProjects,
  demolish,
  moveBuilding,
  placeDecor,
  removeDecor,
  prestigeOf,
  type TownState,
} from '@/engine/town';
import { TOWN_BUILDINGS, TOWN_DEED_COSTS, TOWN_DEED_PRESTIGE } from '@/content/townBuildings';
import { TOWN_DECOR } from '@/content/townDecor';
import type { GameState } from '../shared';
import { uid } from '../gameState';

export interface TownSlice {
  town: TownState;
  townQueueBuild: (key: string, r: number, c: number, rot?: 0 | 1) => void;
  townQueueUpgrade: (buildingId: string) => void;
  townCancelProject: (projectId: string) => void;
  townBuyDeed: () => void;
  townPlaceDecor: (key: string, r: number, c: number) => void;
  townRemoveDecor: (r: number, c: number) => void;
  townDemolish: (buildingId: string) => void;
  townMoveBuilding: (buildingId: string, r: number, c: number, rot?: 0 | 1) => void;
}

/** Refund a Record<matId, qty> back into the player's materials (clone-and-add). */
function addMaterials(base: Record<string, number>, refund: Record<string, number>): Record<string, number> {
  const materials = { ...base };
  for (const [mat, qty] of Object.entries(refund)) materials[mat] = (materials[mat] ?? 0) + qty;
  return materials;
}

export const createTownSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  TownSlice
> = (set) => ({
  town: freshTown(),

  // Charge gold + materials at queue time (escrow), then immediately drain any banked
  // labor into the new project. Mirrors craft()'s validate→subtract idiom: unlimitedGold
  // frees gold but materials are always charged, and nothing mutates until all checks pass.
  townQueueBuild: (key, r, c, rot) =>
    set((s) => {
      const def = TOWN_BUILDINGS[key];
      if (!def) return s;
      const queued = queueBuild(s.town, def, r, c, rot, uid());
      if (!queued) return s; // invalid placement (bounds/occupied/locked/unique/prestige/queue_full)
      const cost = def.tiers[0];
      const freeGold = s.settings.unlimitedGold;
      if (!freeGold && s.character.gold < cost.gold) return s;
      for (const [mat, qty] of Object.entries(cost.materials)) {
        if ((s.materials[mat] ?? 0) < qty) return s;
      }
      const materials = { ...s.materials };
      for (const [mat, qty] of Object.entries(cost.materials)) materials[mat] = (materials[mat] ?? 0) - qty;
      const gold = freeGold ? s.character.gold : s.character.gold - cost.gold;
      const { town } = settleProjects(applyLabor(queued, 0, toISODate()));
      return { town, materials, character: { ...s.character, gold } };
    }),

  townQueueUpgrade: (buildingId) =>
    set((s) => {
      const building = s.town.buildings.find((b) => b.id === buildingId);
      if (!building) return s;
      const def = TOWN_BUILDINGS[building.key];
      if (!def || building.tier >= def.maxTier) return s;
      const queued = queueUpgrade(s.town, buildingId, uid());
      if (!queued) return s; // already queued or queue full
      const cost = def.tiers[building.tier];
      const freeGold = s.settings.unlimitedGold;
      if (!freeGold && s.character.gold < cost.gold) return s;
      for (const [mat, qty] of Object.entries(cost.materials)) {
        if ((s.materials[mat] ?? 0) < qty) return s;
      }
      const materials = { ...s.materials };
      for (const [mat, qty] of Object.entries(cost.materials)) materials[mat] = (materials[mat] ?? 0) - qty;
      const gold = freeGold ? s.character.gold : s.character.gold - cost.gold;
      const { town } = settleProjects(applyLabor(queued, 0, toISODate()));
      return { town, materials, character: { ...s.character, gold } };
    }),

  // Cancel: 100% of the escrowed materials refund; gold stays sunk; applied labor forfeited.
  townCancelProject: (projectId) =>
    set((s) => {
      const { town, refundMaterials } = cancelProject(s.town, projectId);
      if (town === s.town) return s;
      return { town, materials: addMaterials(s.materials, refundMaterials) };
    }),

  // Deeds are pure gold (the BAL-05 sink), gated on prestige and deeds < 3.
  townBuyDeed: () =>
    set((s) => {
      const deeds = s.town.deeds;
      if (deeds >= 3) return s;
      if (prestigeOf(s.town) < TOWN_DEED_PRESTIGE[deeds]) return s;
      const cost = TOWN_DEED_COSTS[deeds];
      const freeGold = s.settings.unlimitedGold;
      if (!freeGold && s.character.gold < cost) return s;
      const gold = freeGold ? s.character.gold : s.character.gold - cost;
      return { town: { ...s.town, deeds: deeds + 1 }, character: { ...s.character, gold } };
    }),

  townPlaceDecor: (key, r, c) =>
    set((s) => {
      const def = TOWN_DECOR[key];
      if (!def) return s;
      const v = Math.floor(Math.random() * 4); // cosmetic variant seed (0..3)
      const placed = placeDecor(s.town, def, r, c, v);
      if (!placed) return s; // caps or invalid placement
      const freeGold = s.settings.unlimitedGold;
      if (!freeGold && s.character.gold < def.gold) return s;
      for (const [mat, qty] of Object.entries(def.materials)) {
        if ((s.materials[mat] ?? 0) < qty) return s;
      }
      const materials = { ...s.materials };
      for (const [mat, qty] of Object.entries(def.materials)) materials[mat] = (materials[mat] ?? 0) - qty;
      const gold = freeGold ? s.character.gold : s.character.gold - def.gold;
      return { town: placed, materials, character: { ...s.character, gold } };
    }),

  townRemoveDecor: (r, c) =>
    set((s) => {
      const { town, refundMaterials } = removeDecor(s.town, r, c);
      if (town === s.town) return s;
      return { town, materials: addMaterials(s.materials, refundMaterials) };
    }),

  townDemolish: (buildingId) =>
    set((s) => {
      const { town, refundMaterials } = demolish(s.town, buildingId);
      if (town === s.town) return s;
      return { town, materials: addMaterials(s.materials, refundMaterials) };
    }),

  townMoveBuilding: (buildingId, r, c, rot) =>
    set((s) => {
      const town = moveBuilding(s.town, buildingId, r, c, rot);
      if (!town) return s;
      return { town };
    }),
});
