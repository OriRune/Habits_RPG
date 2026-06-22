/**
 * Tests for src/net/clock.ts — syncServerClock().
 *
 * Strategy:
 *  - `@/net/supabaseClient` is mocked via vi.mock so no network call is made.
 *  - The clock seam (setClockOffset / _resetNow from engine/date) captures the
 *    offset that syncServerClock computes and lets us assert against now().
 *  - afterEach always calls _resetNow() so no offset leaks between tests.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// ─── 1. Hoist mock callables ──────────────────────────────────────────────────

const mockRpc = vi.hoisted(() =>
  vi.fn<() => Promise<{ data: unknown; error: unknown }>>(),
);

// ─── 2. Stub the Supabase client ─────────────────────────────────────────────

vi.mock('@/net/supabaseClient', () => ({
  supabase: { rpc: (_name: string) => mockRpc() },
}));

// ─── 3. Import modules under test ────────────────────────────────────────────

import { syncServerClock } from '../clock';
import { now, setClockOffset, _resetNow } from '@/engine/date';

// ─── 4. Reset after every test ───────────────────────────────────────────────

afterEach(() => {
  _resetNow(); // resets both _now and _offsetMs
  mockRpc.mockReset();
});

// ─── 5. Tests: syncServerClock ────────────────────────────────────────────────

describe('syncServerClock — always resolves (clockReady safety)', () => {
  // `useCloudSync` calls `.finally(() => setClockReady(true))` on the promise
  // returned by syncServerClock. These tests confirm the function always resolves
  // (never rejects) so clockReady is always set regardless of backend outcome.

  it('resolves without throwing when the RPC returns an error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'network timeout' } });
    await expect(syncServerClock()).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });

  it('resolves without throwing when the RPC returns null data', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(syncServerClock()).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });
});

describe('syncServerClock', () => {
  it('applies RTT-compensated offset after a successful server_now call', async () => {
    // The mock resolves instantly (rtt ≈ 0), so the offset should be
    // approximately (serverTime - Date.now()) ≈ 10 000 ms.
    const deviceTime = Date.now();
    const simulatedServerTime = deviceTime + 10_000;

    mockRpc.mockResolvedValueOnce({ data: simulatedServerTime, error: null });

    await syncServerClock();

    // now() should now be ~10 s ahead of the real device clock.
    const adjusted = now().getTime();
    expect(adjusted - deviceTime).toBeGreaterThan(9_000);
    expect(adjusted - deviceTime).toBeLessThan(11_000);
  });

  it('does not change the offset when the RPC returns an error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });

    const before = now().getTime();
    await syncServerClock();
    const after = now().getTime();

    // Offset should remain 0 — now() delta is just elapsed wall time (< 100 ms).
    expect(after - before).toBeLessThan(100);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[clock]'),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it('does not change the offset when data is null (no error)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const before = now().getTime();
    await syncServerClock();
    const after = now().getTime();

    expect(after - before).toBeLessThan(100);
    warnSpy.mockRestore();
  });
});

// ─── 6. Tests: setClockOffset + now() seam ────────────────────────────────────
// These verify the underlying date.ts seam that syncServerClock writes into.

describe('setClockOffset integration', () => {
  beforeEach(() => setClockOffset(0));

  it('now() reflects a positive offset', () => {
    const before = now().getTime();
    setClockOffset(5_000);
    const after = now().getTime();
    expect(after - before).toBeGreaterThanOrEqual(4_900);
    expect(after - before).toBeLessThan(5_200);
  });

  it('now() reflects a negative offset', () => {
    const before = now().getTime();
    setClockOffset(-3_000);
    const after = now().getTime();
    // before > after because offset moves time backward
    expect(before - after).toBeGreaterThanOrEqual(2_900);
    expect(before - after).toBeLessThan(3_100);
  });

  it('_resetNow restores offset to 0', () => {
    setClockOffset(99_999);
    _resetNow();
    const deviceTime = Date.now();
    expect(now().getTime()).toBeCloseTo(deviceTime, -2);
  });
});
