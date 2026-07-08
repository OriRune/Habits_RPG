// Armory Break trial — ST.
// Hold to charge a power needle; release in the golden zone to crack the lock.
// Three locks of rising difficulty; the zone sits mid-meter with an overshoot penalty.

import { useState, useEffect, useRef, useCallback } from 'react';
import { armoryAccuracy, armoryScore, projectReleasePower, ARMORY_LOCKS, SWEET_ZONE_START, SWEET_ZONE_WIDTH } from '@/engine/trials/armoryBreak';
import { play as sfxPlay } from '@/lib/sfx';
import { MashMeter } from '../MashMeter';
import { cn } from '@/lib/cn';

interface ArmoryBreakProps {
  onFinish: (score01: number) => void;
  /** ST stat level — widens each lock's sweet zone (scoring + visual). */
  stLevel: number;
}

// Per-lock difficulty: rise speed increases and zone narrows on lock 3.
const LOCK_CONFIG = [
  { riseSpeed: 0.70, zoneWidth: SWEET_ZONE_WIDTH },         // lock 1 — forgiving
  { riseSpeed: 1.00, zoneWidth: SWEET_ZONE_WIDTH },         // lock 2 — standard
  { riseSpeed: 1.40, zoneWidth: SWEET_ZONE_WIDTH * 0.75 }, // lock 3 — fast, narrower
] as const;

/** ST widens the sweet zone by this much (meter fraction) per stat level. */
const ST_ZONE_WIDEN_PER_LEVEL = 0.006;

const FALL_SPEED = 0.5;
const INTER_LOCK_PAUSE_MS = 400;
const FINISH_DELAY_MS = 600;

/**
 * Effective sweet-zone width for a lock, widened by the ST stat level.
 * Capped at 2× the lock's base so high ST never makes the trial trivial.
 * Used for BOTH the accuracy scoring and the MashMeter visual so they never drift.
 */
function effectiveZoneWidth(lock: number, stLevel: number): number {
  const base = LOCK_CONFIG[Math.min(lock, LOCK_CONFIG.length - 1)].zoneWidth;
  return Math.min(base * 2, base + stLevel * ST_ZONE_WIDEN_PER_LEVEL);
}

