// Rooftop Chase trial — AG.
// Side-view endless runner over a medieval town skyline.
// Space / ArrowUp / Jump button → jump (double-jump allowed midair).
// ArrowDown / S / Slide button → slide under lowbar banners.

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
  DOUBLE_JUMP_VELOCITY,
  MAX_JUMPS,
  STUMBLE_MS,
  SLIDE_MS,
  LEAD_START,
  LEAD_MAX,
  STOMP_BOUNCE_VELOCITY,
  type RoofFeature,
} from '@/engine/trials/rooftopChase';

interface RooftopChaseProps {
  onFinish: (score01: number) => void;
}

// ── Display constants ──────────────────────────────────────────────────────────

const VIEW_W = 320;
const VIEW_H = 200;
/** Roof surface Y from top of play area (more sky = more visible jump arc). */
const ROOF_PX = 148;
/** Pixels below the roof surface (parapet / lower-wall area). */
const PARAPET_H = VIEW_H - ROOF_PX;
/** Pixel scale: 1 world-unit = 7 px. */
const PX_PER_WU = 7;
/** Hero's fixed screen X (world scrolls past). */
const HERO_X_PX = 72;
/**
 * Hero hitbox width in world-units.
 * Slightly narrower than the visual sprite for fairness.
 * Collision: hero left edge is at world x = distance,
 *            right edge is at world x = distance + HERO_W_WU.
 */
const HERO_W_WU = 2.2;

// ── Parallax layer constants ──────────────────────────────────────────────────

/** Far castle silhouette scrolls 6% of hero speed. */
const FAR_FACTOR = 0.06;
/** Mid rooftop ridgeline scrolls 22% of hero speed. */
const MID_FACTOR = 0.22;
/** Foreground roof-decor (chimneys etc.) scrolls 1.4× — faster than features, depth cue. */
const DECOR_FACTOR = 1.4;

/** Castle-skyline tile width (px). Tiles repeat for seamless loop. */
const FAR_TILE_W = 480;
/** Mid-rooftop tile width (px). */
const MID_TILE_W = 320;
/** Foreground decor tile width (px). */
const DECOR_TILE_W = 240;

// ── Procedural art data ───────────────────────────────────────────────────────

/** Silhouetted castle towers within the FAR_TILE_W strip [x, width, height, hasCren]. */
const CASTLE_TOWERS: ReadonlyArray<[number, number, number, boolean]> = [
  [0,   18, 62, true],
  [36,  12, 45, false],
  [62,  22, 75, true],
  [110, 16, 52, true],
  [150, 28, 90, true],   // the keep — tallest
  [200, 14, 48, false],
  [228, 20, 68, true],
  [270, 12, 40, false],
  [300, 18, 58, true],
  [340, 24, 72, true],
  [390, 14, 46, false],
  [420, 20, 65, true],
  [456, 16, 52, false],
];

/** Pitched-roof building shapes within MID_TILE_W [x, w, h]. */
const MID_BUILDINGS: ReadonlyArray<[number, number, number]> = [
  [0,   38, 44],
  [40,  26, 34],
  [68,  48, 54],
  [120, 32, 40],
  [156, 42, 50],
  [202, 28, 36],
  [234, 44, 48],
  [282, 36, 42],
];

