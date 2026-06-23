import type { StateCreator } from 'zustand';
import { STAT_IDS, emptyStatXP } from '@/engine/stats';
import { toISODate, weekKey, addDays } from '@/engine/date';
import { cumulativeXpToReach } from '@/engine/leveling';
import { creationStatLevels, MAX_LEVEL, statLevelsFromXp } from '@/engine/progression';
import { classFor } from '@/engine/classes';
import { bossForLevel } from '@/engine/bosses';
import { createBattle } from '@/engine/combat';
import { WEAPONS, STARTER_WEAPON } from '@/engine/weapons';
import { STARTER_SPELLS } from '@/engine/spells';
import { emptyCombatStats } from '@/engine/combatStats';
import {
  emptyTrialsClearedOn,
  emptyBestTrialScore,
} from '@/engine/trials/trials';
import { type StatId } from '@/engine/stats';
import type { GameState, Character, PendingClassChoice } from '../shared';
import {
  freshCharacter,
  freshSettings,
  fighterFor,
  MAX_ENERGY,
} from '../shared';
import { freshEarningsLedger } from '@/engine/balance';

export interface CoreSlice {
  character: Character;
  codex: string[];
  pendingLevelUp: number | null;
  pendingClassChoice: PendingClassChoice | null;
  bossLosses: Record<number, number>;
  lastActiveISO: string;
  created: boolean;
  hasSeenWelcome: boolean;
  earnings: import('@/engine/balance').EarningsLedger;
  energyLog: Record<string, import('@/engine/balance').EnergyLogEntry>;

  dismissWelcome: () => void;
  createCharacter: (input: {
    name: string;
    allocations: Partial<Record<StatId, number>>;
    weaponKey: string;
    spellKey: string;
  }) => void;
  chooseClass: (primary: StatId, secondary: StatId) => void;
  devSetLevel: (target: number) => void;
  devSetDeepestFloor: (n: number) => void;
  devSpawnTrial: (level: number) => void;
  devClearClass: () => void;
  devFillEnergy: () => void;
  devAddGold: (amount: number) => void;
  devForceWeeklyRollover: () => void;
  devResetEarnings: () => void;
  resetGame: () => void;
}

export const createCoreSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  CoreSlice
> = (set) => ({
  character: freshCharacter(),
  codex: [],
  pendingLevelUp: null,
  pendingClassChoice: null,
  bossLosses: {},
  lastActiveISO: toISODate(),
  created: false,
  hasSeenWelcome: false,
  earnings: freshEarningsLedger(),
  energyLog: {},

  dismissWelcome: () => set(() => ({ hasSeenWelcome: true })),

  createCharacter: ({ name, allocations, weaponKey, spellKey }) =>
    set((s) => {
      const weapon = WEAPONS[weaponKey] ? weaponKey : STARTER_WEAPON;
      const spells = [...STARTER_SPELLS];
      if (spellKey && !spells.includes(spellKey)) spells.push(spellKey);
      return {
        character: {
          ...s.character,
          name: name.trim() || 'Adventurer',
          statLevels: creationStatLevels(allocations),
        },
        equippedWeapon: weapon,
        ownedWeapons: [weapon],
        knownSpells: spells,
        created: true,
      };
    }),

  chooseClass: (primary, secondary) =>
    set((s) => {
      const classId = classFor(primary, secondary);
      const codex = s.codex.includes(classId) ? s.codex : [...s.codex, classId];
      return {
        character: { ...s.character, classId },
        codex,
        pendingClassChoice: null,
      };
    }),

  devSetLevel: (target) =>
    set((s) => {
      const level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(target)));
      const total = cumulativeXpToReach(level);
      const per = Math.floor(total / STAT_IDS.length);
      const remainder = total - per * STAT_IDS.length;
      const statXp = emptyStatXP();
      STAT_IDS.forEach((id, i) => {
        statXp[id] = per + (i === 0 ? remainder : 0);
      });
      const statLevels = statLevelsFromXp(statXp as Record<StatId, number>);
      return {
        character: {
          ...s.character,
          level,
          statXp,
          statXpAtLastLevel: { ...statXp },
          statLevels,
        },
        pendingLevelUp: null,
      };
    }),

  devSetDeepestFloor: (n) =>
    set(() => ({ deepestFloor: Math.max(0, Math.floor(n)) })),

  devSpawnTrial: (level) =>
    set((s) => {
      if (s.battle) return s;
      const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
      const boss = bossForLevel(target);
      const battle = createBattle(fighterFor(s), boss, { lossesBefore: s.bossLosses[target] ?? 0 });
      return { pendingLevelUp: target, battle };
    }),

  devClearClass: () =>
    set((s) => ({ character: { ...s.character, classId: null } })),

  devFillEnergy: () =>
    set((s) => ({ character: { ...s.character, energy: MAX_ENERGY } })),

  devAddGold: (amount) =>
    set((s) => ({
      character: { ...s.character, gold: s.character.gold + Math.max(0, Math.floor(amount)) },
    })),

  devForceWeeklyRollover: () =>
    set(() => ({ lastWeekKey: weekKey(addDays(toISODate(), -7)) })),

  devResetEarnings: () =>
    set(() => ({ earnings: freshEarningsLedger(), energyLog: {} })),

  resetGame: () =>
    set(() => ({
      habits: [],
      character: freshCharacter(),
      inventory: {},
      materials: {},
      knownSpells: [...STARTER_SPELLS],
      equippedWeapon: STARTER_WEAPON,
      ownedWeapons: [STARTER_WEAPON],
      combatStats: emptyCombatStats(),
      codex: [],
      challenges: [],
      customChallenges: [],
      lastWeekKey: weekKey(toISODate()),
      pendingReport: null,
      battle: null,
      dungeon: null,
      mining: null,
      deepestMineFloor: 0,
      bestMineScore: 0,
      forest: null,
      deepestForestStage: 0,
      bestForestScore: 0,
      arena: null,
      deepestArenaTier: 0,
      tactics: null,
      deepestTacticsTier: 0,
      trialsClearedOn: emptyTrialsClearedOn(),
      bestTrialScore: emptyBestTrialScore(),
      pendingLevelUp: null,
      pendingClassChoice: null,
      bossLosses: {},
      deepestFloor: 0,
      dungeonHistory: [],
      completionLog: {},
      lastActiveISO: toISODate(),
      settings: freshSettings(),
      created: false,
      hasSeenWelcome: false,
      earnings: freshEarningsLedger(),
      energyLog: {},
      mineTombstone: null,
      claimedPartyQuests: [],
    })),
});