export function ArmoryBreak({ onFinish, stLevel }: ArmoryBreakProps) {
  const [currentLock, setCurrentLock] = useState(0);
  const [power, setPower] = useState(0);
  const [held, setHeld] = useState(false);
  const [accuracies, setAccuracies] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const lastTs = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const powerRef = useRef(0);
  const heldRef = useRef(false);
  const accuraciesRef = useRef<number[]>([]);
  const transitioningRef = useRef(false);
  const currentLockRef = useRef(0);

  // Mirror state to refs for safe rAF/callback access without stale closures.
  powerRef.current = power;
  heldRef.current = held;
  accuraciesRef.current = accuracies;
  transitioningRef.current = transitioning;
  currentLockRef.current = currentLock;

  const handleRelease = useCallback(() => {
    if (done || !heldRef.current || transitioningRef.current) return;
    setHeld(false);
    heldRef.current = false;
    // Project power forward from the last rAF frame to the true release instant so a
    // well-timed release isn't quantized down to the previous frame's value. (MINI-40c)
    const releaseTs = performance.now();
    const dtSeconds = lastTs.current ? Math.max(0, (releaseTs - lastTs.current) / 1000) : 0;
    const { riseSpeed } = LOCK_CONFIG[Math.min(currentLockRef.current, LOCK_CONFIG.length - 1)];
    const releasePower = projectReleasePower(powerRef.current, riseSpeed, dtSeconds);
    const acc = armoryAccuracy(releasePower, effectiveZoneWidth(currentLockRef.current, stLevel));
    sfxPlay(acc >= 0.35 ? 'armoryLockCrack' : 'armoryLockMiss');
    const next = [...accuraciesRef.current, acc];
    if (next.length >= ARMORY_LOCKS) {
      setAccuracies(next);
      setDone(true);
      cancelAnimationFrame(rafRef.current!);
      sfxPlay('armoryFinish');
      timerRef.current = setTimeout(() => onFinish(armoryScore(next)), FINISH_DELAY_MS);
    } else {
      setAccuracies(next);
      setTransitioning(true);
      transitioningRef.current = true;
      setPower(0);
      powerRef.current = 0;
      lastTs.current = null;
      timerRef.current = setTimeout(() => {
        setCurrentLock(next.length);
        setTransitioning(false);
      }, INTER_LOCK_PAUSE_MS);
    }
  }, [done, onFinish, stLevel]);

  const handlePress = useCallback(() => {
    if (done || transitioningRef.current) return;
    setHeld(true);
    heldRef.current = true;
    sfxPlay('armoryCharge');
  }, [done]);

  // Cancel any pending timer on unmount.
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // rAF animation loop — restarts with the correct riseSpeed when currentLock changes.
  useEffect(() => {
    if (done) return;
    const { riseSpeed } = LOCK_CONFIG[Math.min(currentLock, LOCK_CONFIG.length - 1)];
    const loop = (ts: number) => {
      if (lastTs.current === null) lastTs.current = ts;
      const dt = (ts - lastTs.current) / 1000;
      lastTs.current = ts;
      const next = heldRef.current
        ? Math.min(1, powerRef.current + riseSpeed * dt)
        : Math.max(0, powerRef.current - FALL_SPEED * dt);
      setPower(next);
      powerRef.current = next;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [done, currentLock]);

  // Keyboard controls — deps are stable (only done/onFinish), so listeners register once.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) { e.preventDefault(); handlePress(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); handleRelease(); }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [handlePress, handleRelease]);

  const resultLabels = accuracies.map(a =>
    a >= 0.7 ? 'Great' : a >= 0.35 ? 'OK' : 'Missed'
  );

  return (
    <div className="flex flex-col items-center gap-6 px-2">
      <p className="text-center text-sm text-ink-muted">
        <strong className="text-ink">Hold</strong> to charge. <strong className="text-ink">Release</strong> when the needle enters the golden zone.
      </p>

      <div className="flex justify-center gap-6">
        {Array.from({ length: ARMORY_LOCKS }, (_, i) => (
          <MashMeter
            key={i}
            power={i === currentLock && !done ? power : 0}
            locked={i < accuracies.length}
            lockedAccuracy={accuracies[i]}
            label={`Lock ${i + 1}`}
            zoneStart={SWEET_ZONE_START}
            zoneWidth={effectiveZoneWidth(i, stLevel)}
          />
        ))}
      </div>

      {done ? (
        <div className="text-center space-y-1">
          <p className="text-2xl">⚒️</p>
          <p className="font-display text-sm font-bold text-gold-deep">All Locks Cracked!</p>
        </div>
      ) : (
        <button
          className={cn(
            'select-none touch-none rounded-md border-2 border-gold-deep px-8 py-5 font-display text-lg font-bold text-wood-900 shadow-gold transition-all duration-75',
            held
              ? 'bg-gradient-to-b from-amber-600 to-amber-800 ring-2 ring-gold-bright scale-95'
              : 'bg-gradient-to-b from-gold-bright to-gold-deep active:scale-95',
            transitioning && 'opacity-40 cursor-not-allowed',
          )}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); handlePress(); }}
          onPointerUp={handleRelease}
          disabled={transitioning}
        >
          ⚒️ Hold to Charge
        </button>
      )}

      <p className="text-xs text-ink-muted min-h-[1.25rem]">
        {done
          ? ' '
          : resultLabels.length > 0
            ? `Lock ${Math.min(currentLock + 1, ARMORY_LOCKS)} of ${ARMORY_LOCKS} • So far: ${resultLabels.join(', ')}`
            : `Lock 1 of ${ARMORY_LOCKS} • Release in the golden zone`}
      </p>
    </div>
  );
}
