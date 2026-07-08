// The living smithy — the Forge minigame's scene layer. Presentational only
// (pointer-events-none): ForgeMinigame's rAF loop drives it through an imperative
// handle, writing THREE CSS variables per frame (--forge-heat / --forge-quality /
// --forge-tempo) that every persistent visual derives from in CSS. Transient feedback
// (hammer swings, impact rings, sparks, steam) is spawned as self-removing DOM nodes.
// All spawns and looping animations are skipped or frozen under reduced motion — the
// informational channels (workpiece glow = heat, temper line = quality forecast) are
// plain opacity-from-variable, so they read correctly with animations off.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { ForgeRunState, ForgeEventKind } from '@/engine/crafting/forge';
import { SmithyBackdrop } from './SmithyBackdrop';

export interface ForgeSceneHandle {
  /** Per-frame: bind reducer state + the live score forecast to the scene. */
  update(s: ForgeRunState, forecast01: number): void;
  /** A strike resolved — swing the hammer and burst sparks scaled by accuracy. */
  strike(acc: number, weight: number, crit: boolean): void;
  /** An event started (kind) or ended (null). */
  eventFx(kind: ForgeEventKind | null): void;
  /** The piece was plunged — steam + ripple scaled by plunge accuracy. */
  quenchFx(acc: number): void;
}

interface ForgeSceneProps {
  /** Workpiece silhouette on the anvil: blade for weapons, plate for gear/items. */
  workpiece: 'blade' | 'plate';
  reducedMotion: boolean;
}

/** Fixed ember field over the coal bed (mine-sparkle idiom: constants, not RNG). */
const EMBERS: { left: string; bottom: string; size: number; dur: string; delay: string }[] = [
  { left: '13%', bottom: '22%', size: 3, dur: '2.4s', delay: '0s' },
  { left: '17%', bottom: '20%', size: 2, dur: '3.1s', delay: '0.5s' },
  { left: '21%', bottom: '24%', size: 3, dur: '2.7s', delay: '1.1s' },
  { left: '25%', bottom: '21%', size: 2, dur: '2.2s', delay: '0.3s' },
  { left: '29%', bottom: '23%', size: 2, dur: '3.4s', delay: '1.6s' },
  { left: '15%', bottom: '26%', size: 2, dur: '2.9s', delay: '2.0s' },
  { left: '23%', bottom: '27%', size: 3, dur: '2.5s', delay: '0.8s' },
  { left: '27%', bottom: '25%', size: 2, dur: '3.0s', delay: '1.4s' },
  { left: '19%', bottom: '19%', size: 2, dur: '2.3s', delay: '1.9s' },
  { left: '31%', bottom: '20%', size: 2, dur: '2.8s', delay: '0.2s' },
  { left: '11%', bottom: '18%', size: 2, dur: '3.2s', delay: '1.2s' },
  { left: '26%', bottom: '18%', size: 3, dur: '2.6s', delay: '2.3s' },
];

/** Workpiece subpaths in a 64×16 box — base, heat glow, and temper line reuse them. */
const WORKPIECE_PATH: Record<'blade' | 'plate', string> = {
  blade: 'M2,8 L38,3.5 L48,8 L38,12.5 Z M48,6.4 L60,6.4 L60,9.6 L48,9.6 Z',
  plate: 'M9,13.5 L13,2.5 L51,2.5 L55,13.5 Z',
};

// Scene anchor points (fractions of the container) — must track SmithyBackdrop's
// geometry: coal bed left, anvil face centre-right, slack tub right.
const ANVIL = { left: '63%', top: '52%' };
const TUB = { left: '90%', top: '66%' };

