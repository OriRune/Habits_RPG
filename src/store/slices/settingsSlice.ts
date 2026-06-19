import type { StateCreator } from 'zustand';
import type { GameState, GameSettings } from '../shared';
import { freshSettings } from '../shared';

export interface SettingsSlice {
  settings: GameSettings;
  updateSettings: (patch: Partial<GameSettings>) => void;
}

export const createSettingsSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  SettingsSlice
> = (set) => ({
  settings: freshSettings(),

  updateSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),
});
