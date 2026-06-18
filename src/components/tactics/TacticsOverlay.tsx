import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Zap, Sparkles, Footprints, LogOut, Skull, Trophy, ChevronRight, Shield, Eye, EyeOff } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useTacticsAudio } from '@/hooks/useTacticsAudio';
import {
  type Tile,
  type TacticalEffect,
  type UnitStatus,
  type EnemyIntent,
  type AIArchetype,
  type TacticsObjective,
  TERRAIN_ICONS,
  ARCHETYPE_INFO,
  previewPlayerAttack,
  previewSpell,
  type AttackPreview,
} from '@/engine/hexBattle';
import { hexKey, hexDistance, type Hex } from '@/engine/hex';
import { getSpell, SCHOOL_STAT, type StatusKey } from '@/engine/spells';
import { MAX_ELEVATION, SPELL_RANGE, climbFor, heightRangeBonus, hasLineOfSight } from '@/engine/hexBattle';
import type { StatId } from '@/engine/stats';
import { base, topCenter, hexCorners, isoBounds, colHeight, type Pt } from './iso';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

// --- Board geometry -----------------------------------------------------------------------------
function sizeFor(radius: number): number {
  return radius <= 3 ? 30 : radius === 4 ? 24 : radius === 5 ? 19 : 16;
}

function fitSize(radius: number, availW: number, availH: number): number {
  const probe = isoBounds(radius, 100, MAX_ELEVATION);
  const s = 100 * Math.min(availW / probe.width, availH / probe.height);
  return Math.max(14, Math.min(72, Math.floor(s)));
}

const STATUS_GLYPH: Record<StatusKey, string> = {
  bless: '🛡️', burn: '🔥', weaken: '🔻', blind: '💫', freeze: '❄️', poison: '☠️',
};

const SPELL_FX: Record<string, { anim: string; glyph: string }> = {
  sparks:  { anim: 'tactics-sparks',  glyph: '⚡' },
  firebolt:{ anim: 'tactics-firebolt',glyph: '🔥' },
  mend:    { anim: 'tactics-mend',    glyph: '✚' },
  bless:   { anim: 'tactics-bless',   glyph: '✨' },
  dazzle:  { anim: 'tactics-dazzle',  glyph: '💫' },
  hex:     { anim: 'tactics-hex',     glyph: '🟣' },
  // Tactics positional spells (always available)
  push:    { anim: 'tactics-cast',    glyph: '💨' },
  blink:   { anim: 'tactics-cast',    glyph: '🌀' },
  cleave:  { anim: 'tactics-cast',    glyph: '⚡' },
};

const FLOATER_COLOR: Record<NonNullable<TacticalEffect['color']>, string> = {
  'dmg-enemy': '#fbbf24',  // amber — damage dealt by player
  'dmg-player': '#f87171', // red — damage taken
  'heal': '#34d399',       // green
  'status': '#c084fc',     // purple — status inflicted
};

function terrainRGB(t: Tile): [number, number, number] {
  const lift = t.elevation * 12;
  switch (t.terrain) {
    case 'blocked': return [60 + lift, 56 + lift, 64 + lift];
    case 'cover':   return [96 + lift, 72 + lift, 44 + lift];
    case 'slow':    return [52 + lift, 78 + lift, 48 + lift];
    case 'hazard':  return [120 + lift, 48 + lift, 36 + lift];
    default:        return [46 + lift, 58 + lift, 70 + lift];
  }
}
const rgbStr = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const darken = (c: [number, number, number], f: number): string =>
  `rgb(${Math.round(c[0] * f)},${Math.round(c[1] * f)},${Math.round(c[2] * f)})`;
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
        <span key={st.key} title={`${st.key} (${st.turns}t)`}>{STATUS_GLYPH[st.key]}</span>
      ))}
    </div>
  );
}

