// Lockpicking trial — DX.
// One pin at a time. A cursor bounces at escalating speed; tap to set each pin.
// Speed jitters on each wall-bounce so pure muscle-memory won't carry you.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  generatePins,
  hitAccuracy,
  lockpickingScore,
  LOCK_PINS,
  CURSOR_SPEEDS,
  CURSOR_JITTER,
} from '@/engine/trials/lockpicking';

interface LockpickingProps {
  onFinish: (score01: number) => void;
}

type Phase = 'active' | 'flash' | 'done';

interface FlashState {
  type: 'perfect' | 'hit' | 'barely' | 'miss';
  accuracy: number;
}

const FLASH_MS = 420;

function accuracyLabel(acc: number): FlashState {
  if (acc >= 0.80) return { type: 'perfect', accuracy: acc };
  if (acc >= 0.40) return { type: 'hit', accuracy: acc };
  if (acc > 0)     return { type: 'barely', accuracy: acc };
  return { type: 'miss', accuracy: 0 };
}

const FLASH_STYLES: Record<FlashState['type'], { text: string; color: string; bg: string }> = {
  perfect: { text: 'PERFECT!',  color: 'text-gold-bright',    bg: 'bg-gold-bright/20' },
  hit:     { text: 'CLICK!',    color: 'text-emerald-400',    bg: 'bg-emerald-500/15' },
  barely:  { text: 'BARELY…',   color: 'text-amber-400',      bg: 'bg-amber-400/15'   },
  miss:    { text: 'SLIP!',     color: 'text-rose-400',       bg: 'bg-rose-500/15'    },
};

const PIN_RESULT_COLOR: Record<FlashState['type'], string> = {
  perfect: 'text-gold-bright',
  hit:     'text-emerald-400',
  barely:  'text-amber-400',
  miss:    'text-rose-500',
};

