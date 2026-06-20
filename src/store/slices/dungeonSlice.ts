import type { StateCreator } from 'zustand';
import { type CombatStats, emptyCombatStats, combatXpForWin, dungeonCombatStatXp } from '@/engine/combatStats';
import { type CombatAction, playerAction } from '@/engine/combat';
import { getWeapon } from '@/engine/weapons';
import { rollBoons, rollCurse } from '@/engine/relics';
import { mergeReward, DUNGEON_ENERGY_COST } from '@/engine/dungeon';
import { generateFloorMap } from '@/engine/dungeonMap';
import { type DungeonRun } from '@/engine/dungeonTypes';
import { biomeForDepth } from '@/engine/biomes';
import { getEncounter, chooseEncounter, checkChance } from '@/engine/encounters';
import { DUNGEON_UNLOCK_LEVEL } from '@/engine/progression';
import { toISODate } from '@/engine/date';
import type { GameState, DungeonRunSummary } from '../shared';
import {
  gearBonuses,
  fighterFor,
  topUpFighter,
  applyReward,
  grantStatXp,
  boonMaxTier,
  offerBoon,
  resolveCurrentNode,
  currentRoom,
  enterRoom,
  finishRun,
} from '../shared';

const FLOOR_LOSS_KEEP = 0.25;

export interface DungeonSlice {
  combatStats: CombatStats;
  dungeon: DungeonRun | null;
  deepestFloor: number;
  dungeonHistory: DungeonRunSummary[];

  startDungeon: () => void;
  dungeonChoosePath: (nodeId: string) => void;
  dungeonEncounterChoose: (choiceIndex: number) => void;
  dungeonBattleAction: (action: CombatAction) => void;
  dungeonAdvance: () => void;
  dungeonBank: () => void;
  dungeonDescend: (mode: 'rest' | 'pressOn') => void;
  collectDungeon: () => void;
  chooseBoon: (relicKey: string) => void;
  dungeonShrine: (choice: 'pray' | 'offer' | 'leave') => void;
  dungeonBuy: (offerId: string) => void;
  dungeonRest: (choice: 'heal' | 'fortify') => void;
  dungeonLeaveRoom: () => void;
}

export const createDungeonSlice: StateCreator<
  GameState,
  [['zustand/persist', unknown]],
  [],
  DungeonSlice
