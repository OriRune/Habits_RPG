import { useEffect } from 'react';
import { supabase } from '@/net/supabaseClient';
import { useAuthStore } from '@/net/auth';
import { usePartyStore } from '@/hooks/useParty';
import { useGameStore } from '@/store/useGameStore';
import {
  coopGameName,
  getActiveCoopSession,
  endCoopSession,
  leaveCoop,
  pushCoopNotice,
  setSession,
  useCoopStore,
  type CoopSession,
} from '@/net/coop/session';
import {
  COOP_BROADCAST_MS,
  COOP_PLAYER_TIMEOUT_MS,
  coopChannelName,
  type CoopMessage,
  type TileSnapshot,
  type SnapshotRequest,
} from '@/net/coop/protocol';
import type { MineTile } from '@/engine/mining';
import type { ForestTile } from '@/engine/forest';
import { getMineBaseSeed, getForestBaseSeed } from '@/store/runRng';
import {
  applyPlayerSlice,
  applyBye,
  pruneStalePlayers,
  buildPlayerSlice,
  buildWorldSlice,
  diffMineTiles,
  diffForestTiles,
  shouldReapOrphan,
} from '@/net/coop/reduce';

/**
 * Co-op transport (Phase 3), mounted once in App.
 *
 *  - Discovery: tracks the active `coop_sessions` row for my party (live).
 *  - Transport: while I've joined a session, opens the Broadcast channel and, at
 *    ~10 Hz, broadcasts my player slice (and, if I'm the host, the authoritative
 *    world slice). Incoming player slices populate the remote-player roster; the
 *    host's world slice is applied to my mine (guests only); guests' attack
 *    intents are resolved by the host.
 */
