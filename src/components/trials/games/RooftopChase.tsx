// Rooftop Chase trial — AG.
// Side-view endless runner across discrete medieval building rooftops at varied heights.
// Fall into a gap → run ends.  Chaser appears after CHASER_SPAWN_DISTANCE.
//
// Controls:
//   Space / ↑ / Jump button   → jump (double-jump allowed midair)
//   ↓ / S / Slide button      → slide under lowbar banners (grounded only)
//   Shift / D / Dash button   → speed burst that shoves chaser back (cooldown)

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  generateCourse,
  buildingAt,
  hasFallen,
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
  DASH_DURATION_MS,
  DASH_COOLDOWN_MS,
  DASH_SPEED_BONUS,
  CHASER_SPAWN_DISTANCE,
  LEAD_START,
  LEAD_MAX,
  STOMP_BOUNCE_VELOCITY,
  type Building,
} from '@/engine/trials/rooftopChase';

interface RooftopChaseProps {
  onFinish: (score01: number) => void;
}

// ── Display constants ──────────────────────────────────────────────────────────

const VIEW_W = 320;
const VIEW_H = 210;
/** Screen Y of the roof surface at elevation 0 (measured from top of play area). */
const ROOF_BASE_PX = 158;
/** Height below the roof base to the bottom of the view (street + parapet). */
const BELOW_ROOF_PX = VIEW_H - ROOF_BASE_PX;
/** Pixel scale: 1 world-unit = 7 px. */
const PX_PER_WU = 7;
/** Hero's fixed screen X (world scrolls past). */
const HERO_X_PX = 72;
/**
 * Hero hitbox width in world-units.
 * Slightly narrower than the visual sprite for fairness.
 */
const HERO_W_WU = 2.2;

/** Convert a world-unit roof elevation to screen Y (from top of view). */
function screenYForElev(elev: number): number {
  return ROOF_BASE_PX - elev * PX_PER_WU;
}

// ── Parallax layer constants ──────────────────────────────────────────────────

const FAR_FACTOR = 0.06;
const MID_FACTOR = 0.22;
const DECOR_FACTOR = 1.35;

const FAR_TILE_W = 480;
const MID_TILE_W = 320;
const DECOR_TILE_W = 240;

// ── Procedural art data ───────────────────────────────────────────────────────

