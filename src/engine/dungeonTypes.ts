// Shared types for the Dungeon Delve run state — extracted here so engine tests can
// import DungeonRun without pulling in the Zustand store.
import { type FloorMap } from './dungeonMap';
import { type Reward } from './challenges';
import { type EncounterRunState } from './encounters';
import { type BattleState } from './combat';
import { type MerchantOffer } from './dungeon';
import { type StatId } from './stats';

/** How a run ended. `banked` = left safely at a checkpoint; `fled` = escaped mid-floor
 *  (combat flee); `defeated` = fell to 0 HP. Presentation and retention both key off this. */
export type DungeonEndReason = 'banked' | 'fled' | 'defeated';

/** An in-progress Dungeon Expedition — an endless descent through floors.
 *  Persisted so a run resumes on reload. */
export interface DungeonRun {
  /** Current floor number (1-based); drives biome + difficulty scaling. */
  depth: number;
  biomeKey: string;
  /** The current floor's branching room map. */
  map: FloorMap;
  /** The room currently being resolved, or null when choosing the next path / at floor start. */
  nodeId: string | null;
  /** Node ids the player may enter next (the branching choice); empty while inside a room. */
  choices: string[];
  /** Ordered ids of rooms entered this floor (for the map UI). */
  path: string[];
  hp: number;
  maxHp: number;
  /** Mana + Stamina, persisted across rooms; restored to full at each checkpoint. */
  mp: number;
  maxMp: number;
  sta: number;
  maxSta: number;
  /** Loot locked in at the last checkpoint — safe even if you fall. */
  bankedReward: Reward;
  /** Loot gathered on the current floor — partly forfeit if you fall mid-floor. */
  floorReward: Reward;
  /** Active branching text encounter (encounter rooms). */
  encounter: EncounterRunState | null;
  /** Loot revealed in a treasure room, shown before continuing. */
  roomLoot: Reward | null;
  /** Active combat for a combat/boss/elite room (reuses the combat engine). */
  battle: BattleState | null;
  /** True between floors: the player chooses to Bank & Leave or Descend Deeper. */
  atCheckpoint: boolean;
  status: 'active' | 'ended';
  /** True when the run ended by banking. Kept for save-compat; prefer `endReason`. */
  cleared: boolean;
  /** Why the run ended. Absent on saves from before this field existed — read via
   *  `runEndReason()`, which derives a fallback from `cleared` + `hp`. */
  endReason?: DungeonEndReason;
  /** Run-only relic keys (boons + curses), applied to dungeon fights like gear. */
  relics: string[];
  /** Three boon keys offered to the player (floor clear / shrine / elite); null when none pending. */
  pendingBoon: string[] | null;
  /** Wares offered in a merchant room (null outside one). */
  merchant: MerchantOffer[] | null;
  /** Cumulative stat-XP granted to the character during this run (via grantStatXp calls).
   *  Tracked for the balance ledger; flushed to earnings.xp['dungeon'] at collectDungeon. */
  earnedXp?: number;
  /**
   * Persistent per-run stat-point bonuses accumulated from triggered relics (e.g. `onShrine`
   * stacking relics). Applied inside `fighterFor` alongside flat relic effects.
   */
  runBuff?: Partial<Record<StatId, number>>;
  /** Rooms successfully resolved (combat won, encounter finished, utility room completed)
   *  during this run — incremented when the room resolves, not on entry. */
  roomsCleared?: number;
  /** Rooms entered during this run — incremented on entry, before any outcome. A room the
   *  player flees or falls in counts here but not in `roomsCleared`. Absent on old saves;
   *  read as `roomsEntered ?? roomsCleared`. */
  roomsEntered?: number;
  /** Total HP damage dealt to enemies during this run — summed from battle outcomes. */
  damageDealt?: number;
  /** Total HP damage taken by the player during this run — summed from battle outcomes. */
  damageTaken?: number;
}