/** Chimney positions within DECOR_TILE_W [x, baseW, capW, h]. */
const CHIMNEYS: ReadonlyArray<[number, number, number, number]> = [
  [18,  8, 12, 28],
  [60,  6, 10, 22],
  [100, 8, 12, 32],
  [150, 6, 10, 24],
  [190, 8, 12, 28],
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function HeroSprite({
  airborne,
  sliding,
  stumbling,
  landing,
}: {
  airborne: boolean;
  sliding: boolean;
  stumbling: boolean;
  landing: boolean;
}) {
  const opacity = stumbling ? 0.35 : 1;

  if (sliding) {
    // Flat crouch — head forward, body low
    return (
      <div style={{ width: 34, height: 18, position: 'relative', opacity }}>
        {/* Cloak swept back */}
        <div style={{
          position: 'absolute', bottom: 2, left: 0, width: 28, height: 12,
          background: 'linear-gradient(90deg, #2d1b5e, #4a2890)',
          borderRadius: '6px 2px 2px 8px',
        }} />
        {/* Body */}
        <div style={{
          position: 'absolute', bottom: 3, left: 4, width: 22, height: 10,
          backgroundColor: '#c85a2a',
          borderRadius: '3px 2px 2px 3px',
        }} />
        {/* Head forward */}
        <div style={{
          position: 'absolute', bottom: 5, right: 0, width: 12, height: 12,
          backgroundColor: '#e0b070',
          borderRadius: '50% 50% 40% 40%',
        }} />
        {/* Helmet */}
        <div style={{
          position: 'absolute', bottom: 12, right: 0, width: 14, height: 7,
          backgroundColor: '#9a7530',
          borderRadius: '3px 3px 0 0',
          borderBottom: '2px solid #7a5520',
        }} />
        {/* Legs swept back */}
        <div style={{ position: 'absolute', bottom: 0, left: 6, width: 5, height: 5, backgroundColor: '#5a3520', borderRadius: '0 0 3px 3px' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 13, width: 5, height: 5, backgroundColor: '#4a2810', borderRadius: '0 0 3px 3px' }} />
      </div>
    );
  }

  const runAnim = airborne ? undefined : 'rooftop-run 0.32s linear infinite';
  const landAnim = landing ? 'rooftop-land 0.18s ease-out forwards' : undefined;
  const bodyAnim = landAnim ?? runAnim;

  return (
    <div style={{
      width: 24, height: 38, position: 'relative', opacity,
      animation: bodyAnim,
    }}>
      {/* Cloak (behind, sweeps in wind) */}
      <div style={{
        position: 'absolute', bottom: 10, left: 0, width: 22, height: 22,
        background: 'linear-gradient(135deg, #2d1b5e 60%, #4a2890)',
        borderRadius: '2px 2px 10px 8px',
        animation: airborne ? undefined : 'rooftop-cloak 0.32s linear infinite',
      }} />
      {/* Torso / tabard */}
      <div style={{
        position: 'absolute', bottom: 14, left: 4, width: 16, height: 16,
        backgroundColor: '#c85a2a',
        borderRadius: '2px',
      }} />
      {/* Belt */}
      <div style={{
        position: 'absolute', bottom: 14, left: 4, width: 16, height: 3,
        backgroundColor: '#7a5020',
      }} />
      {/* Head */}
      <div style={{
        position: 'absolute', bottom: 28, left: 5, width: 14, height: 13,
        backgroundColor: '#e0b070',
        borderRadius: '50% 50% 40% 40%',
      }} />
      {/* Helmet */}
      <div style={{
        position: 'absolute', bottom: 36, left: 4, width: 16, height: 8,
        backgroundColor: '#9a7530',
        borderRadius: '3px 3px 0 0',
        borderBottom: '2px solid #7a5520',
      }} />
      {/* Helmet nasal guard */}
      <div style={{
        position: 'absolute', bottom: 32, left: 10, width: 4, height: 6,
        backgroundColor: '#7a5520',
      }} />
      {/* Front leg */}
      <div style={{
        position: 'absolute', bottom: 0, left: 6, width: 6, height: 16,
        backgroundColor: '#5a3520',
        borderRadius: '0 0 3px 3px',
        transformOrigin: 'top center',
        animation: airborne ? undefined : 'rooftop-leg-f 0.32s linear infinite',
        transform: airborne ? 'rotate(15deg)' : undefined,
      }} />
      {/* Back leg */}
      <div style={{
        position: 'absolute', bottom: 0, left: 13, width: 6, height: 16,
        backgroundColor: '#4a2510',
        borderRadius: '0 0 3px 3px',
        transformOrigin: 'top center',
        animation: airborne ? undefined : 'rooftop-leg-b 0.32s linear infinite',
        transform: airborne ? 'rotate(-15deg)' : undefined,
      }} />
      {/* Boots */}
      <div style={{ position: 'absolute', bottom: 0, left: 4, width: 8, height: 5, backgroundColor: '#3a1a08', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 13, width: 8, height: 5, backgroundColor: '#2a1008', borderRadius: '0 0 3px 3px' }} />
      {/* Forward lean when airborne */}
      {airborne && (
        <div style={{
          position: 'absolute', bottom: 10, right: -4, width: 10, height: 3,
          backgroundColor: '#c85a2a',
          borderRadius: '2px',
          transform: 'rotate(-20deg)',
        }} />
      )}
    </div>
  );
}

function ChaserSprite({ danger }: { danger: boolean }) {
  const eyeGlow = danger ? '0 0 8px #ff2200' : '0 0 4px #cc4400';
  const eyeColor = danger ? '#ff3300' : '#cc5500';
  return (
    <div style={{ width: 38, height: 30, position: 'relative', animation: 'rooftop-chaser 0.28s linear infinite' }}>
      {/* Body — low elongated beast */}
      <div style={{
        position: 'absolute', bottom: 10, left: 0, width: 30, height: 16,
        background: 'linear-gradient(90deg, #100808, #1e1010)',
        borderRadius: '8px 3px 3px 8px',
      }} />
      {/* Hump / scruff */}
      <div style={{
        position: 'absolute', bottom: 22, left: 6, width: 16, height: 10,
        backgroundColor: '#1a0c0c',
        borderRadius: '50%',
      }} />
      {/* Head (right side, forward) */}
      <div style={{
        position: 'absolute', bottom: 14, right: 0, width: 18, height: 15,
        backgroundColor: '#1e1010',
        borderRadius: '40% 50% 40% 30%',
      }} />
      {/* Snout */}
      <div style={{
        position: 'absolute', bottom: 12, right: 0, width: 10, height: 8,
        backgroundColor: '#241414',
        borderRadius: '30% 50% 50% 20%',
      }} />
      {/* Teeth */}
      <div style={{ position: 'absolute', bottom: 12, right: 1, width: 3, height: 4, backgroundColor: '#e8e0d0', borderRadius: '0 0 2px 1px' }} />
      <div style={{ position: 'absolute', bottom: 12, right: 5, width: 2, height: 3, backgroundColor: '#e8e0d0', borderRadius: '0 0 2px 1px' }} />
      {/* Ears */}
      <div style={{ position: 'absolute', bottom: 26, right: 3, width: 6, height: 9, backgroundColor: '#1e1010', clipPath: 'polygon(50% 0%,100% 100%,0% 100%)' }} />
      <div style={{ position: 'absolute', bottom: 26, right: 10, width: 5, height: 7, backgroundColor: '#1e1010', clipPath: 'polygon(50% 0%,100% 100%,0% 100%)' }} />
      {/* Glowing eye */}
      <div style={{
        position: 'absolute', bottom: 20, right: 4, width: 6, height: 6,
        backgroundColor: eyeColor,
        borderRadius: '50%',
        boxShadow: eyeGlow,
      }} />
      {/* Tail */}
      <div style={{
        position: 'absolute', bottom: 16, left: 2, width: 10, height: 4,
        backgroundColor: '#1a0c0c',
        borderRadius: '0 2px 2px 0',
        transform: 'rotate(-20deg)',
        transformOrigin: 'right center',
      }} />
      {/* Front legs */}
      <div style={{ position: 'absolute', bottom: 0, right: 4, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-f 0.28s linear infinite' }} />
      <div style={{ position: 'absolute', bottom: 0, right: 10, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-b 0.28s linear infinite' }} />
      {/* Back legs */}
      <div style={{ position: 'absolute', bottom: 0, left: 6, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-b 0.28s linear infinite' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 12, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-f 0.28s linear infinite' }} />
    </div>
  );
}

/** A medieval chimney/crate hazard obstacle. */
function HazardSprite({ widthPx }: { widthPx: number }) {
  const cx = Math.floor(widthPx / 2);
  return (
    <div style={{ width: widthPx, height: 40, position: 'relative' }}>
      {/* Main chimney shaft */}
      <div style={{
        position: 'absolute', bottom: 0, left: cx - 7, width: 14, height: 36,
        background: 'linear-gradient(180deg, #9a7050, #6a4830)',
        border: '1px solid #4a2820',
        borderRadius: '2px 2px 0 0',
      }} />
      {/* Chimney cap (wider) */}
      <div style={{
        position: 'absolute', bottom: 34, left: cx - 10, width: 20, height: 7,
        background: 'linear-gradient(180deg, #b08060, #8a6040)',
        border: '1px solid #5a3020',
        borderRadius: '2px 2px 0 0',
      }} />
      {/* Smoke wisps */}
      <div style={{
        position: 'absolute', bottom: 40, left: cx - 3, width: 6, height: 6,
        backgroundColor: 'rgba(200,190,180,0.4)',
        borderRadius: '50%',
      }} />
      {/* Stone brick texture lines */}
      <div style={{ position: 'absolute', bottom: 10, left: cx - 7, width: 14, height: 1, backgroundColor: '#5a3820', opacity: 0.6 }} />
      <div style={{ position: 'absolute', bottom: 20, left: cx - 7, width: 14, height: 1, backgroundColor: '#5a3820', opacity: 0.6 }} />
    </div>
  );
}

/** An armoured guard (mook) obstacle. Can be stomped. */
function MookSprite() {
  return (
    <div style={{ width: 26, height: 42, position: 'relative' }}>
      {/* Spear shaft */}
      <div style={{
        position: 'absolute', bottom: 0, right: 3, width: 2, height: 42,
        backgroundColor: '#8a6040',
      }} />
      {/* Spear tip */}
      <div style={{
        position: 'absolute', bottom: 40, right: 2, width: 4, height: 8,
        backgroundColor: '#d0c080',
        clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
      }} />
      {/* Legs */}
      <div style={{ position: 'absolute', bottom: 0, left: 4, width: 6, height: 16, backgroundColor: '#5a6878', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 12, width: 6, height: 16, backgroundColor: '#4a5868', borderRadius: '0 0 3px 3px' }} />
      {/* Boots */}
      <div style={{ position: 'absolute', bottom: 0, left: 2, width: 9, height: 5, backgroundColor: '#302018', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 10, width: 9, height: 5, backgroundColor: '#201808', borderRadius: '0 0 3px 3px' }} />
      {/* Plate armour torso */}
      <div style={{
        position: 'absolute', bottom: 14, left: 2, width: 18, height: 16,
        background: 'linear-gradient(180deg, #8090a8, #60708a)',
        border: '1px solid #405060',
        borderRadius: '2px 2px 0 0',
      }} />
      {/* Neck */}
      <div style={{ position: 'absolute', bottom: 28, left: 8, width: 8, height: 4, backgroundColor: '#a0b0c0' }} />
      {/* Helmet */}
      <div style={{
        position: 'absolute', bottom: 30, left: 3, width: 18, height: 13,
        background: 'linear-gradient(180deg, #90a0b8, #708098)',
        border: '1px solid #405060',
        borderRadius: '3px 3px 0 0',
      }} />
      {/* Visor slit */}
      <div style={{ position: 'absolute', bottom: 34, left: 6, width: 12, height: 3, backgroundColor: '#202830', borderRadius: '1px' }} />
      {/* Eyes glowing through visor */}
      <div style={{ position: 'absolute', bottom: 34, left: 7, width: 3, height: 2, backgroundColor: '#ff6040', borderRadius: '50%', opacity: 0.9 }} />
      <div style={{ position: 'absolute', bottom: 34, left: 14, width: 3, height: 2, backgroundColor: '#ff6040', borderRadius: '50%', opacity: 0.9 }} />
      {/* Crest on helmet */}
      <div style={{ position: 'absolute', bottom: 42, left: 8, width: 8, height: 5, backgroundColor: '#c02020', borderRadius: '2px 2px 0 0' }} />
    </div>
  );
}

/** A lowbar banner/rope strung at head height — must slide under. */
function LowbarSprite({ widthPx }: { widthPx: number }) {
  // Banner hangs at 30px above roof (just above hero head height)
  const ROPE_Y = 30;
  return (
    <div style={{ width: widthPx, height: 48, position: 'relative', bottom: 0 }}>
      {/* Left pole */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, width: 5, height: ROPE_Y + 10,
        background: 'linear-gradient(180deg, #8a6040, #6a4820)',
        borderRadius: '2px 2px 0 0',
      }} />
      {/* Right pole */}
      <div style={{
        position: 'absolute', bottom: 0, right: 0, width: 5, height: ROPE_Y + 10,
        background: 'linear-gradient(180deg, #8a6040, #6a4820)',
        borderRadius: '2px 2px 0 0',
      }} />
      {/* Rope */}
      <div style={{
        position: 'absolute', bottom: ROPE_Y, left: 0, right: 0, height: 3,
        background: 'linear-gradient(90deg, #c8a040, #e8c060, #c8a040)',
        boxShadow: '0 0 5px rgba(200,160,60,0.6)',
      }} />
      {/* Cloth banner */}
      <div style={{
        position: 'absolute', bottom: ROPE_Y - 12, left: '8%', right: '8%', height: 13,
        backgroundColor: '#a01818',
        borderRadius: '0 0 3px 3px',
        animation: 'rooftop-banner 1.6s ease-in-out infinite',
        transformOrigin: 'top center',
      }} />
      {/* Warning symbol on banner */}
      <div style={{
        position: 'absolute', bottom: ROPE_Y - 10, left: 0, right: 0,
        textAlign: 'center',
        fontSize: 8,
        color: 'rgba(255,230,180,0.9)',
        lineHeight: 1,
        pointerEvents: 'none',
      }}>
        ⚠
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function RooftopChase({ onFinish }: RooftopChaseProps) {
  // ── Stable feature list ──────────────────────────────────────────────────
  const featuresRef = useRef<RoofFeature[]>(generateFeatures(Math.random));

  // ── Physics refs (written & read inside RAF only) ────────────────────────
  const heroYRef     = useRef(0);   // world-units above roof (0 = grounded)
  const heroVyRef    = useRef(0);   // world-units/sec (+up, -down)
  const distanceRef  = useRef(0);   // world-units traveled
  const leadRef      = useRef(LEAD_START);
  const stumbleUntilRef = useRef(0);    // perf.now() ms when stumble ends
  const slidingUntilRef = useRef(0);    // perf.now() ms when slide ends
  const jumpsUsedRef = useRef(0);       // jumps used since last landing
  const prevHeroYRef = useRef(0);       // y last frame (to detect landing)
  const activeContactRef = useRef<number | null>(null);
  const doneRef      = useRef(false);
  const rafRef       = useRef<number | null>(null);
  const lastTsRef    = useRef<number | null>(null);
  const landingTsRef = useRef(0);       // ts of most recent landing (for squash anim)

  // ── Render state ─────────────────────────────────────────────────────────
  const [heroYPx, setHeroYPx]           = useState(0);
  const [distance, setDistance]         = useState(0);
  const [lead, setLead]                 = useState(LEAD_START);
  const [stumbling, setStumbling]       = useState(false);
  const [sliding, setSliding]           = useState(false);
  const [airborne, setAirborne]         = useState(false);
  const [landing, setLanding]           = useState(false);
  const [visibleFeatures, setVisibleFeatures] = useState<RoofFeature[]>([]);
  const [stompedId, setStompedId]       = useState<number | null>(null);
  const [stompFlashEnd, setStompFlashEnd] = useState(0);
  const [dustPuffs, setDustPuffs]       = useState<number[]>([]);

  // ── Finish ───────────────────────────────────────────────────────────────
  const finish = useCallback((dist: number) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onFinish(chaseScore(dist));
  }, [onFinish]);

  // ── RAF loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = (ts: number) => {
      if (doneRef.current) return;
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.05);
      lastTsRef.current = ts;

      const prevY = prevHeroYRef.current;

      // 1. Advance distance
      const dist = distanceRef.current;
      const newDist = dist + speedAt(dist) * dt;
      distanceRef.current = newDist;

      // 2. Hero vertical physics
      let vy = heroVyRef.current - GRAVITY * dt;
      let y  = heroYRef.current + vy * dt;
      if (y <= 0) {
        const justLanded = prevY > 0;
        if (justLanded) {
          // Reset double-jump counter on land
          jumpsUsedRef.current = 0;
          landingTsRef.current = ts;
          setDustPuffs((ps) => [...ps.slice(-3), ts]);
          setLanding(true);
          setTimeout(() => setLanding(false), 200);
        }
        y = 0;
        vy = 0;
      }
      heroYRef.current    = y;
      heroVyRef.current   = vy;
      prevHeroYRef.current = y;

      // 3. Sliding state
      const nowSliding = ts < slidingUntilRef.current && y <= 0;

      // 4. Visible features for rendering
      const features = featuresRef.current;
      const viewEnd   = newDist + VIEW_W / PX_PER_WU + 6;
      const viewStart = newDist - 4;
      const visible = features.filter((f) => f.x + f.width >= viewStart && f.x <= viewEnd);

      // 5. Collision: hero hitbox spans world x [newDist, newDist + HERO_W_WU]
      //    Feature spans [f.x, f.x + f.width].  Overlap iff both ranges intersect.
      const overlapping = visible.find(
        (f) => newDist < f.x + f.width && newDist + HERO_W_WU > f.x,
      );

      let leadEvent: 'stumble' | 'stomp' | undefined;

      if (overlapping && overlapping.id !== activeContactRef.current) {
        const result = resolveContact(y, vy, nowSliding, overlapping);
        activeContactRef.current = overlapping.id;

        if (result === 'stomp') {
          heroVyRef.current = STOMP_BOUNCE_VELOCITY;
          jumpsUsedRef.current = 0; // stomp resets jump count
          leadEvent = 'stomp';
          setStompedId(overlapping.id);
          setStompFlashEnd(ts + 500);
        } else if (result === 'stumble') {
          stumbleUntilRef.current = ts + STUMBLE_MS;
          leadEvent = 'stumble';
        }
      } else if (!overlapping) {
        activeContactRef.current = null;
      }

      // 6. Lead update
      const newLead = updateLead(leadRef.current, dt, leadEvent);
      leadRef.current = newLead;

      // 7. End conditions
      if (newLead <= 0 || newDist >= CHASE_TARGET_DISTANCE) {
        setDistance(newDist);
        setLead(newLead);
        finish(newDist);
        return;
      }

      // 8. Push render state
      setHeroYPx(Math.round(y * PX_PER_WU));
      setDistance(newDist);
      setLead(newLead);
      setStumbling(ts < stumbleUntilRef.current);
      setSliding(nowSliding);
      setAirborne(y > 0);
      setVisibleFeatures(visible);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [finish]);

  // ── Jump ──────────────────────────────────────────────────────────────────
  const jump = useCallback(() => {
    if (doneRef.current) return;
    const nowStumbling = performance.now() < stumbleUntilRef.current;
    const nowSliding   = performance.now() < slidingUntilRef.current;
    if (nowStumbling || nowSliding) return;

    const grounded = heroYRef.current <= 0;
    if (grounded) {
      heroVyRef.current  = JUMP_VELOCITY;
      jumpsUsedRef.current = 1;
    } else if (jumpsUsedRef.current < MAX_JUMPS) {
      heroVyRef.current  = DOUBLE_JUMP_VELOCITY;
      jumpsUsedRef.current++;
      // Spawn extra dust mid-air to signal the double-jump
      setDustPuffs((ps) => [...ps.slice(-3), performance.now()]);
    }
  }, []);

  // ── Slide ─────────────────────────────────────────────────────────────────
  const slide = useCallback(() => {
    if (doneRef.current) return;
    const grounded     = heroYRef.current <= 0;
    const nowStumbling = performance.now() < stumbleUntilRef.current;
    if (!grounded || nowStumbling) return;
    slidingUntilRef.current = performance.now() + SLIDE_MS;
  }, []);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp')   { e.preventDefault(); jump(); }
      if (e.code === 'ArrowDown' || e.code === 'KeyS')  { e.preventDefault(); slide(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [jump, slide]);

  // ── Derived display values ────────────────────────────────────────────────
  const leadFrac  = lead / LEAD_MAX;
  const leadColor = leadFrac > 0.5 ? '#4ade80' : leadFrac > 0.25 ? '#fbbf24' : '#f87171';
  const leadLabel = leadFrac > 0.6 ? 'Safe' : leadFrac > 0.3 ? 'Close!' : '⚠ Danger!';
  const scorePct  = Math.round(chaseScore(distance) * 100);

  // Chaser screen X: lives behind hero, encroaches as lead shrinks
  const chaserXPx = HERO_X_PX - 50 - (1 - leadFrac) * 28;
  const chaserDanger = leadFrac < 0.3;

  const showStompFlash = stompedId !== null && performance.now() < stompFlashEnd;

  // Speed at current distance — drives visual intensity
  const curSpeed     = speedAt(distance);
  const speedFrac    = (curSpeed - 6) / (22 - 6); // 0 at BASE_SPEED, 1 at MAX_SPEED
  const streakCount  = Math.floor(speedFrac * 7);
  const streakOpacity = 0.15 + speedFrac * 0.55;

  // Parallax scroll offsets (px)
  const farScrollPx   = distance * FAR_FACTOR   * PX_PER_WU;
  const midScrollPx   = distance * MID_FACTOR   * PX_PER_WU;
  const decorScrollPx = distance * DECOR_FACTOR * PX_PER_WU;

  // Sky gradient bottom (warmer/darker as you speed up — dusk feel)
  const skyBottom = `hsl(${220 - speedFrac * 40}, 55%, ${20 - speedFrac * 6}%)`;

  return (
    <div className="flex flex-col items-center gap-3 px-2">
      <p className="text-center text-xs text-ink-muted">
        <strong className="text-ink">Jump</strong> (Space / ↑) to leap &amp; double-jump ·{' '}
        <strong className="text-ink">Slide</strong> (↓ / S) to duck under banners
      </p>

      {/* ── Play area ─────────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-lg border-2 border-gold-deep/50 select-none cursor-pointer"
        style={{ width: VIEW_W, height: VIEW_H }}
        onClick={jump}
        role="button"
        aria-label="Jump"
      >
        {/* ── Layer 0: Sky gradient ──────────────────────────────────────── */}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to bottom, #0d0820 0%, #1a0a3a 35%, #3d1260 65%, ${skyBottom} 100%)`,
          }}
        />

        {/* Moon */}
        <div className="absolute" style={{
          top: 12, right: 40 + Math.sin(distance * 0.01) * 4, width: 18, height: 18,
          backgroundColor: '#f8f0d0',
          borderRadius: '50%',
          boxShadow: '0 0 16px 6px rgba(248,240,200,0.25)',
        }} />

        {/* ── Layer 1: Far castle silhouette ─────────────────────────────── */}
        {/* Two tile-width copies, translated for seamless loop */}
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="absolute"
            style={{
              bottom: PARAPET_H,
              left: -(farScrollPx % FAR_TILE_W) + copy * FAR_TILE_W,
              width: FAR_TILE_W,
              height: 92,
            }}
          >
            {CASTLE_TOWERS.map(([tx, tw, th, cren], i) => (
              <div key={i}>
                {/* Tower body */}
                <div style={{
                  position: 'absolute', bottom: 0, left: tx, width: tw, height: th,
                  backgroundColor: '#160a2a',
                }} />
                {/* Crenellations (battlements) */}
                {cren && ([0, 1, 2] as const).map((ci) => (
                  <div key={ci} style={{
                    position: 'absolute',
                    bottom: th,
                    left: tx + Math.floor(tw / 4) * (ci + 0) + ci * 2,
                    width: Math.max(3, Math.floor(tw / 5)),
                    height: 6,
                    backgroundColor: '#160a2a',
                  }} />
                ))}
                {/* Narrow window slit */}
                <div style={{
                  position: 'absolute',
                  bottom: Math.floor(th * 0.35),
                  left: tx + Math.floor(tw / 2) - 2,
                  width: 3,
                  height: 7,
                  backgroundColor: 'rgba(80,40,120,0.7)',
                }} />
              </div>
            ))}
          </div>
        ))}

        {/* ── Layer 2: Mid rooftop ridgeline ─────────────────────────────── */}
        {[0, 1, 2].map((copy) => (
          <div
            key={copy}
            className="absolute"
            style={{
              bottom: PARAPET_H,
              left: -(midScrollPx % MID_TILE_W) + copy * MID_TILE_W,
              width: MID_TILE_W,
              height: 60,
            }}
          >
            {MID_BUILDINGS.map(([bx, bw, bh], i) => (
              <div key={i}>
                {/* Building body */}
                <div style={{
                  position: 'absolute', bottom: 0, left: bx, width: bw, height: bh,
                  background: 'linear-gradient(180deg, #2a1a40, #1e1230)',
                }} />
                {/* Pitched roof (triangle via borders) */}
                <div style={{
                  position: 'absolute',
                  bottom: bh - 1,
                  left: bx - 2,
                  width: 0,
                  height: 0,
                  borderLeft: `${bw / 2 + 2}px solid transparent`,
                  borderRight: `${bw / 2 + 2}px solid transparent`,
                  borderBottom: `${Math.floor(bh * 0.3)}px solid #201530`,
                }} />
              </div>
            ))}
          </div>
        ))}

        {/* ── Layer 3: Foreground roof surface ───────────────────────────── */}
        {/* Main roof strip */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: ROOF_PX,
            height: PARAPET_H,
            background: 'linear-gradient(180deg, #5a3a20, #4a2e18 60%, #3a2210)',
          }}
        />
        {/* Shingle pattern (repeating gradient) */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: ROOF_PX,
            height: 8,
            backgroundImage: 'repeating-linear-gradient(90deg, #6a4228 0px, #6a4228 14px, #5a3220 14px, #5a3220 16px)',
            backgroundPositionX: `${-(decorScrollPx % 16)}px`,
            opacity: 0.7,
          }}
        />
        {/* Roof ridge highlight */}
        <div
          className="absolute left-0 right-0"
          style={{ top: ROOF_PX, height: 2, backgroundColor: '#8a5a30', opacity: 0.5 }}
        />
        {/* Stone parapet facing */}
        <div
          className="absolute left-0 right-0"
          style={{
            top: ROOF_PX,
            height: 4,
            backgroundImage: 'repeating-linear-gradient(90deg, #7a5030 0px, #7a5030 18px, #6a4020 18px, #6a4020 20px)',
          }}
        />

        {/* ── Layer 4: Foreground decor — chimneys & crenellations ───────── */}
        {[0, 1, 2].map((copy) => (
          <div
            key={copy}
            className="absolute"
            style={{
              bottom: PARAPET_H,
              left: -(decorScrollPx % DECOR_TILE_W) + copy * DECOR_TILE_W,
              width: DECOR_TILE_W,
              height: 40,
            }}
          >
            {CHIMNEYS.map(([cx, bw, cw, ch], i) => (
              <div key={i} style={{ position: 'absolute', bottom: 0, left: cx }}>
                {/* Shaft */}
                <div style={{
                  position: 'absolute', bottom: 0, left: Math.floor((cw - bw) / 2), width: bw, height: ch,
                  background: 'linear-gradient(180deg, #7a5030, #5a3820)',
                  borderLeft: '1px solid #4a2818',
                  borderRight: '1px solid #4a2818',
                }} />
                {/* Cap */}
                <div style={{
                  position: 'absolute', bottom: ch - 1, left: 0, width: cw, height: 5,
                  backgroundColor: '#8a6040',
                  borderTop: '1px solid #a07050',
                }} />
              </div>
            ))}
            {/* Parapet crenellations (merlons) */}
            {[10, 50, 90, 130, 170, 210].map((px, i) => (
              <div key={i} style={{
                position: 'absolute', bottom: 0, left: px, width: 10, height: 12,
                backgroundColor: '#6a4228',
                borderTop: '1px solid #8a5838',
              }} />
            ))}
          </div>
        ))}

        {/* ── Layer 5: Speed lines ───────────────────────────────────────── */}
        {streakCount > 0 && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {Array.from({ length: streakCount }, (_, i) => {
              const yFrac = 0.12 + (i / streakCount) * 0.72;
              const lenPx = 20 + i * 8;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    top: `${yFrac * 100}%`,
                    left: HERO_X_PX - lenPx,
                    width: lenPx,
                    height: 1,
                    background: `linear-gradient(to left, rgba(180,160,255,${streakOpacity}), transparent)`,
                    transformOrigin: 'right center',
                    animation: `rooftop-streak ${0.12 + i * 0.03}s linear infinite`,
                    animationDelay: `${i * 0.04}s`,
                  }}
                />
              );
            })}
          </div>
        )}

        {/* ── Layer 6: Gap cutouts ──────────────────────────────────────── */}
        {visibleFeatures.filter((f) => f.kind === 'gap').map((f) => {
          const leftPx = (f.x - distance) * PX_PER_WU + HERO_X_PX;
          return (
            <div key={f.id}>
              {/* Sky showing through gap */}
              <div className="absolute" style={{
                left: leftPx, width: f.width * PX_PER_WU,
                top: ROOF_PX, height: PARAPET_H,
                background: 'linear-gradient(to bottom, #160a2a, #0d0518)',
              }} />
              {/* Left eave */}
              <div className="absolute" style={{
                left: leftPx - 4, top: ROOF_PX, width: 4, height: 6,
                backgroundColor: '#7a5030',
                borderRadius: '0 0 0 2px',
              }} />
              {/* Right eave */}
              <div className="absolute" style={{
                left: leftPx + f.width * PX_PER_WU, top: ROOF_PX, width: 4, height: 6,
                backgroundColor: '#7a5030',
                borderRadius: '0 0 2px 0',
              }} />
            </div>
          );
        })}

        {/* ── Layer 7: Obstacles ────────────────────────────────────────── */}
        {visibleFeatures.filter((f) => f.kind !== 'gap').map((f) => {
          const leftPx = (f.x - distance) * PX_PER_WU + HERO_X_PX;
          const isStomped = f.id === stompedId && showStompFlash;
          const widthPx = Math.max(f.width * PX_PER_WU, 24);
          return (
            <div
              key={f.id}
              className="absolute"
              style={{
                left: leftPx,
                bottom: PARAPET_H,
                opacity: isStomped ? 0.15 : 1,
              }}
            >
              {f.kind === 'hazard' && <HazardSprite widthPx={widthPx} />}
              {f.kind === 'mook'   && <MookSprite />}
              {f.kind === 'lowbar' && <LowbarSprite widthPx={widthPx} />}
            </div>
          );
        })}

        {/* ── Layer 8: Dust puffs ──────────────────────────────────────── */}
        {dustPuffs.map((ts) => (
          <div
            key={ts}
            className="absolute pointer-events-none"
            style={{
              left: HERO_X_PX + 12,
              bottom: PARAPET_H,
              width: 18,
              height: 10,
              borderRadius: '50%',
              backgroundColor: 'rgba(180,140,90,0.55)',
              animation: 'rooftop-dust 0.5s ease-out forwards',
            }}
            onAnimationEnd={() => setDustPuffs((ps) => ps.filter((t) => t !== ts))}
          />
        ))}

        {/* ── Layer 9: Chaser ──────────────────────────────────────────── */}
        <div
          className="absolute"
          style={{
            left: Math.max(-42, chaserXPx),
            bottom: PARAPET_H,
          }}
        >
          <ChaserSprite danger={chaserDanger} />
        </div>

        {/* ── Layer 10: Hero ───────────────────────────────────────────── */}
        <div
          className="absolute"
          style={{
            left: HERO_X_PX,
            bottom: PARAPET_H,
            transform: `translateY(${-heroYPx}px)`,
          }}
        >
          <HeroSprite
            airborne={airborne}
            sliding={sliding}
            stumbling={stumbling}
            landing={landing}
          />
        </div>

        {/* ── Stomp flash ──────────────────────────────────────────────── */}
        {showStompFlash && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 font-display text-xs font-black text-gold-bright bg-gold-bright/20 px-2 py-0.5 rounded whitespace-nowrap pointer-events-none">
            STOMP! ⚔
          </div>
        )}

        {/* ── Slide indicator ──────────────────────────────────────────── */}
        {sliding && (
          <div className="absolute top-2 left-2 font-display text-[10px] font-bold text-sky-300/90 pointer-events-none">
            SLIDING
          </div>
        )}

        {/* ── HUD ──────────────────────────────────────────────────────── */}
        <div className="absolute top-2 right-2 font-display text-[10px] font-bold text-parchment-100/70">
          {Math.round(distance)}/{CHASE_TARGET_DISTANCE}m
        </div>
        <div
          className="absolute bottom-1 right-2 font-display text-[9px] font-bold"
          style={{ color: `rgba(180,160,255,${0.3 + speedFrac * 0.5})` }}
        >
          {speedFrac > 0.15 ? `${Math.round(curSpeed * 10) / 10} wu/s` : ''}
        </div>
      </div>

      {/* ── Chaser lead meter ──────────────────────────────────────────────── */}
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

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className="flex w-full max-w-xs items-center gap-3">
        <div className="text-center font-display text-xs text-ink-muted">
          Score: <strong className="text-gold-deep">{scorePct}%</strong>
        </div>
        <button
          onClick={jump}
          className="flex-1 select-none rounded-lg border-2 border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep py-3 font-display text-sm font-black text-wood-900 shadow-gold transition-transform active:scale-95"
        >
          ↑ Jump
        </button>
        <button
          onClick={slide}
          className="flex-1 select-none rounded-lg border-2 border-sky-600 bg-gradient-to-b from-sky-400 to-sky-600 py-3 font-display text-sm font-black text-white shadow transition-transform active:scale-95"
        >
          ↓ Slide
        </button>
      </div>
    </div>
  );
}
