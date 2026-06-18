// Rooftop Chase trial — AG.
// Side-view endless runner across discrete medieval building rooftops at varied heights.
// Fall into a gap → run ends.  Chaser appears after CHASER_SPAWN_DISTANCE.
//
// Controls:
//   Space / ↑ / Jump button   → jump (double-jump allowed midair)
//   ↓ / S / Slide button      → slide under lowbar banners (grounded only)
//   Shift / D / Dash button   → speed burst that shoves chaser back (cooldown)
//
// Phase 0 refactor: all sim state lives in ChaseState (engine) + useChaseLoop (hook).
// This component is now a pure renderer of ChaseState — no RAF, no inline physics.

import { useState, useEffect, useRef } from 'react';
import {
  chaseScore,
  speedAt,
  CHASE_TARGET_DISTANCE,
  CHASER_SPAWN_DISTANCE,
  DASH_COOLDOWN_MS,
  LEAD_MAX,
  HERO_HITBOX_W as _HERO_HITBOX_W, // imported for documentation; not used in render math directly
  type Building,
} from '@/engine/trials/rooftopChase';
import { useChaseLoop } from '@/hooks/useChaseLoop';
import { useChaseAudio } from '@/hooks/useChaseAudio';
import { useGameStore } from '@/store/useGameStore';

// Suppress the unused-import lint on HERO_HITBOX_W — it's imported to keep the
// renderer and engine in sync (both reference the same exported constant).
void _HERO_HITBOX_W;

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

/** Convert a world-unit roof elevation to screen Y (from top of view). */
function screenYForElev(elev: number): number {
  return ROOF_BASE_PX - elev * PX_PER_WU;
}

// ── Parallax layer constants ──────────────────────────────────────────────────

const FAR_FACTOR  = 0.06;
const MID_FACTOR  = 0.22;
const DECOR_FACTOR = 1.35;

