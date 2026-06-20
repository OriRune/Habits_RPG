import type { StateCreator } from 'zustand';
import { type GearSlot, getGear } from '@/engine/gear';
import { WEAPONS, STARTER_WEAPON } from '@/engine/weapons';
import { STARTER_SPELLS } from '@/engine/spells';
import { getItem } from '@/engine/items';
import { getRecipe, canCraft } from '@/engine/crafting';
import { toISODate } from '@/engine/date';
import { type Habit, currentStreak } from '@/engine/habits';
import type { GameState } from '../shared';

export interface EconomySlice {
  inventory: Record<string, number>;
  materials: Record<string, number>;
  knownSpells: string[];
  equippedWeapon: string;
  ownedWeapons: string[];
  ownedGear: string[];
  equipment: Record<GearSlot, string | null>;

  buyItem: (itemKey: string) => void;
  useStreakFreeze: (habitId: string) => void;
  equipWeapon: (weaponKey: string) => void;
  buyWeapon: (weaponKey: string) => void;
  learnFromSpellbook: (itemKey: string) => void;
  craft: (recipeKey: string) => void;
  equipGear: (gearKey: string) => void;
  unequipGear: (slot: GearSlot) => void;
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

  craft: (recipeKey) =>
    set((s) => {
      const recipe = getRecipe(recipeKey);
      const freeGold = s.settings.unlimitedGold;
      if (!recipe || !canCraft(recipe, s.materials, freeGold ? Infinity : s.character.gold)) return s;
      const materials = { ...s.materials };
      for (const [key, qty] of Object.entries(recipe.materials)) {
        materials[key] = (materials[key] ?? 0) - qty;
      }
      const gold = freeGold ? s.character.gold : s.character.gold - (recipe.gold ?? 0);
      const { kind, key } = recipe.result;
      const next: Partial<GameState> = { materials, character: { ...s.character, gold } };
      if (kind === 'gear') {
        next.ownedGear = s.ownedGear.includes(key) ? s.ownedGear : [...s.ownedGear, key];
      } else if (kind === 'weapon') {
        next.ownedWeapons = s.ownedWeapons.includes(key) ? s.ownedWeapons : [...s.ownedWeapons, key];
      } else {
        next.inventory = { ...s.inventory, [key]: (s.inventory[key] ?? 0) + 1 };
      }
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
