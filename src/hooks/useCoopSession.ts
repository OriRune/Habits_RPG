import { useEffect } from 'react';
import { supabase } from '@/net/supabaseClient';
import { useAuthStore } from '@/net/auth';
import { usePartyStore } from '@/hooks/useParty';
import { useGameStore } from '@/store/useGameStore';
import {
  coopGameName,
  getActiveCoopSession,
  leaveCoop,
  pushCoopNotice,
  setSession,
  useCoopStore,
} from '@/net/coop/session';
import {
  COOP_BROADCAST_MS,
  COOP_PLAYER_TIMEOUT_MS,
  coopChannelName,
  type CoopMessage,
  type PlayerSlice,
  type WorldSlice,
} from '@/net/coop/protocol';
import type { MineTile } from '@/engine/mining';
import type { ForestTile } from '@/engine/forest';

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
    void getActiveCoopSession(partyId).then((s) => {
      if (active) setSession(s);
    });
    const lobby = sb
      .channel(`coop-lobby:${partyId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'coop_sessions', filter: `party_id=eq.${partyId}` },
        () => {
          void getActiveCoopSession(partyId).then(setSession);
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
        // First slice from a player → they just joined the raid.
        const known = !!useCoopStore.getState().remotePlayers[msg.userId];
        useCoopStore.setState((st) => ({
          remotePlayers: { ...st.remotePlayers, [msg.userId]: { ...msg, lastSeen: performance.now() } },
        }));
        if (!known) pushCoopNotice(`${msg.username} joined the raid`);
      } else if (msg.type === 'bye') {
        if (msg.userId === userId) return;
        const rp = useCoopStore.getState().remotePlayers[msg.userId];
        if (rp) {
          pushCoopNotice(`${msg.username} retreated from the ${coopGameName(game)}`);
          useCoopStore.setState((st) => {
            const next = { ...st.remotePlayers };
            delete next[msg.userId];
            return { remotePlayers: next };
          });
        }
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
    void channel.subscribe();

    const send = (msg: CoopMessage) => {
      void channel.send({ type: 'broadcast', event: 'msg', payload: msg });
    };
    useCoopStore.setState({ send });

    const interval = setInterval(() => {
      const st = useGameStore.getState();
      const run = game === 'forest' ? st.forest : st.mining;
      if (!run) return;
      // floor (mine) / stage (forest) both carry the run's depth on the wire.
      const depth = 'floor' in run ? run.floor : run.stage;
      const entities = 'monsters' in run ? run.monsters : run.beasts;

      send({
        type: 'player',
        userId,
        username,
        r: run.player.r,
        c: run.player.c,
        facing: run.player.facing,
        hp: run.hp,
        maxHp: run.maxHp,
        floor: depth,
      } satisfies PlayerSlice);

      if (isHost) {
        send({
          type: 'world',
          t: performance.now(),
          floor: depth,
          status: run.status === 'choosing' ? 'active' : run.status,
          monsters: entities.map((m) => ({
            id: m.id,
            key: m.key,
            r: m.r,
            c: m.c,
            hp: m.hp,
            readyAtMs: m.readyAtMs,
            // Forest beasts carry an `asleep` flag the guest needs for HP-bar/dim render.
            asleep: (m as { asleep?: boolean }).asleep,
          })),
        } satisfies WorldSlice);
      }

      // Drop players we haven't heard from in a while (disconnect / left).
      const now = performance.now();
      const rp = useCoopStore.getState().remotePlayers;
      const next: typeof rp = {};
      let changed = false;
      for (const k of Object.keys(rp)) {
        if (now - rp[k].lastSeen < COOP_PLAYER_TIMEOUT_MS) next[k] = rp[k];
        else {
          changed = true;
          // Timed out without a clean 'bye' (disconnect / tab close).
          pushCoopNotice(`${rp[k].username} left the ${coopGameName(game)}`);
        }
      }
      if (changed) useCoopStore.setState({ remotePlayers: next });
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