const FAR_TILE_W   = 480;
const MID_TILE_W   = 320;
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
  airborne:  boolean;
  sliding:   boolean;
  stumbling: boolean;
  landing:   boolean;
  falling:   boolean;
}) {
  const opacity  = stumbling ? 0.35 : 1;
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
        <div style={{ position: 'absolute', bottom: 0, left: 6,  width: 5, height: 5, backgroundColor: '#5a3520', borderRadius: '0 0 3px 3px' }} />
        <div style={{ position: 'absolute', bottom: 0, left: 13, width: 5, height: 5, backgroundColor: '#4a2810', borderRadius: '0 0 3px 3px' }} />
      </div>
    );
  }

  const runAnim  = airborne ? undefined : 'rooftop-run 0.32s linear infinite';
  const landAnim = landing  ? 'rooftop-land 0.18s ease-out forwards' : undefined;
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
      <div style={{ position: 'absolute', bottom: 0, left:  4, width: 8, height: 5, backgroundColor: '#3a1a08', borderRadius: '0 0 3px 3px' }} />
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
  const eyeGlow  = danger ? '0 0 8px #ff2200' : '0 0 4px #cc4400';
  const eyeColor = danger ? '#ff3300'         : '#cc5500';
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
      <div style={{ position: 'absolute', bottom: 26, right:  3, width: 6, height: 9, backgroundColor: '#1e1010', clipPath: 'polygon(50% 0%,100% 100%,0% 100%)' }} />
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
      <div style={{ position: 'absolute', bottom: 0, right:  4, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-f 0.28s linear infinite' }} />
      <div style={{ position: 'absolute', bottom: 0, right: 10, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-b 0.28s linear infinite' }} />
      <div style={{ position: 'absolute', bottom: 0, left:  6, width: 4, height: 12, backgroundColor: '#1a0a0a', borderRadius: '0 0 3px 3px', transformOrigin: 'top center', animation: 'rooftop-claws-b 0.28s linear infinite' }} />
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
      <div style={{ position: 'absolute', bottom:  0, left:  4, width: 6, height: 16, backgroundColor: '#5a6878', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom:  0, left: 12, width: 6, height: 16, backgroundColor: '#4a5868', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom:  0, left:  2, width: 9, height:  5, backgroundColor: '#302018', borderRadius: '0 0 3px 3px' }} />
      <div style={{ position: 'absolute', bottom:  0, left: 10, width: 9, height:  5, backgroundColor: '#201808', borderRadius: '0 0 3px 3px' }} />
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
      <div style={{ position: 'absolute', bottom: 34, left:  7, width: 3, height: 2, backgroundColor: '#ff6040', borderRadius: '50%', opacity: 0.9 }} />
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
  building:      Building;
  distance:      number;
  decorScrollPx: number;
}) {
  const roofScreenY = screenYForElev(building.roofY);
  const leftPx      = (building.x - distance) * PX_PER_WU + HERO_X_PX;
  const widthPx     = building.width * PX_PER_WU;
  const facadeH     = VIEW_H - roofScreenY;

  const windowPositions = [0.25, 0.65].map((frac) => Math.floor(frac * widthPx));
  const hasWindows      = widthPx > 40;

  return (
    <div key={building.id}>
      {/* Facade */}
      <div
        className="absolute"
        style={{
          left: leftPx, top: roofScreenY, width: widthPx, height: facadeH,
          background: 'linear-gradient(180deg, #4a2e18 0%, #3a2010 40%, #2a1808 100%)',
          borderLeft: '1px solid #5a3820', borderRight: '1px solid #5a3820',
        }}
      >
        {[20, 40, 60, 80].map((yOff) =>
          yOff < facadeH - 4 ? (
            <div key={yOff} style={{
              position: 'absolute', top: yOff, left: 0, right: 0, height: 1,
              backgroundColor: '#5a3820', opacity: 0.4,
            }} />
          ) : null
        )}
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

      {/* Rooftop cap */}
      <div
        className="absolute"
        style={{
          left: leftPx - 2, top: roofScreenY - 4, width: widthPx + 4, height: 8,
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
      <div className="absolute" style={{
        left: leftPx - 2, top: roofScreenY - 5, width: widthPx + 4, height: 2,
        backgroundColor: '#a06840', opacity: 0.7, zIndex: 2,
      }} />
      {/* Eave drips */}
      <div className="absolute" style={{ left: leftPx - 4,          top: roofScreenY - 1, width: 4, height: 5, backgroundColor: '#6a4228', borderRadius: '0 0 0 3px', zIndex: 2 }} />
      <div className="absolute" style={{ left: leftPx + widthPx + 2, top: roofScreenY - 1, width: 4, height: 5, backgroundColor: '#6a4228', borderRadius: '0 0 3px 0', zIndex: 2 }} />

      {/* Props */}
      {building.props.map((prop) => {
        const propLeftPx  = (prop.x - distance) * PX_PER_WU + HERO_X_PX;
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
  const { state, controls } = useChaseLoop(onFinish);

  const soundEnabled  = useGameStore((s) => s.settings.soundEnabled);
  const updateSettings = useGameStore((s) => s.updateSettings);
  useChaseAudio(state, soundEnabled);

  // ── Derive display values ──────────────────────────────────────────────────
  const distance   = state.distance;
  const lead       = state.lead;
  const leadFrac   = lead / LEAD_MAX;
  const leadColor  = leadFrac > 0.5 ? '#4ade80' : leadFrac > 0.25 ? '#fbbf24' : '#f87171';
  const leadLabel  = leadFrac > 0.6 ? 'Safe' : leadFrac > 0.3 ? 'Close!' : '⚠ Danger!';
  const scorePct   = Math.round(chaseScore(distance) * 100);

  const nowStumbling = state.stumbleMs > 0;
  const nowSliding   = state.slideMs   > 0;
  const nowDashing   = state.dashMs    > 0;
  const airborne     = state.heroY > state.heroRoofY + 0.05;
  const falling      = state.justFell && state.done;

  const dashCooldownFrac = state.dashCooldownMs > 0
    ? 1 - state.dashCooldownMs / DASH_COOLDOWN_MS
    : 1;
  const dashReady = dashCooldownFrac >= 1;

  const heroYPx        = Math.round((state.heroY - state.heroRoofY) * PX_PER_WU);
  const heroScreenBottom = BELOW_ROOF_PX + state.heroRoofY * PX_PER_WU;

  const showStompFlash = state.stompFlashMs > 0;

  const curSpeed   = speedAt(distance);
  const speedFrac  = (curSpeed - 4) / (10 - 4); // 0 at BASE_SPEED, 1 at MAX_SPEED
  const streakCount  = Math.floor(speedFrac * 7) + (nowDashing ? 3 : 0);
  const streakOpacity = 0.15 + speedFrac * 0.55;

  // Parallax offsets
  const farScrollPx   = distance * FAR_FACTOR   * PX_PER_WU;
  const midScrollPx   = distance * MID_FACTOR   * PX_PER_WU;
  const decorScrollPx = distance * DECOR_FACTOR * PX_PER_WU;

  const skyBottom = `hsl(${220 - speedFrac * 40}, 55%, ${20 - speedFrac * 6}%)`;

  const chaserXPx    = HERO_X_PX - 50 - (1 - leadFrac) * 28;
  const chaserDanger = leadFrac < 0.3;

  const spawnPct = Math.min(1, distance / CHASER_SPAWN_DISTANCE);

  // Visible buildings
  const viewEndX         = distance + VIEW_W / PX_PER_WU + 6;
  const viewStartX       = distance - 4;
  const visibleBuildings = (state.buildings as Building[]).filter(
    (b) => b.x + b.width >= viewStartX && b.x <= viewEndX,
  );

  // ── Landing animation (stretches one-frame event to 200 ms) ────────────────
  const [landingAnim, setLandingAnim] = useState(false);
  const prevJustLanded = useRef(false);
  useEffect(() => {
    if (state.justLanded && !prevJustLanded.current) {
      setLandingAnim(true);
      const t = setTimeout(() => setLandingAnim(false), 200);
      return () => clearTimeout(t);
    }
    prevJustLanded.current = state.justLanded;
  });

  // ── Dust puffs (triggered by landing, stomping, or dashing) ───────────────
  const [dustPuffs, setDustPuffs] = useState<number[]>([]);
  const prevJustStomped = useRef(false);
  const prevJustDashed  = useRef(false);
  useEffect(() => {
    const now = performance.now();
    if (state.justLanded  && !prevJustLanded.current)  setDustPuffs((ps) => [...ps.slice(-3), now]);
    if (state.justStomped && !prevJustStomped.current) setDustPuffs((ps) => [...ps.slice(-3), now]);
    if (state.justDashed  && !prevJustDashed.current)  setDustPuffs((ps) => [...ps.slice(-3), now]);
    prevJustLanded.current  = state.justLanded;
    prevJustStomped.current = state.justStomped;
    prevJustDashed.current  = state.justDashed;
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col items-center gap-3 px-2">
      <p className="text-center text-xs text-ink-muted">
        <strong className="text-ink">Jump</strong> (Space/↑) leap &amp; double-jump ·{' '}
        <strong className="text-ink">Slide</strong> (↓/S) duck banners ·{' '}
        <strong className="text-ink">Dash</strong> (Shift/D) outrun the beast
      </p>

      {/* ── Play area ───────────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-lg border-2 border-gold-deep/50 select-none cursor-pointer"
        style={{ width: VIEW_W, height: VIEW_H }}
        onClick={controls.jump}
        role="button"
        aria-label="Jump"
      >
        {/* Sky gradient */}
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

        {/* Far castle silhouette */}
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

        {/* Mid rooftop ridgeline */}
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

        {/* Gap street between buildings */}
        <div className="absolute left-0 right-0" style={{
          top: ROOF_BASE_PX, height: BELOW_ROOF_PX,
          background: 'linear-gradient(180deg, #0a0518 0%, #050210 100%)',
        }} />

        {/* Buildings */}
        {visibleBuildings.map((b) => (
          <BuildingView
            key={b.id}
            building={b}
            distance={distance}
            decorScrollPx={decorScrollPx}
          />
        ))}

        {/* Foreground chimneys */}
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

        {/* Speed lines */}
        {streakCount > 0 && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {Array.from({ length: streakCount }, (_, i) => {
              const yFrac  = 0.12 + (i / streakCount) * 0.72;
              const lenPx  = 20 + i * 8;
              const isDash = nowDashing && i >= streakCount - 3;
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

        {/* Dust puffs */}
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

        {/* Chaser */}
        {state.chaserActive && (
          <div className="absolute" style={{
            left: Math.max(-42, chaserXPx),
            bottom: BELOW_ROOF_PX,
          }}>
            <ChaserSprite danger={chaserDanger} />
          </div>
        )}

        {/* Hero */}
        <div className="absolute" style={{
          left: HERO_X_PX,
          bottom: heroScreenBottom,
          transform: `translateY(${-heroYPx}px)`,
        }}>
          <HeroSprite
            airborne={airborne}
            sliding={nowSliding}
            stumbling={nowStumbling}
            landing={landingAnim}
            falling={falling}
          />
        </div>

        {/* Stomp flash */}
        {showStompFlash && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 font-display text-xs font-black text-gold-bright bg-gold-bright/20 px-2 py-0.5 rounded whitespace-nowrap pointer-events-none">
            STOMP! ⚔
          </div>
        )}

        {/* Sound mute toggle — top-left corner of play area */}
        <button
          onClick={(e) => {
            e.stopPropagation(); // don't trigger the jump click on the canvas
            updateSettings({ soundEnabled: !soundEnabled });
          }}
          className="absolute top-1.5 left-2 z-10 select-none rounded px-1 py-0.5 font-display text-[11px] text-parchment-300/60 hover:text-parchment-100 transition-colors"
          aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
          title={soundEnabled ? 'Mute sound' : 'Unmute sound'}
        >
          {soundEnabled ? '🔊' : '🔇'}
        </button>

        {/* Slide indicator */}
        {nowSliding && (
          <div className="absolute top-2 left-8 font-display text-[10px] font-bold text-sky-300/90 pointer-events-none">
            SLIDING
          </div>
        )}

        {/* Dash indicator */}
        {nowDashing && (
          <div className="absolute top-2 left-8 font-display text-[10px] font-black text-yellow-300/95 pointer-events-none"
            style={{ textShadow: '0 0 6px rgba(255,220,80,0.8)' }}>
            DASH!
          </div>
        )}

        {/* Chaser incoming warning */}
        {!state.chaserActive && spawnPct > 0.7 && (
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 font-display text-[10px] font-bold text-red-400/80 pointer-events-none animate-pulse whitespace-nowrap">
            ⚠ Something stalks you…
          </div>
        )}

        {/* HUD */}
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

      {/* ── Chaser lead meter ──────────────────────────────────────────────────── */}
      {state.chaserActive ? (
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

      {/* ── Controls ──────────────────────────────────────────────────────────── */}
      <div className="flex w-full max-w-xs items-center gap-2">
        <div className="text-center font-display text-xs text-ink-muted">
          Score: <strong className="text-gold-deep">{scorePct}%</strong>
        </div>
        <button
          onClick={controls.jump}
          className="flex-1 select-none rounded-lg border-2 border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep py-2.5 font-display text-sm font-black text-wood-900 shadow-gold transition-transform active:scale-95"
        >
          ↑ Jump
        </button>
        <button
          onClick={controls.slide}
          className="flex-1 select-none rounded-lg border-2 border-sky-600 bg-gradient-to-b from-sky-400 to-sky-600 py-2.5 font-display text-sm font-black text-white shadow transition-transform active:scale-95"
        >
          ↓ Slide
        </button>
        <div className="relative flex-1">
          <button
            onClick={controls.dash}
            disabled={!dashReady}
            className="w-full select-none rounded-lg border-2 border-amber-600 bg-gradient-to-b from-amber-400 to-amber-600 py-2.5 font-display text-sm font-black text-white shadow transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ⚡ Dash
          </button>
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
