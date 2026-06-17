import { useEffect } from 'react';
import { supabase } from '@/net/supabaseClient';
import { useAuthStore } from '@/net/auth';
import { usePartyStore } from '@/hooks/useParty';
import { useGameStore } from '@/store/useGameStore';
import { getActiveCoopSession, leaveCoop, setSession, useCoopStore } from '@/net/coop/session';
import {
  COOP_BROADCAST_MS,
  COOP_PLAYER_TIMEOUT_MS,
  coopChannelName,
  type CoopMessage,
  type PlayerSlice,
  type WorldSlice,
} from '@/net/coop/protocol';

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

  useEffect(() => {
    if (!supabase || !sessionId || !joined) return;
    const sb = supabase;
    const username = useAuthStore.getState().username ?? 'Adventurer';
    const channel = sb.channel(coopChannelName(sessionId), {
      config: { broadcast: { self: false } },
    });

    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      const msg = payload as CoopMessage;
      if (msg.type === 'player') {
        if (msg.userId === userId) return;
        useCoopStore.setState((st) => ({
          remotePlayers: { ...st.remotePlayers, [msg.userId]: { ...msg, lastSeen: performance.now() } },
        }));
      } else if (msg.type === 'world') {
        if (!isHost) useGameStore.getState().coopApplyWorld(msg);
      } else if (msg.type === 'attack') {
        if (isHost) useGameStore.getState().coopApplyRemoteAttack(msg.monsterId, msg.dmg);
      } else if (msg.type === 'tile') {
        // Peer-to-peer: both host and guests apply each other's digs.
        if (msg.userId !== userId) {
          useGameStore.getState().coopApplyTile(msg.floor, msg.r, msg.c, msg.tile);
        }
      }
    });
    void channel.subscribe();

    const send = (msg: CoopMessage) => {
      void channel.send({ type: 'broadcast', event: 'msg', payload: msg });
    };
    useCoopStore.setState({ send });

    const interval = setInterval(() => {
      const mining = useGameStore.getState().mining;
      if (!mining) return;

      send({
        type: 'player',
        userId,
        username,
        r: mining.player.r,
        c: mining.player.c,
        facing: mining.player.facing,
        hp: mining.hp,
        maxHp: mining.maxHp,
        floor: mining.floor,
      } satisfies PlayerSlice);

      if (isHost) {
        send({
          type: 'world',
          t: performance.now(),
          floor: mining.floor,
          status: mining.status,
          monsters: mining.monsters.map((m) => ({
            id: m.id,
            key: m.key,
            r: m.r,
            c: m.c,
            hp: m.hp,
            readyAtMs: m.readyAtMs,
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
        else changed = true;
      }
      if (changed) useCoopStore.setState({ remotePlayers: next });
    }, COOP_BROADCAST_MS);

    return () => {
      clearInterval(interval);
      useCoopStore.setState({ send: null, remotePlayers: {} });
      void sb.removeChannel(channel);
    };
  }, [sessionId, joined, isHost, userId]);

  // Auto-leave the session when the local run ends (banked / died / quit).
  useEffect(() => {
    const unsub = useGameStore.subscribe((s) => {
      const { joined: stillJoined, session } = useCoopStore.getState();
      if (stillJoined && !s.mining) {
        void leaveCoop(!!session && session.host_id === userId);
      }
    });
    return unsub;
  }, [userId]);
}
