// Last Stand trial — HP.
// Block incoming wave attacks from Left / Center / Right in time.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import { play as sfxPlay } from '@/lib/sfx';
import {
  generateAttacks,
  lastStandScore,
  seededRng,
  STARTING_HP,
  DAMAGE_PER_HIT,
  SPAWN_AHEAD_MS,
  BLOCK_GRACE_MS,
  DIRECTIONS,
  type Direction,
  type Attack,
} from '@/engine/trials/lastStand';

interface LastStandProps {
  onFinish: (score01: number) => void;
}

const DIR_LABELS: Record<Direction, string> = { left: '← Left', center: '▲ Center', right: '→ Right' };
const DIR_EMOJI: Record<Direction, string> = { left: '⬅️', center: '⬆️', right: '➡️' };

type Phase = 'countdown' | 'running' | 'done';
type FeedbackMap = Record<Direction, 'blocked' | 'hit' | null>;

const EMPTY_FEEDBACK: FeedbackMap = { left: null, center: null, right: null };

export function LastStand({ onFinish }: LastStandProps) {
  const [phase, setPhase] = useState<Phase>('countdown');
  const [countdown, setCountdown] = useState(3);

  const [attacks, setAttacks] = useState<Attack[]>(() => generateAttacks(seededRng(Date.now())));
  const [hp, setHp] = useState(STARTING_HP);
  const [elapsed, setElapsed] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackMap>(EMPTY_FEEDBACK);
  const [damageFlash, setDamageFlash] = useState(false);

  // Refs for values read inside the RAF loop without triggering re-renders.
  const phaseRef = useRef<Phase>('countdown');
  phaseRef.current = phase;
  const attacksCopy = useRef<Attack[]>(attacks);
  attacksCopy.current = attacks;
  const hpRef = useRef(hp);
  hpRef.current = hp;
  const elapsedRef = useRef(0);
  const startMs = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Collect pending timers so they can be cleared on unmount.
  const pendingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    return () => { pendingTimers.current.forEach(clearTimeout); };
  }, []);

  const scheduleTimeout = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    pendingTimers.current.push(t);
    return t;
  }, []);

  // Flash a direction column for ~400 ms after a block or hit.
  const triggerFeedback = useCallback((dir: Direction, type: 'blocked' | 'hit') => {
    setFeedback(prev => ({ ...prev, [dir]: type }));
    scheduleTimeout(() => setFeedback(prev => ({ ...prev, [dir]: null })), 400);
  }, [scheduleTimeout]);

  // Flash the HP bar edge for ~350 ms when damage lands.
  const triggerDamageFlash = useCallback(() => {
    setDamageFlash(true);
    scheduleTimeout(() => setDamageFlash(false), 350);
  }, [scheduleTimeout]);

  const finish = useCallback(
    (finalAttacks: Attack[], died: boolean) => {
      const blocked = finalAttacks.filter((a) => a.result === 'blocked').length;
      const resolved = finalAttacks.filter((a) => a.result !== null).length;
      sfxPlay(died ? 'defeat' : 'win');
      onFinish(lastStandScore(blocked, resolved));
    },
    [onFinish],
  );

  // ── Countdown: 3 → 2 → 1 → start ─────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'countdown') return;
    const t = scheduleTimeout(() => {
      if (countdown > 1) {
        setCountdown(c => c - 1);
      } else {
        setPhase('running');
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [phase, countdown, scheduleTimeout]);

  // ── RAF game loop ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'running') return;

    const loop = (ts: number) => {
      if (startMs.current === null) startMs.current = ts;
      const el = ts - startMs.current;
      elapsedRef.current = el;
      setElapsed(el);

      // Build a set of already-resolved attack IDs so we can detect newly hit ones.
      const prevResolved = new Set(
        attacksCopy.current.filter(a => a.result !== null).map(a => a.id),
      );

      let changed = false;
      const next = attacksCopy.current.map((a) => {
        if (a.result !== null) return a;
        // Resolve as hit once the one-frame grace window has expired.
        if (el > a.landMs + BLOCK_GRACE_MS) {
          changed = true;
          return { ...a, result: 'hit' as const };
        }
        return a;
      });

      if (changed) {
        const newlyHit = next.filter(a => a.result === 'hit' && !prevResolved.has(a.id));
        const newDamage = newlyHit.length;

        if (newDamage > 0) {
          newlyHit.forEach(a => triggerFeedback(a.dir, 'hit'));
          triggerDamageFlash();
          sfxPlay('playerHurt');
        }

        const newHp = Math.max(0, hpRef.current - newDamage * DAMAGE_PER_HIT);
        setAttacks(next);
        setHp(newHp);
        hpRef.current = newHp;
        attacksCopy.current = next;

        if (newHp <= 0) {
          setPhase('done');
          finish(next, true);
          return;
        }
      }

      // Must be checked outside `if (changed)` — blocking all attacks produces
      // no new hits (changed===false), so this is the only path that catches perfect runs.
      if (next.every((a) => a.result !== null)) {
        setPhase('done');
        finish(next, false);
        return;
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase, finish, triggerFeedback, triggerDamageFlash]);

  // ── Block handler ──────────────────────────────────────────────────────────────

  const block = useCallback(
    (dir: Direction) => {
      if (phaseRef.current !== 'running') return;
      const el = elapsedRef.current;
      const target = attacksCopy.current
        .filter((a) => {
          if (a.result !== null || a.dir !== dir) return false;
          return el >= a.landMs - SPAWN_AHEAD_MS && el <= a.landMs + BLOCK_GRACE_MS;
        })
        .sort((a, b) => a.landMs - b.landMs)[0];
      if (!target) return;
      const next = attacksCopy.current.map((a) =>
        a.id === target.id ? { ...a, result: 'blocked' as const } : a,
      );
      setAttacks(next);
      attacksCopy.current = next;
      triggerFeedback(dir, 'blocked');
      sfxPlay('lastStandBlock');
    },
    [triggerFeedback],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); block('left'); }
      if (e.code === 'Space' || e.code === 'KeyS') { e.preventDefault(); block('center'); }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); block('right'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [block]);

  // ── Derived display values ─────────────────────────────────────────────────────

  // Attacks visible on screen: spawned but not yet resolved.
  const incoming = attacks.filter(
    (a) => a.result === null && elapsed >= a.landMs - SPAWN_AHEAD_MS,
  );

  // Directions whose block window is currently open — used to highlight buttons.
  const activeDirections = new Set<Direction>(
    attacks
      .filter((a) => {
        if (a.result !== null) return false;
        return elapsed >= a.landMs - SPAWN_AHEAD_MS && elapsed <= a.landMs + BLOCK_GRACE_MS;
      })
      .map((a) => a.dir),
  );

  const blockedCount = attacks.filter((a) => a.result === 'blocked').length;
  const totalAttacks = attacks.length;
  const isDone = phase === 'done';
  const hpPct = hp;

  // ── Countdown screen ───────────────────────────────────────────────────────────

  if (phase === 'countdown') {
    return (
      <div className="flex flex-col items-center justify-center gap-3 min-h-64 select-none">
        <div
          className="text-7xl font-display font-bold text-parchment-100 tabular-nums"
          style={{ textShadow: '0 0 24px rgba(212,160,23,0.5)' }}
        >
          {countdown}
        </div>
        <p className="text-xs font-display text-ink-muted">Get ready…</p>
      </div>
    );
  }

  // ── Game screen ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col items-center gap-5 px-2 relative">
      {/* Red edge flash when HP is lost */}
      <div
        className="pointer-events-none absolute inset-0 rounded-lg border-2 border-rose-500"
        style={{ opacity: damageFlash ? 0.75 : 0, transition: 'opacity 0.35s ease-out' }}
      />

      {/* HP bar */}
      <div className="w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs font-display text-ink-muted">
          <span>❤️ HP</span>
          <span style={{ color: damageFlash ? '#f87171' : undefined, transition: 'color 0.35s' }}>
            {hp}%
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/50">
          <div
            className={`h-full transition-all duration-200 ${hpPct > 60 ? 'bg-emerald-500/70' : hpPct > 30 ? 'bg-amber-400/70' : 'bg-rose-500/70'}`}
            style={{ width: `${hpPct}%` }}
          />
        </div>
        {/* Damage number — fades in on hit, fades out after */}
        <div
          className="mt-0.5 text-right text-xs font-bold text-rose-400"
          style={{ opacity: damageFlash ? 1 : 0, transition: 'opacity 0.35s ease-out' }}
        >
          −{DAMAGE_PER_HIT}
        </div>
      </div>

      {/* Incoming attacks: three lanes with sword emoji + timer bar */}
      <div className="flex gap-4 w-full max-w-xs justify-center min-h-24 items-center">
        {DIRECTIONS.map((dir) => {
          const attk = incoming.find((a) => a.dir === dir);
          const progress = attk
            ? Math.min(1, (elapsed - (attk.landMs - SPAWN_AHEAD_MS)) / SPAWN_AHEAD_MS)
            : 0;
          const fb = feedback[dir];

          return (
            <div key={dir} className="flex flex-col items-center gap-1.5 w-16">
              {/* Sword — scales in as attack approaches; swaps emoji on block/hit */}
              <div
                className="text-2xl transition-transform duration-100"
                style={{
                  opacity: attk || fb ? 1 : 0.1,
                  transform: attk ? `scale(${0.6 + 0.4 * progress})` : 'scale(0.6)',
                  filter: fb === 'blocked'
                    ? 'drop-shadow(0 0 6px #34d399)'
                    : fb === 'hit'
                    ? 'drop-shadow(0 0 6px #f87171)'
                    : 'none',
                  transition: 'opacity 0.1s, filter 0.1s',
                }}
              >
                {fb === 'blocked' ? '🛡️' : fb === 'hit' ? '💥' : '⚔️'}
              </div>

              {/* Timer bar — fills as attack closes in; turns red near impact */}
              <div className="w-12 h-1.5 rounded-full bg-parchment-300/30 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    progress > 0.75
                      ? 'bg-rose-500'
                      : progress > 0.45
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{ width: attk ? `${progress * 100}%` : '0%' }}
                />
              </div>

              <div className="text-xs font-display text-ink-muted">{DIR_EMOJI[dir]}</div>
            </div>
          );
        })}
      </div>

      {/* Block buttons — glow when their window is open */}
      <div className="flex gap-2 w-full max-w-xs">
        {DIRECTIONS.map((dir) => {
          const isActive = activeDirections.has(dir) && !isDone;
          return (
            <Button
              key={dir}
              variant="secondary"
              onClick={() => block(dir)}
              disabled={isDone}
              className={`flex-1 py-3 text-xs transition-all duration-100 ${
                isActive ? 'ring-2 ring-gold-bright/80 bg-gold-deep/20 scale-105' : ''
              }`}
            >
              {DIR_LABELS[dir]}
            </Button>
          );
        })}
      </div>

      <p className="text-xs text-ink-muted">
        {isDone
          ? `${blockedCount} / ${totalAttacks} attacks blocked`
          : `Blocked: ${blockedCount} / ${totalAttacks}`}
      </p>
      <p className="text-xs text-ink-muted opacity-60">Keyboard: ← A (left) · Space S (center) · → D (right)</p>
    </div>
  );
}
