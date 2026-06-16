// Last Stand trial — HP.
// Block incoming wave attacks from Left / Center / Right in time.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/Button';

interface LastStandProps {
  onFinish: (score01: number) => void;
}

type Direction = 'left' | 'center' | 'right';

interface Attack {
  id: number;
  dir: Direction;
  /** ms from run start when the attack "lands" */
  landMs: number;
  result: 'blocked' | 'hit' | null;
}

const TOTAL_WAVES = 8;
const ATTACKS_PER_WAVE = 2;
const WAVE_INTERVAL_MS = 2400;
const BLOCK_WINDOW_MS = 700; // how long before landing the player can block
const SPAWN_AHEAD_MS = 1400; // show attack N ms before it lands
const DIRECTIONS: Direction[] = ['left', 'center', 'right'];
const DIR_LABELS: Record<Direction, string> = { left: '← Left', center: '▲ Center', right: '→ Right' };
const DIR_EMOJI: Record<Direction, string> = { left: '⬅️', center: '⬆️', right: '➡️' };

function generateAttacks(rng: () => number): Attack[] {
  const attacks: Attack[] = [];
  let id = 0;
  for (let wave = 0; wave < TOTAL_WAVES; wave++) {
    for (let a = 0; a < ATTACKS_PER_WAVE; a++) {
      const offset = a * (WAVE_INTERVAL_MS / ATTACKS_PER_WAVE);
      attacks.push({
        id: id++,
        dir: DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)],
        landMs: wave * WAVE_INTERVAL_MS + offset + SPAWN_AHEAD_MS,
        result: null,
      });
    }
  }
  return attacks;
}

export function LastStand({ onFinish }: LastStandProps) {
  const attacksRef = useRef(generateAttacks(Math.random));
  const [attacks, setAttacks] = useState(attacksRef.current);
  const [hp, setHp] = useState(100);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const startMs = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const attacksCopy = useRef(attacks);
  attacksCopy.current = attacks;
  const hpRef = useRef(hp);
  hpRef.current = hp;

  const finish = useCallback(
    (finalAttacks: Attack[]) => {
      setDone(true);
      const blocked = finalAttacks.filter((a) => a.result === 'blocked').length;
      onFinish(blocked / finalAttacks.length);
    },
    [onFinish],
  );

  useEffect(() => {
    const loop = (ts: number) => {
      if (startMs.current === null) startMs.current = ts;
      const el = ts - startMs.current;
      elapsedRef.current = el;
      setElapsed(el);

      // Resolve attacks that have passed their landing window
      let changed = false;
      const next = attacksCopy.current.map((a) => {
        if (a.result !== null) return a;
        if (el > a.landMs + BLOCK_WINDOW_MS) {
          changed = true;
          return { ...a, result: 'hit' as const };
        }
        return a;
      });

      if (changed) {
        const newHits = next.filter((a) => a.result === 'hit').length;
        const prevHits = attacksCopy.current.filter((a) => a.result === 'hit').length;
        const newDamage = newHits - prevHits;
        const newHp = Math.max(0, hpRef.current - newDamage * 14);
        setAttacks(next);
        setHp(newHp);
        hpRef.current = newHp;
        attacksCopy.current = next;

        // End if dead or all attacks resolved
        const allDone = next.every((a) => a.result !== null);
        if (newHp <= 0 || allDone) {
          finish(next);
          return;
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [finish]);

  const block = useCallback(
    (dir: Direction) => {
      if (done) return;
      const el = elapsedRef.current;
      // Find the soonest active attack in the correct direction within the block window
      const target = attacksCopy.current
        .filter((a) => a.result === null && a.dir === dir && el >= a.landMs - BLOCK_WINDOW_MS && el <= a.landMs + BLOCK_WINDOW_MS)
        .sort((a, b) => a.landMs - b.landMs)[0];
      if (!target) return;
      const next = attacksCopy.current.map((a) =>
        a.id === target.id ? { ...a, result: 'blocked' as const } : a,
      );
      setAttacks(next);
      attacksCopy.current = next;
    },
    [done],
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

  // Incoming attacks: spawned but not yet resolved
  const incoming = attacks.filter(
    (a) => a.result === null && elapsed >= a.landMs - SPAWN_AHEAD_MS,
  );

  const blocked = attacks.filter((a) => a.result === 'blocked').length;
  const hpPct = hp;

  return (
    <div className="flex flex-col items-center gap-5 px-2">
      {/* HP bar */}
      <div className="w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs font-display text-ink-muted">
          <span>🛡️ Endurance</span>
          <span>{hp}%</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/50">
          <div
            className={`h-full transition-all duration-200 ${hpPct > 60 ? 'bg-emerald-500/70' : hpPct > 30 ? 'bg-amber-400/70' : 'bg-rose-500/70'}`}
            style={{ width: `${hpPct}%` }}
          />
        </div>
      </div>

      {/* Incoming attacks display */}
      <div className="flex gap-4 w-full max-w-xs justify-center min-h-20 items-center">
        {DIRECTIONS.map((dir) => {
          const attk = incoming.find((a) => a.dir === dir);
          const progress = attk
            ? Math.min(1, (elapsed - (attk.landMs - SPAWN_AHEAD_MS)) / SPAWN_AHEAD_MS)
            : 0;
          return (
            <div key={dir} className="flex flex-col items-center gap-1 w-16">
              <div className={`text-2xl transition-all ${attk ? 'opacity-100' : 'opacity-10'}`}
                style={{ transform: attk ? `scale(${0.6 + 0.4 * progress})` : 'scale(0.6)' }}>
                ⚔️
              </div>
              <div className="text-xs font-display text-ink-muted">{DIR_EMOJI[dir]}</div>
            </div>
          );
        })}
      </div>

      {/* Block buttons */}
      <div className="flex gap-2 w-full max-w-xs">
        {DIRECTIONS.map((dir) => (
          <Button
            key={dir}
            variant="secondary"
            onClick={() => block(dir)}
            disabled={done}
            className="flex-1 py-3 text-xs"
          >
            {DIR_LABELS[dir]}
          </Button>
        ))}
      </div>

      <p className="text-xs text-ink-muted">
        {done
          ? `${blocked} / ${attacks.length} attacks blocked`
          : `Attacks blocked: ${blocked} / ${attacks.filter((a) => a.result !== null).length}`}
      </p>
      <p className="text-xs text-ink-muted opacity-60">Keyboard: ← A (left) · Space S (center) · → D (right)</p>
    </div>
  );
}
