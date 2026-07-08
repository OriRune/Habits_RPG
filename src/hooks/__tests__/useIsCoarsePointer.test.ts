// @vitest-environment jsdom
// Unit test for useIsCoarsePointer (plan3 9.1). jsdom has no matchMedia, so we
// stub a minimal MediaQueryList fake that we can flip and whose listeners we can fire.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsCoarsePointer } from '@/hooks/useIsCoarsePointer';

// A minimal MediaQueryList fake — tracks `matches`, records add/removeEventListener,
// and can dispatch a `change` to registered listeners.
function makeFakeMql(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initialMatches,
    addEventListener: vi.fn((_: string, cb: () => void) => listeners.add(cb)),
    removeEventListener: vi.fn((_: string, cb: () => void) => listeners.delete(cb)),
    // Test helper: flip `matches` and notify listeners like the browser would.
    _emit(next: boolean) {
      mql.matches = next;
      listeners.forEach((cb) => cb());
    },
    _listenerCount: () => listeners.size,
  };
  return mql;
}

let fakeMql: ReturnType<typeof makeFakeMql>;

beforeEach(() => {
  fakeMql = makeFakeMql(false);
  window.matchMedia = vi.fn(() => fakeMql) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useIsCoarsePointer', () => {
  it('returns false when (pointer: coarse) does not match', () => {
    const { result } = renderHook(() => useIsCoarsePointer());
    expect(result.current).toBe(false);
  });

  it('returns true when (pointer: coarse) matches', () => {
    fakeMql = makeFakeMql(true);
    const { result } = renderHook(() => useIsCoarsePointer());
    expect(result.current).toBe(true);
  });

  it('updates when the change listener fires', () => {
    const { result } = renderHook(() => useIsCoarsePointer());
    expect(result.current).toBe(false);
    act(() => fakeMql._emit(true));
    expect(result.current).toBe(true);
    act(() => fakeMql._emit(false));
    expect(result.current).toBe(false);
  });

  it('removes its listener on unmount', () => {
    const { unmount } = renderHook(() => useIsCoarsePointer());
    expect(fakeMql._listenerCount()).toBe(1);
    unmount();
    expect(fakeMql._listenerCount()).toBe(0);
    expect(fakeMql.removeEventListener).toHaveBeenCalled();
  });
});
