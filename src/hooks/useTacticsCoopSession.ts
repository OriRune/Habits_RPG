import { useEffect } from 'react';
import { supabase } from '@/net/supabaseClient';
import { useAuthStore } from '@/net/auth';
import { useGameStore, fighterFor } from '@/store/useGameStore';
import { acceptTacticsStateT, resetTacticsStateT } from '@/store/runRng';
import { pushCoopNotice, leaveCoop, useCoopStore } from '@/net/coop/session';
import { coopChannelName } from '@/net/coop/protocol';
import type { CoopMessage, HeroJoin, TacticsState, TacticsIntent } from '@/net/coop/protocol';
import type { HeroOpts, HexBattleState } from '@/engine/hexBattle';
import { handleTacticsMessage, resolveTacticsIntent, shouldBroadcastTactics, tailTacticsLog } from '@/net/coop/reduce';

/** MP-22: wire-log tail sent with each TacticsState (overlay only renders the last ~4). */
const TACTICS_LOG_TAIL = 20;

/**
 * Co-op transport hook for Hex Tactics (event-driven, not 10 Hz).
 * Mounted once in App.tsx alongside useCoopSession.
 *
 * - Guest: sends HeroJoin on channel subscribe; applies TacticsState broadcasts.
 * - Host: on HeroJoin → builds the shared board via beginTacticsCoop; after every
 *   local store mutation to `tactics` → re-broadcasts TacticsState; on TacticsIntent
 *   from the guest → applies the action, re-broadcasts.
 * - Both: on 'bye' → leaveCoop; auto-leave when the local skirmish ends.
 */
export function useTacticsCoopSession(): void {
  const authSession = useAuthStore((s) => s.session);
  const coopSession = useCoopStore((s) => s.session);
  const joined = useCoopStore((s) => s.joined);

  const sessionId = coopSession?.id ?? null;
  const game = coopSession?.game ?? 'mine';
  const userId = authSession?.user?.id ?? 'anon';
  const isHost = !!coopSession && coopSession.host_id === userId;
  const seed = coopSession?.seed;

  // --- Channel setup: subscribe + handle events ------------------------------------------------
  useEffect(() => {
    if (!supabase || !sessionId || !joined || game !== 'tactics') return;
    const sb = supabase;
    const username = useAuthStore.getState().username ?? 'Adventurer';

    const channel = sb.channel(coopChannelName(sessionId), {
      config: { broadcast: { self: false } },
    });

    const send = (msg: CoopMessage) => {
      void channel.send({ type: 'broadcast', event: 'msg', payload: msg });
    };

    channel.on('broadcast', { event: 'msg' }, ({ payload }) => {
      const msg = payload as CoopMessage;
      const s = useGameStore.getState();
      // Only advance the stateful staleness mark for a guest's tactics-state (the
      // host never compares against its own broadcast); pass the result into the
      // pure router as `accept`.
      const accept =
        msg.type === 'tactics-state' && !isHost ? acceptTacticsStateT((msg as TacticsState).t) : false;

      const action = handleTacticsMessage(msg, {
        isHost,
        userId,
        hasTactics: !!s.tactics,
        tacticsActive: !!s.tactics && s.tactics.status === 'active',
        accept,
      });

      switch (action.kind) {
        case 'resend':
          // The board already exists (guest rejoin, Supabase reconnect re-firing
          // SUBSCRIBED, or a second guest): beginTacticsCoop would no-op, so the
          // store subscription never fires and the (re)joining guest hangs on a
          // null board. Resend the current authoritative state directly (MP-10).
          // Wall clock: the stamp crosses machines and must survive a host reload.
          send({ type: 'tactics-state', t: Date.now(), state: tailTacticsLog(s.tactics!, TACTICS_LOG_TAIL) } satisfies TacticsState);
          break;

        case 'begin': {
          const hostFighter = fighterFor(s);
          const hostHeroOpts: HeroOpts = {
            fighter: hostFighter,
            ag: s.character.statLevels.AG,
            knownSpells: s.knownSpells,
            id: userId,
            name: username,
          };
          useGameStore.getState().beginTacticsCoop({ heroes: [hostHeroOpts, (msg as HeroJoin).heroOpts], seed });
          // The store subscription (effect below) fires immediately after beginTacticsCoop
          // and broadcasts the new state, so no explicit send() here.
          break;
        }

        case 'apply':
          // Guest only: apply the host's authoritative state, re-keyed to the guest's own hero.
          useGameStore.getState().coopApplyTactics({ ...(msg as TacticsState).state, activeHeroId: userId });
          break;

        case 'intent':
          // Host only: apply the guest's action. The store subscription fires after
          // coopApplyTactics updates tactics and broadcasts the result.
          applyTacticsIntent(msg as TacticsIntent, s.tactics!);
          break;

        case 'bye':
          pushCoopNotice(`${action.username} retreated from Hex Tactics`);
          useCoopStore.setState((st) => {
            const next = { ...st.remotePlayers };
            delete next[action.userId];
            return { remotePlayers: next };
          });
          break;

        case 'ignore':
          break;
      }
    });

    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      // Fresh channel → fresh staleness mark, so a new session/host is never
      // blocked by the previous session's high-water mark.
      resetTacticsStateT();
      useCoopStore.setState({ send });
      if (!isHost) {
        // Guest: announce presence + send combat snapshot so host can build the board.
        const s = useGameStore.getState();
        const myFighter = fighterFor(s);
        const heroOpts: HeroOpts = {
          fighter: myFighter,
          ag: s.character.statLevels.AG,
          knownSpells: s.knownSpells,
          id: userId,
          name: username,
        };
        send({ type: 'hero-join', userId, username, heroOpts } satisfies HeroJoin);
      }
    });

    return () => {
      useCoopStore.setState({ send: null, remotePlayers: {} });
      void sb.removeChannel(channel);
    };
  }, [sessionId, joined, isHost, userId, game, seed]);

  // --- Host: re-broadcast after every local tactics mutation ----------------------------------
  useEffect(() => {
    if (!joined || game !== 'tactics' || !isHost) return;
    return useGameStore.subscribe((s, prev) => {
      if (s.tactics === prev.tactics) return;
      const { send } = useCoopStore.getState();
      if (!send || !s.tactics) return;
      // MP-22: skip selection-only churn (highlight caches the guest recomputes itself).
      if (!shouldBroadcastTactics(prev.tactics, s.tactics)) return;
      // Wall clock: the stamp crosses machines and must survive a host reload.
      send({ type: 'tactics-state', t: Date.now(), state: tailTacticsLog(s.tactics, TACTICS_LOG_TAIL) } satisfies TacticsState);
    });
  }, [joined, game, isHost]);

  // --- Auto-leave when the local skirmish ends (same pattern as useCoopSession) ---------------
  useEffect(() => {
    return useGameStore.subscribe((s) => {
      const { joined: stillJoined, session } = useCoopStore.getState();
      if (!stillJoined || !session || session.game !== 'tactics') return;
      if (!s.tactics) void leaveCoop(session.host_id === userId);
    });
  }, [userId]);
}

/**
 * Apply a guest's TacticsIntent to the current battle state (host side only).
 * Delegates to the pure `resolveTacticsIntent` reducer, then pushes the result
 * back into the store via coopApplyTactics (which triggers the broadcast
 * subscription).
 */
function applyTacticsIntent(intent: TacticsIntent, tactics: HexBattleState): void {
  const next = resolveTacticsIntent(tactics, intent, Math.random);
  if (next !== tactics) useGameStore.getState().coopApplyTactics(next);
}