/** Compact preview tooltip shown in the action bar caption when hovering a target. */
function PreviewBadge({ preview }: { preview: AttackPreview }) {
  if (preview.isHeal) {
    return (
      <span className="font-display text-xs text-emerald-400">
        +{preview.min} HP {preview.min !== preview.max ? `– +${preview.max}` : ''}
      </span>
    );
  }
  const heightLabel = preview.dz > 0 ? ` ⬆+${Math.round((preview.heightMult - 1) * 100)}%` : preview.dz < 0 ? ` ⬇${Math.round((1 - preview.heightMult) * 100)}%` : '';
  const tag = preview.weak ? ' 💥 WEAK' : preview.resist ? ' 🔰 resist' : '';
  const lethal = preview.lethal ? ' 💀' : '';
  const guardNote = preview.guardBonus > 0 ? ` 🛡+${preview.guardBonus}` : '';
  const coverNote = preview.coverBonus > 0 ? ` cover-${preview.coverBonus}` : '';
  return (
    <span className={cn('font-display text-xs', preview.lethal ? 'text-red-400' : preview.weak ? 'text-amber-300' : 'text-parchment-200')}>
      {preview.min}–{preview.max} dmg{heightLabel}{guardNote}{coverNote}{tag}{lethal}
    </span>
  );
}

