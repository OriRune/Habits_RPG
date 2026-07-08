import type { StateCreator } from 'zustand';
import { type GearSlot, getGear } from '@/engine/gear';
import { WEAPONS, STARTER_WEAPON } from '@/engine/weapons';
import { STARTER_SPELLS } from '@/engine/spells';
import { getItem } from '@/engine/items';
import {
  getRecipe,
  canCraft,
  scoreToTier,
  reforgeCost,
  reforgeAnchorOf,
  NORMAL,
  MASTERWORK,
} from '@/engine/crafting';
import { type ForgeBoosts } from '@/engine/crafting/forge';
import { toISODate } from '@/engine/date';
import { type Habit, currentStreak, mostRecentMissedScheduledDay } from '@/engine/habits';
import type { GameState } from '../shared';

export interface EconomySlice {
  inventory: Record<string, number>;
  materials: Record<string, number>;
  knownSpells: string[];
  equippedWeapon: string;
  ownedWeapons: string[];
  ownedGear: string[];
  equipment: Record<GearSlot, string | null>;
  claimedPartyQuests: string[];
  /** Forge quality tier per crafted gear key (CraftTier 0–3; absent key = Normal). */
  gearQuality: Record<string, number>;
  /** Forge quality tier per crafted weapon key (CraftTier 0–3; absent key = Normal). */
  weaponQuality: Record<string, number>;

  buyItem: (itemKey: string) => void;
  useStreakFreeze: (habitId: string) => void;
  useRecoveryElixir: (habitId: string) => void;
  claimPartyQuestReward: (questId: string, memberCount: number) => void;
  equipWeapon: (weaponKey: string) => void;
  buyWeapon: (weaponKey: string) => void;
  buyGear: (gearKey: string) => void;
  learnFromSpellbook: (itemKey: string) => void;
  craft: (recipeKey: string, score01?: number, boosts?: ForgeBoosts) => void;
  /** Re-forge an owned, below-Masterwork gear/weapon: gold sink + 1 anchor material (§5). */
  reforge: (recipeKey: string, score01: number, boosts?: ForgeBoosts) => void;
  equipGear: (gearKey: string) => void;
  unequipGear: (slot: GearSlot) => void;
}

/**
 * Fuel & Flux material costs (§6) for a boost selection: Seasoned Wood = 2 wood,
 * Firebrick = 2 stone, Gemstone flux = 1 gemstone. Empty when no boosts are selected.
 */
function boostCosts(boosts?: ForgeBoosts): Record<string, number> {
  const costs: Record<string, number> = {};
  if (boosts?.fuel === 'wood') costs.wood = 2;
  else if (boosts?.fuel === 'stone') costs.stone = 2;
  if (boosts?.flux) costs.gemstone = 1;
  return costs;
}