export const ForgeScene = forwardRef<ForgeSceneHandle, ForgeSceneProps>(function ForgeScene(
  { workpiece, reducedMotion },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hammerRef = useRef<HTMLDivElement>(null);
  const shimmerRef = useRef<HTMLDivElement>(null);
  const flareRef = useRef<HTMLDivElement>(null);
  const snapTintRef = useRef<HTMLDivElement>(null);
  const fxRef = useRef<HTMLDivElement>(null);
  // Last-written values so per-frame class/visibility toggles only touch the DOM on change.
  const wasHotRef = useRef(false);
  const wasChargingRef = useRef(false);

  // Clear any in-flight transient nodes if the scene unmounts mid-burst.
  useEffect(() => {
    const fx = fxRef.current;
    return () => {
      if (fx) fx.innerHTML = '';
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      update(s: ForgeRunState, forecast01: number) {
        const root = rootRef.current;
        if (!root) return;
        const heat = s.phase === 'stoke' ? s.heatBar : Math.max(0, s.heat);
        root.style.setProperty('--forge-heat', heat.toFixed(3));
        root.style.setProperty('--forge-quality', forecast01.toFixed(3));
        root.style.setProperty('--forge-tempo', s.tempo.toFixed(3));
        const hot = heat > 0.4;
        if (hot !== wasHotRef.current) {
          wasHotRef.current = hot;
          if (shimmerRef.current) shimmerRef.current.style.visibility = hot ? 'visible' : 'hidden';
        }
        // Hammer wind-up tremble while a heavy charges (suppressed for quick taps).
        const charging = s.phase === 'strike' && s.charging && s.chargeT > 0.15;
        if (charging !== wasChargingRef.current) {
          wasChargingRef.current = charging;
          hammerRef.current?.classList.toggle('forge-hammer-charging', charging);
        }
      },

      strike(acc: number, weight: number, crit: boolean) {
        // Swing the hammer (CSS one-shot; snap-back eased by the transform transition).
        const hammer = hammerRef.current;
        if (hammer && !reducedMotion) {
          hammer.classList.remove('forge-hammer-charging');
          wasChargingRef.current = false;
          hammer.classList.remove('forge-hammer-swinging');
          // Force a reflow so back-to-back swings restart the animation.
          void hammer.offsetWidth;
          hammer.classList.add('forge-hammer-swinging');
          hammer.addEventListener(
            'animationend',
            () => hammer.classList.remove('forge-hammer-swinging'),
            { once: true },
          );
        }
        const fx = fxRef.current;
        if (!fx || reducedMotion) return;
        const burst = document.createElement('div');
        burst.className = 'pointer-events-none absolute';
        burst.style.left = ANVIL.left;
        burst.style.top = ANVIL.top;
        // Impact ring — heavies ring wider.
        const ring = document.createElement('div');
        const ringSize = weight > 1 ? 64 : 40;
        ring.className = 'absolute rounded-full border-2';
        ring.style.width = ring.style.height = `${ringSize}px`;
        ring.style.borderColor = acc > 0.5 ? 'var(--c-gold-bright, #e6c158)' : '#8a8378';
        ring.style.animation = 'forge-impact-ring 0.45s ease-out forwards';
        burst.appendChild(ring);
        // Sparks — count scales with accuracy; a tempo-dead mash reads as 2 gray chips.
        const n = 2 + Math.round(acc * 8);
        const sparkColor = acc > 0.5 ? 'var(--c-gold-bright, #e6c158)' : '#9a938a';
        for (let i = 0; i < n; i++) {
          const spark = document.createElement('span');
          spark.className = 'absolute h-1 w-1 rounded-full';
          spark.style.background = sparkColor;
          spark.style.setProperty('--a', `${Math.round((360 / n) * i - 80)}deg`);
          spark.style.animation = `forge-spark 0.6s ease-out ${i * 0.02}s forwards`;
          burst.appendChild(spark);
        }
        if (crit) {
          // White-hot flash over the whole scene + four gold stars.
          const flash = document.createElement('div');
          flash.className = 'absolute inset-0 bg-parchment-100';
          flash.style.animation = 'forge-crit-flash 0.3s ease-out forwards';
          fx.appendChild(flash);
          setTimeout(() => flash.remove(), 400);
          for (let i = 0; i < 4; i++) {
            const star = document.createElement('span');
            star.className = 'absolute h-1.5 w-1.5 rotate-45';
            star.style.background = 'var(--c-gold-bright, #e6c158)';
            star.style.setProperty('--a', `${i * 90 + 45}deg`);
            star.style.animation = 'forge-spark 0.75s ease-out forwards';
            burst.appendChild(star);
          }
        }
        fx.appendChild(burst);
        setTimeout(() => burst.remove(), 900);
      },

      eventFx(kind: ForgeEventKind | null) {
        // Ember Surge: the coal bed flares. Cold Snap: a steel-blue chill settles.
        // The static tints stay legible under reduced motion; only the flare loops.
        const flare = flareRef.current;
        const tint = snapTintRef.current;
        if (flare) {
          if (kind === 'ember' && !reducedMotion) {
            flare.style.animation = 'forge-event-flare 1.25s ease-in-out 2';
            flare.addEventListener('animationend', () => (flare.style.animation = ''), { once: true });
          }
          flare.style.opacity = kind === 'ember' ? '0.4' : '0';
        }
        if (tint) tint.style.opacity = kind === 'snap' ? '0.45' : '0';
      },

      quenchFx(acc: number) {
        const fx = fxRef.current;
        if (!fx || reducedMotion) return;
        const at = document.createElement('div');
        at.className = 'pointer-events-none absolute';
        at.style.left = TUB.left;
        at.style.top = TUB.top;
        const ripple = document.createElement('div');
        ripple.className = 'absolute rounded-full border';
        ripple.style.width = '40px';
        ripple.style.height = '14px';
        ripple.style.borderColor = '#6da8c4';
        ripple.style.animation = 'forge-quench-ripple 0.7s ease-out forwards';
        at.appendChild(ripple);
        const puffs = 2 + Math.round(acc * 3);
        for (let i = 0; i < puffs; i++) {
          const puff = document.createElement('span');
          puff.className = 'absolute rounded-full bg-parchment-100/70';
          const size = 6 + i * 3;
          puff.style.width = puff.style.height = `${size}px`;
          puff.style.left = `${(i - puffs / 2) * 9}px`;
          puff.style.top = '-6px';
          puff.style.animation = `forge-steam-rise ${0.9 + i * 0.18}s ease-out ${i * 0.08}s forwards`;
          at.appendChild(puff);
        }
        fx.appendChild(at);
        setTimeout(() => at.remove(), 2200);
      },
    }),
    [reducedMotion],
  );

  const path = WORKPIECE_PATH[workpiece];
  return (
    <div
      ref={rootRef}
      className="forge-scene pointer-events-none relative h-40 w-full overflow-hidden rounded-lg border border-gold-deep/40 shadow-wood"
      style={{ '--forge-heat': 0, '--forge-quality': 0, '--forge-tempo': 0 } as React.CSSProperties}
      aria-hidden="true"
    >
      <SmithyBackdrop />

      {/* Fire glow over the coal bed — opacity IS the heat readout. */}
      <div
        className="forge-fire-glow absolute"
        style={{
          left: '4%',
          top: '30%',
          width: '32%',
          height: '52%',
          background:
            'radial-gradient(closest-side, var(--c-ember-bright, #c97a2e) 0%, rgba(156, 58, 37, 0.55) 45%, transparent 72%)',
          mixBlendMode: 'screen',
          opacity: 'calc(0.08 + var(--forge-heat) * 0.92)',
        }}
      />

      {/* Ember field — the whole layer breathes with the fire. */}
      <div className="forge-ambient absolute inset-0" style={{ opacity: 'var(--forge-heat)' }}>
        {EMBERS.map((e, i) => (
          <span
            key={i}
            className="forge-ember-mote absolute rounded-full"
            style={
              {
                left: e.left,
                bottom: e.bottom,
                width: e.size,
                height: e.size,
                background: i % 3 === 0 ? 'var(--c-gold-bright, #e6c158)' : 'var(--c-ember-bright, #c97a2e)',
                '--dur': e.dur,
                '--delay': e.delay,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Heat shimmer above the coals (visible only while the fire is hot). */}
      <div
        ref={shimmerRef}
        className="forge-shimmer-strip absolute"
        style={{
          left: '8%',
          top: '26%',
          width: '26%',
          height: '14%',
          visibility: 'hidden',
          background: 'linear-gradient(to top, rgba(243, 231, 201, 0.35), transparent)',
          filter: 'blur(2px)',
        }}
      />

      {/* The workpiece on the anvil: dark steel → heat glow → white-hot core → temper line.
          Every overlay is opacity-from-variable, so the piece tells the run's story even
          with all animation frozen. */}
      <div
        className="absolute -translate-x-1/2 -translate-y-full"
        style={{ left: ANVIL.left, top: ANVIL.top, width: '19%' }}
      >
        <svg viewBox="0 0 64 16" className="w-full">
          <path d={path} fill="#1b1410" stroke="#0c0805" strokeWidth="0.6" />
          <path d={path} fill="var(--c-ember-bright, #c97a2e)" style={{ opacity: 'var(--forge-heat)' }} />
          <path d={path} fill="#fff3d6" style={{ opacity: 'calc((var(--forge-heat) - 0.55) * 1.3)' }} />
          <path
            d={path}
            fill="none"
            stroke="var(--c-gold-bright, #e6c158)"
            strokeWidth="1.1"
            style={{ opacity: 'calc(var(--forge-quality) * 0.85)' }}
          />
        </svg>
      </div>

      {/* The smith's hammer, raised over the anvil. Swings via one-shot class. */}
      <div
        ref={hammerRef}
        className="absolute transition-transform duration-300"
        style={{
          left: '66%',
          top: '10%',
          width: '20%',
          transformOrigin: '90% 95%',
          transform: 'rotate(-38deg)',
        }}
      >
        <svg viewBox="0 0 64 40" className="w-full">
          <line x1="58" y1="37" x2="18" y2="10" stroke="#6b4a26" strokeWidth="4.5" strokeLinecap="round" />
          <rect x="2" y="2" width="26" height="15" rx="3" fill="#3d3833" stroke="#57504a" strokeWidth="1.5" transform="rotate(34 15 9)" />
        </svg>
      </div>

      {/* Ember Surge flare over the hearth. */}
      <div
        ref={flareRef}
        className="absolute"
        style={{
          left: '2%',
          top: '20%',
          width: '36%',
          height: '65%',
          background: 'radial-gradient(closest-side, #fff3d6 0%, var(--c-gold-bright, #e6c158) 35%, transparent 70%)',
          mixBlendMode: 'screen',
          opacity: 0,
          transition: 'opacity 0.4s',
        }}
      />
      {/* Cold Snap chill tint over the whole scene. */}
      <div
        ref={snapTintRef}
        className="absolute inset-0"
        style={{ background: '#39597a', mixBlendMode: 'soft-light', opacity: 0, transition: 'opacity 0.4s' }}
      />

      {/* Transient FX layer (rings, sparks, steam) — children self-remove. */}
      <div ref={fxRef} className="absolute inset-0" />
    </div>
  );
});