export function useCoopSession(): void {
  const authSession = useAuthStore((s) => s.session);
  const partyId = usePartyStore((s) => s.party?.id ?? null);
  const coopSession = useCoopStore((s) => s.session);
  const joined = useCoopStore((s) => s.joined);

  // --- Discovery: the active session for my party ---
  useEffect(() => {
    if (!supabase || !partyId) {
      setSession(null);
      return;
    }
    const sb = supabase;
    let active = true;
    // Apply a discovered session; if it's my own orphaned row (I'm the host but
    // haven't joined it — e.g. a tab-close left the row `active`), reap it instead
    // of surfacing a hostless zombie raid as joinable (MP-09).
    const applyDiscovered = (s: CoopSession | null) => {
      const myId = useAuthStore.getState().session?.user?.id ?? 'anon';
      if (shouldReapOrphan(s, myId, useCoopStore.getState().joined)) {
        void endCoopSession(s!.id);
        setSession(null);
        return;
      }
      setSession(s);
    };
    void getActiveCoopSession(partyId).then((s) => {
      if (active) applyDiscovered(s);
    });
    const lobby = sb
      .channel(`coop-lobby:${partyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'coop_sessions', filter: `party_id=eq.${partyId}` },
        () => {
          void getActiveCoopSession(partyId).then((s) => {
            if (active) applyDiscovered(s);
          });
        },
      )
      .subscribe();
    return () => {
      active = false;
      void sb.removeChannel(lobby);
    };
  }, [partyId]);

  // --- Transport: broadcast + receive while joined ---
  const sessionId = coopSession?.id ?? null;
  const userId = authSession?.user?.id ?? 'anon';
  const isHost = !!coopSession && coopSession.host_id === userId;
  const game = coopSession?.game ?? 'mine';

  useEffect(() => {
    // Tactics co-op is handled by useTacticsCoopSession — skip here to avoid
    // both hooks competing for the same channel.
    if (!supabase || !sessionId || !joined || game === 'tactics') return;
    const sb = supabase;
    const username = useAuthStore.getState().username ?? 'Adventurer';
    const channel = sb.channel(coopChannelName(sessionId), {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      const msg = payload as CoopMessage;
      if (msg.type === 'player') {
        if (msg.userId === userId) return;
        useCoopStore.setState((st) => {
          const { roster, isNew } = applyPlayerSlice(st.remotePlayers, msg, performance.now());
          if (isNew) pushCoopNotice(`${msg.username} joined the raid`);
          return { remotePlayers: roster };
        });
      } else if (msg.type === 'snapshot-request') {
        // Host-only: a peer just (re)joined and regenerated a pristine floor from the
        // shared seed — it never saw the party's earlier per-cell TileSlices. Backfill
        // them with a one-shot changed-tiles snapshot so resource nodes/openings match.
        // Request-driven (not host-side isNew detection) so a quick refresh-rejoin —
        // still inside the roster timeout — is backfilled too (MP-25).
        if (isHost && msg.userId !== userId) sendTileSnapshot();
      } else if (msg.type === 'tile-snapshot') {
        if (msg.userId !== userId) {
          if (game === 'forest') {
            useGameStore.getState().coopApplyForestTileSnapshot(
              msg.floor,
              msg.tiles as ReadonlyArray<{ r: number; c: number; tile: ForestTile }>,
            );
          } else {
            useGameStore.getState().coopApplyTileSnapshot(
              msg.floor,
              msg.tiles as ReadonlyArray<{ r: number; c: number; tile: MineTile }>,
            );
          }
        }
      } else if (msg.type === 'bye') {
        if (msg.userId === userId) return;
        useCoopStore.setState((st) => {
          const roster = applyBye(st.remotePlayers, msg.userId);
          if (roster !== st.remotePlayers) pushCoopNotice(`${msg.username} retreated from the ${coopGameName(game)}`);
          return { remotePlayers: roster };
        });
      } else if (msg.type === 'world') {
        if (!isHost) {
          if (game === 'forest') useGameStore.getState().coopApplyForestWorld(msg);
          else useGameStore.getState().coopApplyWorld(msg);
        }
      } else if (msg.type === 'attack') {
        if (isHost) {
          if (game === 'forest') useGameStore.getState().coopApplyForestAttack(msg.monsterId, msg.dmg);
          else useGameStore.getState().coopApplyRemoteAttack(msg.monsterId, msg.dmg);
        }
      } else if (msg.type === 'tile') {
        // Peer-to-peer: both host and guests apply each other's digs/gathers.
        if (msg.userId !== userId) {
          if (game === 'forest') {
            useGameStore.getState().coopApplyForestTile(msg.floor, msg.r, msg.c, msg.tile as ForestTile);
          } else {
            useGameStore.getState().coopApplyTile(msg.floor, msg.r, msg.c, msg.tile as MineTile);
          }
        }
      }
    });

    const send = (msg: CoopMessage) => {
      void channel.send({ type: 'broadcast', event: 'msg', payload: msg });
    };
    useCoopStore.setState({ send });

    // Host-only: send the current floor's divergence from a pristine regen to a peer
    // that requested it (just (re)joined), so they don't miss the party's earlier digs (MP-25).
    const sendTileSnapshot = () => {
      const st = useGameStore.getState();
      if (game === 'forest') {
        const base = getForestBaseSeed();
        if (base === undefined || !st.forest) return;
        const tiles = diffForestTiles(st.forest, base);
        if (tiles.length) send({ type: 'tile-snapshot', userId, floor: st.forest.stage, tiles } satisfies TileSnapshot);
      } else {
        const base = getMineBaseSeed();
        if (base === undefined || !st.mining) return;
        const tiles = diffMineTiles(st.mining, base);
        if (tiles.length) send({ type: 'tile-snapshot', userId, floor: st.mining.floor, tiles } satisfies TileSnapshot);
      }
    };

    // Subscribe last, so `send` exists when a guest fires its snapshot request on join.
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && !isHost) {
        send({ type: 'snapshot-request', userId } satisfies SnapshotRequest);
      }
    });

    const interval = setInterval(() => {
      const st = useGameStore.getState();
      const run = game === 'forest' ? st.forest : st.mining;
      if (!run) return;

      send(buildPlayerSlice(run, { userId, username }));
      if (isHost) send(buildWorldSlice(run));

      // Drop players we haven't heard from in a while (disconnect / left).
      useCoopStore.setState((cst) => {
        const { roster, timedOut } = pruneStalePlayers(cst.remotePlayers, performance.now(), COOP_PLAYER_TIMEOUT_MS);
        timedOut.forEach((name) => pushCoopNotice(`${name} left the ${coopGameName(game)}`));
        return timedOut.length > 0 ? { remotePlayers: roster } : cst;
      });
    }, COOP_BROADCAST_MS);

    return () => {
      clearInterval(interval);
      useCoopStore.setState({ send: null, remotePlayers: {} });
      void sb.removeChannel(channel);
    };
  }, [sessionId, joined, isHost, userId, game]);

  // Auto-leave the session when the local run ends (banked / died / quit).
  // Tactics sessions are watched by useTacticsCoopSession — skip here.
  useEffect(() => {
    const unsub = useGameStore.subscribe((s) => {
      const { joined: stillJoined, session } = useCoopStore.getState();
      if (!stillJoined || !session || session.game === 'tactics') return;
      const run = session.game === 'forest' ? s.forest : s.mining;
      if (!run) void leaveCoop(session.host_id === userId);
    });
    return unsub;
  }, [userId]);
}
