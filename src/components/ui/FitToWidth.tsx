import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Scales a fixed-size block of content down uniformly so it always fits the
 * available horizontal space, never scaling *up* beyond 1:1.
 *
 * Works via CSS `transform: scale` so the content's internal coordinate system
 * (absolute positions, pixel sizes, pointer-event-free interactions) is
 * unchanged — only the visual presentation shrinks on narrow screens.
 *
 * Usage:
 *   <FitToWidth contentWidth={572} contentHeight={572}>
 *     <div style={{ width: 572, height: 572 }}>…fixed-size content…</div>
 *   </FitToWidth>
 */
export function FitToWidth({
  contentWidth,
  contentHeight,
  children,
}: {
  contentWidth: number;
  contentHeight: number;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const measure = () => {
      const avail = el.clientWidth;
      if (avail > 0) setScale(Math.min(1, avail / contentWidth));
    };

    measure(); // synchronous on mount — avoids first-render flash
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [contentWidth]);

  return (
    <div
      ref={wrapRef}
      style={{
        // Fill available width up to the natural content width.
        width: '100%',
        maxWidth: contentWidth,
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
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
        }}
      >
        {children}
      </div>
    </div>
  );
}