export const createEconomySlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  EconomySlice
> = (set) => ({
  inventory: {},
  materials: {},
  knownSpells: [...STARTER_SPELLS],
  equippedWeapon: STARTER_WEAPON,
  ownedWeapons: [STARTER_WEAPON],
  ownedGear: [],
  equipment: { armor: null, trinket: null, tool: null },
  claimedPartyQuests: [],
  gearQuality: {},
  weaponQuality: {},

  buyItem: (itemKey) =>
    set((s) => {
      const item = getItem(itemKey);
      if (!item || item.price === undefined) return s;
      const free = s.settings.unlimitedGold;
      if (!free && s.character.gold < item.price) return s;
      return {
        character: { ...s.character, gold: free ? s.character.gold : s.character.gold - item.price },
        inventory: { ...s.inventory, [itemKey]: (s.inventory[itemKey] ?? 0) + 1 },
      };
    }),

  useStreakFreeze: (habitId) =>
    set((s) => {
      if ((s.inventory['streak_freeze'] ?? 0) <= 0) return s;
      const habit = s.habits.find((h) => h.id === habitId);
      if (!habit) return s;
      const today = toISODate();
      // Don't consume the item if today is already logged (completed or frozen).
      if (habit.log[today] !== undefined) return s;
      // Don't spend a freeze protecting an already-dead streak.
      if (currentStreak(habit, today) === 0) return s;
      return {
        inventory: { ...s.inventory, streak_freeze: s.inventory['streak_freeze'] - 1 },
        habits: s.habits.map((h) => {
          if (h.id !== habitId) return h;
          const updated: Habit = {
            ...h,
            log: { ...h.log, [today]: { xp: 0, frozen: true } },
            lastCompletedISO: today,
          };
          updated.streak = currentStreak(updated, today);
          return updated;
        }),
      };
    }),

  useRecoveryElixir: (habitId) =>
    set((s) => {
      if ((s.inventory['recovery_elixir'] ?? 0) <= 0) return s;
      const habit = s.habits.find((h) => h.id === habitId);
      if (!habit) return s;
      const today = toISODate();
      const missed = mostRecentMissedScheduledDay(habit, today);
      // Nothing to repair — don't consume the elixir.
      if (missed === undefined) return s;
      return {
        inventory: { ...s.inventory, recovery_elixir: s.inventory['recovery_elixir'] - 1 },
        habits: s.habits.map((h) => {
          if (h.id !== habitId) return h;
          // Retroactive repair of a past day; leaves lastCompletedISO (today's completion) alone.
          const updated: Habit = { ...h, log: { ...h.log, [missed]: { xp: 0, frozen: true } } };
          updated.streak = currentStreak(updated, today);
          return updated;
        }),
      };
    }),

  claimPartyQuestReward: (questId, memberCount) =>
    set((s) => {
      if (s.claimedPartyQuests.includes(questId)) return s;
      const reward = Math.min(200, 50 + 10 * memberCount);
      return {
        claimedPartyQuests: [...s.claimedPartyQuests, questId],
        character: { ...s.character, gold: s.character.gold + reward },
      };
    }),

  equipWeapon: (weaponKey) =>
    set((s) => {
      if (!s.ownedWeapons.includes(weaponKey)) return s;
      return { equippedWeapon: weaponKey };
    }),

  buyWeapon: (weaponKey) =>
    set((s) => {
      const weapon = WEAPONS[weaponKey];
      if (!weapon || weapon.price === undefined) return s;
      if (s.ownedWeapons.includes(weaponKey)) return s;
      const free = s.settings.unlimitedGold;
      if (!free && s.character.gold < weapon.price) return s;
      return {
        character: { ...s.character, gold: free ? s.character.gold : s.character.gold - weapon.price },
        ownedWeapons: [...s.ownedWeapons, weaponKey],
      };
    }),

  buyGear: (gearKey) =>
    set((s) => {
      const gear = getGear(gearKey);
      if (!gear || gear.price === undefined) return s;
      if (s.ownedGear.includes(gearKey)) return s;
      const free = s.settings.unlimitedGold;
      if (!free && s.character.gold < gear.price) return s;
      return {
        character: { ...s.character, gold: free ? s.character.gold : s.character.gold - gear.price },
        ownedGear: [...s.ownedGear, gearKey],
      };
    }),

  learnFromSpellbook: (itemKey) =>
    set((s) => {
      const item = getItem(itemKey);
      const spellKey = item?.effect.learnsSpell;
      if (!spellKey || (s.inventory[itemKey] ?? 0) <= 0) return s;
      const inventory = { ...s.inventory, [itemKey]: s.inventory[itemKey] - 1 };
      const knownSpells = s.knownSpells.includes(spellKey)
        ? s.knownSpells
        : [...s.knownSpells, spellKey];
      return { inventory, knownSpells };
    }),

  craft: (recipeKey, score01, boosts) =>
    set((s) => {
      const recipe = getRecipe(recipeKey);
      const freeGold = s.settings.unlimitedGold;
      if (!recipe || !canCraft(recipe, s.materials, freeGold ? Infinity : s.character.gold)) return s;
      // Fuel & Flux (§6): insufficient boost materials rejects the whole craft — no partial spend.
      const bCosts = boostCosts(boosts);
      for (const [key, qty] of Object.entries(bCosts)) {
        if ((s.materials[key] ?? 0) < qty) return s;
      }
      const materials = { ...s.materials };
      for (const [key, qty] of Object.entries(recipe.materials)) {
        materials[key] = (materials[key] ?? 0) - qty;
      }
      for (const [key, qty] of Object.entries(bCosts)) {
        materials[key] = (materials[key] ?? 0) - qty;
      }
      const gold = freeGold ? s.character.gold : s.character.gold - (recipe.gold ?? 0);
      const { kind, key } = recipe.result;
      const next: Partial<GameState> = { materials, character: { ...s.character, gold } };
      // No score (one-click path) ⇒ Normal, identical to pre-Forge crafting. The absent-key
      // Normal default applies only at read time; a scored first craft stores its earned tier,
      // Crude included. Re-crafts can only improve a stored tier, never downgrade it.
      const tier = score01 === undefined ? NORMAL : scoreToTier(score01);
      if (kind === 'gear') {
        next.ownedGear = s.ownedGear.includes(key) ? s.ownedGear : [...s.ownedGear, key];
        const prev = s.gearQuality[key];
        next.gearQuality = { ...s.gearQuality, [key]: prev === undefined ? tier : Math.max(prev, tier) };
      } else if (kind === 'weapon') {
        next.ownedWeapons = s.ownedWeapons.includes(key) ? s.ownedWeapons : [...s.ownedWeapons, key];
        const prev = s.weaponQuality[key];
        next.weaponQuality = { ...s.weaponQuality, [key]: prev === undefined ? tier : Math.max(prev, tier) };
      } else {
        next.inventory = { ...s.inventory, [key]: (s.inventory[key] ?? 0) + 1 };
      }
      return next;
    }),

  reforge: (recipeKey, score01, boosts) =>
    set((s) => {
      const recipe = getRecipe(recipeKey);
      if (!recipe) return s;
      const { kind, key } = recipe.result;
      // Re-forge only applies to gear/weapon the player already OWNS.
      if (kind !== 'gear' && kind !== 'weapon') return s;
      const owned = kind === 'gear' ? s.ownedGear.includes(key) : s.ownedWeapons.includes(key);
      if (!owned) return s;
      // Absent quality entry (bought/looted item) reads as Normal for the below-Masterwork gate.
      const qualityMap = kind === 'gear' ? s.gearQuality : s.weaponQuality;
      const prev = qualityMap[key];
      const current = prev === undefined ? NORMAL : prev;
      if (current >= MASTERWORK) return s;
      // Cost: gold sink + 1 anchor material + any boost materials (§5/§6).
      const cost = reforgeCost(recipe);
      const freeGold = s.settings.unlimitedGold;
      if (!freeGold && s.character.gold < cost) return s;
      const needed = boostCosts(boosts);
      const anchor = reforgeAnchorOf(recipe);
      needed[anchor] = (needed[anchor] ?? 0) + 1;
      for (const [matKey, qty] of Object.entries(needed)) {
        if ((s.materials[matKey] ?? 0) < qty) return s;
      }
      // Consume cost + materials atomically; a worse run still spends but keeps the tier.
      const materials = { ...s.materials };
      for (const [matKey, qty] of Object.entries(needed)) {
        materials[matKey] = (materials[matKey] ?? 0) - qty;
      }
      const gold = freeGold ? s.character.gold : s.character.gold - cost;
      const newTier = Math.max(current, scoreToTier(score01));
      const next: Partial<GameState> = { materials, character: { ...s.character, gold } };
      if (kind === 'gear') next.gearQuality = { ...s.gearQuality, [key]: newTier };
      else next.weaponQuality = { ...s.weaponQuality, [key]: newTier };
      return next;
    }),

  equipGear: (gearKey) =>
    set((s) => {
      const gear = getGear(gearKey);
      if (!gear || !s.ownedGear.includes(gearKey)) return s;
      return { equipment: { ...s.equipment, [gear.slot]: gearKey } };
    }),

  unequipGear: (slot) =>
    set((s) => ({ equipment: { ...s.equipment, [slot]: null } })),
});
