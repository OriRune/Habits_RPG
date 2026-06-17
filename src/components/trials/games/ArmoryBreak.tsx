// Armory Break trial — ST.
// Hold to charge a power needle; release near the peak to crack the lock.

import { useState, useEffect, useRef, useCallback } from 'react';
import { armoryAccuracy, armoryScore, ARMORY_LOCKS, SWEET_ZONE_START } from '@/engine/trials/armoryBreak';
import { MashMeter } from '../MashMeter';

interface ArmoryBreakProps {
  onFinish: (score01: number) => void;
}

const RISE_SPEED = 0.85; // 0→1 in ~1.2s while held
const FALL_SPEED = 0.5;  // 1→0 in ~2s when released

export function ArmoryBreak({ onFinish }: ArmoryBreakProps) {
  const [currentLock, setCurrentLock] = useState(0);
  const [power, setPower] = useState(0);
  const [held, setHeld] = useState(false);
  const [accuracies, setAccuracies] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const lastTs = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const powerRef = useRef(0);
  const heldRef = useRef(false);
  powerRef.current = power;
  heldRef.current = held;

  const handleRelease = useCallback(() => {
    if (done || !heldRef.current) return;
    setHeld(false);
    heldRef.current = false;
    const acc = armoryAccuracy(powerRef.current);
    const next = [...accuracies, acc];
    if (next.length >= ARMORY_LOCKS) {
      setAccuracies(next);
      setDone(true);
      cancelAnimationFrame(rafRef.current!);
      onFinish(armoryScore(next));
    } else {
      setAccuracies(next);
      setCurrentLock(next.length);
    }
  }, [done, accuracies, onFinish]);

  const handlePress = useCallback(() => {
    if (done) return;
    setHeld(true);
    heldRef.current = true;
  }, [done]);

  useEffect(() => {
    if (done) return;
    const loop = (ts: number) => {
      if (lastTs.current === null) lastTs.current = ts;
      const dt = (ts - lastTs.current) / 1000;
      lastTs.current = ts;
      let next = heldRef.current
        ? Math.min(1, powerRef.current + RISE_SPEED * dt)
        : Math.max(0, powerRef.current - FALL_SPEED * dt);
      setPower(next);
      powerRef.current = next;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [done]);

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

  return (
    <div className="flex flex-col items-center gap-6 px-2">
      <p className="text-center text-sm text-ink-muted">
        <strong className="text-ink">Hold</strong> to charge. <strong className="text-ink">Release</strong> when the power bar is in the golden zone.
      </p>

      <div className="flex justify-center gap-6">
        {Array.from({ length: ARMORY_LOCKS }, (_, i) => (
          <MashMeter
            key={i}
            power={i === currentLock && !done ? power : 0}
            locked={i < accuracies.length}
            lockedAccuracy={accuracies[i]}
            label={`Lock ${i + 1}`}
          />
        ))}
      </div>

      {!done && (
        <button
          className="select-none rounded-md border-2 border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep px-8 py-5 font-display text-lg font-bold text-wood-900 shadow-gold active:scale-95"
          onPointerDown={handlePress}
          onPointerUp={handleRelease}
          onPointerLeave={handleRelease}
        >
          ⚒️ Hold to Charge
        </button>
      )}

      <p className="text-xs text-ink-muted">
        Lock {Math.min(currentLock + 1, ARMORY_LOCKS)} of {ARMORY_LOCKS} •{' '}
        Zone starts at {Math.round(SWEET_ZONE_START * 100)}% power
      </p>
    </div>
  );
}
