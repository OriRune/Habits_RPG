// Lockpicking trial — DX.
// Skyrim-style: rotate the pick to find the sweet spot, apply torque to open.
// 3 locks of rising difficulty; finite lockpick budget; score = efficiency.

import { useState, useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '@/store/useGameStore';
import * as sfx from '@/lib/sfx';
import {
  generateLocks,
  allowedTurn,
  canOpen,
  breakTime,
  lockpickingScore,
  NUM_LOCKS,
  PICK_BUDGET,
  PICK_MIN_DEG,
  PICK_MAX_DEG,
  CYLINDER_OPEN_DEG,
  CYLINDER_TURN_SPEED,
  CYLINDER_RETURN_SPEED,
  PICK_KEY_SPEED,
  LOCK_LABELS,
  type LockConfig,
} from '@/engine/trials/lockpicking';

export interface LockpickingProps {
  onFinish: (score: number) => void;
}

type Phase = 'idle' | 'turning' | 'breaking' | 'opening' | 'done';
type FlashType = 'unlock' | 'break' | null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function pointerToDeg(cx: number, cy: number, px: number, py: number): number {
  const dx = px - cx;
  const dy = cy - py;
  const raw = (Math.atan2(dx, dy) * 180) / Math.PI;
  return clamp(raw + 90, PICK_MIN_DEG, PICK_MAX_DEG);
}

/**
 * Continuously interpolate warmth (0..1) through three color anchors:
 * red (cold) → amber (mid) → green (hot).
 */
function warmthGlowColor(warmth: number): string {
  const stops: [number, number, number, number][] = [
    [239, 68,  68,  0.50],  // red
    [234, 179, 8,   0.75],  // amber
    [74,  222, 128, 0.95],  // green
  ];
  const t = warmth * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2);
  const f = t - i;
  const a = stops[i], b = stops[i + 1];
  const r  = Math.round(a[0] + (b[0] - a[0]) * f);
  const g  = Math.round(a[1] + (b[1] - a[1]) * f);
  const bv = Math.round(a[2] + (b[2] - a[2]) * f);
  const al = (a[3] + (b[3] - a[3]) * f).toFixed(2);
  return `rgba(${r},${g},${bv},${al})`;
}

// ── SVG pieces ────────────────────────────────────────────────────────────────