export function TacticsOverlay() {
  const tactics = useGameStore((s) => s.tactics);
  const tacticsSelect = useGameStore((s) => s.tacticsSelect);
  const tacticsMove = useGameStore((s) => s.tacticsMove);
  const tacticsAttack = useGameStore((s) => s.tacticsAttack);
  const tacticsCast = useGameStore((s) => s.tacticsCast);
  const tacticsEndTurn = useGameStore((s) => s.tacticsEndTurn);
  const tacticsHold = useGameStore((s) => s.tacticsHold);
  const endTactics = useGameStore((s) => s.endTactics);
  const soundEnabled = useGameStore((s) => s.settings.soundEnabled);

  // Audio: synthesised combat SFX + adaptive tension drone.
  useTacticsAudio(tactics, soundEnabled);

  const [live, setLive] = useState<TacticalEffect[]>([]);
  const [animating, setAnimating] = useState(false);
  const lastBatch = useRef<TacticalEffect[] | null>(null);

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

  // Threat overlay and intent arrows toggles
  const [showThreat, setShowThreat] = useState(true);
  const [showIntents, setShowIntents] = useState(true);

  // Hovered hex for preview (set on tile mouse-enter when a targeted action is selected)
  const [hoveredHex, setHoveredHex] = useState<Hex | null>(null);

  const radius = tactics?.radius ?? 3;
  const size = useMemo(
    () => (vp.w > 0 && vp.h > 0 ? fitSize(radius, vp.w - 16, vp.h - 16) : sizeFor(radius)),
    [radius, vp.w, vp.h],
  );
  const bounds = useMemo(() => isoBounds(radius, size, MAX_ELEVATION), [radius, size]);
  if (!tactics) return null;

  const elevationOf = (h: Hex) => tactics.tiles[hexKey(h)]?.elevation ?? 0;
  const top = (h: Hex) => {
    const p = topCenter(h, size, elevationOf(h));
    return { x: p.x + bounds.offsetX, y: p.y + bounds.offsetY };
  };
  const groundY = (h: Hex) => base(h, size).y;

  const reachable = new Set(tactics.reachable.map(hexKey));
  const targetable = new Set(tactics.targetable.map(hexKey));
  const threat = new Set(tactics.threatHexes.map(hexKey));
  const sel = tactics.selected;
  const isPlayerTurn = tactics.turn === 'player' && tactics.status === 'active';
  const locked = animating || !isPlayerTurn;

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

  // Compute hover preview when hovering a targetable tile
  const hoverPreview = useMemo((): AttackPreview | null => {
    if (!hoveredHex || !sel || locked) return null;
    if (sel.kind === 'attack') return previewPlayerAttack(tactics, hoveredHex);
    if (sel.kind === 'spell') return previewSpell(tactics, sel.spellKey, hoveredHex);
    return null;
  }, [hoveredHex, sel, tactics, locked]);

  function onTileClick(h: Hex) {
    if (locked) return;
    const key = hexKey(h);
    if (sel?.kind === 'move' && reachable.has(key)) tacticsMove(h);
    else if (sel?.kind === 'attack' && targetable.has(key)) tacticsAttack(h);
    else if (sel?.kind === 'spell' && targetable.has(key)) tacticsCast(sel.spellKey, h);
  }

  function onTileHover(h: Hex | null) {
    if (!h) { setHoveredHex(null); return; }
    const key = hexKey(h);
    if (targetable.has(key)) setHoveredHex(h);
    else setHoveredHex(null);
  }

  function onPickSpell(spellKey: string) {
    const spell = getSpell(spellKey);
    if (!spell) return;
    // Blink needs the player to pick a destination tile → enter targeting mode.
    if (spell.mechanic === 'blink') { setHoveredHex(null); tacticsSelect({ kind: 'spell', spellKey }); return; }
    // Cleave and other support spells are self-cast — fire immediately.
    if (spell.school === 'support') { tacticsCast(spellKey, null); return; }
    // Damage / illusion / push → enter targeting mode.
    setHoveredHex(null);
    tacticsSelect({ kind: 'spell', spellKey });
  }

  const weapon = tactics.weapon;
  const attackLabel = weapon.ranged ? 'Shoot' : 'Strike';

  const tilesByDepth = Object.values(tactics.tiles)
    .slice()
    .sort((a, b) => groundY(a.hex) - groundY(b.hex) || a.hex.q - b.hex.q);

  const playerKey = hexKey(tactics.player.hex);

  // Build intent lookup by enemyId for easy rendering
  const intentByEnemyId = new Map<number, EnemyIntent>();
  for (const intent of (tactics.intentPlan ?? [])) intentByEnemyId.set(intent.enemyId, intent);

  // Which stat the player's current action governs (for weak/resist affinity display).
  const activeAttackStat: StatId | null = (() => {
    if (!sel || locked) return null;
    if (sel.kind === 'attack') return tactics.weapon.attackStat;
    if (sel.kind === 'spell') {
      const sp = getSpell(sel.spellKey);
      if (!sp || sp.school === 'support') return null; // heals don't check affinities
      return SCHOOL_STAT[sp.school];
    }
    return null;
  })();

  const unitsByDepth = [
    {
      key: 'player', hex: tactics.player.hex, glyph: '🧝',
      hp: tactics.player.hp, maxHp: tactics.player.maxHp, statuses: tactics.player.statuses,
      friendly: true, name: 'You' as string | undefined, enemyId: undefined as number | undefined,
      aiArchetype: undefined as AIArchetype | undefined,
      weakTo: [] as StatId[], resistTo: [] as StatId[],
    },
    ...tactics.enemies.map((e) => ({
      key: `e${e.id}`, hex: e.hex, glyph: e.icon,
      hp: e.hp, maxHp: e.maxHp, statuses: e.statuses, friendly: false, name: e.name as string | undefined,
      enemyId: e.id,
      aiArchetype: e.aiArchetype,
      weakTo: e.weakTo, resistTo: e.resistTo,
    })),
  ].sort((a, b) => groundY(a.hex) - groundY(b.hex));

  // Log: show the last 4 entries, newest last
  const logLines = tactics.log.slice(-4);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-wood-950/95 backdrop-blur-sm">
      {/* Header */}
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
          {/* Overlay toggles */}
          <button
            type="button"
            title={showThreat ? 'Hide danger zone' : 'Show danger zone'}
            onClick={() => setShowThreat((v) => !v)}
            className={cn(
              'flex items-center gap-1 rounded-md border px-1.5 py-1 font-display text-[10px] transition-colors',
              showThreat ? 'border-red-500/50 bg-red-900/30 text-red-400' : 'border-gold-deep/30 bg-wood-800/40 text-parchment-300/50',
            )}
          >
            <Shield className="h-3 w-3" />
          </button>
          <button
            type="button"
            title={showIntents ? 'Hide enemy intents' : 'Show enemy intents'}
            onClick={() => setShowIntents((v) => !v)}
            className={cn(
              'flex items-center gap-1 rounded-md border px-1.5 py-1 font-display text-[10px] transition-colors',
              showIntents ? 'border-amber-500/50 bg-amber-900/30 text-amber-400' : 'border-gold-deep/30 bg-wood-800/40 text-parchment-300/50',
            )}
          >
            {showIntents ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
          {/* Archetype legend — colored dots with tooltips */}
          <div className="ml-1 flex items-center gap-1" title="Enemy archetype ring colors">
            {(Object.entries(ARCHETYPE_INFO) as [AIArchetype, typeof ARCHETYPE_INFO[AIArchetype]][]).map(([arch, info]) => (
              <div
                key={arch}
                title={`${info.label}: ${info.blurb}`}
                className="h-2.5 w-2.5 cursor-help rounded-full"
                style={{ backgroundColor: info.color + '55', border: `1.5px solid ${info.color}` }}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {tactics.player.overwatch && (
            <span className="flex items-center gap-1 rounded border border-sky-500/50 bg-sky-900/30 px-2 py-0.5 font-display text-[10px] text-sky-300" title="Overwatch active — reaction shot fires on the first enemy that steps into range">
              ⌖ Watching
            </span>
          )}
          <Gauge icon={<Heart className="h-3.5 w-3.5 text-red-400" />} value={tactics.player.hp} max={tactics.player.maxHp} fill="#ef4444" />
          <Gauge icon={<Sparkles className="h-3.5 w-3.5 text-blue-400" />} value={tactics.player.mp} max={tactics.player.maxMp} fill="#3b82f6" />
          <Gauge icon={<Zap className="h-3.5 w-3.5 text-amber-400" />} value={tactics.player.sta} max={tactics.player.maxSta} fill="#f59e0b" />
        </div>
      </div>

      {/* Objective banner */}
      {tactics.objective && <ObjectiveBanner objective={tactics.objective} turnCount={tactics.turnCount} />}

      {/* Board */}
      <div ref={boardWrapRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
        <div className="relative" style={{ width: bounds.width, height: bounds.height }}>
          {/* Board SVG */}
          <svg width={bounds.width} height={bounds.height} className="absolute inset-0">
            {/* Intent movement lines (behind tiles) */}
            {showIntents && (tactics.intentPlan ?? []).map((intent) => {
              if (hexKey(intent.moveTo) === hexKey(tactics.enemies.find(e => e.id === intent.enemyId)?.hex ?? intent.moveTo)) return null;
              const enemy = tactics.enemies.find(e => e.id === intent.enemyId);
              if (!enemy || enemy.hp <= 0) return null;
              const from = top(enemy.hex);
              const to = top(intent.moveTo);
              return (
                <line
                  key={`intent-move-${intent.enemyId}`}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  stroke="rgba(251,146,60,0.55)" strokeWidth={2} strokeDasharray="4 3"
                  style={{ pointerEvents: 'none' }}
                />
              );
            })}

            {tilesByDepth.map((tile) => {
              const t = top(tile.hex);
              const key = hexKey(tile.hex);
              const rgb = terrainRGB(tile);
              const corners = hexCorners(size);
              const E = tile.elevation * colHeight(size);
              const highlight = reachable.has(key) ? 'reach' : targetable.has(key) ? 'target' : null;
              const isPlayerTile = key === playerKey;
              const isThreat = showThreat && threat.has(key) && !isPlayerTile;
              const isHovered = hoveredHex && hexKey(hoveredHex) === key;

              const wall = (a: number, b: number, fill: string) => {
                const pa = corners[a];
                const pb = corners[b];
                const pts = [
                  `${t.x + pa.x},${t.y + pa.y}`,
                  `${t.x + pb.x},${t.y + pb.y}`,
                  `${t.x + pb.x},${t.y + pb.y + E}`,
                  `${t.x + pa.x},${t.y + pa.y + E}`,
                ].join(' ');
                return <polygon key={`${a}-${b}`} points={pts} fill={fill} />;
              };

              return (
                <g key={key}>
                  {E > 0 && (
                    <>
                      {wall(3, 4, darken(rgb, 0.55))}
                      {wall(4, 5, darken(rgb, 0.42))}
                      {wall(5, 0, darken(rgb, 0.72))}
                    </>
                  )}
                  <polygon
                    points={ptsAt(corners, t.x, t.y)}
                    fill={rgbStr(rgb)}
                    stroke={
                      isHovered ? 'rgba(255,255,255,0.9)'
                      : highlight === 'reach' ? 'rgba(56,189,248,0.95)'
                      : highlight === 'target' ? 'rgba(251,191,36,0.95)'
                      : isPlayerTile ? 'rgba(56,189,248,0.6)'
                      : 'rgba(0,0,0,0.4)'}
                    strokeWidth={isHovered ? 3.5 : highlight || isPlayerTile ? 3 : 1}
                    style={{ cursor: highlight || firing.has(key) ? 'pointer' : 'default' }}
                    onClick={() => onTileClick(tile.hex)}
                    onMouseEnter={() => onTileHover(tile.hex)}
                    onMouseLeave={() => onTileHover(null)}
                  />
                  {/* Projectile reach overlay */}
                  {firing.has(key) && (
                    <polygon
                      points={ptsAt(corners, t.x, t.y)}
                      fill="rgba(251,146,60,0.32)"
                      stroke="rgba(251,146,60,0.7)"
                      strokeWidth={1}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {/* Threat zone overlay (danger zone tint) */}
                  {isThreat && (
                    <polygon
                      points={ptsAt(corners, t.x, t.y)}
                      fill="rgba(239,68,68,0.18)"
                      stroke="rgba(239,68,68,0.5)"
                      strokeWidth={1}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  {TERRAIN_ICONS[tile.terrain] && (
                    <text
                      x={t.x} y={t.y}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={size * 0.7} opacity={0.85}
                      style={{ pointerEvents: 'none' }}
                    >
                      {TERRAIN_ICONS[tile.terrain]}
                    </text>
                  )}
                  {/* Elevation badge for high ground (when targeting) */}
                  {tile.elevation > 0 && (highlight === 'target' || (sel?.kind === 'move' && reachable.has(key))) && (
                    <text
                      x={t.x + size * 0.52} y={t.y - size * 0.35}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={size * 0.38} fill="rgba(250,204,21,0.9)"
                      style={{ pointerEvents: 'none', fontWeight: 'bold' }}
                    >
                      {'▲'.repeat(tile.elevation)}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Archetype rings — colored hex outlines on enemy tiles (helps read behavior at a glance) */}
            {tactics.enemies.filter((e) => e.hp > 0).map((e) => {
              const t = top(e.hex);
              const corners = hexCorners(size);
              const info = ARCHETYPE_INFO[e.aiArchetype];
              return (
                <polygon
                  key={`arch-ring-${e.id}`}
                  points={ptsAt(corners, t.x, t.y)}
                  fill="none"
                  stroke={info.color}
                  strokeWidth={2.5}
                  opacity={0.7}
                  style={{ pointerEvents: 'none' }}
                />
              );
            })}

            {/* Beacon tile marker — pulsing ring on the designated Hold the Beacon hex */}
            {tactics.objective?.kind === 'beacon' && tactics.objective.beaconHex && (() => {
              const bHex = tactics.objective.beaconHex;
              const t = top(bHex);
              const corners = hexCorners(size);
              const done = tactics.objective.complete;
              const color = done ? '#22c55e' : '#fbbf24';
              return (
                <g key="beacon-marker" style={{ pointerEvents: 'none' }}>
                  <polygon
                    points={ptsAt(corners, t.x, t.y)}
                    fill={color + '22'}
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.85}
                  />
                  <text
                    x={t.x} y={t.y}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize={size * 0.5}
                    opacity={0.9}
                  >◎</text>
                </g>
              );
            })()}
          </svg>

          {/* Units (DOM overlay) */}
          {unitsByDepth.map((u) => {
            const c = top(u.hex);
            const intent = u.enemyId !== undefined ? intentByEnemyId.get(u.enemyId) : undefined;
            const archetypeColor = u.aiArchetype ? ARCHETYPE_INFO[u.aiArchetype].color : undefined;
            const archetypeBlurb = u.aiArchetype ? `${ARCHETYPE_INFO[u.aiArchetype].label} — ${ARCHETYPE_INFO[u.aiArchetype].blurb}` : undefined;
            const weakResist: 'weak' | 'resist' | null = (() => {
              if (!activeAttackStat || u.friendly) return null;
              if (u.weakTo.includes(activeAttackStat)) return 'weak';
              if (u.resistTo.includes(activeAttackStat)) return 'resist';
              return null;
            })();
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
                intent={showIntents ? intent : undefined}
                archetypeColor={archetypeColor}
                archetypeBlurb={archetypeBlurb}
                weakResist={weakResist}
                onClick={u.enemyId !== undefined ? () => onTileClick(u.hex) : undefined}
              />
            );
          })}

          {/* Animation effects + floaters */}
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
          <ActionButton active={sel?.kind === 'move'} disabled={locked || tactics.player.movesLeft <= 0} onClick={() => { setHoveredHex(null); tacticsSelect({ kind: 'move' }); }}>
            <Footprints className="h-4 w-4" /> Move
          </ActionButton>
          <ActionButton active={sel?.kind === 'attack'} disabled={locked || tactics.player.hasActed} onClick={() => { setHoveredHex(null); tacticsSelect({ kind: 'attack' }); }}>
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
                onClick={() => { setHoveredHex(null); onPickSpell(key); }}
                title={`${spell.name} — ${spell.mpCost} MP`}
              >
                {(SPELL_FX[key]?.glyph ?? '✨')} {spell.name}
                <span className="ml-1 text-[10px] text-blue-300">{spell.mpCost}</span>
              </ActionButton>
            );
          })}
          <ActionButton
            accent
            disabled={locked || tactics.player.hasActed}
            onClick={tacticsHold}
            title="Arm an overwatch stance — fire a reaction shot on the first enemy that steps into range"
          >
            {tactics.player.overwatch ? '⌖ Watching…' : 'Hold ⌖'}
          </ActionButton>
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

        {/* Context / preview area — hover preview takes priority, then last log lines */}
        <div className="mt-1.5 mx-auto max-w-2xl min-h-[2.5rem]">
          {hoverPreview && (sel?.kind === 'attack' || sel?.kind === 'spell') ? (
            <div className="text-center text-[11px]">
              <PreviewBadge preview={hoverPreview} />
            </div>
          ) : sel?.kind === 'move' ? (
            <div className="truncate text-center text-[11px] text-stat-AG">
              <Footprints className="mr-1 inline h-3 w-3" />
              Move up to {tactics.player.movesLeft} more tile{tactics.player.movesLeft === 1 ? '' : 's'} · climb {climbFor(tactics.player.ag)} —
              <span className="text-parchment-300/80"> set by your Agility ({tactics.player.ag})</span>
            </div>
          ) : sel?.kind === 'attack' && tactics.weapon.ranged ? (
            <div className="truncate text-center text-[11px] text-orange-300/90">
              Orange tiles show your shot's reach — hover an enemy to preview damage.
            </div>
          ) : sel?.kind === 'spell' && (() => { const m = getSpell(sel.spellKey)?.mechanic; return m === 'blink'; })() ? (
            <div className="truncate text-center text-[11px] text-blue-300/90">
              Click any open tile within 2 squares to teleport — ignores terrain height.
            </div>
          ) : sel?.kind === 'spell' && (() => { const m = getSpell(sel.spellKey)?.mechanic; return m === 'push'; })() ? (
            <div className="truncate text-center text-[11px] text-purple-300/90">
              Click an enemy — they'll be hurled away. Bonus damage if they hit a wall or hazard.
            </div>
          ) : (
            /* Mini log: last 4 lines, newest at the bottom */
            <div className="flex flex-col gap-0.5">
              {logLines.map((line, i) => (
                <div
                  key={i}
                  className={cn(
                    'truncate text-center text-[10px]',
                    i === logLines.length - 1 ? 'text-parchment-200' : 'text-parchment-300/50',
                  )}
                >
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UnitSprite({
  x, y, glyph, hp, maxHp, statuses, friendly, name, scale = 1,
  intent, archetypeColor, archetypeBlurb, weakResist, onClick,
}: {
  x: number; y: number; glyph: string; hp: number; maxHp: number; statuses: UnitStatus[];
  friendly?: boolean; name?: string; scale?: number;
  intent?: EnemyIntent;
  /** Archetype ring color (hex string); absent for the player. */
  archetypeColor?: string;
  /** Short archetype label + blurb shown in the intent badge tooltip. */
  archetypeBlurb?: string;
  /** Whether the current player action hits a weakness (⬆) or resistance (⬇) of this enemy. */
  weakResist?: 'weak' | 'resist' | null;
  onClick?: () => void;
}) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  return (
    <div
      className={cn('absolute z-20 flex flex-col items-center', onClick ? 'cursor-pointer' : 'pointer-events-none')}
      style={{ left: 0, top: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -78%)`, transition: 'transform 200ms ease-out' }}
      title={name}
      onClick={onClick}
    >
      {/* Intent badge — shows planned action icon + archetype name (Phase C) */}
      {intent && !friendly && (
        <div
          className="pointer-events-none flex items-center gap-0.5 rounded-sm bg-wood-950/70 px-0.5 text-[9px]"
          title={archetypeBlurb ? `${archetypeBlurb}\n${intent.attackLabel}` : intent.attackLabel}
        >
          {intent.willAttack ? (
            <span style={{ fontSize: Math.round(10 * scale) }}>{intent.attackIcon}</span>
          ) : intent.attackIcon === '❄️' ? (
            <span className="text-blue-300">❄️</span>
          ) : null}
          {archetypeBlurb && (
            <span
              className="ml-0.5 font-display leading-none"
              style={{ fontSize: Math.round(8 * scale), color: archetypeColor ?? '#aaa' }}
            >
              {archetypeBlurb.split(' ')[0]}
            </span>
          )}
        </div>
      )}
      <StatusRow statuses={statuses} />
      <div className="h-1 overflow-hidden rounded-full border border-black/50 bg-black/60" style={{ width: Math.round(26 * scale) }}>
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: friendly ? '#34d399' : '#ef4444' }} />
      </div>
      {/* Unit glyph — with subtle archetype glow and weak/resist indicator */}
      <div className="relative flex items-center justify-center">
        <span
          style={{
            fontSize: Math.round(26 * scale),
            lineHeight: 1,
            filter: archetypeColor
              ? `drop-shadow(0 0 ${Math.round(5 * scale)}px ${archetypeColor}88) drop-shadow(0 2px 2px rgba(0,0,0,0.7))`
              : 'drop-shadow(0 2px 2px rgba(0,0,0,0.7))',
          }}
        >
          {glyph}
        </span>
        {/* Weak/resist affinity indicator — shown when the player's selected action has an affinity */}
        {weakResist && (
          <span
            className="absolute -right-1 -bottom-0.5 leading-none"
            style={{
              fontSize: Math.round(10 * scale),
              color: weakResist === 'weak' ? '#4ade80' : '#f87171',
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.8))',
            }}
            title={weakResist === 'weak' ? 'Weak to this attack (+damage)' : 'Resists this attack (-damage)'}
          >
            {weakResist === 'weak' ? '⬆' : '⬇'}
          </span>
        )}
      </div>
    </div>
  );
}

function EffectSprite({ fx, from, to }: { fx: TacticalEffect; from: { x: number; y: number }; to: { x: number; y: number } }) {
  if (fx.kind === 'floater') {
    const color = fx.color ? FLOATER_COLOR[fx.color] : '#fbbf24';
    return (
      <div
        className="pointer-events-none absolute z-40 select-none font-display font-bold"
        style={{
          left: to.x,
          top: to.y,
          color,
          fontSize: 15,
          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          animation: `tactics-floater ${fx.durationMs}ms ease-out forwards`,
        }}
      >
        {fx.label}
      </div>
    );
  }
  if (fx.kind === 'arrow') {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const rot = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (
      <div
        className="pointer-events-none absolute z-30 text-lg"
        style={{
          left: from.x, top: from.y,
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

/** Thin banner showing the match's optional secondary objective and its live progress. */
function ObjectiveBanner({ objective, turnCount }: { objective: TacticsObjective; turnCount: number }) {
  const { kind, label, desc, target, progress, complete, failed } = objective;

  let progressLabel = '';
  if (kind === 'beacon') {
    progressLabel = complete ? '✓ Complete' : `${progress}/${target} turns`;
  } else if (kind === 'swift') {
    progressLabel = complete ? '✓ Complete' : failed ? '✗ Missed' : `Turn ${turnCount} / ${target}`;
  } else if (kind === 'flawless') {
    progressLabel = failed ? '✗ Failed' : complete ? '✓ Complete' : `HP ≥ ${target}%`;
  }

  return (
    <div
      title={desc}
      className={cn(
        'flex items-center justify-between border-b px-4 py-1 font-display text-[11px]',
        complete
          ? 'border-green-700/40 bg-green-900/20 text-green-300'
          : failed
            ? 'border-red-700/40 bg-red-900/20 text-red-400 line-through opacity-60'
            : 'border-gold-deep/25 bg-amber-900/10 text-amber-300/80',
      )}
    >
      <span>
        <span className="mr-1 opacity-70">Bonus:</span>
        {label}
      </span>
      <span className={cn('font-bold', complete ? 'text-green-300' : failed ? 'text-red-400' : 'text-amber-300')}>
        {progressLabel}
      </span>
    </div>
  );
}
