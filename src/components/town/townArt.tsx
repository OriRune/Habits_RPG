// ============================================================================
//  TOWN ART — procedural, palette-aware SVG for the Homestead renderer.
// ============================================================================
//
//  A primitive kit (isoBox / roofGable / prism / dome / spire / silo / fence …)
//  plus a distinct composer per building artKey, three tiers deep. Tier growth is
//  ADDITIVE: tier I is the base volume; tier II stacks a storey / roof / trim;
//  tier III adds gilding, banners, and gold accents. No bespoke per-tier art.
//
//  Coloring goes through Tailwind `fill-*` utilities (which resolve to
//  rgb(var(--c-*))) and the shared gradients in <TownArtDefs>, so the town
//  re-skins for free on palette / dark-mode changes. The role map is:
//    wall → parchment-300 · roofA → ember · roofB → gold-deep ·
//    timber → wood-600 · trim → gold.
//  grass / water / foliage / steam use fixed jewel tones (same precedent as
//  stat-identity colors) — the only sanctioned non-themed fills here. No image assets.
// ============================================================================
import { type ReactNode } from 'react';
import { TOWN_TILE_W, TOWN_TILE_H, diamondCorners, type Pt } from './iso';

/** Screen lift per one height unit — matches the tactics silhouette language (≈0.47×tile). */
const LIFT_PER_UNIT = 0.47 * TOWN_TILE_W;
const HW = TOWN_TILE_W / 2;
const HH = TOWN_TILE_H / 2;

/** Fixed jewel tones — unthemed by design (grass/water/foliage/steam), same as stat colors. */
const WATER = '#2f6d8c';
const WATER_LIT = '#4f97b4';
const FOLIAGE = '#3f6b4a';
const FOLIAGE_DARK = '#2e5238';
const STEAM = 'rgba(232,242,246,0.5)';