/** Classic trapezoid keyhole that rotates with the cylinder. */
function Keyhole({ size }: { size: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const circleR = 10;
  const circlecy = cy - 8;
  const slotTopW = 8;
  const slotBotW = 18;
  const slotTop = circlecy + circleR - 1;
  const slotBot = cy + size * 0.22;
  return (
    <svg
      width={size}
      height={size}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible' }}
    >
      <circle cx={cx} cy={cy} r={size / 2 - 3} fill="none" stroke="rgba(255,200,80,0.08)" strokeWidth={2} />
      <circle cx={cx} cy={circlecy} r={circleR} fill="#100a03" />
      <polygon
        points={`
          ${cx - slotTopW / 2},${slotTop}
          ${cx + slotTopW / 2},${slotTop}
          ${cx + slotBotW / 2},${slotBot}
          ${cx - slotBotW / 2},${slotBot}
        `}
        fill="#100a03"
      />
      <ellipse cx={cx} cy={slotBot} rx={slotBotW / 2} ry={5} fill="#100a03" />
      <circle cx={cx} cy={circlecy} r={circleR - 3} fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth={1} />
    </svg>
  );
}

/** Tension wrench — L-shaped metal tool in the bottom of the keyhole. */
function TensionWrench({ cylinderSize }: { cylinderSize: number }) {
  const cx = cylinderSize / 2;
  const cy = cylinderSize / 2;
  const keyholeBottom = cy + cylinderSize * 0.22 + 5;
  return (
    <svg
      width={cylinderSize}
      height={cylinderSize + 28}
      className="absolute pointer-events-none"
      style={{ top: 0, left: 0, overflow: 'visible' }}
    >
      <rect x={cx - 3} y={keyholeBottom} width={6} height={22} rx={2} fill="#8a8070" />
      <rect x={cx - 10} y={keyholeBottom + 18} width={20} height={5} rx={2} fill="#8a8070" />
      <rect x={cx - 2} y={keyholeBottom + 2} width={2} height={14} rx={1} fill="rgba(255,255,255,0.35)" />
    </svg>
  );
}

/** The lockpick (bobby pin) — thin wire pivoting from center of lock. */
function LockPick({
  pickDeg,
  cylinderDeg,
  broken,
  phase,
  center,
  length,
  stressRatio,
}: {
  pickDeg: number;
  cylinderDeg: number;
  broken: boolean;
  phase: Phase;
  center: number;
  length: number;
  stressRatio: number;
}) {
  const isTurning = phase === 'turning';
  // Extra lean as stress builds — pick visually strains toward the cylinder
  const stressLean = isTurning ? stressRatio * 4 : 0;
  const cssRot = pickDeg - 90 + (isTurning ? -cylinderDeg * 0.08 - stressLean : 0);

  // Blend shaft color from zinc toward rose as stress increases
  const shaftR = Math.round(161 + (239 - 161) * stressRatio); // zinc-400→rose-500 R
  const shaftG = Math.round(161 + (68  - 161) * stressRatio); // G channel
  const shaftB = Math.round(170 + (68  - 170) * stressRatio); // B channel
  const shaftColor = broken ? '#fb7185' : (stressRatio > 0.1 ? `rgb(${shaftR},${shaftG},${shaftB})` : undefined);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        width: 5,
        height: broken ? length * 0.55 : length,
        left: center - 2.5,
        top: center - length,
        transformOrigin: '50% 100%',
        transform: `rotate(${cssRot}deg)`,
        transition: 'none',
      }}
    >
      <div
        className={`w-full rounded-full ${broken || stressRatio > 0.1 ? '' : 'bg-gradient-to-t from-zinc-400 to-zinc-200'}`}
        style={{
          height: broken ? '70%' : '85%',
          background: shaftColor ?? undefined,
          boxShadow: broken
            ? '0 0 6px rgba(239,68,68,0.8)'
            : stressRatio > 0.3
              ? `0 0 ${3 + stressRatio * 5}px rgba(239,68,68,${(stressRatio * 0.6).toFixed(2)})`
              : '0 0 3px rgba(0,0,0,0.7)',
        }}
      />
      {!broken && (
        <div
          className="absolute bg-zinc-100 rounded-full"
          style={{
            width: 5,
            height: 10,
            top: 0,
            left: -1,
            transform: 'rotate(-18deg)',
            transformOrigin: '50% 100%',
            boxShadow: '0 0 2px rgba(255,255,255,0.6)',
          }}
        />
      )}
      {!broken && (
        <div
          className="absolute rounded-sm bg-amber-900/80 border border-amber-700/60"
          style={{ width: 7, height: 10, bottom: 0, left: -1 }}
        />
      )}
    </div>
  );
}

// ── Arc tick marks ────────────────────────────────────────────────────────────

