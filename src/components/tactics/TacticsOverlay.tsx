import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Zap, Sparkles, Footprints, LogOut, Skull, Trophy, ChevronRight } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import {
  type Tile,
  type TacticalEffect,
  type UnitStatus,
  TERRAIN_ICONS,
} from '@/engine/hexBattle';
import { hexKey, hexDistance, type Hex } from '@/engine/hex';
import { getSpell, type StatusKey } from '@/engine/spells';
import { MAX_ELEVATION, SPELL_RANGE, climbFor, heightRangeBonus, hasLineOfSight } from '@/engine/hexBattle';
import { base, topCenter, hexCorners, isoBounds, colHeight, type Pt } from './iso';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

// --- Board geometry -----------------------------------------------------------------------------
/** Fallback hex size before the container has been measured. */
function sizeFor(radius: number): number {
  return radius <= 3 ? 30 : radius === 4 ? 24 : radius === 5 ? 19 : 16;
}

/** Largest hex size whose board fits the available area — the board grows to fill the screen. */
function fitSize(radius: number, availW: number, availH: number): number {
  const probe = isoBounds(radius, 100, MAX_ELEVATION); // bounds scale ~linearly with size
  const s = 100 * Math.min(availW / probe.width, availH / probe.height);
  return Math.max(14, Math.min(72, Math.floor(s)));
}

const STATUS_GLYPH: Record<StatusKey, string> = {
  bless: '🛡️', burn: '🔥', weaken: '🔻', blind: '💫', freeze: '❄️', poison: '☠️',
};

/** Per-spell animation keyframe + accent glyph. Falls back to a generic cast flash. */
const SPELL_FX: Record<string, { anim: string; glyph: string }> = {
  sparks: { anim: 'tactics-sparks', glyph: '⚡' },
  firebolt: { anim: 'tactics-firebolt', glyph: '🔥' },
  mend: { anim: 'tactics-mend', glyph: '✚' },
  bless: { anim: 'tactics-bless', glyph: '✨' },
  dazzle: { anim: 'tactics-dazzle', glyph: '💫' },
  hex: { anim: 'tactics-hex', glyph: '🟣' },
};

function terrainRGB(t: Tile): [number, number, number] {
  // Brightness ramps with elevation so higher tiles read as raised.
  const lift = t.elevation * 12;
  switch (t.terrain) {
    case 'blocked': return [60 + lift, 56 + lift, 64 + lift];
    case 'cover': return [96 + lift, 72 + lift, 44 + lift];
    case 'slow': return [52 + lift, 78 + lift, 48 + lift];
    case 'hazard': return [120 + lift, 48 + lift, 36 + lift];
    default: return [46 + lift, 58 + lift, 70 + lift];
  }
}
const rgbStr = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
/** Darken a colour by a factor (0..1) for column side walls — sells the 3D form. */
const darken = (c: [number, number, number], f: number): string =>
  `rgb(${Math.round(c[0] * f)},${Math.round(c[1] * f)},${Math.round(c[2] * f)})`;
/** SVG points string from a list of corners offset to a centre. */
const ptsAt = (corners: Pt[], cx: number, cy: number) => corners.map((p) => `${cx + p.x},${cy + p.y}`).join(' ');

function Gauge({ icon, value, max, fill }: { icon: React.ReactNode; value: number; max: number; fill: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <div className="h-2.5 w-20 overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: fill }} />
      </div>
      <span className="font-display text-[11px] tabular-nums text-parchment-300">
        {Math.max(0, Math.round(value))}/{Math.round(max)}
      </span>
    </div>
  );
}

function StatusRow({ statuses }: { statuses: UnitStatus[] }) {
  if (statuses.length === 0) return null;
  return (
    <div className="pointer-events-none flex gap-0.5 text-[10px]" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.8))' }}>
      {statuses.map((st) => (
        <span key={st.key} title={`${st.key} (${st.turns})`}>{STATUS_GLYPH[st.key]}</span>
      ))}
    </div>
  );
}

