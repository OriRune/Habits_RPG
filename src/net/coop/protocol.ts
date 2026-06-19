import type { Dir, MineTile } from '@/engine/mining';
import type { ForestTile } from '@/engine/forest';
import type { HexBattleState, HeroOpts } from '@/engine/hexBattle';
import type { Hex } from '@/engine/hex';

/**
 * Co-op wire protocol (Phase 3) — the messages broadcast over the Supabase
 * Realtime channel `coop:{sessionId}`.
 *
 * Authority split:
 *  - The HOST owns the canonical world (monsters/runes/boss) and broadcasts a
 *    WorldSlice; clients display it rather than simulating monsters themselves.
 *  - EACH player owns its own body and broadcasts a PlayerSlice; the host feeds
 *    the other players' positions into stepMonsters for nearest-player targeting.
 *
 * For Hex Tactics (turn-based), the protocol is event-driven rather than 10 Hz:
 *  - Guest sends HeroJoin once on connect; host broadcasts TacticsState after
 *    every resolved action. No interval timer needed.
 *
 * Keep these payloads small — broadcast Hz is the dominant free-tier cost.
 */

export type CoopGame = 'mine' | 'forest' | 'tactics';

/** Minimal per-monster state needed to render + target. */
export interface MonsterSlice {
  id: string;
  key: string;
  r: number;
  c: number;
  hp: number;
  readyAtMs: number;
  /** Forest beasts only: whether still dormant — drives the guest's HP-bar/dim render. */
  asleep?: boolean;
}

/** Host → everyone: the authoritative dynamic world for this frame. */
export interface WorldSlice {
  type: 'world';
  /** Host clock (ms) when produced — used for ordering / staleness. */
  t: number;
  floor: number;
  status: 'active' | 'banking' | 'ended';
  monsters: MonsterSlice[];
}

/** Each player → everyone: that player's own body. */
export interface PlayerSlice {
  type: 'player';
  userId: string;
  username: string;
  r: number;
  c: number;
  facing: Dir;
  hp: number;
  maxHp: number;
  floor: number;
}

/** Guest → host: a melee attack on a monster, resolved authoritatively by the host. */
export interface AttackIntent {
  type: 'attack';
  userId: string;
  monsterId: string;
  dmg: number;
}

/**
 * Any player → everyone: a single dug cell (rock/ore → floor, or durability decay).
 * Peer-to-peer (not host-gated) so resource nodes vanish for the whole party; each
 * player still keeps its own haul. `floor` lets receivers drop events from a floor
 * they've already left.
 */
export interface TileSlice {
  type: 'tile';
  userId: string;
  /** Depth the change belongs to (mine floor / forest stage). */
  floor: number;
  r: number;
  c: number;
  tile: MineTile | ForestTile;
}

/** Any player → everyone: a clean departure, so peers drop the avatar + toast at once
 *  (rather than waiting out the stale-player timeout, which still covers hard disconnects). */
export interface ByeIntent {
  type: 'bye';
  userId: string;
  username: string;
}

/** Guest → host: the guest's combat snapshot so the host can add their hero to the board. */
export interface HeroJoin {
  type: 'hero-join';
  userId: string;
  username: string;
  /** Full HeroOpts (fighter + ag + knownSpells) for the guest's hero. */
  heroOpts: HeroOpts;
}

/** Host → everyone: the full authoritative tactics battle state after each resolved action. */
export interface TacticsState {
  type: 'tactics-state';
  /** Host clock (ms) when produced — used to drop stale messages. */
  t: number;
  state: HexBattleState;
}

/**
 * Guest → host: a tactical action intent to be resolved authoritatively by the host.
 * The `heroId` field is the guest's own hero ID; the host validates ownership before applying.
 */
export interface TacticsIntent {
  type: 'tactics-intent';
  userId: string;
  heroId: string;
  action: 'move' | 'attack' | 'cast' | 'hold' | 'endTurn';
  /** Destination hex (move) or target hex (attack / cast). */
  to?: Hex;
  /** Spell key — for cast actions only. */
  spellKey?: string;
}

export type CoopMessage = WorldSlice | PlayerSlice | AttackIntent | TileSlice | ByeIntent | HeroJoin | TacticsState | TacticsIntent;

/** The Realtime channel name for a session's world sync. */
export function coopChannelName(sessionId: string): string {
  return `coop:${sessionId}`;
}

/** Broadcast cadence (host world + client player). ~10 Hz keeps within free-tier. */
export const COOP_BROADCAST_HZ = 10;
export const COOP_BROADCAST_MS = Math.round(1000 / COOP_BROADCAST_HZ);
/** Drop a remote player from the roster if we haven't heard from them in this long. */
export const COOP_PLAYER_TIMEOUT_MS = 5000;