/** Five evenly-spaced tick marks spanning the 180° pick arc. */
function ArcTicks({ center, radius }: { center: number; radius: number }) {
  const ticks = [0, 45, 90, 135, 180];
  return (
    <svg
      width={center * 2}
      height={center * 2}
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible' }}
    >
      {ticks.map((pickDeg) => {
        // pickDeg 90 = 12 o'clock; 0 = 9 o'clock; 180 = 3 o'clock
        const angleDeg = pickDeg - 90;
        const rad = (angleDeg * Math.PI) / 180;
        const outer = radius;
        const inner = radius - 7;
        const x1 = center + Math.sin(rad) * outer;
        const y1 = center - Math.cos(rad) * outer;
        const x2 = center + Math.sin(rad) * inner;
        const y2 = center - Math.cos(rad) * inner;
        const isMid = pickDeg === 90;
        return (
          <line
            key={pickDeg}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={isMid ? 'rgba(180,140,40,0.45)' : 'rgba(140,110,40,0.25)'}
            strokeWidth={isMid ? 2 : 1}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Lockpicking({ onFinish }: LockpickingProps) {
  const level   = useGameStore((s) => s.character.level);
  const dxLevel = useGameStore((s) => s.character.statLevels?.DX ?? 0);

  // Locks are generated once per session and held in a stable ref.
  // generateLocks accepts any () => number RNG — swap for a seeded generator here if needed.
  const locks = useRef<LockConfig[]>(null as unknown as LockConfig[]);
  if (!locks.current) locks.current = generateLocks(Math.random, level, dxLevel);

  // ── Render state ──────────────────────────────────────────────────────────
  const [pickDeg, setPickDeg]                 = useState(90);
  const [cylinderDeg, setCylinderDeg]         = useState(0);
  const [shakeX, setShakeX]                   = useState(0);
  const [shakeY, setShakeY]                   = useState(0);
  const [warmth, setWarmth]                   = useState(0);
  const [idleProximity, setIdleProximity]     = useState(0); // passive proximity hint
  const [stressRatio, setStressRatio]         = useState(0); // jam timer fraction → pick stress
  const [flashType, setFlashType]             = useState<FlashType>(null);
  const [platePulse, setPlatePulse]           = useState(false);
  const [pickBroken, setPickBroken]           = useState(false);
  const [phase, setPhase]                     = useState<Phase>('idle');
  const [currentLock, setCurrentLock]         = useState(0);
  const [picksRemaining, setPicksRemaining]   = useState(PICK_BUDGET);
  const [locksOpened, setLocksOpened]         = useState(0);
  const [lockResults, setLockResults]         = useState<('open' | 'failed' | null)[]>(
    () => Array(NUM_LOCKS).fill(null),
  );
  const [hint, setHint]                       = useState<string | null>(null);

  // ── Refs (read directly in RAF loop to avoid stale closures) ─────────────
  const pickDegRef          = useRef(90);
  const cylinderDegRef      = useRef(0);
  const torqueHeldRef       = useRef(false);
  const pickKeyDirRef       = useRef(0);
  const jamTimeRef          = useRef(0);
  const phaseRef            = useRef<Phase>('idle');
  const currentLockRef      = useRef(0);
  const picksRemainingRef   = useRef(PICK_BUDGET);
  const locksOpenedRef      = useRef(0);
  const rafRef              = useRef<number | null>(null);
  const lastTsRef           = useRef<number | null>(null);
  const doneRef             = useRef(false);
  const lockAreaRef         = useRef<HTMLDivElement>(null);
  const lastScrapeRef       = useRef(0); // timestamp of last scrape SFX

  phaseRef.current          = phase;
  currentLockRef.current    = currentLock;
  picksRemainingRef.current = picksRemaining;
  locksOpenedRef.current    = locksOpened;

  // ── Flash + plate pulse effects on phase transitions ─────────────────────
  useEffect(() => {
    if (phase === 'opening') {
      setFlashType('unlock');
      setPlatePulse(true);
      sfx.play('lockClick');
      const t1 = setTimeout(() => setFlashType(null), 750);
      const t2 = setTimeout(() => setPlatePulse(false), 600);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (phase === 'breaking') {
      setFlashType('break');
      setPickBroken(true);
      sfx.play('lockSnap');
      const t = setTimeout(() => {
        setFlashType(null);
        setPickBroken(false);
      }, 550);
      return () => clearTimeout(t);
    }
  }, [phase]);

  // ── Finish helper ─────────────────────────────────────────────────────────
  const finish = useCallback((opened: number, picks: number) => {
    if (doneRef.current) return;
    doneRef.current = true;
    phaseRef.current = 'done';
    setPhase('done');
    onFinish(lockpickingScore(opened, picks));
  }, [onFinish]);

  // ── RAF loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'done') return;

    lastTsRef.current = null;

    const loop = (ts: number) => {
      if (phaseRef.current === 'done') return;

      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;

      const ph = phaseRef.current;

      // ── Breaking: cylinder snaps back ────────────────────────────────────
      if (ph === 'breaking') {
        cylinderDegRef.current = Math.max(0, cylinderDegRef.current - CYLINDER_RETURN_SPEED * 2.5 * dt);
        setCylinderDeg(cylinderDegRef.current);
        if (cylinderDegRef.current <= 0) {
          // Check for out-of-picks failure — finish after the snap animation completes
          if (picksRemainingRef.current <= 0) {
            finish(locksOpenedRef.current, 0);
            return;
          }
          phaseRef.current = 'idle';
          setPhase('idle');
          setHint(null);
          setWarmth(0);
          setStressRatio(0);
          setShakeX(0);
          setShakeY(0);
        }
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // ── Opening: cylinder sweeps to 90° ──────────────────────────────────
      if (ph === 'opening') {
        cylinderDegRef.current = Math.min(
          CYLINDER_OPEN_DEG,
          cylinderDegRef.current + CYLINDER_TURN_SPEED * 2.5 * dt,
        );
        setCylinderDeg(cylinderDegRef.current);
        if (cylinderDegRef.current >= CYLINDER_OPEN_DEG) {
          const nextOpened = locksOpenedRef.current + 1;
          locksOpenedRef.current = nextOpened;
          setLocksOpened(nextOpened);
          setLockResults((prev) => {
            const copy = [...prev];
            copy[currentLockRef.current] = 'open';
            return copy;
          });
          if (nextOpened >= NUM_LOCKS) {
            finish(nextOpened, picksRemainingRef.current);
          } else {
            const nextLock = currentLockRef.current + 1;
            currentLockRef.current = nextLock;
            setCurrentLock(nextLock);
            cylinderDegRef.current = 0;
            setCylinderDeg(0);
            jamTimeRef.current = 0;
            // Reset pick to center so the next lock starts fair
            pickDegRef.current = 90;
            setPickDeg(90);
            phaseRef.current = 'idle';
            setPhase('idle');
            setHint(null);
            setWarmth(0);
            setIdleProximity(0);
            setStressRatio(0);
          }
        }
        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      // ── Idle / turning ────────────────────────────────────────────────────

      if (pickKeyDirRef.current !== 0) {
        pickDegRef.current = clamp(
          pickDegRef.current + pickKeyDirRef.current * PICK_KEY_SPEED * dt,
          PICK_MIN_DEG,
          PICK_MAX_DEG,
        );
        setPickDeg(pickDegRef.current);
      }

      const lock = locks.current[currentLockRef.current];
      const turn = allowedTurn(pickDegRef.current, lock);
      const targetCylinder = turn * CYLINDER_OPEN_DEG;

      if (torqueHeldRef.current) {
        phaseRef.current = 'turning';
        setPhase('turning');

        if (cylinderDegRef.current < targetCylinder) {
          cylinderDegRef.current = Math.min(
            targetCylinder,
            cylinderDegRef.current + CYLINDER_TURN_SPEED * dt,
          );
        } else if (cylinderDegRef.current > targetCylinder) {
          cylinderDegRef.current = Math.max(
            targetCylinder,
            cylinderDegRef.current - CYLINDER_RETURN_SPEED * dt,
          );
        }
        setCylinderDeg(cylinderDegRef.current);
        setWarmth(turn);

        const isJamming = turn < 1 && cylinderDegRef.current >= targetCylinder - 0.5;

        if (isJamming) {
          jamTimeRef.current += dt;

          const bt = breakTime(pickDegRef.current, lock, currentLockRef.current);
          const sr = Math.min(jamTimeRef.current / bt, 1);
          setStressRatio(sr);

          // Throttled scrape SFX — fire at most once per ~350 ms
          const now = performance.now();
          if (now - lastScrapeRef.current > 350) {
            sfx.play('lockScrape');
            lastScrapeRef.current = now;
          }

          const severity = 1 - turn;
          const amp = 8 * Math.pow(severity, 0.7);
          setShakeX((Math.random() * 2 - 1) * amp);
          setShakeY((Math.random() * 2 - 1) * amp * 0.6);

          if (jamTimeRef.current > bt) {
            jamTimeRef.current = 0;
            lastScrapeRef.current = 0;
            setShakeX(0);
            setShakeY(0);
            setWarmth(0);
            setStressRatio(0);
            setIdleProximity(0);
            const newPicks = picksRemainingRef.current - 1;
            picksRemainingRef.current = newPicks;
            setPicksRemaining(newPicks);
            torqueHeldRef.current = false;

            if (newPicks <= 0) {
              setLockResults((prev) => {
                const copy = [...prev];
                copy[currentLockRef.current] = 'failed';
                return copy;
              });
            }
            // Always enter breaking phase — finish() fires when the cylinder returns (if 0 picks)
            phaseRef.current = 'breaking';
            setPhase('breaking');
            setHint('Pick snapped!');
          } else {
            if (turn > 0.65) setHint('Getting warmer…');
            else if (turn > 0.3) setHint('Keep looking…');
            else setHint('Wrong angle');
          }
        } else {
          setShakeX(0);
          setShakeY(0);
          setStressRatio(0);
          jamTimeRef.current = 0;

          if (canOpen(pickDegRef.current, lock) && cylinderDegRef.current >= CYLINDER_OPEN_DEG - 1) {
            torqueHeldRef.current = false;
            phaseRef.current = 'opening';
            setPhase('opening');
            setHint(null);
            setWarmth(0);
          } else if (turn > 0.9) {
            setHint('Almost there!');
          } else {
            setHint(null);
          }
        }
      } else {
        // Idle — passive proximity signal (faint glow when pick is in the turn zone)
        setIdleProximity(turn);

        phaseRef.current = 'idle';
        setPhase('idle');
        jamTimeRef.current = 0;
        setShakeX(0);
        setShakeY(0);
        setWarmth(0);
        setStressRatio(0);
        setHint(null);

        if (cylinderDegRef.current > 0) {
          cylinderDegRef.current = Math.max(0, cylinderDegRef.current - CYLINDER_RETURN_SPEED * dt);
          setCylinderDeg(cylinderDegRef.current);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase === 'done', finish]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'done') return;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { e.preventDefault(); pickKeyDirRef.current = -1; }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); pickKeyDirRef.current = 1; }
      else if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); torqueHeldRef.current = true; }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'ArrowRight' || e.code === 'KeyD') pickKeyDirRef.current = 0;
      else if (e.code === 'Space' || e.code === 'ArrowUp') torqueHeldRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [phase]);

  // ── Pointer (mouse / touch) ───────────────────────────────────────────────
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (phaseRef.current === 'done') return;
    const rect = lockAreaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const deg = pointerToDeg(rect.left + rect.width / 2, rect.top + rect.height / 2, e.clientX, e.clientY);
    pickDegRef.current = deg;
    setPickDeg(deg);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    torqueHeldRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerUp = useCallback(() => { torqueHeldRef.current = false; }, []);

  // ── Render ────────────────────────────────────────────────────────────────

  const isDone = phase === 'done';
  const PLATE    = 200;
  const CENTER   = PLATE / 2;
  const CYL_SIZE = 88;
  const PICK_LEN = CENTER - 8;

  const cylinderCssRot = -cylinderDeg;

  const torqueActive = phase === 'turning' || (torqueHeldRef.current && phase !== 'breaking');
  const glowColor    = warmthGlowColor(warmth);
  const glowRadius   = 8 + warmth * 18;
  const cylinderGlow = torqueActive && warmth > 0
    ? { boxShadow: `0 0 ${glowRadius}px ${glowRadius / 2}px ${glowColor}` }
    : idleProximity > 0
      // Passive proximity: faint warm gold when in the turn zone
      ? { boxShadow: `0 0 ${4 + idleProximity * 8}px ${2 + idleProximity * 3}px rgba(200,160,40,${(idleProximity * 0.18).toFixed(2)})` }
      : {};

  const plateTransform = `translate(${shakeX}px, ${shakeY}px)`;
  const breakAnim   = phase === 'breaking' ? { animation: 'lock-break 0.45s ease-out' } : {};
  const plateAnim   = platePulse           ? { animation: 'lock-plate-open 0.6s ease-out' } : {};

  return (
    <div className="flex flex-col items-center gap-4 select-none">

      {/* Lock progress row */}
      <div className="flex items-center gap-5">
        {lockResults.map((result, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <span className={`text-xl font-bold transition-colors ${
              result === 'open'   ? 'text-gold-bright'
              : result === 'failed' ? 'text-rose-400'
              : i === currentLock && !isDone ? 'text-gold-bright'
              : 'text-parchment-400/30'
            }`}>
              {result === 'open' ? '✓' : result === 'failed' ? '✗' : i === currentLock && !isDone ? '🔑' : '○'}
            </span>
            <span className="text-[10px] font-display text-ink-muted">{LOCK_LABELS[i]}</span>
          </div>
        ))}
      </div>

      {/* Lock N of 3 */}
      {!isDone && (
        <p className="text-[11px] font-display text-ink-muted -mt-2">
          Lock {currentLock + 1} of {NUM_LOCKS}
        </p>
      )}

      {/* Pick count */}
      <div className="flex items-center gap-1">
        <span className="font-display text-xs text-ink-muted mr-1">Picks:</span>
        {Array.from({ length: PICK_BUDGET }, (_, i) => (
          <span key={i} className={`text-xs transition-opacity ${i < picksRemaining ? 'opacity-100' : 'opacity-15'}`}>
            🗝️
          </span>
        ))}
      </div>

      {/* Lock visual area */}
      <div
        ref={lockAreaRef}
        className="relative cursor-crosshair touch-none"
        style={{ width: PLATE, height: PLATE + 30 }}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Outer lock plate — shakes with the cylinder */}
        <div
          className="absolute rounded-full"
          style={{
            width: PLATE,
            height: PLATE,
            top: 0,
            left: 0,
            background: 'radial-gradient(circle at 40% 35%, #4a3a22, #1c1208)',
            border: '4px solid',
            borderColor: 'rgb(120 80 20)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.7), inset 0 1px 2px rgba(255,200,80,0.12)',
            transform: plateTransform,
            ...breakAnim,
            ...plateAnim,
          }}
        >
          {/* Decorative ring inset */}
          <div
            className="absolute rounded-full"
            style={{
              inset: 10,
              border: '1px solid rgba(180,120,30,0.3)',
              pointerEvents: 'none',
            }}
          />

          {/* Arc tick marks — give the player positional reference */}
          <ArcTicks center={CENTER} radius={CENTER - 6} />

          {/* Inner cylinder — rotates, carries the keyhole and tension wrench */}
          <div
            className="absolute rounded-full"
            style={{
              width: CYL_SIZE,
              height: CYL_SIZE,
              left: CENTER - CYL_SIZE / 2,
              top: CENTER - CYL_SIZE / 2,
              background: 'radial-gradient(circle at 40% 30%, #5a4828, #2a1f0e)',
              border: '2px solid rgba(160,110,30,0.55)',
              transform: `rotate(${cylinderCssRot}deg)`,
              transition: 'none',
              ...cylinderGlow,
            }}
          >
            <Keyhole size={CYL_SIZE} />
            <TensionWrench cylinderSize={CYL_SIZE} />
          </div>

          {/* Lockpick */}
          {!isDone && (
            <LockPick
              pickDeg={pickDeg}
              cylinderDeg={cylinderDeg}
              broken={pickBroken}
              phase={phase}
              center={CENTER}
              length={PICK_LEN}
              stressRatio={stressRatio}
            />
          )}

          {/* Unlock flash overlay */}
          {flashType === 'unlock' && (
            <div
              className="absolute pointer-events-none"
              style={{
                top: '50%',
                left: '50%',
                animation: 'lock-open 0.75s ease-out forwards',
                zIndex: 20,
                whiteSpace: 'nowrap',
              }}
            >
              <span className="font-display text-2xl font-black text-emerald-300"
                style={{ textShadow: '0 0 12px rgba(74,222,128,0.9)' }}>
                CLICK!
              </span>
            </div>
          )}

          {/* Break flash overlay */}
          {flashType === 'break' && (
            <div
              className="absolute pointer-events-none"
              style={{
                top: '50%',
                left: '50%',
                animation: 'lock-snap 0.55s ease-out forwards',
                zIndex: 20,
                whiteSpace: 'nowrap',
              }}
            >
              <span className="font-display text-2xl font-black text-rose-400"
                style={{ textShadow: '0 0 10px rgba(239,68,68,0.9)' }}>
                SNAP!
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Hint / status */}
      <div className="h-5 flex items-center justify-center -mt-6">
        {hint && (
          <span
            key={hint}
            className={`font-display text-xs font-semibold ${
              hint === 'Almost there!'    ? 'text-emerald-400'
              : hint === 'Getting warmer…' ? 'text-amber-400'
              : hint === 'Pick snapped!'   ? 'text-rose-400'
              : 'text-ink-muted'
            }`}
            style={{ animation: 'hint-pop 0.18s ease-out' }}
          >
            {hint}
          </span>
        )}
      </div>

      {/* Instruction */}
      <p className="text-center text-xs text-ink-muted max-w-[230px] leading-snug">
        {isDone
          ? 'Complete!'
          : phase === 'turning'
            ? 'Holding torque… watch the glow.'
            : 'Move pick to search · Hold "Turn Lock" to apply torque'}
      </p>

      {/* On-screen controls */}
      {!isDone && (
        <div className="flex items-center gap-3">
          <button
            className="h-12 w-12 rounded-lg border-2 border-gold-deep/70 bg-wood-800 font-display text-base font-bold text-parchment-200 shadow-wood active:scale-95 touch-none"
            onPointerDown={(e) => { e.preventDefault(); pickKeyDirRef.current = -1; }}
            onPointerUp={() => { pickKeyDirRef.current = 0; }}
            onPointerLeave={() => { pickKeyDirRef.current = 0; }}
          >◀</button>

          <button
            className="h-12 flex-1 rounded-lg border-2 border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep font-display text-sm font-black text-wood-900 shadow-gold active:scale-95 touch-none"
            onPointerDown={(e) => { e.preventDefault(); torqueHeldRef.current = true; }}
            onPointerUp={() => { torqueHeldRef.current = false; }}
            onPointerLeave={() => { torqueHeldRef.current = false; }}
          >Turn Lock</button>

          <button
            className="h-12 w-12 rounded-lg border-2 border-gold-deep/70 bg-wood-800 font-display text-base font-bold text-parchment-200 shadow-wood active:scale-95 touch-none"
            onPointerDown={(e) => { e.preventDefault(); pickKeyDirRef.current = 1; }}
            onPointerUp={() => { pickKeyDirRef.current = 0; }}
            onPointerLeave={() => { pickKeyDirRef.current = 0; }}
          >▶</button>
        </div>
      )}

      <p className="text-[10px] text-ink-muted/50 font-display">
        A/D or ←/→ to rotate · Space/↑ to turn · Mouse to aim
      </p>
    </div>
  );
}