const CASTLE_TOWERS: ReadonlyArray<[number, number, number, boolean]> = [
  [0,   18, 62, true],
  [36,  12, 45, false],
  [62,  22, 75, true],
  [110, 16, 52, true],
  [150, 28, 90, true],
  [200, 14, 48, false],
  [228, 20, 68, true],
  [270, 12, 40, false],
  [300, 18, 58, true],
  [340, 24, 72, true],
  [390, 14, 46, false],
  [420, 20, 65, true],
  [456, 16, 52, false],
];

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
  falling,
}: {
  airborne: boolean;
  sliding: boolean;
  stumbling: boolean;
  landing: boolean;
  falling: boolean;
}) {
  const opacity = stumbling ? 0.35 : 1;
  const fallAnim = falling ? 'rooftop-fall 0.6s ease-in forwards' : undefined;

  if (sliding) {
    return (
      <div style={{ width: 34, height: 18, position: 'relative', opacity, animation: fallAnim }}>
        <div style={{
          position: 'absolute', bottom: 2, left: 0, width: 28, height: 12,
          background: 'linear-gradient(90deg, #2d1b5e, #4a2890)',
          borderRadius: '6px 2px 2px 8px',
        }} />
        <div style={{
          position: 'absolute', bottom: 3, left: 4, width: 22, height: 10,
          backgroundColor: '#c85a2a',
          borderRadius: '3px 2px 2px 3px',
        }} />
        <div style={{
          position: 'absolute', bottom: 5, right: 0, width: 12, height: 12,
          backgroundColor: '#e0b070',
          borderRadius: '50% 50% 40% 40%',
        }} />
        <div style={{
          position: 'absolute', bottom: 12, right: 0, width: 14, height: 7,
          backgroundColor: '#9a7530',
          borderRadius: '3px 3px 0 0',
          borderBottom: '2px solid #7a5520',
        }} />
        <div style={{ position: 'absolute', bottom: 0, left: 6, width: 5, height: 5, backgroundColor: '#5a3520', borderRadius: '0 0 3px 3px' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 13, width: 5, height: 5, backgroundColor: '#4a2810', borderRadius: '0 0 3px 3px' }} />
      </div>
    );
  }

  const runAnim = airborne ? undefined : 'rooftop-run 0.32s linear infinite';
  const landAnim = landing ? 'rooftop-land 0.18s ease-out forwards' : undefined;
  const bodyAnim = fallAnim ?? landAnim ?? runAnim;

  return (
    <div style={{ width: 24, height: 38, position: 'relative', opacity, animation: bodyAnim }}>
      <div style={{
        position: 'absolute', bottom: 10, left: 0, width: 22, height: 22,
        background: 'linear-gradient(135deg, #2d1b5e 60%, #4a2890)',
        borderRadius: '2px 2px 10px 8px',
        animation: airborne || fallAnim ? undefined : 'rooftop-cloak 0.32s linear infinite',
      }} />
      <div style={{
        position: 'absolute', bottom: 14, left: 4, width: 16, height: 16,
        backgroundColor: '#c85a2a',
        borderRadius: '2px',
      }} />
      <div style={{
        position: 'absolute', bottom: 14, left: 4, width: 16, height: 3,
        backgroundColor: '#7a5020',
      }} />
      <div style={{
        position: 'absolute', bottom: 28, left: 5, width: 14, height: 13,
        backgroundColor: '#e0b070',
        borderRadius: '50% 50% 40% 40%',
      }} />
      <div style={{
        position: 'absolute', bottom: 36, left: 4, width: 16, height: 8,
        backgroundColor: '#9a7530',
        borderRadius: '3px 3px 0 0',
        borderBottom: '2px solid #7a5520',
      }} />
      <div style={{
        position: 'absolute', bottom: 32, left: 10, width: 4, height: 6,
        backgroundColor: '#7a5520',
      }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 6, width: 6, height: 16,
        backgroundColor: '#5a3520',
        borderRadius: '0 0 3px 3px',
        transformOrigin: 'top center',
        animation: airborne || fallAnim ? undefined : 'rooftop-leg-f 0.32s linear infinite',
        transform: airborne ? 'rotate(15deg)' : undefined,
      }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 13, width: 6, height: 16,
        backgroundColor: '#4a2510',
        borderRadius: '0 0 3px 3px',
        transformOrigin: 'top center',
        animation: airborne || fallAnim ? undefined : 'rooftop-leg-b 0.32s linear infinite',
        transform: airborne ? 'rotate(-15deg)' : undefined,
      }} />
      <div style={{ position: 'absolute', bottom: 0, left: 4, width: 8, height: 5, backgroundColor: '#3a1a08', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 13, width: 8, height: 5, backgroundColor: '#2a1008', borderRadius: '0 0 3px 3px' }} />
      {airborne && !fallAnim && (
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
      <div style={{
        position: 'absolute', bottom: 10, left: 0, width: 30, height: 16,
        background: 'linear-gradient(90deg, #100808, #1e1010)',
        borderRadius: '8px 3px 3px 8px',
      }} />
      <div style={{
        position: 'absolute', bottom: 22, left: 6, width: 16, height: 10,
        backgroundColor: '#1a0c0c',
        borderRadius: '50%',
      }} />
      <div style={{
        position: 'absolute', bottom: 14, right: 0, width: 18, height: 15,
        backgroundColor: '#1e1010',
        borderRadius: '40% 50% 40% 30%',
      }} />
      <div style={{
        position: 'absolute', bottom: 12, right: 0, width: 10, height: 8,
        backgroundColor: '#241414',
        borderRadius: '30% 50% 50% 20%',
      }} />
      <div style={{ position: 'absolute', bottom: 12, right: 1, width: 3, height: 4, backgroundColor: '#e8e0d0', borderRadius: '0 0 2px 1px' }} />
      <div style={{ position: 'absolute', bottom: 12, right: 5, width: 2, height: 3, backgroundColor: '#e8e0d0', borderRadius: '0 0 2px 1px' }} />
      <div style={{ position: 'absolute', bottom: 26, right: 3, width: 6, height: 9, backgroundColor: '#1e1010', clipPath: 'polygon(50% 0%,100% 100%,0% 100%)' }} />
      <div style={{ position: 'absolute', bottom: 26, right: 10, width: 5, height: 7, backgroundColor: '#1e1010', clipPath: 'polygon(50% 0%,100% 100%,0% 100%)' }} />
      <div style={{
        position: 'absolute', bottom: 20, right: 4, width: 6, height: 6,
        backgroundColor: eyeColor,
        borderRadius: '50%',
        boxShadow: eyeGlow,
      }} />
      <div style={{
        position: 'absolute', bottom: 16, left: 2, width: 10, height: 4,
        backgroundColor: '#1a0c0c',
        borderRadius: '0 2px 2px 0',
        transform: 'rotate(-20deg)',
        transformOrigin: 'right center',
      }} />
      <div style={{ position: 'absolute', bottom: 0, right: 4, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-f 0.28s linear infinite' }} />
      <div style={{ position: 'absolute', bottom: 0, right: 10, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-b 0.28s linear infinite' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 6, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-b 0.28s linear infinite' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 12, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-f 0.28s linear infinite' }} />
    </div>
  );
}

function HazardSprite({ widthPx }: { widthPx: number }) {
  const cx = Math.floor(widthPx / 2);
  return (
    <div style={{ width: widthPx, height: 40, position: 'relative' }}>
      <div style={{
        position: 'absolute', bottom: 0, left: cx - 7, width: 14, height: 36,
        background: 'linear-gradient(180deg, #9a7050, #6a4830)',
        border: '1px solid #4a2820',
        borderRadius: '2px 2px 0 0',
      }} />
      <div style={{
        position: 'absolute', bottom: 34, left: cx - 10, width: 20, height: 7,
        background: 'linear-gradient(180deg, #b08060, #8a6040)',
        border: '1px solid #5a3020',
        borderRadius: '2px 2px 0 0',
      }} />
      <div style={{
        position: 'absolute', bottom: 40, left: cx - 3, width: 6, height: 6,
        backgroundColor: 'rgba(200,190,180,0.4)',
        borderRadius: '50%',
      }} />
      <div style={{ position: 'absolute', bottom: 10, left: cx - 7, width: 14, height: 1, backgroundColor: '#5a3820', opacity: 0.6 }} />
      <div style={{ position: 'absolute', bottom: 20, left: cx - 7, width: 14, height: 1, backgroundColor: '#5a3820', opacity: 0.6 }} />
    </div>
  );
}

function MookSprite() {
  return (
    <div style={{ width: 26, height: 42, position: 'relative' }}>
      <div style={{ position: 'absolute', bottom: 0, right: 3, width: 2, height: 42, backgroundColor: '#8a6040' }} />
      <div style={{
        position: 'absolute', bottom: 40, right: 2, width: 4, height: 8,
        backgroundColor: '#d0c080',
        clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
      }} />
      <div style={{ position: 'absolute', bottom: 0, left: 4, width: 6, height: 16, backgroundColor: '#5a6878', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 12, width: 6, height: 16, backgroundColor: '#4a5868', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 2, width: 9, height: 5, backgroundColor: '#302018', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 10, width: 9, height: 5, backgroundColor: '#201808', borderRadius: '0 0 3px 3px' }} />
      <div style={{
        position: 'absolute', bottom: 14, left: 2, width: 18, height: 16,
        background: 'linear-gradient(180deg, #8090a8, #60708a)',
        border: '1px solid #405060',
        borderRadius: '2px 2px 0 0',
      }} />
      <div style={{ position: 'absolute', bottom: 28, left: 8, width: 8, height: 4, backgroundColor: '#a0b0c0' }} />
      <div style={{
        position: 'absolute', bottom: 30, left: 3, width: 18, height: 13,
        background: 'linear-gradient(180deg, #90a0b8, #708098)',
        border: '1px solid #405060',
        borderRadius: '3px 3px 0 0',
      }} />
      <div style={{ position: 'absolute', bottom: 34, left: 6, width: 12, height: 3, backgroundColor: '#202830', borderRadius: '1px' }} />
      <div style={{ position: 'absolute', bottom: 34, left: 7, width: 3, height: 2, backgroundColor: '#ff6040', borderRadius: '50%', opacity: 0.9 }} />
      <div style={{ position: 'absolute', bottom: 34, left: 14, width: 3, height: 2, backgroundColor: '#ff6040', borderRadius: '50%', opacity: 0.9 }} />
      <div style={{ position: 'absolute', bottom: 42, left: 8, width: 8, height: 5, backgroundColor: '#c02020', borderRadius: '2px 2px 0 0' }} />
    </div>
  );
}

function LowbarSprite({ widthPx }: { widthPx: number }) {
  const ROPE_Y = 30;
  return (
    <div style={{ width: widthPx, height: 48, position: 'relative', bottom: 0 }}>
      <div style={{
        position: 'absolute', bottom: 0, left: 0, width: 5, height: ROPE_Y + 10,
        background: 'linear-gradient(180deg, #8a6040, #6a4820)',
        borderRadius: '2px 2px 0 0',
      }} />
      <div style={{
        position: 'absolute', bottom: 0, right: 0, width: 5, height: ROPE_Y + 10,
        background: 'linear-gradient(180deg, #8a6040, #6a4820)',
        borderRadius: '2px 2px 0 0',
      }} />
      <div style={{
        position: 'absolute', bottom: ROPE_Y, left: 0, right: 0, height: 3,
        background: 'linear-gradient(90deg, #c8a040, #e8c060, #c8a040)',
        boxShadow: '0 0 5px rgba(200,160,60,0.6)',
      }} />
      <div style={{
        position: 'absolute', bottom: ROPE_Y - 12, left: '8%', right: '8%', height: 13,
        backgroundColor: '#a01818',
        borderRadius: '0 0 3px 3px',
        animation: 'rooftop-banner 1.6s ease-in-out infinite',
        transformOrigin: 'top center',
      }} />
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

// ── Building renderer ──────────────────────────────────────────────────────────

function BuildingView({
  building,
  distance,
  decorScrollPx,
}: {
  building: Building;
  distance: number;
  decorScrollPx: number;
}) {
  const roofScreenY = screenYForElev(building.roofY);
  const leftPx = (building.x - distance) * PX_PER_WU + HERO_X_PX;
  const widthPx = building.width * PX_PER_WU;
  const facadeH = VIEW_H - roofScreenY; // from roof top down to bottom of view

  // Lit windows pattern — a couple per building
  const windowPositions = [0.25, 0.65].map((frac) => Math.floor(frac * widthPx));
  const hasWindows = widthPx > 40;

  return (
    <div key={building.id}>
      {/* Facade (wall below roofline) */}
      <div
        className="absolute"
        style={{
          left: leftPx,
          top: roofScreenY,
          width: widthPx,
          height: facadeH,
          background: 'linear-gradient(180deg, #4a2e18 0%, #3a2010 40%, #2a1808 100%)',
          borderLeft: '1px solid #5a3820',
          borderRight: '1px solid #5a3820',
        }}
      >
        {/* Stone course lines */}
        {[20, 40, 60, 80].map((yOff) =>
          yOff < facadeH - 4 ? (
            <div key={yOff} style={{
              position: 'absolute', top: yOff, left: 0, right: 0, height: 1,
              backgroundColor: '#5a3820', opacity: 0.4,
            }} />
          ) : null
        )}
        {/* Lit windows */}
        {hasWindows && windowPositions.map((wx, wi) => (
          wx + 10 < widthPx - 4 ? (
            <div key={wi} style={{
              position: 'absolute', top: 12, left: wx, width: 10, height: 12,
              backgroundColor: 'rgba(255,200,80,0.25)',
              border: '1px solid rgba(200,140,40,0.5)',
              borderRadius: '1px 1px 0 0',
              boxShadow: 'inset 0 0 6px rgba(255,180,60,0.3)',
            }} />
          ) : null
        ))}
      </div>

      {/* Rooftop cap (shingle surface) */}
      <div
        className="absolute"
        style={{
          left: leftPx - 2,          // slight overhang (eave)
          top: roofScreenY - 4,      // 4px above facade top = cap height
          width: widthPx + 4,
          height: 8,
          background: 'linear-gradient(180deg, #7a5030 0%, #5a3820 60%, #4a2e18 100%)',
          backgroundImage: `linear-gradient(180deg, #7a5030 0%, #5a3820 60%, #4a2e18 100%),
            repeating-linear-gradient(90deg, #6a4228 0px, #6a4228 13px, #5a3220 13px, #5a3220 15px)`,
          backgroundBlendMode: 'overlay',
          backgroundPositionX: `${-(decorScrollPx % 15)}px`,
          borderTop: '1px solid #9a6038',
          zIndex: 2,
        }}
      />
      {/* Ridge highlight */}
      <div
        className="absolute"
        style={{
          left: leftPx - 2,
          top: roofScreenY - 5,
          width: widthPx + 4,
          height: 2,
          backgroundColor: '#a06840',
          opacity: 0.7,
          zIndex: 2,
        }}
      />
      {/* Left eave drip */}
      <div className="absolute" style={{
        left: leftPx - 4, top: roofScreenY - 1, width: 4, height: 5,
        backgroundColor: '#6a4228',
        borderRadius: '0 0 0 3px',
        zIndex: 2,
      }} />
      {/* Right eave drip */}
      <div className="absolute" style={{
        left: leftPx + widthPx + 2, top: roofScreenY - 1, width: 4, height: 5,
        backgroundColor: '#6a4228',
        borderRadius: '0 0 3px 0',
        zIndex: 2,
      }} />

      {/* Props sitting on this roof */}
      {building.props.map((prop) => {
        const propLeftPx = (prop.x - distance) * PX_PER_WU + HERO_X_PX;
        const propWidthPx = Math.max(prop.width * PX_PER_WU, 24);
        return (
          <div
            key={prop.id}
            className="absolute"
            style={{
              left: propLeftPx,
              top: roofScreenY - (prop.kind === 'lowbar' ? 48 : prop.kind === 'mook' ? 42 : 40) - 4,
              zIndex: 3,
            }}
          >
            {prop.kind === 'hazard' && <HazardSprite widthPx={propWidthPx} />}
            {prop.kind === 'mook'   && <MookSprite />}
            {prop.kind === 'lowbar' && <LowbarSprite widthPx={propWidthPx} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function RooftopChase({ onFinish }: RooftopChaseProps) {
  // ── Stable course ────────────────────────────────────────────────────────────
  const buildingsRef = useRef<Building[]>(generateCourse(Math.random));

  // ── Physics refs (written & read inside RAF only) ─────────────────────────
  const heroYRef        = useRef(0);   // absolute world-y above baseline (0 = ground/roofY)
  const heroVyRef       = useRef(0);   // world-units/sec (+up, -down)
  const distanceRef     = useRef(0);   // world-units traveled (hero's world-x left edge)
  const leadRef         = useRef(LEAD_START);
  const stumbleUntilRef = useRef(0);   // perf.now() when stumble ends
  const slidingUntilRef = useRef(0);   // perf.now() when slide ends
  const dashUntilRef    = useRef(0);   // perf.now() when dash burst ends
  const dashReadyAtRef  = useRef(0);   // perf.now() when dash cooldown expires
  const jumpsUsedRef    = useRef(0);
  const prevHeroYRef    = useRef(0);
  const activeContactRef = useRef<number | null>(null);
  const dashLeadEventRef = useRef(false); // true for one frame after dash starts
  const doneRef         = useRef(false);
  const rafRef          = useRef<number | null>(null);
  const lastTsRef       = useRef<number | null>(null);
  const landingTsRef    = useRef(0);

  // ── Render state ─────────────────────────────────────────────────────────
  const [heroYPx, setHeroYPx]             = useState(0);
  const [distance, setDistance]           = useState(0);
  const [lead, setLead]                   = useState(LEAD_START);
  const [chaserActive, setChaserActive]   = useState(false);
  const [stumbling, setStumbling]         = useState(false);
  const [sliding, setSliding]             = useState(false);
  const [airborne, setAirborne]           = useState(false);
  const [landing, setLanding]             = useState(false);
  const [falling, setFalling]             = useState(false);
  const [visibleBuildings, setVisibleBuildings] = useState<Building[]>([]);
  const [stompedPropId, setStompedPropId] = useState<number | null>(null);
  const [stompFlashEnd, setStompFlashEnd] = useState(0);
  const [dustPuffs, setDustPuffs]         = useState<number[]>([]);
  const [dashing, setDashing]             = useState(false);
  const [dashCooldownFrac, setDashCooldownFrac] = useState(1); // 1 = ready, 0 = just used
  const [heroRoofY, setHeroRoofY]         = useState(0); // elevation of current building

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

      const buildings = buildingsRef.current;
      const prevY = prevHeroYRef.current;

      // 1. Advance distance (with optional dash speed boost)
      const nowDashing = ts < dashUntilRef.current;
      const dist = distanceRef.current;
      const scrollSpeed = speedAt(dist) * (nowDashing ? 1 + DASH_SPEED_BONUS : 1);
      const newDist = dist + scrollSpeed * dt;
      distanceRef.current = newDist;

      // 2. Find the building underfoot and its roof elevation
      const footX = newDist + HERO_W_WU / 2;
      const underfoot = buildingAt(buildings, footX);
      const currentRoofY = underfoot ? underfoot.roofY : 0; // fallback, fall check overrides

      // 3. Hero vertical physics relative to ground (which can be elevated)
      let vy = heroVyRef.current - GRAVITY * dt;
      let y  = heroYRef.current + vy * dt;

      // Check fall (over a gap and dropped below next building's top)
      const fallen = hasFallen(buildings, footX, y);
      if (fallen && !doneRef.current) {
        // Trigger fall animation briefly then end
        doneRef.current = true;
        setFalling(true);
        setDistance(newDist);
        setTimeout(() => {
          onFinish(chaseScore(newDist));
        }, 600);
        return;
      }

      // Land on roof surface
      if (underfoot && y <= currentRoofY) {
        const justLanded = prevY > currentRoofY;
        if (justLanded) {
          jumpsUsedRef.current = 0;
          landingTsRef.current = ts;
          setDustPuffs((ps) => [...ps.slice(-3), ts]);
          setLanding(true);
          setTimeout(() => setLanding(false), 200);
        }
        y = currentRoofY;
        vy = 0;
      }
      heroYRef.current  = y;
      heroVyRef.current = vy;
      prevHeroYRef.current = y;

      // 4. Sliding state
      const nowSliding = ts < slidingUntilRef.current && y <= currentRoofY + 0.05;

      // 5. Visible buildings for rendering
      const viewEndX   = newDist + VIEW_W / PX_PER_WU + 6;
      const viewStartX = newDist - 4;
      const visible = buildings.filter(
        (b) => b.x + b.width >= viewStartX && b.x <= viewEndX,
      );

      // 6. Collision: find overlapping prop across all visible buildings
      let overlappingPropId: number | null = null;
      let overlappingProp: { prop: typeof buildings[0]['props'][0]; roofY: number } | null = null;
      for (const b of visible) {
        for (const p of b.props) {
          if (newDist < p.x + p.width && newDist + HERO_W_WU > p.x) {
            overlappingPropId = p.id;
            overlappingProp = { prop: p, roofY: b.roofY };
            break;
          }
        }
        if (overlappingProp) break;
      }

      let leadEvent: 'stumble' | 'stomp' | 'dash' | undefined;

      // Consume pending dash lead event (one-frame)
      if (dashLeadEventRef.current) {
        leadEvent = 'dash';
        dashLeadEventRef.current = false;
      }

      if (overlappingProp && overlappingPropId !== activeContactRef.current) {
        const result = resolveContact(
          y, vy, nowSliding, overlappingProp.prop, overlappingProp.roofY,
        );
        activeContactRef.current = overlappingPropId;

        if (result === 'stomp') {
          heroVyRef.current = STOMP_BOUNCE_VELOCITY;
          jumpsUsedRef.current = 0;
          leadEvent = leadEvent ?? 'stomp';
          setStompedPropId(overlappingPropId);
          setStompFlashEnd(ts + 500);
        } else if (result === 'stumble') {
          stumbleUntilRef.current = ts + STUMBLE_MS;
          leadEvent = leadEvent ?? 'stumble';
        }
      } else if (!overlappingProp) {
        activeContactRef.current = null;
      }

      // 7. Lead update (chaser active only after spawn distance)
      const active = newDist >= CHASER_SPAWN_DISTANCE;
      const newLead = updateLead(leadRef.current, dt, active, leadEvent);
      leadRef.current = newLead;

      // 8. End conditions
      if (newLead <= 0 || newDist >= CHASE_TARGET_DISTANCE) {
        setDistance(newDist);
        setLead(newLead);
        finish(newDist);
        return;
      }

      // 9. Dash cooldown fraction for UI
      const cdFrac = dashReadyAtRef.current <= ts
        ? 1
        : 1 - (dashReadyAtRef.current - ts) / DASH_COOLDOWN_MS;

      // 10. Push render state
      setHeroYPx(Math.round((y - currentRoofY) * PX_PER_WU));
      setHeroRoofY(currentRoofY);
      setDistance(newDist);
      setLead(newLead);
      setChaserActive(active);
      setStumbling(ts < stumbleUntilRef.current);
      setSliding(nowSliding);
      setAirborne(y > currentRoofY + 0.05);
      setVisibleBuildings(visible);
      setDashing(nowDashing);
      setDashCooldownFrac(Math.max(0, Math.min(1, cdFrac)));

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [finish, onFinish]);

  // ── Jump ──────────────────────────────────────────────────────────────────
  const jump = useCallback(() => {
    if (doneRef.current) return;
    const nowStumbling = performance.now() < stumbleUntilRef.current;
    const nowSliding   = performance.now() < slidingUntilRef.current;
    if (nowStumbling || nowSliding) return;

    const buildings = buildingsRef.current;
    const footX = distanceRef.current + HERO_W_WU / 2;
    const underfoot = buildingAt(buildings, footX);
    const currentRoofY = underfoot ? underfoot.roofY : heroYRef.current;
    const grounded = heroYRef.current <= currentRoofY + 0.05;

    if (grounded) {
      heroVyRef.current = JUMP_VELOCITY;
      jumpsUsedRef.current = 1;
    } else if (jumpsUsedRef.current < MAX_JUMPS) {
      heroVyRef.current = DOUBLE_JUMP_VELOCITY;
      jumpsUsedRef.current++;
      setDustPuffs((ps) => [...ps.slice(-3), performance.now()]);
    }
  }, []);

  // ── Slide ─────────────────────────────────────────────────────────────────
  const slide = useCallback(() => {
    if (doneRef.current) return;
    const buildings = buildingsRef.current;
    const footX = distanceRef.current + HERO_W_WU / 2;
    const underfoot = buildingAt(buildings, footX);
    const currentRoofY = underfoot ? underfoot.roofY : 0;
    const grounded     = heroYRef.current <= currentRoofY + 0.05;
    const nowStumbling = performance.now() < stumbleUntilRef.current;
    if (!grounded || nowStumbling) return;
    slidingUntilRef.current = performance.now() + SLIDE_MS;
  }, []);

  // ── Dash ──────────────────────────────────────────────────────────────────
  const dash = useCallback(() => {
    if (doneRef.current) return;
    const now = performance.now();
    if (now < dashReadyAtRef.current) return; // cooldown active
    const nowStumbling = now < stumbleUntilRef.current;
    if (nowStumbling) return;
    dashUntilRef.current  = now + DASH_DURATION_MS;
    dashReadyAtRef.current = now + DASH_COOLDOWN_MS;
    dashLeadEventRef.current = true;
    setDustPuffs((ps) => [...ps.slice(-3), now]);
  }, []);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp')          { e.preventDefault(); jump(); }
      if (e.code === 'ArrowDown' || e.code === 'KeyS')         { e.preventDefault(); slide(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyD') {
        e.preventDefault(); dash();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [jump, slide, dash]);

  // ── Derived display values ────────────────────────────────────────────────
  const leadFrac   = lead / LEAD_MAX;
  const leadColor  = leadFrac > 0.5 ? '#4ade80' : leadFrac > 0.25 ? '#fbbf24' : '#f87171';
  const leadLabel  = leadFrac > 0.6 ? 'Safe' : leadFrac > 0.3 ? 'Close!' : '⚠ Danger!';
  const scorePct   = Math.round(chaseScore(distance) * 100);
  const dashReady  = dashCooldownFrac >= 1;

  // Chaser screen X: far off-screen left initially, encroaches as lead shrinks
  const chaserXPx     = HERO_X_PX - 50 - (1 - leadFrac) * 28;
  const chaserDanger  = leadFrac < 0.3;

  const showStompFlash = stompedPropId !== null && performance.now() < stompFlashEnd;

  const curSpeed    = speedAt(distance);
  const speedFrac   = (curSpeed - 6) / (22 - 6);
  const streakCount = Math.floor(speedFrac * 7) + (dashing ? 3 : 0);
  const streakOpacity = 0.15 + speedFrac * 0.55;

  // Parallax offsets (px)
  const farScrollPx   = distance * FAR_FACTOR   * PX_PER_WU;
  const midScrollPx   = distance * MID_FACTOR   * PX_PER_WU;
  const decorScrollPx = distance * DECOR_FACTOR * PX_PER_WU;

  const skyBottom = `hsl(${220 - speedFrac * 40}, 55%, ${20 - speedFrac * 6}%)`;

  // Hero screen Y (roofY already baked into heroYPx as offset above that roof)
  const heroScreenBottom = BELOW_ROOF_PX + heroRoofY * PX_PER_WU;

  // Spawn distance progress for "chaser incoming" message
  const spawnPct = Math.min(1, distance / CHASER_SPAWN_DISTANCE);

  return (
    <div className="flex flex-col items-center gap-3 px-2">
      <p className="text-center text-xs text-ink-muted">
        <strong className="text-ink">Jump</strong> (Space/↑) leap &amp; double-jump ·{' '}
        <strong className="text-ink">Slide</strong> (↓/S) duck banners ·{' '}
        <strong className="text-ink">Dash</strong> (Shift/D) outrun the beast
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
        <div className="absolute inset-0" style={{
          background: `linear-gradient(to bottom, #0d0820 0%, #1a0a3a 35%, #3d1260 65%, ${skyBottom} 100%)`,
        }} />

        {/* Moon */}
        <div className="absolute" style={{
          top: 12, right: 40 + Math.sin(distance * 0.01) * 4, width: 18, height: 18,
          backgroundColor: '#f8f0d0',
          borderRadius: '50%',
          boxShadow: '0 0 16px 6px rgba(248,240,200,0.25)',
        }} />

        {/* ── Layer 1: Far castle silhouette ─────────────────────────────── */}
        {[0, 1].map((copy) => (
          <div key={copy} className="absolute" style={{
            bottom: BELOW_ROOF_PX,
            left: -(farScrollPx % FAR_TILE_W) + copy * FAR_TILE_W,
            width: FAR_TILE_W, height: 92,
          }}>
            {CASTLE_TOWERS.map(([tx, tw, th, cren], i) => (
              <div key={i}>
                <div style={{ position: 'absolute', bottom: 0, left: tx, width: tw, height: th, backgroundColor: '#160a2a' }} />
                {cren && ([0, 1, 2] as const).map((ci) => (
                  <div key={ci} style={{
                    position: 'absolute', bottom: th,
                    left: tx + Math.floor(tw / 4) * (ci + 0) + ci * 2,
                    width: Math.max(3, Math.floor(tw / 5)), height: 6,
                    backgroundColor: '#160a2a',
                  }} />
                ))}
                <div style={{
                  position: 'absolute',
                  bottom: Math.floor(th * 0.35), left: tx + Math.floor(tw / 2) - 2,
                  width: 3, height: 7, backgroundColor: 'rgba(80,40,120,0.7)',
                }} />
              </div>
            ))}
          </div>
        ))}

        {/* ── Layer 2: Mid rooftop ridgeline ─────────────────────────────── */}
        {[0, 1, 2].map((copy) => (
          <div key={copy} className="absolute" style={{
            bottom: BELOW_ROOF_PX,
            left: -(midScrollPx % MID_TILE_W) + copy * MID_TILE_W,
            width: MID_TILE_W, height: 60,
          }}>
            {MID_BUILDINGS.map(([bx, bw, bh], i) => (
              <div key={i}>
                <div style={{ position: 'absolute', bottom: 0, left: bx, width: bw, height: bh, background: 'linear-gradient(180deg, #2a1a40, #1e1230)' }} />
                <div style={{
                  position: 'absolute', bottom: bh - 1, left: bx - 2,
                  width: 0, height: 0,
                  borderLeft: `${bw / 2 + 2}px solid transparent`,
                  borderRight: `${bw / 2 + 2}px solid transparent`,
                  borderBottom: `${Math.floor(bh * 0.3)}px solid #201530`,
                }} />
              </div>
            ))}
          </div>
        ))}

        {/* ── Layer 3: Gap sky (dark streets between buildings) ──────────── */}
        {/* Full-width dark band at baseline level shows through gaps automatically since
            buildings' facades only cover their own width */}
        <div className="absolute left-0 right-0" style={{
          top: ROOF_BASE_PX,
          height: BELOW_ROOF_PX,
          background: 'linear-gradient(180deg, #0a0518 0%, #050210 100%)',
        }} />

        {/* ── Layer 4: Buildings (facades + rooftops + props) ────────────── */}
        {visibleBuildings.map((b) => (
          <BuildingView
            key={b.id}
            building={b}
            distance={distance}
            decorScrollPx={decorScrollPx}
          />
        ))}

        {/* ── Layer 5: Foreground decor tile — chimneys on far-left buildings */}
        {[0, 1, 2].map((copy) => (
          <div key={copy} className="absolute" style={{
            bottom: BELOW_ROOF_PX,
            left: -(decorScrollPx % DECOR_TILE_W) + copy * DECOR_TILE_W,
            width: DECOR_TILE_W, height: 40,
            pointerEvents: 'none',
          }}>
            {CHIMNEYS.map(([cx, bw, cw, ch], i) => (
              <div key={i} style={{ position: 'absolute', bottom: 0, left: cx }}>
                <div style={{
                  position: 'absolute', bottom: 0, left: Math.floor((cw - bw) / 2), width: bw, height: ch,
                  background: 'linear-gradient(180deg, #7a5030, #5a3820)',
                  borderLeft: '1px solid #4a2818', borderRight: '1px solid #4a2818',
                }} />
                <div style={{
                  position: 'absolute', bottom: ch - 1, left: 0, width: cw, height: 5,
                  backgroundColor: '#8a6040', borderTop: '1px solid #a07050',
                }} />
              </div>
            ))}
          </div>
        ))}

        {/* ── Layer 6: Speed lines ───────────────────────────────────────── */}
        {streakCount > 0 && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {Array.from({ length: streakCount }, (_, i) => {
              const yFrac = 0.12 + (i / streakCount) * 0.72;
              const lenPx = 20 + i * 8;
              const isDash = dashing && i >= streakCount - 3;
              return (
                <div key={i} style={{
                  position: 'absolute',
                  top: `${yFrac * 100}%`,
                  left: HERO_X_PX - lenPx,
                  width: lenPx,
                  height: isDash ? 2 : 1,
                  background: isDash
                    ? `linear-gradient(to left, rgba(255,220,100,${streakOpacity + 0.3}), transparent)`
                    : `linear-gradient(to left, rgba(180,160,255,${streakOpacity}), transparent)`,
                  transformOrigin: 'right center',
                  animation: isDash
                    ? `rooftop-dash ${0.08 + i * 0.02}s linear infinite`
                    : `rooftop-streak ${0.12 + i * 0.03}s linear infinite`,
                  animationDelay: `${i * 0.04}s`,
                }} />
              );
            })}
          </div>
        )}

        {/* ── Layer 7: Dust puffs ──────────────────────────────────────── */}
        {dustPuffs.map((ts) => (
          <div key={ts} className="absolute pointer-events-none" style={{
            left: HERO_X_PX + 12,
            bottom: heroScreenBottom,
            width: 18, height: 10,
            borderRadius: '50%',
            backgroundColor: 'rgba(180,140,90,0.55)',
            animation: 'rooftop-dust 0.5s ease-out forwards',
          }}
            onAnimationEnd={() => setDustPuffs((ps) => ps.filter((t) => t !== ts))}
          />
        ))}

        {/* ── Layer 8: Chaser (only once active) ─────────────────────────── */}
        {chaserActive && (
          <div className="absolute" style={{
            left: Math.max(-42, chaserXPx),
            bottom: BELOW_ROOF_PX, // chaser runs at baseline for now (stylistic)
          }}>
            <ChaserSprite danger={chaserDanger} />
          </div>
        )}

        {/* ── Layer 9: Hero ───────────────────────────────────────────────── */}
        <div className="absolute" style={{
          left: HERO_X_PX,
          bottom: heroScreenBottom,
          transform: `translateY(${-heroYPx}px)`,
        }}>
          <HeroSprite
            airborne={airborne}
            sliding={sliding}
            stumbling={stumbling}
            landing={landing}
            falling={falling}
          />
        </div>

        {/* ── Stomp flash ──────────────────────────────────────────────── */}
        {showStompFlash && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 font-display text-xs font-black text-gold-bright bg-gold-bright/20 px-2 py-0.5 rounded whitespace-nowrap pointer-events-none">
            STOMP! ⚔
          </div>
        )}

        {/* Slide indicator */}
        {sliding && (
          <div className="absolute top-2 left-2 font-display text-[10px] font-bold text-sky-300/90 pointer-events-none">
            SLIDING
          </div>
        )}

        {/* Dash indicator */}
        {dashing && (
          <div className="absolute top-2 left-2 font-display text-[10px] font-black text-yellow-300/95 pointer-events-none"
            style={{ textShadow: '0 0 6px rgba(255,220,80,0.8)' }}>
            DASH!
          </div>
        )}

        {/* Chaser incoming warning */}
        {!chaserActive && spawnPct > 0.7 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 font-display text-[10px] font-bold text-red-400/80 pointer-events-none animate-pulse whitespace-nowrap">
            ⚠ Something stalks you…
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

      {/* ── Chaser lead meter (only shows once active) ──────────────────────── */}
      {chaserActive ? (
        <div className="w-full max-w-xs space-y-1">
          <div className="flex items-center justify-between px-0.5">
            <span className="font-display text-[10px] text-ink-muted">🐺 Chaser</span>
            <span className="font-display text-[10px] font-bold" style={{ color: leadColor }}>
              {leadLabel}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/20">
            <div className="h-full rounded-full transition-none" style={{ width: `${leadFrac * 100}%`, backgroundColor: leadColor }} />
          </div>
        </div>
      ) : (
        <div className="w-full max-w-xs">
          <div className="h-2.5 w-full overflow-hidden rounded-full border border-gold-deep/20 bg-parchment-300/10">
            <div className="h-full rounded-full bg-parchment-300/20 transition-none" style={{ width: `${spawnPct * 100}%` }} />
          </div>
          <p className="text-center font-display text-[9px] text-ink-muted/60 mt-0.5">Keep running…</p>
        </div>
      )}

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className="flex w-full max-w-xs items-center gap-2">
        <div className="text-center font-display text-xs text-ink-muted">
          Score: <strong className="text-gold-deep">{scorePct}%</strong>
        </div>
        <button
          onClick={jump}
          className="flex-1 select-none rounded-lg border-2 border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep py-2.5 font-display text-sm font-black text-wood-900 shadow-gold transition-transform active:scale-95"
        >
          ↑ Jump
        </button>
        <button
          onClick={slide}
          className="flex-1 select-none rounded-lg border-2 border-sky-600 bg-gradient-to-b from-sky-400 to-sky-600 py-2.5 font-display text-sm font-black text-white shadow transition-transform active:scale-95"
        >
          ↓ Slide
        </button>
        <div className="relative flex-1">
          <button
            onClick={dash}
            disabled={!dashReady}
            className="w-full select-none rounded-lg border-2 border-amber-600 bg-gradient-to-b from-amber-400 to-amber-600 py-2.5 font-display text-sm font-black text-white shadow transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ⚡ Dash
          </button>
          {/* Cooldown fill overlay */}
          {!dashReady && (
            <div className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
              <div
                className="h-full bg-black/50 transition-none"
                style={{ width: `${(1 - dashCooldownFrac) * 100}%`, right: 0, position: 'absolute' }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
