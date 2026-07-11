import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Scales a fixed-size block of content uniformly so it always fits the
 * available horizontal space. By default it never scales *up* beyond 1:1;
 * pass `maxScale` to let wide desktop viewports magnify the content (the
 * crawl boards use 1.5 — pixel art stays crisp under `image-rendering:
 * pixelated`, and positional pointer handlers must divide by the measured
 * scale rather than assume 1:1, see components/minigame/boardTap.ts).
 *
 * Works via CSS `transform: scale` so the content's internal coordinate system
 * (absolute positions, pixel sizes) is unchanged — only the visual
 * presentation scales.
 *
 * Usage:
 *   <FitToWidth contentWidth={572} contentHeight={572}>
 *     <div style={{ width: 572, height: 572 }}>…fixed-size content…</div>
 *   </FitToWidth>
 */
export function FitToWidth({
  contentWidth,
  contentHeight,
  maxScale = 1,
  children,
}: {
  contentWidth: number;
  contentHeight: number;
  /** Upper scale bound. Default 1 = shrink-only (the original behavior). */
  maxScale?: number;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const measure = () => {
      const avail = el.clientWidth;
      if (avail > 0) setScale(Math.min(maxScale, avail / contentWidth));
    };

    measure(); // synchronous on mount — avoids first-render flash
    if (typeof ResizeObserver === 'undefined') return; // jsdom
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [contentWidth, maxScale]);

  return (
    <div
      ref={wrapRef}
      style={{
        // Fill available width up to the scaled content width.
        width: '100%',
        maxWidth: contentWidth * maxScale,
        // Collapse to the scaled height so surrounding flow isn't pushed out.
        height: contentHeight * scale,
        overflow: 'hidden',
        // Don't let a flex parent squish this block vertically.
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: contentWidth,
          height: contentHeight,
          transform: scale !== 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}
