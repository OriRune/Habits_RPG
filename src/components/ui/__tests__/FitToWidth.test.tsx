/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { FitToWidth } from '../FitToWidth';

// jsdom has no ResizeObserver — stub one that hands us the callback so tests can
// simulate a measured container width (clientWidth is always 0 in jsdom otherwise).
let roCallback: (() => void) | null = null;

beforeEach(() => {
  roCallback = null;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        roCallback = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(availWidth: number, maxScale?: number) {
  const r = render(
    <FitToWidth contentWidth={572} contentHeight={572} maxScale={maxScale}>
      <div>board</div>
    </FitToWidth>,
  );
  const wrap = r.container.firstChild as HTMLElement;
  Object.defineProperty(wrap, 'clientWidth', { value: availWidth, configurable: true });
  act(() => roCallback?.());
  const inner = wrap.firstChild as HTMLElement;
  return { wrap, inner };
}

describe('FitToWidth', () => {
  it('scales down when the container is narrower than the content', () => {
    const { wrap, inner } = renderAt(286);
    expect(inner.style.transform).toBe('scale(0.5)');
    expect(wrap.style.height).toBe('286px');
  });

  it('never scales above 1:1 by default', () => {
    const { wrap, inner } = renderAt(900);
    expect(inner.style.transform).toBe('');
    expect(wrap.style.height).toBe('572px');
    expect(wrap.style.maxWidth).toBe('572px');
  });

  it('scales up to maxScale when allowed', () => {
    const { wrap, inner } = renderAt(900, 1.5);
    expect(inner.style.transform).toBe('scale(1.5)');
    expect(wrap.style.height).toBe('858px');
    expect(wrap.style.maxWidth).toBe('858px');
  });

  it('with maxScale set, a narrow container still scales down normally', () => {
    const { inner } = renderAt(286, 1.5);
    expect(inner.style.transform).toBe('scale(0.5)');
  });
});
