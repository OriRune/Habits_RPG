import type { Dir } from '@/engine/mining';

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
 * Keep these payloads small — broadcast Hz is the dominant free-tier cost.
 */

export type CoopGame = 'mine';

/** Minimal per-monster state needed to render + target. */
export interface MonsterSlice {
  id: string;
  key: string;
  r: number;
  c: number;
  hp: number;
  readyAtMs: number;
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

export type CoopMessage = WorldSlice | PlayerSlice | AttackIntent;

/** The Realtime channel name for a session's world sync. */
export function coopChannelName(sessionId: string): string {
  return `coop:${sessionId}`;
}

/** Broadcast cadence (host world + client player). ~10 Hz keeps within free-tier. */
export const COOP_BROADCAST_HZ = 10;
export const COOP_BROADCAST_MS = Math.round(1000 / COOP_BROADCAST_HZ);
/** Drop a remote player from the roster if we haven't heard from them in this long. */
export const COOP_PLAYER_TIMEOUT_MS = 5000;