function ptsStr(points: Pt[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}
const up = (p: Pt, dy: number): Pt => ({ x: p.x, y: p.y - dy });

/** Ground centre of a w×h footprint, relative to the anchor (top-left) cell's base point. */
function centerGround(w: number, h: number): Pt {
  return { x: ((w - h) * HW) / 2, y: ((w + h - 2) * HH) / 2 };
}

/**
 * Shared gradient defs — rendered once inside the TownCanvas <svg>. Stops use CSS vars so the
 * gradients follow the active palette. Referenced by stable url(#town-*) ids; one definition,
 * many references (no per-instance id collisions).
 */
export function TownArtDefs(): ReactNode {
  return (
    <defs>
      <linearGradient id="town-wall" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgb(var(--c-parchment-200))" />
        <stop offset="1" stopColor="rgb(var(--c-parchment-400))" />
      </linearGradient>
      <linearGradient id="town-roofA" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgb(var(--c-ember-bright))" />
        <stop offset="1" stopColor="rgb(var(--c-ember))" />
      </linearGradient>
      <linearGradient id="town-roofB" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgb(var(--c-gold-bright))" />
        <stop offset="1" stopColor="rgb(var(--c-gold-deep))" />
      </linearGradient>
      <linearGradient id="town-timber" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="rgb(var(--c-wood-500))" />
        <stop offset="1" stopColor="rgb(var(--c-wood-700))" />
      </linearGradient>
      <radialGradient id="town-forge" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="rgb(var(--c-ember-bright))" stopOpacity="0.9" />
        <stop offset="1" stopColor="rgb(var(--c-ember))" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}

// ---------------------------------------------------------------------------
// Primitive kit
// ---------------------------------------------------------------------------

interface BoxOpts {
  /** Fill for the top face (a Tailwind class or a url(#…) / rgb(...) string). */
  top?: string;
  /** Fill for the sunlit right face. */
  right?: string;
  /** Fill for the shaded left face. */
  left?: string;
  /** Extra upward shift applied to the whole box (for stacking storeys). */
  liftBase?: number;
}

/** Split a fill token into (className | undefined, fill | undefined) — `fill-*` → class, else attr. */
function splitFill(fill: string): { cls?: string; attr?: string } {
  return fill.startsWith('fill-') ? { cls: fill } : { attr: fill };
}

/**
 * An extruded box over a w×h footprint, `height` height-units tall. Draws the shaded left face,
 * the sunlit right face, and the lit top rhombus. Corners come from the footprint diamond so the
 * box tessellates with the ground grid.
 */
function isoBox(w: number, h: number, height: number, opts: BoxOpts = {}): ReactNode {
  const {
    top = 'url(#town-wall)',
    right = 'fill-parchment-400',
    left = 'fill-wood-600',
    liftBase = 0,
  } = opts;
  const lift = height * LIFT_PER_UNIT;
  const [N, E, S, W] = diamondCorners(w, h);
  const tN = up(N, liftBase + lift);
  const tE = up(E, liftBase + lift);
  const tS = up(S, liftBase + lift);
  const tW = up(W, liftBase + lift);
  const gS = up(S, liftBase);
  const gE = up(E, liftBase);
  const gW = up(W, liftBase);
  const t = splitFill(top);
  const r = splitFill(right);
  const l = splitFill(left);
  return (
    <g>
      <polygon className={l.cls} fill={l.attr} points={ptsStr([tW, tS, gS, gW])} />
      <polygon className={r.cls} fill={r.attr} points={ptsStr([tS, tE, gE, gS])} />
      <polygon className={t.cls} fill={t.attr} stroke="rgba(0,0,0,0.18)" strokeWidth={0.75}
        points={ptsStr([tN, tE, tS, tW])} />
    </g>
  );
}

/**
 * A free-standing mini-prism centred at ground point (cx, cy): a small isoBox not tied to the
 * grid. Half-widths rw (x) / rh (iso depth), `hgt` px tall. Used for chimneys, crates, posts,
 * anvils, plinths — anything placed on top of or beside a building.
 */
function prism(cx: number, cy: number, rw: number, rh: number, hgt: number, opts: BoxOpts = {}): ReactNode {
  const { top = 'fill-parchment-300', right = 'fill-parchment-400', left = 'fill-wood-600' } = opts;
  const N = { x: cx, y: cy - rh }, E = { x: cx + rw, y: cy }, S = { x: cx, y: cy + rh }, W = { x: cx - rw, y: cy };
  const tN = up(N, hgt), tE = up(E, hgt), tS = up(S, hgt), tW = up(W, hgt);
  const t = splitFill(top), r = splitFill(right), l = splitFill(left);
  return (
    <g>
      <polygon className={l.cls} fill={l.attr} points={ptsStr([tW, tS, S, W])} />
      <polygon className={r.cls} fill={r.attr} points={ptsStr([tS, tE, E, S])} />
      <polygon className={t.cls} fill={t.attr} stroke="rgba(0,0,0,0.16)" strokeWidth={0.6}
        points={ptsStr([tN, tE, tS, tW])} />
    </g>
  );
}

/** A simple gable roof cap sitting on top of a box `height` units up over a w×h footprint. */
function roofGable(w: number, h: number, height: number, fill: string, peak = 0.55): ReactNode {
  const lift = height * LIFT_PER_UNIT;
  const [N, E, S, W] = diamondCorners(w, h);
  const apex = { x: (E.x + W.x) / 2, y: (E.y + W.y) / 2 - lift - peak * LIFT_PER_UNIT };
  const eN = up(N, lift), eE = up(E, lift), eS = up(S, lift), eW = up(W, lift);
  const { cls, attr } = splitFill(fill);
  return (
    <g>
      <polygon className={cls} fill={attr} points={ptsStr([eW, eN, apex])} />
      <polygon className={cls} fill={attr} opacity={0.82} points={ptsStr([eN, eE, apex])} />
      <polygon className={cls} fill={attr} opacity={0.7} points={ptsStr([eE, eS, eW, apex])} />
    </g>
  );
}

/** A domed roof over a w×h footprint at `height` up — a front half-ellipse silhouette + finial. */
function dome(w: number, h: number, height: number, fill = 'url(#town-roofB)', rise = 0.9): ReactNode {
  const lift = height * LIFT_PER_UNIT;
  const c = centerGround(w, h);
  const rx = Math.min(w, h) * HW * 0.72;
  const ry = rise * LIFT_PER_UNIT;
  const baseY = c.y - lift;
  const { cls, attr } = splitFill(fill);
  return (
    <g>
      <path className={cls} fill={attr} stroke="rgba(0,0,0,0.15)" strokeWidth={0.75}
        d={`M ${c.x - rx} ${baseY} A ${rx} ${ry} 0 0 1 ${c.x + rx} ${baseY} Z`} />
      {/* soft sheen on the sunlit right flank */}
      <path fill="rgba(255,255,255,0.16)"
        d={`M ${c.x} ${baseY - ry} A ${rx} ${ry} 0 0 1 ${c.x + rx} ${baseY} L ${c.x} ${baseY} Z`} />
      <line x1={c.x} y1={baseY - ry} x2={c.x} y2={baseY - ry - 6} stroke="rgb(var(--c-gold-bright))" strokeWidth={1.5} />
      <circle cx={c.x} cy={baseY - ry - 7} r={2} className="fill-gold-bright" />
    </g>
  );
}

/** A tall pointed spire/steeple over a w×h footprint — two faces + a finial (chapel/watchtower). */
function spire(w: number, h: number, height: number, spireH: number, fill = 'url(#town-roofB)'): ReactNode {
  const lift = height * LIFT_PER_UNIT;
  const c = centerGround(w, h);
  const rw = Math.min(w, h) * HW * 0.5;
  const rh = Math.min(w, h) * HH * 0.5;
  const baseY = c.y - lift;
  const L = { x: c.x - rw, y: baseY }, R = { x: c.x + rw, y: baseY };
  const B = { x: c.x, y: baseY + rh }, apex = { x: c.x, y: baseY - spireH * LIFT_PER_UNIT };
  const { cls, attr } = splitFill(fill);
  return (
    <g>
      <polygon className={cls} fill={attr} opacity={0.72} points={ptsStr([L, B, apex])} />
      <polygon className={cls} fill={attr} points={ptsStr([B, R, apex])} />
      <circle cx={apex.x} cy={apex.y - 2} r={2.4} className="fill-gold-bright" stroke="rgb(var(--c-gold-deep))" strokeWidth={0.5} />
    </g>
  );
}

/**
 * A polygon-approximated cylindrical silo standing at ground point (cx, cyBase): elliptical rim,
 * a vertical body with a hoop band and side shading, and a conical cap. Granary signature volume.
 */
function silo(cx: number, cyBase: number, rw: number, hgt: number, cap = 'url(#town-roofB)'): ReactNode {
  const ry = rw * 0.42;
  const topY = cyBase - hgt;
  const { cls, attr } = splitFill(cap);
  return (
    <g>
      {/* body */}
      <path className="fill-parchment-300" stroke="rgba(0,0,0,0.16)" strokeWidth={0.75}
        d={`M ${cx - rw} ${cyBase} L ${cx - rw} ${topY} A ${rw} ${ry} 0 0 1 ${cx + rw} ${topY} L ${cx + rw} ${cyBase} A ${rw} ${ry} 0 0 1 ${cx - rw} ${cyBase} Z`} />
      {/* shaded left flank */}
      <path className="fill-wood-600" opacity={0.35}
        d={`M ${cx - rw} ${cyBase} L ${cx - rw} ${topY} A ${rw} ${ry} 0 0 1 ${cx - rw * 0.4} ${topY - ry * 0.6} L ${cx - rw * 0.4} ${cyBase + ry * 0.6} A ${rw} ${ry} 0 0 0 ${cx - rw} ${cyBase} Z`} />
      {/* hoop band */}
      <ellipse cx={cx} cy={cyBase - hgt * 0.5} rx={rw} ry={ry} fill="none" stroke="rgba(0,0,0,0.18)" strokeWidth={1.5} />
      {/* rim */}
      <ellipse cx={cx} cy={topY} rx={rw} ry={ry} className="fill-parchment-200" stroke="rgba(0,0,0,0.16)" strokeWidth={0.6} />
      {/* conical cap */}
      <polygon className={cls} fill={attr} points={`${cx - rw},${topY} ${cx + rw},${topY} ${cx},${topY - rw * 1.15}`} />
    </g>
  );
}

/** A perimeter fence around a w×h footprint: corner + mid posts joined by a top rail. */
function fence(w: number, h: number, postH = 0.32): ReactNode {
  const [N, E, S, W] = diamondCorners(w, h);
  const lift = postH * LIFT_PER_UNIT;
  const edges: [Pt, Pt][] = [[N, E], [E, S], [S, W], [W, N]];
  const posts: Pt[] = [];
  const rails: ReactNode[] = [];
  edges.forEach(([a, b], ei) => {
    const steps = Math.max(2, Math.round(Math.max(w, h) * 1.5));
    for (let i = 0; i <= steps; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
      if (ei === 0 || i > 0) posts.push(p);
    }
    rails.push(
      <line key={`rail-${ei}`} x1={a.x} y1={a.y - lift * 0.7} x2={b.x} y2={b.y - lift * 0.7}
        stroke="rgb(var(--c-wood-600))" strokeWidth={1.6} />,
    );
  });
  return (
    <g>
      {rails}
      {posts.map((p, i) => (
        <line key={`post-${i}`} x1={p.x} y1={p.y} x2={p.x} y2={p.y - lift}
          stroke="rgb(var(--c-wood-700))" strokeWidth={2} strokeLinecap="round" />
      ))}
    </g>
  );
}

/** A striped awning sloping out over a footprint's sunlit (S→E) front edge (trading post). */
function awning(w: number, h: number, height: number, stripes = 4): ReactNode {
  const lift = height * LIFT_PER_UNIT;
  const [, E, S] = diamondCorners(w, h);
  const eE = up(E, lift), eS = up(S, lift);
  const outX = 10, outY = 8; // eave overhang
  const oE = { x: eE.x + outX, y: eE.y + outY };
  const oS = { x: eS.x + outX * 0.3, y: eS.y + outY };
  const bars: ReactNode[] = [];
  for (let i = 0; i < stripes; i++) {
    const t0 = i / stripes, t1 = (i + 1) / stripes;
    const a = { x: eS.x + (eE.x - eS.x) * t0, y: eS.y + (eE.y - eS.y) * t0 };
    const b = { x: eS.x + (eE.x - eS.x) * t1, y: eS.y + (eE.y - eS.y) * t1 };
    const a2 = { x: oS.x + (oE.x - oS.x) * t0, y: oS.y + (oE.y - oS.y) * t0 };
    const b2 = { x: oS.x + (oE.x - oS.x) * t1, y: oS.y + (oE.y - oS.y) * t1 };
    bars.push(
      <polygon key={i} className={i % 2 === 0 ? 'fill-ember' : 'fill-parchment-200'}
        points={ptsStr([a, b, b2, a2])} />,
    );
  }
  return <g stroke="rgba(0,0,0,0.12)" strokeWidth={0.5}>{bars}</g>;
}

/** A row of windows painted flat on a footprint's front (S→E) face at height `atH`. */
function windowRow(w: number, h: number, wallH: number, atH: number, count = 2, glass = WATER): ReactNode {
  const [, E, S] = diamondCorners(w, h);
  const y = -atH * LIFT_PER_UNIT;
  const wins: ReactNode[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const cx = S.x + (E.x - S.x) * t;
    const cy = S.y + (E.y - S.y) * t + y;
    wins.push(
      <g key={i}>
        <rect x={cx - 2.4} y={cy - 5} width={4.8} height={7} rx={0.8} fill={glass} stroke="rgb(var(--c-wood-700))" strokeWidth={0.7} />
        <line x1={cx} y1={cy - 5} x2={cx} y2={cy + 2} stroke="rgb(var(--c-wood-700))" strokeWidth={0.5} />
      </g>,
    );
  }
  void wallH;
  return <g>{wins}</g>;
}

/** A banner pennant, anchored near a footprint's north corner. */
function banner(w: number, h: number, height: number, fill = 'fill-gold'): ReactNode {
  const lift = height * LIFT_PER_UNIT;
  const [N] = diamondCorners(w, h);
  const x = N.x, y = N.y - lift;
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - 18} stroke="rgb(var(--c-wood-700))" strokeWidth={1.5} />
      <polygon className={fill} points={`${x},${y - 18} ${x + 12},${y - 15} ${x},${y - 10}`} />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Composers — (w, h, tier, variant) => ReactNode. Tier growth is additive.
// ---------------------------------------------------------------------------

/** Generic house (fallback): walls + gable roof; taller storey and trim added per tier. */
function genericHouse(w: number, h: number, tier: number, variant: number): ReactNode {
  const wallH = 0.55 + tier * 0.15;
  const roofFill = variant % 2 === 0 ? 'url(#town-roofA)' : 'url(#town-roofB)';
  return (
    <g>
      {isoBox(w, h, wallH)}
      {roofGable(w, h, wallH, roofFill, tier >= 2 ? 0.7 : 0.5)}
      {tier >= 3 && banner(w, h, wallH + 0.4, 'fill-gold')}
    </g>
  );
}

/** The Keep: a broad, tall central block with an inset upper storey — bigger and distinct. */
function keep(tier: number): ReactNode {
  const baseH = 0.9 + tier * 0.2;
  const c = centerGround(3, 3);
  return (
    <g>
      {isoBox(3, 3, baseH)}
      {windowRow(3, 3, baseH, baseH * 0.55, 3)}
      {/* Upper storey (inset) */}
      {isoBox(2, 2, baseH * 0.55, { liftBase: baseH * LIFT_PER_UNIT, top: 'url(#town-wall)' })}
      {/* crenellated cap corners on the upper storey */}
      {tier >= 1 && [0, 1, 2, 3].map((i) => {
        const corner = diamondCorners(2, 2)[i];
        return <g key={i}>{prism(corner.x, corner.y - baseH * 1.55 * LIFT_PER_UNIT, 3, 1.5, 5, { top: 'fill-parchment-300' })}</g>;
      })}
      {tier >= 2 && roofGable(2, 2, baseH * 1.55, 'url(#town-roofB)', 0.8)}
      {tier >= 2 && banner(3, 3, baseH + 0.6, 'fill-ember')}
      {tier >= 3 && (
        <g>
          {banner(1, 1, baseH + 0.6, 'fill-gold')}
          {/* gilded ridge line along the keep top */}
          <line x1={c.x - HW} y1={c.y - baseH * LIFT_PER_UNIT} x2={c.x + HW} y2={c.y - baseH * LIFT_PER_UNIT}
            stroke="rgb(var(--c-gold-bright))" strokeWidth={1.5} opacity={0.8} />
        </g>
      )}
      {tier >= 4 && dome(2, 2, baseH * 2.1, 'url(#town-roofB)', 0.7)}
    </g>
  );
}

/** Watchtower (1×1): a slender, tall tower — a peaked roof at II, a pennant + gold ring at III. */
function watchtower(tier: number): ReactNode {
  const bodyH = 1.5 + tier * 0.4;
  const c = centerGround(1, 1);
  return (
    <g>
      {isoBox(1, 1, bodyH)}
      {windowRow(1, 1, bodyH, bodyH * 0.55, 1)}
      {/* battlement ring */}
      {[0, 1, 2, 3].map((i) => {
        const corner = diamondCorners(1, 1)[i];
        return <g key={i}>{prism(corner.x, corner.y - bodyH * LIFT_PER_UNIT, 3, 1.5, 4, { top: 'fill-parchment-300' })}</g>;
      })}
      {tier === 1 && (
        <line x1={c.x} y1={c.y - bodyH * LIFT_PER_UNIT} x2={c.x} y2={c.y - bodyH * LIFT_PER_UNIT - 10}
          stroke="rgb(var(--c-wood-700))" strokeWidth={1.5} />
      )}
      {tier >= 2 && spire(1, 1, bodyH, 1.0 + tier * 0.15, 'url(#town-roofA)')}
      {tier >= 3 && banner(1, 1, bodyH + 0.9, 'fill-gold')}
    </g>
  );
}

/** Bathhouse (2×2): a low wide hall under a dome, steam puffs, a small pool at the front. */
function bathhouse(tier: number): ReactNode {
  const wallH = 0.5 + tier * 0.12;
  const c = centerGround(2, 2);
  return (
    <g>
      {isoBox(2, 2, wallH)}
      {windowRow(2, 2, wallH, wallH * 0.5, 2)}
      {dome(2, 2, wallH, tier >= 2 ? 'url(#town-roofB)' : 'url(#town-wall)', 0.85 + tier * 0.08)}
      {/* steam puffs (static — reduced-motion safe) */}
      {[0, 1, 2].slice(0, tier).map((i) => (
        <circle key={i} cx={c.x - 8 + i * 9} cy={c.y - wallH * LIFT_PER_UNIT - 26 - i * 5} r={3 + i} fill={STEAM} />
      ))}
      {/* front pool */}
      <ellipse cx={c.x} cy={c.y + 12} rx={12} ry={5} fill={WATER} stroke={WATER_LIT} strokeWidth={1} />
      {tier >= 3 && banner(2, 2, wallH + 1.2, 'fill-gold')}
    </g>
  );
}

/** Trading Post (2×2): a hall with a striped awning and a stack of crates by the door. */
function trading_post(tier: number): ReactNode {
  const wallH = 0.55 + tier * 0.14;
  const c = centerGround(2, 2);
  return (
    <g>
      {isoBox(2, 2, wallH)}
      {roofGable(2, 2, wallH, 'url(#town-roofA)', 0.55)}
      {awning(2, 2, wallH * 0.62, 3 + tier)}
      {/* crates in front */}
      {prism(c.x - 10, c.y + 14, 5, 2.6, 6, { top: 'url(#town-timber)', right: 'fill-wood-500', left: 'fill-wood-700' })}
      {tier >= 2 && prism(c.x - 3, c.y + 17, 5, 2.6, 6, { top: 'url(#town-timber)', right: 'fill-wood-500', left: 'fill-wood-700' })}
      {tier >= 2 && prism(c.x - 7, c.y + 11, 4.5, 2.4, 12, { top: 'url(#town-timber)', right: 'fill-wood-500', left: 'fill-wood-700' })}
      {tier >= 3 && banner(2, 2, wallH + 0.9, 'fill-gold')}
    </g>
  );
}

/** Training Yard (2×3): an open, fenced yard with a training dummy; a shed + banners grow in. */
function training_yard(tier: number): ReactNode {
  const c = centerGround(2, 3);
  return (
    <g>
      {/* packed-earth ground patch */}
      <polygon points={ptsStr(diamondCorners(2, 3))} fill="#6b5636" opacity={0.55} />
      {fence(2, 3, 0.34)}
      {/* training dummy: post + crossbar + straw head */}
      {prism(c.x + 8, c.y - 2, 2, 1.2, 20, { top: 'fill-wood-700', right: 'fill-wood-600', left: 'fill-wood-700' })}
      <line x1={c.x + 8 - 8} y1={c.y - 2 - 22} x2={c.x + 8 + 8} y2={c.y - 2 - 22} stroke="rgb(var(--c-wood-600))" strokeWidth={2} />
      <circle cx={c.x + 8} cy={c.y - 2 - 26} r={4} fill="#c9a24a" stroke="rgb(var(--c-wood-700))" strokeWidth={0.8} />
      {/* weapon rack (tier ≥ 2) */}
      {tier >= 2 && (
        <g stroke="rgb(var(--c-wood-700))" strokeWidth={1.6}>
          <line x1={c.x - 14} y1={c.y + 6} x2={c.x - 14} y2={c.y - 8} />
          <line x1={c.x - 10} y1={c.y + 7} x2={c.x - 10} y2={c.y - 9} />
          <line x1={c.x - 16} y1={c.y - 4} x2={c.x - 8} y2={c.y - 6} />
        </g>
      )}
      {/* small shed at the back (tier ≥ 2) */}
      {tier >= 2 && (
        <g transform={`translate(${c.x - 8} ${c.y - 6})`}>
          {prism(0, 0, 8, 4, 12, { top: 'url(#town-wall)' })}
          <polygon className="fill-ember" points={`${-9},${-12} ${9},${-12} ${0},${-20}`} />
        </g>
      )}
      {tier >= 3 && banner(2, 3, 0.5, 'fill-gold')}
    </g>
  );
}

/** Granary (2×2): a polygon silo beside a low barn; a second silo + gold cap grow in. */
function granary(tier: number): ReactNode {
  const wallH = 0.42 + tier * 0.1;
  const c = centerGround(2, 2);
  return (
    <g>
      {isoBox(2, 2, wallH)}
      {roofGable(2, 2, wallH, 'url(#town-timber)', 0.5)}
      {silo(c.x + 6, c.y + 4, 9, 34 + tier * 6, tier >= 3 ? 'url(#town-roofB)' : 'url(#town-roofA)')}
      {tier >= 2 && silo(c.x - 12, c.y + 8, 6, 24, tier >= 3 ? 'url(#town-roofB)' : 'url(#town-roofA)')}
      {tier >= 3 && banner(2, 2, wallH + 0.9, 'fill-gold')}
    </g>
  );
}

/** Mason's Guild (2×2): a sturdy stone workshop with a chimney and dressed stone blocks out front. */
function masons_guild(tier: number): ReactNode {
  const wallH = 0.6 + tier * 0.14;
  const c = centerGround(2, 2);
  return (
    <g>
      {isoBox(2, 2, wallH, { top: 'url(#town-wall)', right: 'fill-parchment-300', left: 'fill-wood-700' })}
      {roofGable(2, 2, wallH, 'url(#town-wall)', 0.5 + tier * 0.06)}
      {windowRow(2, 2, wallH, wallH * 0.5, 2)}
      {/* stone-block chimney */}
      {prism(c.x + 16, c.y - 6, 4, 2, (wallH + 0.9) * LIFT_PER_UNIT, { top: 'fill-parchment-300', right: 'fill-parchment-400', left: 'fill-wood-700' })}
      {/* dressed stone blocks stacked out front */}
      {prism(c.x - 12, c.y + 14, 5, 2.5, 6, { top: 'fill-parchment-300', right: 'fill-parchment-400', left: 'fill-wood-600' })}
      {prism(c.x - 5, c.y + 17, 5, 2.5, 6, { top: 'fill-parchment-300', right: 'fill-parchment-400', left: 'fill-wood-600' })}
      {tier >= 2 && prism(c.x - 8, c.y + 11, 4.5, 2.3, 12, { top: 'fill-parchment-300', right: 'fill-parchment-400', left: 'fill-wood-600' })}
      {tier >= 3 && banner(2, 2, wallH + 0.9, 'fill-gold')}
    </g>
  );
}

/** Smithy (2×2): a workshop with a tall smoking chimney and an anvil under a warm forge glow. */
function smithy(tier: number): ReactNode {
  const wallH = 0.55 + tier * 0.13;
  const c = centerGround(2, 2);
  const chimH = (wallH + 0.9 + tier * 0.25) * LIFT_PER_UNIT;
  return (
    <g>
      {isoBox(2, 2, wallH)}
      {roofGable(2, 2, wallH, 'url(#town-timber)', 0.5)}
      {/* forge glow spilling from the doorway (ember, palette-aware, static) */}
      <ellipse cx={c.x} cy={c.y + 10} rx={13} ry={7} fill="url(#town-forge)" />
      {/* anvil */}
      {prism(c.x, c.y + 12, 4, 2, 4, { top: 'fill-wood-800', right: 'fill-wood-700', left: 'fill-wood-900' })}
      <polygon className="fill-wood-800" points={`${c.x - 6},${c.y + 6} ${c.x + 4},${c.y + 6} ${c.x + 6},${c.y + 3} ${c.x - 2},${c.y + 3}`} />
      {/* smoking chimney */}
      {prism(c.x + 14, c.y - 6, 4, 2, chimH, { top: 'fill-wood-700', right: 'fill-wood-600', left: 'fill-wood-800' })}
      {[0, 1, 2].slice(0, 1 + tier).map((i) => (
        <circle key={i} cx={c.x + 14 + i * 3} cy={c.y - 6 - chimH - 6 - i * 6} r={2.5 + i} fill={STEAM} />
      ))}
      {tier >= 3 && banner(2, 2, wallH + 0.9, 'fill-gold')}
    </g>
  );
}

/** Chapel (2×2): a nave with a tall steeple and a rose window; buttresses + gold cross grow in. */
function chapel(tier: number): ReactNode {
  const wallH = 0.6 + tier * 0.12;
  const c = centerGround(2, 2);
  return (
    <g>
      {isoBox(2, 2, wallH, { top: 'url(#town-wall)', right: 'fill-parchment-300', left: 'fill-wood-700' })}
      {roofGable(2, 2, wallH, 'url(#town-roofA)', 0.6)}
      {/* rose window on the front face */}
      <circle cx={c.x + 8} cy={c.y - wallH * LIFT_PER_UNIT * 0.5} r={3.4} fill={WATER} stroke="rgb(var(--c-gold-deep))" strokeWidth={0.9} />
      {/* buttresses (tier ≥ 2) */}
      {tier >= 2 && (
        <g>
          {prism(c.x - 20, c.y - 2, 2.5, 1.5, (wallH * 0.8) * LIFT_PER_UNIT, { top: 'fill-parchment-300', left: 'fill-wood-700' })}
          {prism(c.x - 14, c.y + 6, 2.5, 1.5, (wallH * 0.8) * LIFT_PER_UNIT, { top: 'fill-parchment-300', left: 'fill-wood-700' })}
        </g>
      )}
      {spire(1, 1, wallH, 2.0 + tier * 0.4, tier >= 3 ? 'url(#town-roofB)' : 'url(#town-wall)')}
      {tier >= 3 && (
        <g stroke="rgb(var(--c-gold-bright))" strokeWidth={2} strokeLinecap="round">
          <line x1={c.x} y1={c.y - (wallH + 2.4 + 1.2) * LIFT_PER_UNIT} x2={c.x} y2={c.y - (wallH + 2.4 + 1.2) * LIFT_PER_UNIT - 9} />
          <line x1={c.x - 4} y1={c.y - (wallH + 2.4 + 1.2) * LIFT_PER_UNIT - 4} x2={c.x + 4} y2={c.y - (wallH + 2.4 + 1.2) * LIFT_PER_UNIT - 4} />
        </g>
      )}
    </g>
  );
}

/** Manor (2×3): a grand multi-gabled residence — a wing, window rows, then gilding + banners. */
function manor(tier: number): ReactNode {
  const wallH = 0.6 + tier * 0.16;
  const c = centerGround(2, 3);
  return (
    <g>
      {isoBox(2, 3, wallH)}
      {windowRow(2, 3, wallH, wallH * 0.55, 3)}
      {roofGable(2, 3, wallH, 'url(#town-roofA)', 0.6)}
      {/* front wing (a smaller box + its own gable) */}
      <g transform={`translate(${c.x - 4} ${c.y + 10})`}>
        {prism(0, 0, 12, 6, (wallH * 0.75) * LIFT_PER_UNIT, { top: 'url(#town-wall)' })}
        <polygon className="fill-ember" points={`${-13},${-(wallH * 0.75) * LIFT_PER_UNIT} ${13},${-(wallH * 0.75) * LIFT_PER_UNIT} ${0},${-(wallH * 0.75) * LIFT_PER_UNIT - 12}`} />
      </g>
      {/* second storey (tier ≥ 2) */}
      {tier >= 2 && isoBox(2, 2, wallH * 0.5, { liftBase: wallH * LIFT_PER_UNIT, top: 'url(#town-wall)' })}
      {tier >= 2 && roofGable(2, 2, wallH * 1.5, 'url(#town-roofB)', 0.6)}
      {tier >= 3 && (
        <g>
          {banner(2, 3, wallH + 1.0, 'fill-gold')}
          {banner(1, 1, wallH + 1.0, 'fill-gold')}
        </g>
      )}
    </g>
  );
}

/** Construction scaffold — a translucent timber frame shown for queued build projects. */
export function scaffold(w: number, h: number): ReactNode {
  const frameH = 0.7;
  const lift = frameH * LIFT_PER_UNIT;
  const [N, E, S, W] = diamondCorners(w, h);
  const upP = (p: Pt): Pt => ({ x: p.x, y: p.y - lift });
  const posts = [N, E, S, W];
  return (
    <g opacity={0.85}>
      <polygon fill="rgba(120,90,50,0.25)" points={ptsStr([N, E, S, W])} />
      {posts.map((p, i) => (
        <line key={i} x1={p.x} y1={p.y} x2={p.x} y2={p.y - lift}
          stroke="rgb(var(--c-wood-500))" strokeWidth={3} strokeLinecap="round" />
      ))}
      <polygon fill="url(#town-timber)" opacity={0.6}
        points={ptsStr([upP(N), upP(E), upP(S), upP(W)])} />
      <line x1={W.x} y1={W.y} x2={upP(E).x} y2={upP(E).y}
        stroke="rgb(var(--c-wood-600))" strokeWidth={2} />
    </g>
  );
}

/** Dispatch: pick the composer for a building's artKey. Unknown artKeys fall back to genericHouse. */
export function buildingArt(artKey: string, w: number, h: number, tier: number, variant: number): ReactNode {
  switch (artKey) {
    case 'keep': return keep(tier);
    case 'watchtower': return watchtower(tier);
    case 'bathhouse': return bathhouse(tier);
    case 'trading_post': return trading_post(tier);
    case 'training_yard': return training_yard(tier);
    case 'granary': return granary(tier);
    case 'masons_guild': return masons_guild(tier);
    case 'smithy': return smithy(tier);
    case 'chapel': return chapel(tier);
    case 'manor': return manor(tier);
    default: return genericHouse(w, h, tier, variant);
  }
}

// ---------------------------------------------------------------------------
// Decor — distinct props with small deterministic variants (v = 0..3).
// ---------------------------------------------------------------------------

/** Directions to adjacent cobble cells, for auto-connecting path segments. */
export interface PathConn { n: boolean; e: boolean; s: boolean; w: boolean; }

/**
 * A cobble path tile that auto-connects: a rounded stone patch plus a stub toward each orthogonal
 * neighbour that is also a path. Adjacency (PathConn) is computed by the caller from the decor list.
 * Grid dirs map to iso edges: +c → SE edge, −c → NW, +r → SW, −r → NE.
 */
export function cobblePath(conn: PathConn): ReactNode {
  const [N, E, S, W] = diamondCorners(1, 1);
  const sc = (p: Pt, k: number): Pt => ({ x: p.x * k, y: p.y * k });
  const patch = [N, E, S, W].map((p) => sc(p, 0.6));
  // A stub fills the gap between the central patch and one cell edge (corners A,B), so adjacent
  // path tiles meet along their shared edge and read as one continuous path.
  const stub = (a: Pt, b: Pt): ReactNode => <polygon points={ptsStr([sc(a, 0.6), sc(b, 0.6), b, a])} />;
  return (
    <g className="fill-parchment-300" stroke="rgb(var(--c-wood-700))" strokeWidth={0.5} strokeOpacity={0.5}>
      <polygon points={ptsStr(patch)} />
      {conn.e && stub(E, S)} {/* +c → SE edge */}
      {conn.s && stub(S, W)} {/* +r → SW edge */}
      {conn.w && stub(W, N)} {/* −c → NW edge */}
      {conn.n && stub(N, E)} {/* −r → NE edge */}
    </g>
  );
}

const FOLIAGE_KEYS = new Set(['tree', 'hedge', 'flower_bed']);

/** A small, distinct prop for a decor artKey. `v` (0..3) drives a deterministic size/flip/hue tweak. */
export function decorArt(artKey: string, v = 0): ReactNode {
  const flip = v % 2 === 1 ? -1 : 1;
  const grow = 1 + (v % 3) * 0.08;
  switch (artKey) {
    case 'tree':
      return (
        <g transform={`scale(${flip} 1)`}>
          <line x1={0} y1={0} x2={0} y2={-11 * grow} stroke="#4a3320" strokeWidth={2.2} />
          <circle cx={0} cy={-15 * grow} r={7 * grow} fill={FOLIAGE} stroke={FOLIAGE_DARK} strokeWidth={1} />
          <circle cx={-4} cy={-12 * grow} r={4 * grow} fill={FOLIAGE_DARK} opacity={0.7} />
        </g>
      );
    case 'hedge':
      return (
        <g>
          <ellipse cx={0} cy={-4} rx={11 * grow} ry={6} fill={FOLIAGE} stroke={FOLIAGE_DARK} strokeWidth={1} />
          <ellipse cx={-4} cy={-6} rx={4} ry={3} fill={FOLIAGE_DARK} opacity={0.6} />
        </g>
      );
    case 'flower_bed':
      return (
        <g>
          <polygon points={ptsStr(diamondCorners(1, 1).map((p) => ({ x: p.x * 0.5, y: p.y * 0.5 })))} fill={FOLIAGE_DARK} />
          {[['#d86a7a', -4], ['#e8b923', 3], ['#7a6ad8', 0]].map(([col, dx], i) => (
            <circle key={i} cx={Number(dx) * flip} cy={-4 - (i % 2) * 3} r={2.4} fill={col as string} />
          ))}
        </g>
      );
    case 'well':
      return (
        <g>
          {prism(0, 2, 8, 4, 7, { top: WATER, right: 'fill-parchment-400', left: 'fill-wood-700' })}
          <line x1={-7} y1={-6} x2={7} y2={-6} stroke="rgb(var(--c-wood-700))" strokeWidth={1.5} />
          <line x1={-6} y1={-6} x2={-6} y2={-14} stroke="rgb(var(--c-wood-700))" strokeWidth={1.5} />
          <line x1={6} y1={-6} x2={6} y2={-14} stroke="rgb(var(--c-wood-700))" strokeWidth={1.5} />
          <polygon className="fill-ember" points={`-9,-13 9,-13 0,-19`} />
        </g>
      );
    case 'lamppost':
      return (
        <g>
          <line x1={0} y1={2} x2={0} y2={-18 * grow} stroke="rgb(var(--c-wood-700))" strokeWidth={2} />
          <circle cx={0} cy={-20 * grow} r={3} className="fill-gold-bright" stroke="rgb(var(--c-gold-deep))" strokeWidth={0.6} />
          <circle cx={0} cy={-20 * grow} r={5.5} fill="url(#town-forge)" />
        </g>
      );
    case 'banner':
      return (
        <g transform={`scale(${flip} 1)`}>
          <line x1={0} y1={2} x2={0} y2={-22} stroke="rgb(var(--c-wood-700))" strokeWidth={1.8} />
          <polygon className={v % 2 === 0 ? 'fill-ember' : 'fill-gold'} points={`0,-22 11,-19 11,-9 0,-11`} />
        </g>
      );
    case 'fountain': {
      const c = centerGround(2, 2);
      return (
        <g transform={`translate(${c.x} ${c.y})`}>
          <ellipse cx={0} cy={6} rx={16} ry={8} fill={WATER} stroke="rgb(var(--c-parchment-400))" strokeWidth={2} />
          {prism(0, 4, 4, 2, 8, { top: 'fill-parchment-300', right: 'fill-parchment-400', left: 'fill-wood-700' })}
          <ellipse cx={0} cy={-6} rx={7} ry={3.5} fill={WATER_LIT} stroke="rgb(var(--c-parchment-400))" strokeWidth={1.2} />
          <circle cx={0} cy={-12} r={2} fill={WATER_LIT} />
        </g>
      );
    }
    case 'statue':
      return (
        <g>
          {prism(0, 2, 7, 3.5, 5, { top: 'fill-parchment-300', right: 'fill-parchment-400', left: 'fill-wood-700' })}
          <g transform={`translate(0 -5) scale(${flip} 1)`}>
            <circle cx={0} cy={-16} r={3} className="fill-parchment-200" />
            <polygon className="fill-parchment-300" points={`-3,-14 3,-14 4,-2 -4,-2`} stroke="rgb(var(--c-wood-600))" strokeWidth={0.5} />
          </g>
        </g>
      );
    case 'cart':
      return (
        <g transform={`scale(${flip} 1)`}>
          {prism(0, 0, 9, 4, 5, { top: 'url(#town-timber)', right: 'fill-wood-500', left: 'fill-wood-700' })}
          <circle cx={-6} cy={4} r={3} fill="none" stroke="rgb(var(--c-wood-700))" strokeWidth={1.6} />
          <circle cx={6} cy={4} r={3} fill="none" stroke="rgb(var(--c-wood-700))" strokeWidth={1.6} />
        </g>
      );
    case 'cobble_path':
      // Isolated tile (no adjacency context) — TownCanvas renders connected paths via cobblePath().
      return cobblePath({ n: false, e: false, s: false, w: false });
    default:
      return FOLIAGE_KEYS.has(artKey)
        ? <circle cx={0} cy={-8} r={7} fill={FOLIAGE} stroke={FOLIAGE_DARK} strokeWidth={1} />
        : isoBox(1, 1, 0.35, { top: 'fill-parchment-300', right: 'fill-parchment-400', left: 'fill-wood-600' });
  }
}