export function TacticsOverlay() {
  const tactics = useGameStore((s) => s.tactics);
  const tacticsSelect = useGameStore((s) => s.tacticsSelect);
  const tacticsMove = useGameStore((s) => s.tacticsMove);
  const tacticsAttack = useGameStore((s) => s.tacticsAttack);
  const tacticsCast = useGameStore((s) => s.tacticsCast);
  const tacticsEndTurn = useGameStore((s) => s.tacticsEndTurn);
  const endTactics = useGameStore((s) => s.endTactics);

  // Animation queue: replay each engine effect at its staggered offset, then clear.
  const [live, setLive] = useState<TacticalEffect[]>([]);
  const [animating, setAnimating] = useState(false);
  const lastBatch = useRef<TacticalEffect[] | null>(null);

  // Measure the board area so the board can grow to fill the available space.
  const boardWrapRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setVp({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effects = tactics?.effects;
  useEffect(() => {
    const fx = effects ?? [];
    if (fx.length === 0 || lastBatch.current === fx) return;
    lastBatch.current = fx;
    const timers: number[] = [];
    let maxEnd = 0;
    for (const e of fx) {
      const end = e.startedAtMs + e.durationMs;
      maxEnd = Math.max(maxEnd, end);
      timers.push(window.setTimeout(() => setLive((l) => [...l, e]), e.startedAtMs));
      timers.push(window.setTimeout(() => setLive((l) => l.filter((x) => x.id !== e.id)), end));
    }
    setAnimating(true);
    timers.push(window.setTimeout(() => setAnimating(false), maxEnd + 40));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [effects]);

  const radius = tactics?.radius ?? 3;
  // Fit the board to the measured area (minus a small margin); fall back before first measure.
  const size = useMemo(
    () => (vp.w > 0 && vp.h > 0 ? fitSize(radius, vp.w - 16, vp.h - 16) : sizeFor(radius)),
    [radius, vp.w, vp.h],
  );
  const bounds = useMemo(() => isoBounds(radius, size, MAX_ELEVATION), [radius, size]);
  if (!tactics) return null;

  const elevationOf = (h: Hex) => tactics.tiles[hexKey(h)]?.elevation ?? 0;
  /** Top-face centre of a tile's column, in board canvas coordinates. */
  const top = (h: Hex) => {
    const p = topCenter(h, size, elevationOf(h));
    return { x: p.x + bounds.offsetX, y: p.y + bounds.offsetY };
  };
  /** Ground (base) y of a hex — drives back-to-front painter order. */
  const groundY = (h: Hex) => base(h, size).y;

  const reachable = new Set(tactics.reachable.map(hexKey));
  const targetable = new Set(tactics.targetable.map(hexKey));
  const sel = tactics.selected;
  const isPlayerTurn = tactics.turn === 'player' && tactics.status === 'active';
  const locked = animating || !isPlayerTurn;

  // Firing field: when a ranged attack / spell is selected, light up every tile a projectile can
  // reach — bounded by range, and stopping at walls, tall ridges, and units (line-of-sight blockers).
  const firing = (() => {
    const set = new Set<string>();
    if (locked) return set;
    let baseRange = 0;
    if (sel?.kind === 'attack' && tactics.weapon.ranged) baseRange = tactics.weapon.range ?? 1;
    else if (sel?.kind === 'spell') {
      const sp = getSpell(sel.spellKey);
      if (sp && sp.school !== 'support') baseRange = SPELL_RANGE;
    }
    if (baseRange <= 0) return set;
    const p = tactics.player.hex;
    const pz = elevationOf(p);
    for (const tile of Object.values(tactics.tiles)) {
      const d = hexDistance(p, tile.hex);
      if (d < 1) continue;
      const eff = baseRange + heightRangeBonus(pz - tile.elevation);
      if (d <= eff && hasLineOfSight(tactics, p, tile.hex)) set.add(hexKey(tile.hex));
    }
    return set;
  })();

  function onTileClick(h: Hex) {
    if (locked) return;
    const key = hexKey(h);
    if (sel?.kind === 'move' && reachable.has(key)) tacticsMove(h);
    else if (sel?.kind === 'attack' && targetable.has(key)) tacticsAttack(h);
    else if (sel?.kind === 'spell' && targetable.has(key)) tacticsCast(sel.spellKey, h);
  }

  function onPickSpell(spellKey: string) {
    const spell = getSpell(spellKey);
    if (!spell) return;
    // Support spells (heal/ward) target the caster — fire immediately, no tile pick needed.
    if (spell.school === 'support') tacticsCast(spellKey, null);
    else tacticsSelect({ kind: 'spell', spellKey });
  }

  const weapon = tactics.weapon;
  const attackLabel = weapon.ranged ? 'Shoot' : 'Strike';

  // Painter order: back (smaller ground y) first so front columns/units occlude those behind.
  const tilesByDepth = Object.values(tactics.tiles)
    .slice()
    .sort((a, b) => groundY(a.hex) - groundY(b.hex) || a.hex.q - b.hex.q);
  const unitsByDepth = [
    {
      key: 'player', hex: tactics.player.hex, glyph: '🧝',
      hp: tactics.player.hp, maxHp: tactics.player.maxHp, statuses: tactics.player.statuses,
      friendly: true, name: 'You' as string | undefined,
    },
    ...tactics.enemies.map((e) => ({
      key: `e${e.id}`, hex: e.hex, glyph: e.icon,
      hp: e.hp, maxHp: e.maxHp, statuses: e.statuses, friendly: false, name: e.name as string | undefined,
    })),
  ].sort((a, b) => groundY(a.hex) - groundY(b.hex));

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-wood-950/95 backdrop-blur-sm">
      {/* Header: turn banner + player gauges */}
      <div className="flex items-center justify-between border-b border-gold-deep/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2.5 py-1 font-display text-xs font-bold uppercase tracking-wider',
              isPlayerTurn ? 'bg-stat-AG/20 text-stat-AG' : 'bg-ember-deep/20 text-ember-bright',
            )}
          >
            {tactics.status !== 'active' ? 'Skirmish over' : isPlayerTurn ? 'Your turn' : 'Enemy turn'}
          </span>
          {isPlayerTurn && (
            <span className="flex items-center gap-1 font-display text-[11px] text-parchment-300">
              <Footprints className="h-3.5 w-3.5 text-stat-AG" /> {tactics.player.movesLeft}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          <Gauge icon={<Heart className="h-3.5 w-3.5 text-red-400" />} value={tactics.player.hp} max={tactics.player.maxHp} fill="#ef4444" />
          <Gauge icon={<Sparkles className="h-3.5 w-3.5 text-blue-400" />} value={tactics.player.mp} max={tactics.player.maxMp} fill="#3b82f6" />
          <Gauge icon={<Zap className="h-3.5 w-3.5 text-amber-400" />} value={tactics.player.sta} max={tactics.player.maxSta} fill="#f59e0b" />
        </div>
      </div>

      {/* Board */}
      <div ref={boardWrapRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
        <div className="relative" style={{ width: bounds.width, height: bounds.height }}>
          {/* Board columns (SVG), drawn back-to-front so taller front columns occlude those behind. */}
          <svg width={bounds.width} height={bounds.height} className="absolute inset-0">
            {tilesByDepth.map((tile) => {
              const t = top(tile.hex);
              const key = hexKey(tile.hex);
              const rgb = terrainRGB(tile);
              const corners = hexCorners(size);
              const E = tile.elevation * colHeight(size);
              const highlight = reachable.has(key) ? 'reach' : targetable.has(key) ? 'target' : null;
              // One extruded side-wall quad between two bottom corners, dropped down by E.
              const wall = (a: number, b: number, fill: string) => {
                const pa = corners[a];
                const pb = corners[b];
                const pts = [
                  `${t.x + pa.x},${t.y + pa.y}`,
                  `${t.x + pb.x},${t.y + pb.y}`,
                  `${t.x + pb.x},${t.y + pb.y + E}`,
                  `${t.x + pa.x},${t.y + pa.y + E}`,
                ].join(' ');
                return <polygon points={pts} fill={fill} />;
              };
              return (
                <g key={key}>
                  {E > 0 && (
                    <>
                      {/* bottom silhouette: left(3)→lower-left(4)→lower-right(5)→right(0) */}
                      {wall(3, 4, darken(rgb, 0.55))}
                      {wall(4, 5, darken(rgb, 0.42))}
                      {wall(5, 0, darken(rgb, 0.72))}
                    </>
                  )}
                  <polygon
                    points={ptsAt(corners, t.x, t.y)}
                    fill={rgbStr(rgb)}
                    stroke={highlight === 'reach' ? 'rgba(56,189,248,0.95)' : highlight === 'target' ? 'rgba(251,191,36,0.95)' : 'rgba(0,0,0,0.4)'}
                    strokeWidth={highlight ? 3 : 1}
                    style={{ cursor: highlight || firing.has(key) ? 'pointer' : 'default' }}
                    onClick={() => onTileClick(tile.hex)}
                  />
                  {/* Projectile reach overlay (orange) — sits over the top face but lets clicks through. */}
                  {firing.has(key) && (
                    <polygon
                      points={ptsAt(corners, t.x, t.y)}
                      fill="rgba(251,146,60,0.32)"
                      stroke="rgba(251,146,60,0.7)"
                      strokeWidth={1}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {TERRAIN_ICONS[tile.terrain] && (
                    <text
                      x={t.x}
                      y={t.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={size * 0.7}
                      opacity={0.85}
                      style={{ pointerEvents: 'none' }}
                    >
                      {TERRAIN_ICONS[tile.terrain]}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Units (DOM overlay, painter-sorted so front units paint over back columns) */}
          {unitsByDepth.map((u) => {
            const c = top(u.hex);
            return (
              <UnitSprite
                key={u.key}
                x={c.x}
                y={c.y}
                glyph={u.glyph}
                hp={u.hp}
                maxHp={u.maxHp}
                statuses={u.statuses}
                friendly={u.friendly}
                name={u.name}
                scale={size / 30}
              />
            );
          })}

          {/* Animation effects */}
          {live.map((fx) => (
            <EffectSprite key={fx.id} fx={fx} from={top(fx.from)} to={top(fx.to)} />
          ))}
        </div>

        {/* Outcome banner */}
        {tactics.status !== 'active' && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-wood-950/80">
            {tactics.status === 'won' ? (
              <>
                <Trophy className="h-10 w-10 text-gold-bright" />
                <div className="font-display text-xl font-bold text-gold-bright">Victory!</div>
              </>
            ) : (
              <>
                <Skull className="h-10 w-10 text-ember-bright" />
                <div className="font-display text-xl font-bold text-ember-bright">Defeated</div>
              </>
            )}
            <Button onClick={endTactics} className="px-6 py-2">
              {tactics.status === 'won' ? 'Claim reward' : 'Leave'}
            </Button>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="border-t border-gold-deep/40 bg-wood-900/80 px-3 py-2">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-1.5">
          <ActionButton active={sel?.kind === 'move'} disabled={locked || tactics.player.movesLeft <= 0} onClick={() => tacticsSelect({ kind: 'move' })}>
            <Footprints className="h-4 w-4" /> Move
          </ActionButton>
          <ActionButton active={sel?.kind === 'attack'} disabled={locked || tactics.player.hasActed} onClick={() => tacticsSelect({ kind: 'attack' })}>
            ⚔️ {attackLabel}
          </ActionButton>
          {tactics.knownSpells.map((key) => {
            const spell = getSpell(key);
            if (!spell) return null;
            const tooCostly = tactics.player.mp < spell.mpCost;
            return (
              <ActionButton
                key={key}
                active={sel?.kind === 'spell' && sel.spellKey === key}
                disabled={locked || tactics.player.hasActed || tooCostly}
                onClick={() => onPickSpell(key)}
                title={`${spell.name} — ${spell.mpCost} MP`}
              >
                {(SPELL_FX[key]?.glyph ?? '✨')} {spell.name}
                <span className="ml-1 text-[10px] text-blue-300">{spell.mpCost}</span>
              </ActionButton>
            );
          })}
          <ActionButton accent disabled={locked} onClick={tacticsEndTurn}>
            End turn <ChevronRight className="h-4 w-4" />
          </ActionButton>
          <button
            type="button"
            onClick={endTactics}
            className="ml-1 flex items-center gap-1 rounded-md px-2 py-1.5 font-display text-[11px] text-parchment-300/70 hover:text-ember-bright"
            title="Retreat — forfeit the skirmish"
          >
            <LogOut className="h-3.5 w-3.5" /> Retreat
          </button>
        </div>
        {/* Context caption: movement range (from Agility) while moving, else the latest log line */}
        {sel?.kind === 'move' ? (
          <div className="mt-1 truncate text-center text-[11px] text-stat-AG">
            <Footprints className="mr-1 inline h-3 w-3" />
            Move up to {tactics.player.movesLeft} more tile{tactics.player.movesLeft === 1 ? '' : 's'} · climb {climbFor(tactics.player.ag)} —
            <span className="text-parchment-300/80"> set by your Agility ({tactics.player.ag})</span>
          </div>
        ) : sel?.kind === 'attack' && tactics.weapon.ranged ? (
          <div className="mt-1 truncate text-center text-[11px] text-orange-300/90">
            Orange tiles show your shot's reach — it stops at range, cover ridges, walls, and foes.
          </div>
        ) : (
          <div className="mt-1 truncate text-center text-[11px] text-parchment-300/70">
            {tactics.log[tactics.log.length - 1]}
          </div>
        )}
      </div>
    </div>
  );
}

function UnitSprite({
  x, y, glyph, hp, maxHp, statuses, friendly, name, scale = 1,
}: {
  x: number; y: number; glyph: string; hp: number; maxHp: number; statuses: UnitStatus[]; friendly?: boolean; name?: string; scale?: number;
}) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  return (
    <div
      className="pointer-events-none absolute z-20 flex flex-col items-center"
      style={{ left: 0, top: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -78%)`, transition: 'transform 200ms ease-out' }}
      title={name}
    >
      <StatusRow statuses={statuses} />
      <div className="h-1 overflow-hidden rounded-full border border-black/50 bg-black/60" style={{ width: Math.round(26 * scale) }}>
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: friendly ? '#34d399' : '#ef4444' }} />
      </div>
      <span style={{ fontSize: Math.round(26 * scale), lineHeight: 1, filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.7))' }}>{glyph}</span>
    </div>
  );
}

function EffectSprite({ fx, from, to }: { fx: TacticalEffect; from: { x: number; y: number }; to: { x: number; y: number } }) {
  if (fx.kind === 'arrow') {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const rot = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (
      <div
        className="pointer-events-none absolute z-30 text-lg"
        style={{
          left: from.x, top: from.y,
          // CSS custom props let one keyframe translate along the shot.
          ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${dy}px`, ['--rot' as string]: `${rot}deg`,
          transform: 'translate(-50%, -50%)',
          animation: `tactics-arrow ${fx.durationMs}ms linear forwards`,
        }}
      >
        ➶
      </div>
    );
  }
  if (fx.kind === 'melee') {
    return (
      <div
        className="pointer-events-none absolute z-30 text-2xl"
        style={{ left: to.x, top: to.y, transform: 'translate(-50%, -50%)', animation: `tactics-melee ${fx.durationMs}ms ease-out forwards` }}
      >
        💥
      </div>
    );
  }
  // Spell: kind === `spell:<key>`
  const key = fx.kind.slice('spell:'.length);
  const conf = SPELL_FX[key] ?? { anim: 'tactics-cast', glyph: '✨' };
  return (
    <div
      className="pointer-events-none absolute z-30 text-2xl"
      style={{ left: to.x, top: to.y, transform: 'translate(-50%, -50%)', animation: `${conf.anim} ${fx.durationMs}ms ease-out forwards` }}
    >
      {conf.glyph}
    </div>
  );
}

function ActionButton({
  children, onClick, active, disabled, accent, title,
}: {
  children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; accent?: boolean; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex items-center gap-1 rounded-md border px-2.5 py-1.5 font-display text-xs font-bold transition-colors',
        disabled
          ? 'cursor-not-allowed border-gold-deep/20 bg-wood-900/40 text-parchment-300/30'
          : active
            ? 'border-stat-AG bg-stat-AG/25 text-stat-AG'
            : accent
              ? 'border-gold-deep bg-gold-deep/20 text-gold-bright hover:bg-gold-deep/30'
              : 'border-gold-deep/40 bg-wood-800/60 text-parchment-200 hover:bg-wood-700/60',
      )}
    >
      {children}
    </button>
  );
}
