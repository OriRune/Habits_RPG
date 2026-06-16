// Rooftop Chase trial — AG.
// Side-view endless runner: auto-sprint, one-button jump, chaser tension.
// Space / ArrowUp / tap play area or Jump button to jump.

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  generateFeatures,
  chaseScore,
  speedAt,
  updateLead,
  resolveContact,
  CHASE_TARGET_DISTANCE,
  GRAVITY,
  JUMP_VELOCITY,
  STUMBLE_MS,
  LEAD_START,
  LEAD_MAX,
  STOMP_BOUNCE_VELOCITY,
  type RoofFeature,
} from '@/engine/trials/rooftopChase';

interface RooftopChaseProps {
  onFinish: (score01: number) => void;
}

// ── Display constants ──────────────────────────────────────────────────────────

/** Width of the play area in px. */
const VIEW_W = 320;
/** Height of the play area in px. */
const VIEW_H = 160;
/** Roof surface Y in px from top of view. */
const ROOF_PX = 116;
/** Pixel scale: 1 world-unit = this many px. */
const PX_PER_WU = 7;
/** Fixed hero X in px. */
const HERO_X_PX = 72;

const FEATURE_EMOJIS: Record<string, string> = {
  hazard: '🧱',
  mook: '👹',
};

// ── Component ──────────────────────────────────────────────────────────────────

