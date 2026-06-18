import { useEffect } from 'react';
import { supabase } from '@/net/supabaseClient';
import { useAuthStore } from '@/net/auth';
import { useGameStore, fighterFor } from '@/store/useGameStore';
import { pushCoopNotice, leaveCoop, useCoopStore } from '@/net/coop/session';
import { coopChannelName } from '@/net/coop/protocol';
import type { CoopMessage, HeroJoin, TacticsState, TacticsIntent } from '@/net/coop/protocol';
import type { HeroOpts, HexBattleState } from '@/engine/hexBattle';
import {
  movePlayer as tacticsMoveFn,
  playerAttack as tacticsAttackFn,
  playerCastSpell as tacticsCastFn,
  endPlayerTurn as tacticsEndTurnFn,
  holdOverwatch as tacticsHoldFn,
} from '@/engine/hexBattle';

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

      if (msg.type === 'hero-join') {
        // Host only: receive the guest's HeroOpts, build the board, broadcast initial state.
        if (!isHost) return;
        const s = useGameStore.getState();
        const hostFighter = fighterFor(s);
        const hostHeroOpts: HeroOpts = {
          fighter: hostFighter,
          ag: s.character.statLevels.AG,
          knownSpells: s.knownSpells,
          id: userId,
          name: username,
        };
        useGameStore.getState().beginTacticsCoop({ heroes: [hostHeroOpts, msg.heroOpts], seed });
        // The store subscription (effect below) fires immediately after beginTacticsCoop
        // and broadcasts the new state, so no explicit send() here.

      } else if (msg.type === 'tactics-state') {
        // Guest only: apply the host's authoritative state, re-keyed to the guest's own hero.
        if (isHost) return;
        // Stale-message guard: drop if we already have a newer state.
        const cur = useGameStore.getState().tactics;
        if (cur && (msg as TacticsState).t < performance.now() - 10_000) return;
        useGameStore.getState().coopApplyTactics({ ...msg.state, activeHeroId: userId });

      } else if (msg.type === 'tactics-intent') {
        // Host only: apply the guest's action and broadcast the result.
        if (!isHost) return;
        const store = useGameStore.getState();
        if (!store.tactics || store.tactics.status !== 'active') return;
        // Ownership check: the heroId must belong to a non-host hero.
        if (msg.heroId === userId) return;
        applyTacticsIntent(msg, store.tactics);
        // The store subscription fires after coopApplyTactics updates tactics.

      } else if (msg.type === 'bye') {
        if (msg.userId === userId) return;
        pushCoopNotice(`${msg.username} retreated from Hex Tactics`);
        useCoopStore.setState((st) => {
          const next = { ...st.remotePlayers };
          delete next[msg.userId];
          return { remotePlayers: next };
        });
      }
    });

    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
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
      send({ type: 'tactics-state', t: performance.now(), state: s.tactics } satisfies TacticsState);
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
 * Calls the engine function directly for the specified heroId, then pushes the
 * result back into the store via coopApplyTactics (which triggers the broadcast
 * subscription).
 */
function applyTacticsIntent(intent: TacticsIntent, tactics: HexBattleState): void {
  let next = tactics;
  switch (intent.action) {
    case 'move':
      if (intent.to) next = tacticsMoveFn(tactics, intent.to, intent.heroId);
      break;
    case 'attack':
      if (intent.to) next = tacticsAttackFn(tactics, intent.to, Math.random, intent.heroId);
      break;
    case 'cast':
      if (intent.spellKey !== undefined) next = tacticsCastFn(tactics, intent.spellKey, intent.to ?? null, Math.random, intent.heroId);
      break;
    case 'hold':
      next = tacticsHoldFn(tactics, Math.random, intent.heroId);
      break;
    case 'endTurn':
      next = tacticsEndTurnFn(tactics, Math.random, intent.heroId);
      break;
  }
  if (next !== tactics) useGameStore.getState().coopApplyTactics(next);
}