export function Lockpicking({ onFinish }: LockpickingProps) {
  const pins = useRef(generatePins(Math.random)).current;
  const [currentPin, setCurrentPin] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const [phase, setPhase] = useState<Phase>('active');
  const [flash, setFlash] = useState<FlashState | null>(null);
  const [results, setResults] = useState<(FlashState | null)[]>(() => Array(LOCK_PINS).fill(null));

  // Refs that the RAF loop reads without stale-closure issues
  const posRef    = useRef(0);
  const dirRef    = useRef(1);
  const speedRef  = useRef<number>(CURSOR_SPEEDS[0]);
  const phaseRef  = useRef<Phase>('active');
  const pinRef    = useRef(0);
  const rafRef    = useRef<number | null>(null);
  const lastTs    = useRef<number | null>(null);
  const accuraciesRef = useRef<number[]>([]);

  phaseRef.current = phase;
  pinRef.current = currentPin;

  // ── RAF loop — only runs while active ──────────────────────────────────────
  useEffect(() => {
    if (phase !== 'active') return;
    lastTs.current = null;

    const loop = (ts: number) => {
      if (phaseRef.current !== 'active') return;
      if (lastTs.current === null) lastTs.current = ts;
      const dt = Math.min((ts - lastTs.current) / 1000, 0.05); // cap delta at 50ms
      lastTs.current = ts;

      let pos = posRef.current + dirRef.current * speedRef.current * dt;
      let dir = dirRef.current;

      if (pos >= 1) {
        pos = 1;
        dir = -1;
        // jitter on bounce
        const jitter = 1 + (Math.random() * 2 - 1) * CURSOR_JITTER;
        speedRef.current = CURSOR_SPEEDS[pinRef.current] * jitter;
      } else if (pos <= 0) {
        pos = 0;
        dir = 1;
        const jitter = 1 + (Math.random() * 2 - 1) * CURSOR_JITTER;
        speedRef.current = CURSOR_SPEEDS[pinRef.current] * jitter;
      }

      posRef.current = pos;
      dirRef.current = dir;
      setCursorPos(pos);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase]);

  // ── Handle tap ─────────────────────────────────────────────────────────────
  const handleTap = useCallback(() => {
    if (phaseRef.current !== 'active') return;
    const pin = pins[pinRef.current];
    const acc = hitAccuracy(posRef.current, pin.zoneStart, pin.zoneWidth);
    const flashState = accuracyLabel(acc);

    setPhase('flash');
    phaseRef.current = 'flash';
    setFlash(flashState);

    setTimeout(() => {
      const next = [...accuraciesRef.current, acc];
      accuraciesRef.current = next;

      setResults((prev) => {
        const copy = [...prev];
        copy[pinRef.current] = flashState;
        return copy;
      });

      if (next.length >= LOCK_PINS) {
        setPhase('done');
        phaseRef.current = 'done';
        onFinish(lockpickingScore(next));
      } else {
        const nextPin = next.length;
        posRef.current = 0;
        dirRef.current = 1;
        speedRef.current = CURSOR_SPEEDS[nextPin];
        setCurrentPin(nextPin);
        pinRef.current = nextPin;
        setCursorPos(0);
        setFlash(null);
        setPhase('active');
        phaseRef.current = 'active';
      }
    }, FLASH_MS);
  }, [pins, onFinish]);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); handleTap(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleTap]);

  const pin = pins[currentPin];
  const isFlash = phase === 'flash';
  const flashStyle = flash ? FLASH_STYLES[flash.type] : null;

  const speedLabel =
    currentPin === 0 ? 'Slow'
    : currentPin === 1 ? 'Medium'
    : 'Fast';

  return (
    <div className="flex flex-col items-center gap-5 px-2">
      {/* Instruction */}
      <p className="text-center text-sm text-ink-muted">
        Tap <strong className="text-ink">Set Pin</strong> while the pick is inside the golden zone.
      </p>

      {/* Pin progress dots */}
      <div className="flex items-center gap-3">
        {results.map((r, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <span
              className={`text-lg font-bold ${
                i < currentPin || phase === 'done'
                  ? r ? PIN_RESULT_COLOR[r.type] : 'text-ink-muted'
                  : i === currentPin
                    ? 'text-gold-bright'
                    : 'text-parchment-400/30'
              }`}
            >
              {i < currentPin || (phase === 'done' && results[i])
                ? r?.type === 'miss' ? '✗' : '✓'
                : i === currentPin
                  ? '🔑'
                  : '○'}
            </span>
            <span className="text-[10px] font-display text-ink-muted">Pin {i + 1}</span>
          </div>
        ))}
      </div>

      {/* Lock & active bar */}
      <div className="w-full max-w-xs space-y-2">
        <div className="flex items-center justify-between px-0.5">
          <span className="font-display text-xs font-bold text-ink">
            Pin {currentPin + 1} of {LOCK_PINS}
          </span>
          <span className={`font-display text-xs font-semibold ${
            currentPin === 0 ? 'text-emerald-400'
            : currentPin === 1 ? 'text-amber-400'
            : 'text-rose-400'
          }`}>
            {speedLabel} speed
          </span>
        </div>

        {/* The bar */}
        <div className="relative">
          <div className="relative h-12 w-full overflow-hidden rounded-lg border-2 border-gold-deep/50 bg-parchment-300/40">
            {/* Target zone */}
            <div
              className="absolute top-0 h-full border-x-2 border-gold-bright/70 bg-gold-bright/25"
              style={{
                left: `${pin.zoneStart * 100}%`,
                width: `${pin.zoneWidth * 100}%`,
              }}
            />

            {/* Cursor (pick) */}
            {!isFlash && (
              <div
                className="absolute top-0 h-full flex flex-col items-center justify-center transition-none"
                style={{ left: `${cursorPos * 100}%`, transform: 'translateX(-50%)' }}
              >
                <div className="h-full w-[3px] bg-ink shadow-[0_0_6px_rgba(0,0,0,0.8)]" />
                <span
                  className="absolute text-[10px] leading-none"
                  style={{ top: '50%', transform: 'translateY(-50%)' }}
                >
                  🔑
                </span>
              </div>
            )}

            {/* Flash overlay */}
            {isFlash && flashStyle && (
              <div className={`absolute inset-0 flex items-center justify-center ${flashStyle.bg}`}>
                <span className={`font-display text-2xl font-black tracking-widest ${flashStyle.color}`}>
                  {flashStyle.text}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Zone hint label */}
        <div className="flex justify-between px-0.5 text-[10px] text-ink-muted/60 font-display">
          <span>←</span>
          <span>golden zone</span>
          <span>→</span>
        </div>
      </div>

      {/* Tap button */}
      <button
        onClick={handleTap}
        disabled={isFlash || phase === 'done'}
        className="w-full max-w-xs select-none rounded-lg border-2 border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep py-4 font-display text-lg font-black text-wood-900 shadow-gold transition-transform active:scale-95 disabled:opacity-40"
      >
        🔑 Set Pin {currentPin + 1}
      </button>
    </div>
  );
}