export function RooftopChase({ onFinish }: RooftopChaseProps) {
  // Stable feature list — generated once
  const featuresRef = useRef<RoofFeature[]>(generateFeatures(Math.random));

  // Physics refs (no stale-closure issues; written & read inside RAF only)
  const heroYRef = useRef(0);          // world-units above roof (0 = grounded)
  const heroVyRef = useRef(0);         // world-units/sec (+up, -down)
  const distanceRef = useRef(0);       // world-units traveled
  const leadRef = useRef(LEAD_START);  // chaser distance buffer
  const stumbleUntilRef = useRef(0);   // performance.now() ms when stumble ends
  const activeContactRef = useRef<number | null>(null); // feature id in current contact
  const doneRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // Render state (set each frame)
  const [heroYPx, setHeroYPx] = useState(0);
  const [distance, setDistance] = useState(0);
  const [lead, setLead] = useState(LEAD_START);
  const [stumbling, setStumbling] = useState(false);
  const [visibleFeatures, setVisibleFeatures] = useState<RoofFeature[]>([]);
  const [stompedId, setStompedId] = useState<number | null>(null);
  const [stompFlashEnd, setStompFlashEnd] = useState(0);

  // ── Finish (fires once) ─────────────────────────────────────────────────
  const finish = useCallback(
    (dist: number) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onFinish(chaseScore(dist));
    },
    [onFinish],
  );

  // ── RAF loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = (ts: number) => {
      if (doneRef.current) return;
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;

      // 1. Advance distance
      const dist = distanceRef.current;
      const newDist = dist + speedAt(dist) * dt;
      distanceRef.current = newDist;

      // 2. Hero vertical physics
      let vy = heroVyRef.current - GRAVITY * dt;
      let y = heroYRef.current + vy * dt;
      if (y <= 0) { y = 0; vy = 0; }
      heroYRef.current = y;
      heroVyRef.current = vy;

      // 3. Visible features for rendering
      const features = featuresRef.current;
      const viewEnd = newDist + VIEW_W / PX_PER_WU + 6;
      const viewStart = newDist - 4;
      const visible = features.filter((f) => f.x + f.width >= viewStart && f.x <= viewEnd);

      // 4. Collision: which feature (if any) overlaps the hero's world x?
      const heroWorldX = newDist + HERO_X_PX / PX_PER_WU;
      const overlapping = visible.find(
        (f) => heroWorldX >= f.x && heroWorldX <= f.x + f.width,
      );

      let leadEvent: 'stumble' | 'stomp' | undefined;

      if (overlapping && overlapping.id !== activeContactRef.current) {
        const result = resolveContact(y, vy, overlapping);
        activeContactRef.current = overlapping.id;

        if (result === 'stomp') {
          heroVyRef.current = STOMP_BOUNCE_VELOCITY;
          leadEvent = 'stomp';
          setStompedId(overlapping.id);
          setStompFlashEnd(ts + 500);
        } else if (result === 'stumble') {
          stumbleUntilRef.current = ts + STUMBLE_MS;
          leadEvent = 'stumble';
        }
        // 'clear' — airborne over hazard/gap, no action
      } else if (!overlapping) {
        activeContactRef.current = null;
      }

      // 5. Lead update
      const newLead = updateLead(leadRef.current, dt, leadEvent);
      leadRef.current = newLead;

      // 6. End conditions
      if (newLead <= 0 || newDist >= CHASE_TARGET_DISTANCE) {
        // Push final render state before finishing
        setDistance(newDist);
        setLead(newLead);
        finish(newDist);
        return;
      }

      // 7. Push render state
      setHeroYPx(Math.round(y * PX_PER_WU));
      setDistance(newDist);
      setLead(newLead);
      setStumbling(ts < stumbleUntilRef.current);
      setVisibleFeatures(visible);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [finish]);

  // ── Jump ────────────────────────────────────────────────────────────────
  const jump = useCallback(() => {
    if (doneRef.current) return;
    const grounded = heroYRef.current <= 0;
    const nowStumbling = performance.now() < stumbleUntilRef.current;
    if (grounded && !nowStumbling) {
      heroVyRef.current = JUMP_VELOCITY;
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); jump(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [jump]);

  // ── Derived display ─────────────────────────────────────────────────────
  const leadFrac = lead / LEAD_MAX;
  const leadColor = leadFrac > 0.5 ? '#4ade80' : leadFrac > 0.25 ? '#fbbf24' : '#f87171';
  const leadLabel = leadFrac > 0.6 ? 'Safe' : leadFrac > 0.3 ? 'Close!' : '⚠ Danger!';
  const scorePct = Math.round(chaseScore(distance) * 100);
  // Chaser x: sits behind hero, moves left as lead shrinks
  const chaserXPx = HERO_X_PX - 60 - (1 - leadFrac) * 30;
  const showStompFlash = stompedId !== null && performance.now() < stompFlashEnd;

  return (
    <div className="flex flex-col items-center gap-3 px-2">
      <p className="text-center text-xs text-ink-muted">
        Tap <strong className="text-ink">Jump</strong> (or Space / ↑) to leap obstacles and stomp guards.
      </p>

      {/* ── Play area ────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-lg border-2 border-gold-deep/50 cursor-pointer select-none"
        style={{ width: VIEW_W, height: VIEW_H, background: 'linear-gradient(to bottom, #1e3a5f 0%, #2d5986 60%, #3b6fa8 100%)' }}
        onClick={jump}
        role="button"
        aria-label="Jump"
      >
        {/* Roof surface */}
        <div
          className="absolute left-0 right-0 bg-stone-500 border-t-2 border-stone-300/60"
          style={{ top: ROOF_PX, height: VIEW_H - ROOF_PX }}
        />

        {/* Gap cutouts (sky punched through the roof) */}
        {visibleFeatures
          .filter((f) => f.kind === 'gap')
          .map((f) => {
            const leftPx = (f.x - distance) * PX_PER_WU + HERO_X_PX;
            return (
              <div
                key={f.id}
                className="absolute"
                style={{
                  left: leftPx,
                  width: f.width * PX_PER_WU,
                  top: ROOF_PX,
                  height: VIEW_H - ROOF_PX,
                  background: 'linear-gradient(to bottom, #1e3a5f 0%, #0f1f36 100%)',
                }}
              />
            );
          })}

        {/* Gap lip labels */}
        {visibleFeatures
          .filter((f) => f.kind === 'gap')
          .map((f) => {
            const leftPx = (f.x - distance) * PX_PER_WU + HERO_X_PX;
            return (
              <div
                key={`lbl-${f.id}`}
                className="absolute font-display text-[9px] text-sky-300/80 text-center leading-none"
                style={{ left: leftPx, width: f.width * PX_PER_WU, top: ROOF_PX - 14 }}
              >
                GAP
              </div>
            );
          })}

        {/* Hazards and mooks */}
        {visibleFeatures
          .filter((f) => f.kind !== 'gap')
          .map((f) => {
            const leftPx = (f.x - distance) * PX_PER_WU + HERO_X_PX;
            const isStomped = f.id === stompedId && showStompFlash;
            return (
              <div
                key={f.id}
                className={`absolute flex items-end justify-center text-base leading-none ${isStomped ? 'opacity-20' : ''}`}
                style={{
                  left: leftPx,
                  width: Math.max(f.width * PX_PER_WU, 24),
                  bottom: VIEW_H - ROOF_PX,
                  height: 24,
                }}
              >
                {FEATURE_EMOJIS[f.kind]}
              </div>
            );
          })}

        {/* Chaser */}
        <div
          className="absolute flex items-end text-lg leading-none"
          style={{ left: Math.max(-10, chaserXPx), bottom: VIEW_H - ROOF_PX, height: 24 }}
        >
          🐺
        </div>

        {/* Hero */}
        <div
          className={`absolute flex items-end text-xl leading-none transition-none ${stumbling ? 'opacity-40' : ''}`}
          style={{ left: HERO_X_PX, bottom: VIEW_H - ROOF_PX + heroYPx, height: 28 }}
        >
          🏃
        </div>

        {/* Stomp flash */}
        {showStompFlash && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 font-display text-xs font-black text-gold-bright bg-gold-bright/20 px-2 py-0.5 rounded whitespace-nowrap pointer-events-none">
            STOMP! 🦶
          </div>
        )}

        {/* Distance */}
        <div className="absolute top-2 right-2 font-display text-[10px] font-bold text-parchment-100/70">
          {Math.round(distance)}/{CHASE_TARGET_DISTANCE}m
        </div>
      </div>

      {/* ── Chaser lead meter ─────────────────────────────────────────── */}
      <div className="w-full max-w-xs space-y-1">
        <div className="flex items-center justify-between px-0.5">
          <span className="font-display text-[10px] text-ink-muted">🐺 Chaser distance</span>
          <span className="font-display text-[10px] font-bold" style={{ color: leadColor }}>
            {leadLabel}
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/20">
          <div
            className="h-full rounded-full transition-none"
            style={{ width: `${leadFrac * 100}%`, backgroundColor: leadColor }}
          />
        </div>
      </div>

      {/* ── Jump button + score ──────────────────────────────────────── */}
      <div className="flex w-full max-w-xs items-center gap-3">
        <div className="text-center font-display text-xs text-ink-muted">
          Score: <strong className="text-gold-deep">{scorePct}%</strong>
        </div>
        <button
          onClick={jump}
          className="flex-1 select-none rounded-lg border-2 border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep py-3 font-display text-base font-black text-wood-900 shadow-gold transition-transform active:scale-95"
        >
          ↑ Jump
        </button>
      </div>
    </div>
  );
}
