import { useEffect, useState } from 'react';

/**
 * True when the primary pointer is coarse (touch) — used to gate the real-time
 * minigames, which want a keyboard/mouse. Reactive: convertibles flip pointer
 * type at runtime, so we track the media query rather than reading it once.
 */
export function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => matchCoarse());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return coarse;
}

function matchCoarse(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}
