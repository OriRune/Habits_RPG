/**
 * Tests for `handleTacticsMessage` in src/net/coop/reduce.ts — the pure decision
 * extracted from useTacticsCoopSession's inline broadcast handler.
 *
 * Covers the two bug classes that lived (untested) in that handler:
 *  - MP-10: hero-join must RESEND when a board already exists, only BEGIN otherwise.
 *  - MP-03: a stale tactics-state (staleness guard rejected) must be dropped.
 * Plus the role / ownership / status guards on tactics-intent.
 *
 * Fixtures are minimal message objects cast to CoopMessage — the router only reads
 * `type`, `heroId`, `userId`, `username`.
 */
import { describe, it, expect } from 'vitest';
import { handleTacticsMessage, type TacticsMsgCtx } from '../reduce';
import type { CoopMessage } from '../protocol';

const HOST = 'host-id';
const GUEST = 'guest-id';

/** Default ctx (host, board exists + active, accept true) overridden per case. */
function ctx(over: Partial<TacticsMsgCtx> = {}): TacticsMsgCtx {
  return { isHost: true, userId: HOST, hasTactics: true, tacticsActive: true, accept: true, ...over };
}

const heroJoin: CoopMessage = { type: 'hero-join', userId: GUEST, username: 'Guest', heroOpts: {} as never };
const tacticsState: CoopMessage = { type: 'tactics-state', t: 100, state: {} as never };
const intent = (heroId: string): CoopMessage => ({ type: 'tactics-intent', userId: GUEST, heroId, action: 'move' });
const bye: CoopMessage = { type: 'bye', userId: GUEST, username: 'Guest' };

describe('handleTacticsMessage', () => {
  describe('hero-join (MP-10)', () => {
    it('host + board exists → resend', () => {
      expect(handleTacticsMessage(heroJoin, ctx({ hasTactics: true }))).toEqual({ kind: 'resend' });
    });

    it('host + no board → begin', () => {
      expect(handleTacticsMessage(heroJoin, ctx({ hasTactics: false }))).toEqual({ kind: 'begin' });
    });

    it('non-host → ignore (guest never builds the board)', () => {
      expect(handleTacticsMessage(heroJoin, ctx({ isHost: false }))).toEqual({ kind: 'ignore' });
    });
  });

  describe('tactics-state (MP-03)', () => {
    it('guest + fresh (accept) → apply', () => {
      expect(handleTacticsMessage(tacticsState, ctx({ isHost: false, accept: true }))).toEqual({ kind: 'apply' });
    });

    it('guest + stale (accept false) → ignore', () => {
      expect(handleTacticsMessage(tacticsState, ctx({ isHost: false, accept: false }))).toEqual({ kind: 'ignore' });
    });

    it('host → ignore (never applies its own broadcast)', () => {
      expect(handleTacticsMessage(tacticsState, ctx({ isHost: true, accept: true }))).toEqual({ kind: 'ignore' });
    });
  });

  describe('tactics-intent', () => {
    it('host + active + heroId ≠ userId → intent', () => {
      expect(handleTacticsMessage(intent(GUEST), ctx({ userId: HOST, tacticsActive: true }))).toEqual({ kind: 'intent' });
    });

    it('heroId === userId → ignore (self-intent, host hero)', () => {
      expect(handleTacticsMessage(intent(HOST), ctx({ userId: HOST, tacticsActive: true }))).toEqual({ kind: 'ignore' });
    });

    it('board inactive → ignore', () => {
      expect(handleTacticsMessage(intent(GUEST), ctx({ userId: HOST, tacticsActive: false }))).toEqual({ kind: 'ignore' });
    });

    it('non-host → ignore (guest does not resolve intents)', () => {
      expect(handleTacticsMessage(intent(GUEST), ctx({ isHost: false }))).toEqual({ kind: 'ignore' });
    });
  });

  describe('bye', () => {
    it('other peer → bye descriptor carries the departing id + name', () => {
      expect(handleTacticsMessage(bye, ctx({ userId: HOST }))).toEqual({ kind: 'bye', userId: GUEST, username: 'Guest' });
    });

    it('own bye echo → ignore', () => {
      expect(handleTacticsMessage(bye, ctx({ userId: GUEST }))).toEqual({ kind: 'ignore' });
    });
  });
});
