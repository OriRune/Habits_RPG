import type { StateCreator } from 'zustand';
import { type CombatStats, emptyCombatStats, combatXpForWin, dungeonCombatStatXp } from '@/engine/combatStats';
import { type CombatAction } from '@/engine/combat';
import { getWeapon } from '@/engine/weapons';
import { getRelic, rollBoons, rollCurse } from '@/engine/relics';
import type { StatId } from '@/engine/stats';
import { mergeReward, DUNGEON_ENERGY_COST, combatRoomGold, bossRoomGold } from '@/engine/dungeon';
import { generateFloorMap } from '@/engine/dungeonMap';
import { type DungeonRun } from '@/engine/dungeonTypes';
import { biomeForDepth } from '@/engine/biomes';
import { getEncounter, chooseEncounter, checkChance, encounterDepthTier } from '@/engine/encounters';
import { DUNGEON_UNLOCK_LEVEL } from '@/engine/progression';
import { toISODate } from '@/engine/date';
import type { GameState, DungeonRunSummary } from '../shared';
import {
  runStatBonuses,
  fighterFor,
  resolveBattleAction,
  cloneEarnings,
  applyReward,
  grantStatXp,
  enterRoom,
  energySpentPatch,
} from '../shared';
import {
  boonMaxTier,
  offerBoon,
  resolveCurrentNode,
  currentRoom,
  finishRun,
} from '@/engine/dungeonRun';
import { freshEarningsLedger } from '@/engine/balance';

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
        earnedXp: 0,
      };
      return {
        character: {
          ...s.character,
          energy: freeEnergy ? s.character.energy : s.character.energy - DUNGEON_ENERGY_COST,
        },
        dungeon: run,
        ...(freeEnergy ? {} : energySpentPatch(s, DUNGEON_ENERGY_COST)),
      };
    }),

  dungeonChoosePath: (nodeId) =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'active' || run.nodeId !== null || !run.choices.includes(nodeId)) return s;
      const next: DungeonRun = {
        ...run,
        nodeId,
        choices: [],
        path: [...run.path, nodeId],
        roomsCleared: (run.roomsCleared ?? 0) + 1,
      };
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
        runStatBonuses(s), // MINI-27: gear + relics + runBuff, so "+X WI this run" relics help checks
        Math.random,
        gateCtx,
        run.depth, // MINI-28: deep checks stiffen and pay more
      );
      const inv = s.settings.invincible;
      const hp = inv ? run.maxHp : Math.max(0, Math.min(run.maxHp, run.hp + step.hpDelta));
      const mp = inv ? run.maxMp : Math.max(0, Math.min(run.maxMp, run.mp + step.mpDelta));
      const sta = inv ? run.maxSta : Math.max(0, Math.min(run.maxSta, run.sta + step.staDelta));
      const floorReward = mergeReward(run.floorReward, step.reward);

      // Passing a stat check exercises that stat — award habit XP toward the character level.
      // MINI-28: deeper checks are harder, so they grant more XP (+2 per depth tier).
      const xpGrant =
        checkedStat && encState.lastOutcome === 'success' ? 10 + encounterDepthTier(run.depth) * 2 : 0;
      const statXpPatch = xpGrant ? grantStatXp(s, { [checkedStat!]: xpGrant }) : null;

      if (hp <= 0) {
        // Fell during the encounter — forfeit most of the floor's loot.
        return { dungeon: finishRun({ ...run, encounter: encState, mp, sta, floorReward }, false, 0, FLOOR_LOSS_KEEP) };
      }

      // Apply boon / curse signals from the encounter step.
      let next: DungeonRun = {
        ...run, encounter: encState, hp, mp, sta, floorReward,
        earnedXp: (run.earnedXp ?? 0) + xpGrant,
      };
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
      const { battle, inventory } = resolveBattleAction(run.battle, s, action);
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
      let wonBossId: string | null = null;

      if (room.type === 'combat' || room.type === 'boss' || room.type === 'elite') {
        const b = run.battle;
        if (!b || b.status === 'active') return s; // can't leave mid-fight
        if (b.status === 'fled') {
          // Escaped alive — but a retreat leaves some of the floor's loot behind.
          return { dungeon: finishRun(run, false, b.playerHp, 0.6) };
        }
        if (b.status === 'lost') {
          if (room.type === 'boss') {
            // Count the loss so the retry earns anti-frustration HP relief (via enterRoom → lossesBefore).
            const key = b.bossId;
            return {
              dungeon: finishRun(run, false, 0, FLOOR_LOSS_KEEP),
              dungeonBossLosses: { ...s.dungeonBossLosses, [key]: (s.dungeonBossLosses[key] ?? 0) + 1 },
            };
          }
          return { dungeon: finishRun(run, false, 0, FLOOR_LOSS_KEEP) };
        }
        // Won: carry HP/MP/Sta forward and train a combat stat (caster → Ward, else Defense).
        hp = b.playerHp;
        mp = b.playerMp;
        sta = b.playerSta;
        // Fire onCombatWin triggers — each qualifying relic heals a share of max HP.
        for (const key of run.relics) {
          const def = getRelic(key);
          if (def?.trigger?.type === 'onCombatWin') {
            hp = Math.min(run.maxHp, hp + Math.round(run.maxHp * def.trigger.healPct));
          }
        }
        // hpDefeated sums every phase of a multi-phase boss; bossMaxHp is only the last form.
        const totalHp = b.hpDefeated ?? b.bossMaxHp;
        const xp = combatXpForWin(totalHp);
        combatStats =
          b.attackSchool === 'magic'
            ? { ...s.combatStats, wardXp: s.combatStats.wardXp + xp }
            : { ...s.combatStats, defenseXp: s.combatStats.defenseXp + xp };
        // Also award habit stat XP toward the character level: the attack stat you fight with,
        // plus HP for enduring the fight.
        const atkStat = getWeapon(s.equippedWeapon).attackStat;
        const { atkShare, hpShare } = dungeonCombatStatXp(totalHp);
        statXpPatch = grantStatXp(s, { [atkStat]: atkShare, HP: hpShare });
        workingRun = { ...workingRun, earnedXp: (workingRun.earnedXp ?? 0) + atkShare + hpShare };
        if (room.type === 'elite') {
          // Elites drop bonus gold and guarantee a boon.
          eliteWin = true;
          workingRun = { ...workingRun, floorReward: mergeReward(workingRun.floorReward, { gold: 40 + workingRun.depth * 12 }) };
        } else if (room.type === 'boss') {
          // A floor boss is the marquee payout — well above a plain combat room.
          wonBossId = b.bossId;
          workingRun = { ...workingRun, floorReward: mergeReward(workingRun.floorReward, { gold: bossRoomGold(run.depth) }) };
        } else {
          // Plain combat wins pay depth-scaled gold (≈ half a treasure room).
          workingRun = { ...workingRun, floorReward: mergeReward(workingRun.floorReward, { gold: combatRoomGold(run.depth) }) };
        }
        // Accumulate per-run battle statistics (using pre-heal hp so damageTaken reflects raw loss).
        workingRun = {
          ...workingRun,
          damageTaken: (workingRun.damageTaken ?? 0) + Math.max(0, run.hp - b.playerHp),
          damageDealt: (workingRun.damageDealt ?? 0) + totalHp,
        };
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
        // Beating the boss clears its loss tally so a fresh future attempt starts at full difficulty.
        ...(wonBossId ? { dungeonBossLosses: { ...s.dungeonBossLosses, [wonBossId]: 0 } } : {}),
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
      // Descending past floor 3 costs 1 energy (charge what's available — never block a mid-run player).
      const chargeEnergy = depth > 3 && !s.settings.unlimitedEnergy;
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
      return {
        dungeon: next,
        deepestFloor,
        ...(chargeEnergy
          ? {
              character: { ...s.character, energy: Math.max(0, s.character.energy - 1) },
              ...energySpentPatch(s, 1),
            }
          : {}),
      };
    }),

  collectDungeon: () =>
    set((s) => {
      const run = s.dungeon;
      if (!run || run.status !== 'ended') return s;
      // Compute final gold once — used in both the summary record and the actual reward.
      const finalGold = Math.round((run.bankedReward.gold ?? 0) * s.character.habitBonus);
      const summary: DungeonRunSummary = {
        depth: run.depth,
        cleared: run.cleared,
        defeated: !run.cleared && run.hp <= 0,
        date: toISODate(),
        roomsCleared: run.roomsCleared ?? 0,
        relicCount: run.relics.length,
        goldBanked: finalGold,
      };
      const baseEarnings = s.earnings ?? freshEarningsLedger();
      const next: GameState = {
        ...s,
        character: { ...s.character, statXp: { ...s.character.statXp } },
        inventory: { ...s.inventory },
        materials: { ...s.materials },
        ownedWeapons: [...s.ownedWeapons],
        ownedGear: [...s.ownedGear],
        earnings: cloneEarnings(baseEarnings),
        dungeon: null,
        dungeonHistory: [summary, ...(s.dungeonHistory ?? [])].slice(0, 10),
      };
      // Record dungeon XP accumulated during the run (via grantStatXp in advance/encounter handlers).
      const runXp = run.earnedXp ?? 0;
      if (runXp > 0) next.earnings.xp['dungeon'] += runXp;
      next.earnings.count['dungeon'] += 1;
      // Apply habit-streak gold multiplier to banked gold (§6.3) — same as commitRun does for minigames.
      if (finalGold > 0) next.earnings.gold['dungeon'] += finalGold;
      // Apply the reward (no source — earnings already recorded above to avoid double-counting count).
      applyReward(next, {
        ...run.bankedReward,
        gold: finalGold,
      }); // gold/materials/items/weapons/gear
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
      let shrineSucceeded = false;

      if (choice === 'pray') {
        // A Wisdom check: success blesses you, failure curses you. (BAL-07: was max(WI,CH),
        // which made CH a strictly-redundant second copy of the stronger WI — CH's payoff now
        // lives in illusion scaling, Tactics push, and its own encounter checks instead.)
        // MINI-27: relic/gear/runBuff WI now count, so shrine_stone's "+WI this run" actually helps.
        const power = s.character.statLevels.WI + (runStatBonuses(s).WI ?? 0);
        if (Math.random() < checkChance(power, 6)) {
          offerBoon(next, boonMaxTier(next.depth, s.deepestFloor));
          shrineSucceeded = true;
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
        shrineSucceeded = true;
      }

      // Fire onShrine triggers when the shrine interaction succeeded.
      if (shrineSucceeded) {
        for (const key of run.relics) {
          const def = getRelic(key);
          if (def?.trigger?.type === 'onShrine') {
            const current = next.runBuff ?? {};
            const buff: Partial<Record<StatId, number>> = { ...current };
            for (const [stat, n] of Object.entries(def.trigger.statBonuses)) {
              buff[stat as StatId] = (buff[stat as StatId] ?? 0) + (n ?? 0);
            }
            next.runBuff = buff;
          }
        }
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