> = (set) => ({
  combatStats: emptyCombatStats(),
  dungeon: null,
  deepestFloor: 0,
  dungeonHistory: [],

  startDungeon: () =>
    set((s) => {
      const freeEnergy = s.settings.unlimitedEnergy;
      if (s.dungeon || s.character.level < DUNGEON_UNLOCK_LEVEL) return s;
      if (!freeEnergy && s.character.energy < DUNGEON_ENERGY_COST) return s;
      const { c } = fighterFor(s);
      const biome = biomeForDepth(1);
      const map = generateFloorMap(1, biome, Math.random, { deepest: s.deepestFloor });
      const run: DungeonRun = {
        depth: 1,
        biomeKey: biome.key,
        map,
        nodeId: null,
        choices: map.layers[0],
        path: [],
        hp: c.maxHp,
        maxHp: c.maxHp,
        mp: c.maxMp,
        maxMp: c.maxMp,
        sta: c.maxSta,
        maxSta: c.maxSta,
        bankedReward: {},
        floorReward: {},
        encounter: null,
        roomLoot: null,
        battle: null,
        atCheckpoint: false,
        status: 'active',
        cleared: false,
        relics: [],
        pendingBoon: null,
        merchant: null,
      };
      return {
        character: {
          ...s.character,
          energy: freeEnergy ? s.character.energy : s.character.energy - DUNGEON_ENERGY_COST,
        },
        dungeon: run,
      };
    }),

  dungeonChoosePath: (nodeId) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || run.nodeId !== null || !run.choices.includes(nodeId)) return s;
      const next: DungeonRun = { ...run, nodeId, choices: [], path: [...run.path, nodeId] };
      enterRoom(next, s);
      return { dungeon: next };
    }),

  dungeonEncounterChoose: (choiceIndex) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || !run.encounter || run.encounter.done) return s;
      const room = currentRoom(run);
      if (room?.type !== 'encounter') return s;
      const def = getEncounter(room.key);
      if (!def) return s;

      const gateCtx = { hp: run.hp, mp: run.mp, sta: run.sta, depth: run.depth, relics: run.relics };
      const checkedStat = def.nodes[run.encounter.nodeId]?.choices?.[choiceIndex]?.stat;
      const { state: encState, step } = chooseEncounter(
        run.encounter,
        def,
        choiceIndex,
        s.character.statLevels,
        gearBonuses(s).statBonuses,
        Math.random,
        gateCtx,
      );
      const inv = s.settings.invincible;
      const hp = inv ? run.maxHp : Math.max(0, Math.min(run.maxHp, run.hp + step.hpDelta));
      const mp = inv ? run.maxMp : Math.max(0, Math.min(run.maxMp, run.mp + step.mpDelta));
      const sta = inv ? run.maxSta : Math.max(0, Math.min(run.maxSta, run.sta + step.staDelta));
      const floorReward = mergeReward(run.floorReward, step.reward);

      // Passing a stat check exercises that stat — award habit XP toward the character level.
      const statXpPatch =
        checkedStat && encState.lastOutcome === 'success' ? grantStatXp(s, { [checkedStat]: 10 }) : null;

      if (hp <= 0) {
        // Fell during the encounter — forfeit most of the floor's loot.
        return { dungeon: finishRun({ ...run, encounter: encState, mp, sta, floorReward }, false, 0, FLOOR_LOSS_KEEP) };
      }

      // Apply boon / curse signals from the encounter step.
      let next: DungeonRun = { ...run, encounter: encState, hp, mp, sta, floorReward };
      if (step.grantBoonTier != null) {
        offerBoon(next, step.grantBoonTier);
      }
      if (step.grantCurse) {
        const curse = rollCurse();
        if (curse) {
          next.relics = [...next.relics, curse];
          const newMax = fighterFor({ ...s, dungeon: next }).c.maxHp;
          next.maxHp = newMax;
          next.hp = Math.min(hp, newMax);
        }
      }

      return {
        dungeon: next,
        ...(statXpPatch ?? {}),
      };
    }),

  dungeonBattleAction: (action) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || !run.battle || run.battle.status !== 'active') return s;
      let battle = playerAction(run.battle, fighterFor(s, run.battle.buffs), action);
      if (s.settings.invincible) battle = topUpFighter(battle);

      const inventory = { ...s.inventory };
      if (action.kind === 'item' && (inventory[action.itemKey] ?? 0) > 0) {
        inventory[action.itemKey] -= 1;
      }
      return { dungeon: { ...run, battle }, inventory };
    }),

  dungeonAdvance: () =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || run.atCheckpoint) return s;
      const node = run.nodeId ? run.map.nodes[run.nodeId] : null;
      const room = node?.room;
      if (!node || !room) return s;

      let hp = run.hp;
      let mp = run.mp;
      let sta = run.sta;
      let combatStats: CombatStats | null = null;
      let statXpPatch: ReturnType<typeof grantStatXp> | null = null;

      let workingRun = run;
      let eliteWin = false;

      if (room.type === 'combat' || room.type === 'boss' || room.type === 'elite') {
        const b = run.battle;
        if (!b || b.status === 'active') return s; // can't leave mid-fight
        if (b.status === 'fled') {
          // Escaped alive — a clean retreat keeps everything gathered so far.
          return { dungeon: finishRun(run, false, b.playerHp, 1) };
        }
        if (b.status === 'lost') {
          return { dungeon: finishRun(run, false, 0, FLOOR_LOSS_KEEP) };
        }
        // Won: carry HP/MP/Sta forward and train a combat stat (caster → Ward, else Defense).
        hp = b.playerHp;
        mp = b.playerMp;
        sta = b.playerSta;
        const xp = combatXpForWin(b.bossMaxHp);
        combatStats =
          b.attackSchool === 'magic'
            ? { ...s.combatStats, wardXp: s.combatStats.wardXp + xp }
            : { ...s.combatStats, defenseXp: s.combatStats.defenseXp + xp };
        // Also award habit stat XP toward the character level: the attack stat you fight with,
        // plus HP for enduring the fight.
        const atkStat = getWeapon(s.equippedWeapon).attackStat;
        const { atkShare, hpShare } = dungeonCombatStatXp(b.bossMaxHp);
        statXpPatch = grantStatXp(s, { [atkStat]: atkShare, HP: hpShare });
        if (room.type === 'elite') {
          // Elites drop bonus gold and guarantee a boon.
          eliteWin = true;
          workingRun = { ...run, floorReward: mergeReward(run.floorReward, { gold: 40 + run.depth * 12 }) };
        }
      } else if (room.type === 'encounter') {
        if (!run.encounter || !run.encounter.done) return s; // encounter not finished
      }
      // treasure rooms loot on entry (enterRoom) — advancing just moves on.

      const next = resolveCurrentNode(workingRun, hp, mp, sta);
      if (eliteWin) offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
      return {
        dungeon: next,
        ...(combatStats ? { combatStats } : {}),
        ...(statXpPatch ?? {}),
      };
    }),

  dungeonBank: () =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || !run.atCheckpoint) return s;
      // Floor loot was locked into bankedReward at the checkpoint; just end safely.
      return { dungeon: { ...run, status: 'ended', cleared: true } };
    }),

  dungeonDescend: (mode) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || !run.atCheckpoint) return s;
      const depth = run.depth + 1;
      const deepestFloor = Math.max(s.deepestFloor, depth);
      const biome = biomeForDepth(depth);
      const map = generateFloorMap(depth, biome, Math.random, { deepest: s.deepestFloor });
      // Mana + Stamina reset between floors; HP is the run's attrition currency and carries.
      const next: DungeonRun = {
        ...run,
        depth,
        biomeKey: biome.key,
        map,
        nodeId: null,
        choices: map.layers[0],
        path: [],
        atCheckpoint: false,
        floorReward: {},
        roomLoot: null,
        battle: null,
        encounter: null,
        mp: run.maxMp,
        sta: run.maxSta,
      };
      if (mode === 'rest') {
        // Rest: recover some HP, forgo this checkpoint's boon.
        next.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.4));
      } else {
        // Press On: keep your wounds, take a boon instead.
        offerBoon(next, boonMaxTier(depth, deepestFloor));
      }
      return { dungeon: next, deepestFloor };
    }),

  collectDungeon: () =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'ended') return s;
      const summary: DungeonRunSummary = {
        depth: run.depth,
        cleared: run.cleared,
        defeated: !run.cleared && run.hp <= 0,
        date: toISODate(),
      };
      const next: GameState = {
        ...s,
        character: { ...s.character, statXp: { ...s.character.statXp } },
        inventory: { ...s.inventory },
        materials: { ...s.materials },
        ownedWeapons: [...s.ownedWeapons],
        ownedGear: [...s.ownedGear],
        dungeon: null,
        dungeonHistory: [summary, ...(s.dungeonHistory ?? [])].slice(0, 10),
      };
      // Apply habit-streak gold multiplier to banked gold (§6.3) — same as commitRun does for minigames.
      applyReward(next, {
        ...run.bankedReward,
        gold: Math.round((run.bankedReward.gold ?? 0) * s.character.habitBonus),
      }); // gold/materials/items/weapons/gear — no XP
      return next;
    }),

  chooseBoon: (relicKey) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || !run.pendingBoon || !run.pendingBoon.includes(relicKey)) return s;
      const next: DungeonRun = { ...run, relics: [...run.relics, relicKey], pendingBoon: null };
      // Recompute maxHp so a +maxHp relic raises the gauge now (and grant the gained HP).
      const newMax = fighterFor({ ...s, dungeon: next }).c.maxHp;
      const gained = Math.max(0, newMax - run.maxHp);
      next.maxHp = newMax;
      next.hp = Math.min(newMax, run.hp + gained);
      return { dungeon: next };
    }),

  dungeonShrine: (choice) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || currentRoom(run)?.type !== 'shrine') return s;
      let next: DungeonRun = { ...run };
      if (choice === 'pray') {
        // A check of your best spiritual stat: success blesses you, failure curses you.
        const power = Math.max(s.character.statLevels.WI, s.character.statLevels.CH);
        if (Math.random() < checkChance(power, 6)) {
          offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
        } else {
          const curse = rollCurse();
          if (curse) {
            next.relics = [...run.relics, curse];
            const newMax = fighterFor({ ...s, dungeon: next }).c.maxHp;
            next.maxHp = newMax;
            next.hp = Math.min(next.hp, newMax);
          }
        }
      } else if (choice === 'offer') {
        const cost = Math.round(run.maxHp * 0.25);
        if (run.hp <= cost) return s; // can't pay the toll
        next.hp = run.hp - cost;
        offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
      }
      // 'leave' = no effect. In every case, resolve the room and present the next path.
      return { dungeon: resolveCurrentNode(next, next.hp, next.mp, next.sta) };
    }),

  dungeonBuy: (offerId) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || !run.merchant) return s;
      const offer = run.merchant.find((o) => o.id === offerId);
      if (!offer) return s;
      const free = s.settings.unlimitedGold;
      if (!free && s.character.gold < offer.cost) return s;
      const next: DungeonRun = { ...run, merchant: run.merchant.filter((o) => o.id !== offerId) };
      const patch: Partial<GameState> = {
        character: { ...s.character, gold: free ? s.character.gold : s.character.gold - offer.cost },
      };
      if (offer.kind === 'heal') {
        next.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.4));
      } else if (offer.kind === 'potion' && offer.potionKey) {
        patch.inventory = { ...s.inventory, [offer.potionKey]: (s.inventory[offer.potionKey] ?? 0) + 1 };
      } else if (offer.kind === 'boon') {
        offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
      }
      return { dungeon: next, ...patch };
    }),

  dungeonRest: (choice) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || currentRoom(run)?.type !== 'rest') return s;
      const next: DungeonRun = { ...run };
      if (choice === 'heal') {
        next.hp = Math.min(run.maxHp, run.hp + Math.round(run.maxHp * 0.4));
      } else {
        const choices = rollBoons(3, run.relics, 1); // a modest tier-1 boon
        next.pendingBoon = choices.length ? choices : null;
      }
      return { dungeon: resolveCurrentNode(next, next.hp, next.mp, next.sta) };
    }),


  dungeonLeaveRoom: () =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || currentRoom(run)?.type !== 'merchant') return s;
      return { dungeon: resolveCurrentNode(run, run.hp, run.mp, run.sta) };
    }),
});
