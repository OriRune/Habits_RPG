import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, Zap, Sparkles, Footprints, LogOut, Skull, Trophy, ChevronRight, Shield, Eye, EyeOff, Coins } from 'lucide-react';
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
  computeEnemyThreatCounts,
  previewPlayerAttack,
  previewSpell,
  tacticsReward,
  type AttackPreview,
} from '@/engine/hexBattle';
import { hexKey, hexDistance, type Hex } from '@/engine/hex';
import { getSpell, SCHOOL_STAT, type StatusKey } from '@/engine/spells';
import { tacticsStatXp } from '@/store/shared';
import { MATERIALS } from '@/content/materials';
import { play as sfxPlay } from '@/lib/sfx';
import { MAX_ELEVATION, SPELL_RANGE, STA_REGEN_PER_TURN, MOVE_ANIM_MS, climbFor, heightRangeBonus, hasLineOfSight } from '@/engine/hexBattle';
import type { StatId } from '@/engine/stats';
import { base, topCenter, hexCorners, isoBounds, colHeight, type Pt } from './iso';
import { Button } from '@/components/ui/Button';
import { StreakBonusChip } from '@/components/character/StreakBonusChip';
import { cn } from '@/lib/cn';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';

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

/**
 * Tile top-face color: hue says terrain, lightness says elevation. Height is the mode's core
 * mechanic, so higher tiles read distinctly warmer/lighter — not just a deeper extrusion.
 * The warm shift (R grows fastest) keeps high ground feeling like sunlit ground.
 */
function terrainRGB(t: Tile): [number, number, number] {
  const z = t.elevation;
  switch (t.terrain) {
    case 'blocked': return [60 + z * 12, 56 + z * 11, 64 + z * 9];
    case 'cover':   return [96 + z * 16, 72 + z * 14, 44 + z * 9];
    case 'slow':    return [52 + z * 14, 78 + z * 16, 48 + z * 8];
    case 'hazard':  return [120 + z * 14, 48 + z * 12, 36 + z * 8];
    default:        return [48 + z * 19, 58 + z * 17, 70 + z * 10];
  }
}
const rgbStr = (c: [number, number, number]) => `rgb(${c[0]},${c[1]},${c[2]})`;
const darken = (c: [number, number, number], f: number): string =>
  `rgb(${Math.round(c[0] * f)},${Math.round(c[1] * f)},${Math.round(c[2] * f)})`;
const ptsAt = (corners: Pt[], cx: number, cy: number) => corners.map((p) => `${cx + p.x},${cy + p.y}`).join(' ');

function Gauge({ icon, value, max, fill, note }: { icon: React.ReactNode; value: number; max: number; fill: string; note?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <div className="h-2.5 w-20 overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: fill }} />
      </div>
      <span className="font-display text-[11px] tabular-nums text-parchment-300">
        {Math.max(0, Math.round(value))}/{Math.round(max)}
        {note && <span className="ml-1 text-[9px] opacity-60">{note}</span>}
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
  const exhaustedNote = preview.exhausted ? ' 😮‍💨 exhausted ×½' : '';
  return (
    <span className={cn('font-display text-xs', preview.lethal ? 'text-red-400' : preview.exhausted ? 'text-orange-300' : preview.weak ? 'text-amber-300' : 'text-parchment-200')}>
      {preview.min}–{preview.max} dmg{heightLabel}{guardNote}{coverNote}{tag}{exhaustedNote}{lethal}
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
  const habitBonus = useGameStore((s) => s.character.habitBonus);
  const deepestTacticsTier = useGameStore((s) => s.deepestTacticsTier);
  const soundEnabled = useGameStore((s) => s.settings.soundEnabled);

  // Co-op: identify local player and session role
  const coopJoined = useCoopStore((s) => s.joined);
  const coopSession = useCoopStore((s) => s.session);
  const coopSend = useCoopStore((s) => s.send);
  const userId = useAuthStore((s) => s.session?.user?.id ?? '');
  const isCoopSession = coopJoined && coopSession?.game === 'tactics';
  const isCoopGuest = isCoopSession && coopSession?.host_id !== userId;

  // Audio: synthesised combat SFX + adaptive tension drone.
  useTacticsAudio(tactics, soundEnabled);

  // Retreat needs confirmation to prevent misclicks during a winning match.
  const [confirmRetreat, setConfirmRetreat] = useState(false);

  // Warn the browser before navigating away mid-match so the player doesn't lose their run.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (tactics?.status === 'active') { e.preventDefault(); return ''; }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [tactics?.status]);

  // Flash the objective banner on the very first turn so it doesn't go unnoticed.
  const [showObjectiveIntro, setShowObjectiveIntro] = useState(false);
  useEffect(() => {
    if (tactics?.objective && tactics.turnCount === 1 && tactics.status === 'active') {
      setShowObjectiveIntro(true);
      const t = window.setTimeout(() => setShowObjectiveIntro(false), 3500);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tactics?.objective?.kind, tactics?.turnCount]);

  const [live, setLive] = useState<TacticalEffect[]>([]);
  const [animating, setAnimating] = useState(false);
  const lastBatch = useRef<TacticalEffect[] | null>(null);

  // Tracks which enemy ids have already had their 'move' effect fire this batch.
  // While an enemy's id is absent, the overlay renders it at prevHex so the sprite
  // holds still until the staggered timer fires and slides it to its final tile.
  const [movedIds, setMovedIds] = useState<Set<number>>(new Set());

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
    // Reset which enemies have "moved" at the start of each new animation batch.
    setMovedIds(new Set());
    const timers: number[] = [];
    let maxEnd = 0;
    for (const e of fx) {
      const end = e.startedAtMs + e.durationMs;
      maxEnd = Math.max(maxEnd, end);
      timers.push(window.setTimeout(() => setLive((l) => [...l, e]), e.startedAtMs));
      timers.push(window.setTimeout(() => setLive((l) => l.filter((x) => x.id !== e.id)), end));
      // When a 'move' effect fires, mark that enemy as having completed its slide so the
      // sprite flips from prevHex → hex and the CSS transition plays.
      if (e.kind === 'move' && e.enemyId !== undefined) {
        const eid = e.enemyId;
        timers.push(window.setTimeout(() => setMovedIds((s) => new Set(s).add(eid)), e.startedAtMs));
      }
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

  // Transient "out of range" toast for clicks on non-highlighted tiles while an action is armed.
  const invalidClickSeq = useRef(0);
  const [invalidClick, setInvalidClick] = useState<{ id: number; hex: Hex; text: string } | null>(null);
  useEffect(() => {
    if (!invalidClick) return;
    const t = window.setTimeout(() => setInvalidClick((cur) => (cur?.id === invalidClick.id ? null : cur)), 900);
    return () => clearTimeout(t);
  }, [invalidClick]);

  const radius = tactics?.radius ?? 3;
  const size = useMemo(
    () => (vp.w > 0 && vp.h > 0 ? fitSize(radius, vp.w - 16, vp.h - 16) : sizeFor(radius)),
    [radius, vp.w, vp.h],
  );
  const bounds = useMemo(() => isoBounds(radius, size, MAX_ELEVATION), [radius, size]);

  // Per-tile threat counts for the graded danger tint (audit U4): a tile one kiter can poke
  // reads differently from a tile three chargers converge on. Hook — stays above the early return.
  const threatCounts = useMemo(
    () => (tactics && showThreat ? computeEnemyThreatCounts(tactics) : {}),
    [tactics, showThreat],
  );

  // Hover preview for a targeted action. This hook MUST stay above the `!tactics` early return
  // (rules-of-hooks) — it re-derives the `locked` gate defensively since that's computed below.
  const hoverPreview = useMemo((): AttackPreview | null => {
    if (!tactics || !hoveredHex) return null;
    const playerTurn = tactics.turn === 'player' && tactics.status === 'active';
    const waiting = isCoopSession && playerTurn && (tactics.player.endedTurn ?? false);
    if (animating || !playerTurn || waiting) return null;
    const action = tactics.selected;
    if (action?.kind === 'attack') return previewPlayerAttack(tactics, hoveredHex);
    if (action?.kind === 'spell') return previewSpell(tactics, action.spellKey, hoveredHex);
    return null;
  }, [hoveredHex, tactics, animating, isCoopSession]);

  if (!tactics) return null;

  const elevationOf = (h: Hex) => tactics.tiles[hexKey(h)]?.elevation ?? 0;
  const top = (h: Hex) => {
    const p = topCenter(h, size, elevationOf(h));
    return { x: p.x + bounds.offsetX, y: p.y + bounds.offsetY };
  };
  const groundY = (h: Hex) => base(h, size).y;

  const reachable = new Set(tactics.reachable.map(hexKey));
  const targetable = new Set(tactics.targetable.map(hexKey));
  const sel = tactics.selected;
  const isPlayerTurn = tactics.turn === 'player' && tactics.status === 'active';
  // Per-hero weapon and spell loadout (co-op heroes carry their own; fall back to state-level for solo).
  const weapon = tactics.player.weapon ?? tactics.weapon;
  const knownSpells = tactics.player.knownSpells ?? tactics.knownSpells;
  const myHeroEndedTurn = tactics.player.endedTurn ?? false;
  const waitingForAlly = isCoopSession && isPlayerTurn && myHeroEndedTurn;
  const locked = animating || !isPlayerTurn || waitingForAlly;

  const firing = (() => {
    const set = new Set<string>();
    if (locked) return set;
    let baseRange = 0;
    if (sel?.kind === 'attack' && weapon.ranged) baseRange = weapon.range ?? 1;
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

  /** A click landed on a tile the armed action can't use — say so instead of silently ignoring it. */
  function flagInvalidClick(h: Hex) {
    if (!sel) return;
    const text = sel.kind === 'move' ? 'Out of reach' : 'Out of range';
    setInvalidClick({ id: ++invalidClickSeq.current, hex: h, text });
    sfxPlay('libraryWrong');
  }

  function onTileClick(h: Hex) {
    if (locked) return;
    const key = hexKey(h);
    if (isCoopGuest && coopSend) {
      const heroId = tactics?.player.id ?? userId;
      if (sel?.kind === 'move' && reachable.has(key))
        coopSend({ type: 'tactics-intent', userId, heroId, action: 'move', to: h });
      else if (sel?.kind === 'attack' && targetable.has(key))
        coopSend({ type: 'tactics-intent', userId, heroId, action: 'attack', to: h });
      else if (sel?.kind === 'spell' && targetable.has(key))
        coopSend({ type: 'tactics-intent', userId, heroId, action: 'cast', spellKey: sel.spellKey, to: h });
      else flagInvalidClick(h);
    } else {
      if (sel?.kind === 'move' && reachable.has(key)) tacticsMove(h);
      else if (sel?.kind === 'attack' && targetable.has(key)) tacticsAttack(h);
      else if (sel?.kind === 'spell' && targetable.has(key)) tacticsCast(sel.spellKey, h);
      else flagInvalidClick(h);
    }
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
    // Blink: enter targeting mode so the player picks a destination tile (same path for host/guest).
    if (spell.mechanic === 'blink') { setHoveredHex(null); tacticsSelect({ kind: 'spell', spellKey }); return; }
    if (isCoopGuest && coopSend) {
      const heroId = tactics?.player.id ?? userId;
      // Guest: support spells are self-cast → send intent immediately; others enter targeting mode.
      if (spell.school === 'support') {
        coopSend({ type: 'tactics-intent', userId, heroId, action: 'cast', spellKey });
      } else {
        setHoveredHex(null);
        tacticsSelect({ kind: 'spell', spellKey });
      }
      return;
    }
    // Cleave and other support spells are self-cast — fire immediately.
    if (spell.school === 'support') { tacticsCast(spellKey, null); return; }
    // Damage / illusion / push → enter targeting mode.
    setHoveredHex(null);
    tacticsSelect({ kind: 'spell', spellKey });
  }

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
    if (sel.kind === 'attack') return weapon.attackStat;
    if (sel.kind === 'spell') {
      const sp = getSpell(sel.spellKey);
      if (!sp || sp.school === 'support') return null; // heals don't check affinities
      return SCHOOL_STAT[sp.school];
    }
    return null;
  })();

  // Build a lookup of pending 'move' effects by enemy id for the stagger animation.
  const moveFxByEnemyId = new Map<number, TacticalEffect>();
  for (const e of (tactics.effects ?? [])) {
    if (e.kind === 'move' && e.enemyId !== undefined) moveFxByEnemyId.set(e.enemyId, e);
  }

  const allyHeroes = isCoopSession ? (tactics.players ?? []).filter((p) => p.id !== tactics.player.id) : [];
  const allyName = allyHeroes[0]?.name ?? 'Ally';

  const unitsByDepth = [
    {
      key: 'player', hex: tactics.player.hex, displayHex: tactics.player.hex, glyph: '🧝',
      hp: tactics.player.hp, maxHp: tactics.player.maxHp, statuses: tactics.player.statuses,
      // Show the player's own name in co-op so both heroes are identifiable; hide in solo.
      friendly: true, name: (isCoopSession ? (tactics.player.name ?? 'You') : undefined) as string | undefined, enemyId: undefined as number | undefined,
      aiArchetype: undefined as AIArchetype | undefined,
      weakTo: [] as StatId[], resistTo: [] as StatId[],
      slideMs: 200,
    },
    ...allyHeroes.map((p) => ({
      key: `ally-${p.id ?? 'ally'}`,
      hex: p.hex, displayHex: p.hex, glyph: '🧙',
      hp: p.hp, maxHp: p.maxHp, statuses: p.statuses,
      friendly: true,
      name: ((p.name ?? 'Ally') + (p.endedTurn ? ' ✓' : '')) as string | undefined,
      enemyId: undefined as number | undefined,
      aiArchetype: undefined as AIArchetype | undefined,
      weakTo: [] as StatId[], resistTo: [] as StatId[],
      slideMs: 200,
    })),
    ...tactics.enemies.map((e) => {
      // hasPendingMove: a 'move' effect exists for this enemy and hasn't fired yet.
      //   → render at prevHex with no transition (instant snap, prevents "jump back").
      // hasJustMoved: the effect fired this batch (id is in movedIds).
      //   → render at hex with MOVE_ANIM_MS transition → CSS slides prev→final.
      const hasPendingMove = moveFxByEnemyId.has(e.id) && !movedIds.has(e.id);
      const hasJustMoved   = moveFxByEnemyId.has(e.id) && movedIds.has(e.id);
      return {
        key: `e${e.id}`,
        hex: e.hex,
        displayHex: hasPendingMove ? (e.prevHex ?? e.hex) : e.hex,
        glyph: e.icon,
        hp: e.hp, maxHp: e.maxHp, statuses: e.statuses,
        friendly: false, name: e.name as string | undefined,
        enemyId: e.id,
        aiArchetype: e.aiArchetype,
        weakTo: e.weakTo, resistTo: e.resistTo,
        slideMs: hasPendingMove ? 0 : hasJustMoved ? MOVE_ANIM_MS : 200,
      };
    }),
  ].sort((a, b) => groundY(a.hex) - groundY(b.hex));

  // Log: show the last 4 entries, newest last
  const logLines = tactics.log.slice(-4);

  return (
    // Solid backdrop (no translucency/blur): the board must sit in its own scene, not float
    // over the ghost of the blurred entry-screen text (audit U7). z-50 matches every other
    // run overlay (Mine/Forest/Arena) — at z-40 the app header/nav printed on top of the HUD.
    <div className="fixed inset-0 z-50 flex flex-col bg-wood-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gold-deep/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2.5 py-1 font-display text-xs font-bold uppercase tracking-wider',
              tactics.status !== 'active' ? 'bg-ember-deep/20 text-ember-bright'
              : waitingForAlly ? 'bg-parchment-300/10 text-parchment-300/50'
              : isPlayerTurn ? 'bg-stat-AG/20 text-stat-AG'
              : 'bg-ember-deep/20 text-ember-bright',
            )}
          >
            {tactics.status !== 'active' ? 'Skirmish over' : waitingForAlly ? `Waiting for ${allyName}…` : isPlayerTurn ? 'Your turn' : 'Enemy turn'}
          </span>
          {isPlayerTurn && (
            <span className="flex items-center gap-1 font-display text-[11px] text-parchment-300">
              <Footprints className="h-3.5 w-3.5 text-stat-AG" /> {tactics.player.movesLeft}
            </span>
          )}
          {isPlayerTurn && tactics.player.hasActed && !waitingForAlly && (
            <span className="rounded border border-stat-AG/40 bg-stat-AG/10 px-1.5 py-0.5 font-display text-[9px] text-stat-AG/70">
              ✓ Acted
            </span>
          )}
          {waitingForAlly && (
            <span className="rounded border border-parchment-300/25 bg-wood-800/50 px-1.5 py-0.5 font-display text-[9px] text-parchment-300/55">
              Waiting for {allyName}…
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
          <Gauge icon={<Zap className="h-3.5 w-3.5 text-amber-400" />} value={tactics.player.sta} max={tactics.player.maxSta} fill="#f59e0b" note={`+${STA_REGEN_PER_TURN}/t`} />
        </div>
      </div>

      {/* Objective intro flash — full-width highlight on the very first turn */}
      {showObjectiveIntro && tactics.objective && (
        <div className="border-b border-emerald-700/50 bg-emerald-900/30 px-4 py-2 text-center font-display text-xs text-emerald-300 animate-pulse">
          🎯 Bonus objective: <span className="font-bold">{tactics.objective.label}</span> — {tactics.objective.desc}
          <span className="ml-2 text-emerald-400/80">(+60% gold · healing potion)</span>
        </div>
      )}
      {/* Objective banner */}
      {tactics.objective && <ObjectiveBanner objective={tactics.objective} turnCount={tactics.turnCount} />}

      {/* Board — warm radial vignette centres the eye on the battlefield */}
      <div
        ref={boardWrapRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={{ background: 'radial-gradient(ellipse 90% 75% at 50% 44%, #322618 0%, #221a10 55%, #120d07 100%)' }}
      >
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
              const isAllyTile = allyHeroes.some((p) => hexKey(p.hex) === key);
              const threatCount = showThreat && !isPlayerTile && !isAllyTile ? (threatCounts[key] ?? 0) : 0;
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
                      : isAllyTile ? 'rgba(52,211,153,0.6)'
                      : 'rgba(0,0,0,0.4)'}
                    strokeWidth={isHovered ? 3.5 : highlight || isPlayerTile || isAllyTile ? 3 : 1}
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
                  {/* Threat zone overlay — tint graded by HOW MANY enemies can strike this tile,
                      so the danger map ranks tiles instead of flooding uniform red (audit U4). */}
                  {threatCount > 0 && (
                    <polygon
                      points={ptsAt(corners, t.x, t.y)}
                      fill={`rgba(239,68,68,${(0.08 + 0.09 * Math.min(threatCount, 3)).toFixed(2)})`}
                      stroke={`rgba(239,68,68,${(0.25 + 0.15 * Math.min(threatCount, 3)).toFixed(2)})`}
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
                  {/* Elevation badge for high ground — on targetable tiles, and in move mode only
                      on the HOVERED tile (audit U9: a board-wide ▲ flood shouts over everything). */}
                  {tile.elevation > 0 && (highlight === 'target' || (sel?.kind === 'move' && reachable.has(key) && isHovered)) && (
                    <text
                      x={t.x + size * 0.52} y={t.y - size * 0.62}
                      textAnchor="middle" dominantBaseline="central"
                      fontSize={size * 0.38} fill="rgba(250,204,21,0.95)"
                      stroke="rgba(0,0,0,0.7)" strokeWidth={size * 0.06} paintOrder="stroke"
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
            // Use displayHex (may equal prevHex) so enemies appear to move one at a time
            // during the enemy phase rather than all sliding simultaneously.
            const c = top(u.displayHex);
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
                slideMs={u.slideMs}
                intent={showIntents ? intent : undefined}
                archetypeColor={archetypeColor}
                archetypeBlurb={archetypeBlurb}
                weakResist={weakResist}
                onClick={u.enemyId !== undefined ? () => onTileClick(u.hex) : undefined}
                onHover={u.enemyId !== undefined ? (over) => onTileHover(over ? u.hex : null) : undefined}
              />
            );
          })}

          {/* Animation effects + floaters */}
          {live.map((fx) => (
            <EffectSprite key={fx.id} fx={fx} from={top(fx.from)} to={top(fx.to)} />
          ))}

          {/* Damage preview at the point of aim — the bottom-bar strip stays as a fallback,
              but the decision is made looking at the target, so the numbers live there too. */}
          {hoverPreview && hoveredHex && (sel?.kind === 'attack' || sel?.kind === 'spell') && (() => {
            const p = top(hoveredHex);
            return (
              <div
                className="pointer-events-none absolute z-40 whitespace-nowrap rounded-md border border-gold-deep/60 bg-wood-950/90 px-2 py-1 shadow-lg"
                style={{ left: p.x, top: Math.max(28, p.y - size * 1.15), transform: 'translate(-50%, -100%)' }}
              >
                <PreviewBadge preview={hoverPreview} />
              </div>
            );
          })()}

          {/* Out-of-range toast for invalid clicks while an action is armed */}
          {invalidClick && (() => {
            const p = top(invalidClick.hex);
            return (
              <div
                key={invalidClick.id}
                className="pointer-events-none absolute z-40 whitespace-nowrap rounded-md border border-ember-deep/60 bg-wood-950/90 px-2 py-0.5 font-display text-[11px] text-ember-bright shadow-lg"
                style={{ left: p.x, top: p.y - size * 0.9, transform: 'translate(-50%, -100%)', animation: 'tactics-floater 900ms ease-out forwards' }}
              >
                {invalidClick.text}
              </div>
            );
          })()}
        </div>

        {/* Outcome card — the payoff moment: gold, materials, XP, objective recap, tier record.
            Displayed numbers come from the SAME functions commitTactics banks (no drift). */}
        {tactics.status !== 'active' && (() => {
          const won = tactics.status === 'won';
          const reward = tacticsReward(tactics);
          const goldOut = Math.round((reward.gold ?? 0) * habitBonus);
          const xp = tacticsStatXp(tactics);
          const newRecord = won && tactics.tier > deepestTacticsTier;
          const obj = tactics.objective;
          const statColor: Record<string, string> = { AG: 'text-stat-AG', DX: 'text-stat-DX', EN: 'text-stat-EN' };
          return (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-wood-950/85 p-4">
              <div className="w-full max-w-sm space-y-3 rounded-lg border border-gold-deep/50 bg-wood-900/95 p-5 text-center shadow-2xl">
                <div className="flex flex-col items-center gap-1.5">
                  {won ? <Trophy className="h-10 w-10 text-gold-bright" /> : <Skull className="h-10 w-10 text-ember-bright" />}
                  <div className={cn('font-display text-xl font-bold', won ? 'text-gold-bright' : 'text-ember-bright')}>
                    {won ? 'Victory!' : 'Defeated'}
                  </div>
                  <div className="font-display text-[11px] uppercase tracking-wider text-parchment-300/60">
                    Tier {tactics.tier} · turn {tactics.turnCount}
                  </div>
                  {newRecord && (
                    <div className="rounded-full border border-gold-deep/60 bg-gold-deep/20 px-2.5 py-0.5 font-display text-[11px] font-bold text-gold-bright">
                      🏅 New record — Tier {tactics.tier}!
                    </div>
                  )}
                </div>

                {obj && (
                  <div
                    className={cn(
                      'rounded-md border px-2 py-1 font-display text-[11px]',
                      obj.complete
                        ? 'border-green-700/50 bg-green-900/20 text-green-300'
                        : 'border-red-700/40 bg-red-900/15 text-red-400/90',
                    )}
                  >
                    {obj.complete ? '✓' : '✗'} {obj.label}
                    {obj.complete ? ' — +60% gold · potion' : won ? ' — missed' : ' — voided'}
                  </div>
                )}

                <div className="space-y-1.5 rounded-md border border-gold-deep/30 bg-wood-950/50 p-3 text-left">
                  {goldOut > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-parchment-300"><Coins className="h-3.5 w-3.5 text-gold-bright" /> Gold{!won && ' (damage dealt)'}</span>
                      <span className="font-display font-bold text-gold-bright">+{goldOut}</span>
                    </div>
                  )}
                  {Object.entries(reward.materials ?? {}).map(([key, qty]) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-parchment-300">
                        <span
                          className="flex h-3.5 w-3.5 items-center justify-center rounded-sm font-display text-[9px] font-bold text-white"
                          style={{ backgroundColor: MATERIALS[key]?.color ?? '#666' }}
                        >
                          {MATERIALS[key]?.glyph ?? '?'}
                        </span>
                        {MATERIALS[key]?.name ?? key}
                      </span>
                      <span className="font-display font-bold text-parchment-200">×{qty}</span>
                    </div>
                  ))}
                  {(reward.items ?? []).map((item) => (
                    <div key={item} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-parchment-300">🧪 Healing Potion</span>
                      <span className="font-display font-bold text-parchment-200">×1</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-parchment-300">Training XP{!won && ' (half)'}</span>
                    <span className="font-display font-bold">
                      {Object.entries(xp).map(([stat, amt], i) => (
                        <span key={stat}>
                          {i > 0 && <span className="text-parchment-300/40"> · </span>}
                          <span className={statColor[stat] ?? 'text-parchment-200'}>{stat} +{amt}</span>
                        </span>
                      ))}
                    </span>
                  </div>
                </div>

                <StreakBonusChip className="text-[11px]" />
                {!won && (
                  <div className="text-[11px] text-parchment-300/70">
                    Every skirmish trains you — the XP above is already earned.
                  </div>
                )}
                <Button onClick={endTactics} className="w-full py-2">
                  {won ? 'Claim reward' : 'Leave'}
                </Button>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Action bar — removed entirely once the match ends so nothing stays interactive
          (or misleadingly armed) beneath the outcome card. */}
      {tactics.status === 'active' && (
      <div className="border-t border-gold-deep/40 bg-wood-900/80 px-3 py-2">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-1.5">
          <ActionButton
            active={sel?.kind === 'move'}
            disabled={locked || tactics.player.movesLeft <= 0}
            title={tactics.player.movesLeft <= 0 ? 'No movement left this turn — it refills after the enemy phase' : undefined}
            onClick={() => { setHoveredHex(null); tacticsSelect({ kind: 'move' }); }}
          >
            <Footprints className="h-4 w-4" /> Move
          </ActionButton>
          <ActionButton
            active={sel?.kind === 'attack'}
            disabled={locked || tactics.player.hasActed}
            title={tactics.player.hasActed
              ? 'Already acted this turn — one attack or spell per turn'
              : tactics.player.sta < weapon.staminaCost
                ? `Exhausted — below ${weapon.staminaCost} stamina, this swing lands at half power`
                : undefined}
            onClick={() => { setHoveredHex(null); tacticsSelect({ kind: 'attack' }); }}
          >
            ⚔️ {attackLabel}
            {tactics.player.sta < weapon.staminaCost && <span className="text-orange-300">×½</span>}
          </ActionButton>
          {knownSpells.map((key) => {
            const spell = getSpell(key);
            if (!spell) return null;
            const tooCostly = tactics.player.mp < spell.mpCost;
            return (
              <ActionButton
                key={key}
                active={sel?.kind === 'spell' && sel.spellKey === key}
                disabled={locked || tactics.player.hasActed || tooCostly}
                onClick={() => { setHoveredHex(null); onPickSpell(key); }}
                title={`${spell.name} (${spell.mpCost} MP) — ${spell.description}`}
              >
                {(SPELL_FX[key]?.glyph ?? '✨')} {spell.name}
                <span className="ml-1 text-[10px] text-blue-300">{spell.mpCost}</span>
              </ActionButton>
            );
          })}
          <ActionButton
            accent
            disabled={locked || tactics.player.hasActed}
            onClick={isCoopGuest && coopSend
              ? () => coopSend({ type: 'tactics-intent', userId, heroId: tactics?.player.id ?? userId, action: 'hold' })
              : tacticsHold}
            title="Arm an overwatch stance — fire a reaction shot on the first enemy that steps into range"
          >
            {tactics.player.overwatch ? '⌖ Watching…' : 'Hold ⌖'}
          </ActionButton>
          <ActionButton accent disabled={locked}
            onClick={isCoopGuest && coopSend
              ? () => coopSend({ type: 'tactics-intent', userId, heroId: tactics?.player.id ?? userId, action: 'endTurn' })
              : tacticsEndTurn}
          >
            End turn <ChevronRight className="h-4 w-4" />
          </ActionButton>
          {confirmRetreat ? (
            <span className="ml-1 flex items-center gap-1 rounded-md border border-ember-deep/60 bg-ember-deep/20 px-2 py-1.5 font-display text-[11px] text-ember-bright">
              Forfeit?
              <button type="button" onClick={endTactics} className="underline hover:text-white">Yes</button>
              <button type="button" onClick={() => setConfirmRetreat(false)} className="underline hover:text-parchment-200">No</button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRetreat(true)}
              className="ml-1 flex items-center gap-1 rounded-md px-2 py-1.5 font-display text-[11px] text-parchment-300/70 hover:text-ember-bright"
              title="Retreat — forfeit the skirmish and keep gold for the damage you dealt"
            >
              <LogOut className="h-3.5 w-3.5" /> Retreat
            </button>
          )}
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
          ) : sel?.kind === 'attack' && weapon.ranged ? (
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
      )}
    </div>
  );
}

function UnitSprite({
  x, y, glyph, hp, maxHp, statuses, friendly, name, scale = 1,
  slideMs = 200,
  intent, archetypeColor, archetypeBlurb, weakResist, onClick, onHover,
}: {
  x: number; y: number; glyph: string; hp: number; maxHp: number; statuses: UnitStatus[];
  friendly?: boolean; name?: string; scale?: number;
  /**
   * CSS transition duration for the position transform (ms).
   * 0 = instant snap (used when holding a unit at prevHex before its stagger fires).
   * MOVE_ANIM_MS = smooth slide after stagger timer fires.
   */
  slideMs?: number;
  intent?: EnemyIntent;
  /** Archetype ring color (hex string); absent for the player. */
  archetypeColor?: string;
  /** Short archetype label + blurb shown in the intent badge tooltip. */
  archetypeBlurb?: string;
  /** Whether the current player action hits a weakness (⬆) or resistance (⬇) of this enemy. */
  weakResist?: 'weak' | 'resist' | null;
  onClick?: () => void;
  /** Hover pass-through: the sprite sits above its tile polygon and swallows mouse events,
   *  so without this the damage preview never fires when pointing at the unit itself. */
  onHover?: (over: boolean) => void;
}) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const tooltipText = archetypeBlurb ? `${name ?? ''}\n${archetypeBlurb}` : (name ?? undefined);
  return (
    <div
      // hover:z-30 raises the pointed-at unit above overlapping neighbours (iso rows crowd).
      className={cn('absolute z-20 flex flex-col items-center hover:z-30', onClick ? 'cursor-pointer' : 'pointer-events-none')}
      style={{ left: 0, top: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -78%)`, transition: slideMs > 0 ? `transform ${slideMs}ms ease-out` : 'none' }}
      title={tooltipText}
      onClick={onClick}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      {/* Intent badge — shows planned action icon + archetype name (Phase C) */}
      {intent && !friendly && (
        <div
          className="pointer-events-none flex items-center gap-0.5 rounded-sm bg-wood-950/70 px-0.5 text-[9px]"
          title={archetypeBlurb ? `${archetypeBlurb}\n${intent.attackLabel}` : intent.attackLabel}
        >
          {intent.willAttack ? (
            <span style={{ fontSize: Math.round(10 * scale) }}>{intent.lunge ? '💨' : ''}{intent.attackIcon === '💨' ? '⚔️' : intent.attackIcon}</span>
          ) : intent.lunge ? (
            // Winding up a catch-up lunge — reach next turn is 2×move+1, mirrored by the danger zone.
            <span style={{ fontSize: Math.round(10 * scale) }} title="Winding up a lunge!">💨</span>
          ) : intent.attackIcon === '❄️' ? (
            <span className="text-blue-300">❄️</span>
          ) : null}
          {(name || archetypeBlurb) && (
            // Creature name, colored by archetype — the log speaks in names ("Wailing Wisp hits…"),
            // so the board must too; the archetype lives in the ring color + tooltip (audit U3).
            <span
              className="ml-0.5 truncate font-display leading-none"
              style={{ fontSize: Math.round(8 * scale), color: archetypeColor ?? '#aaa', maxWidth: Math.round(64 * scale) }}
            >
              {name ?? archetypeBlurb!.split(' ')[0]}
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
            animation: !friendly ? 'tactics-idle-pulse 2.8s ease-in-out infinite' : undefined,
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
      {/* Name tag — visible label for co-op heroes so each player knows who is who */}
      {friendly && name && (
        <div
          className="pointer-events-none rounded bg-wood-950/75 px-1 py-px text-center font-display leading-tight"
          style={{ fontSize: Math.round(7 * scale), color: '#c9b57a', whiteSpace: 'nowrap', maxWidth: Math.round(54 * scale) }}
        >
          {name}
        </div>
      )}
    </div>
  );
}

function EffectSprite({ fx, from, to }: { fx: TacticalEffect; from: { x: number; y: number }; to: { x: number; y: number } }) {
  if (fx.kind === 'floater') {
    const color = fx.color ? FLOATER_COLOR[fx.color] : '#fbbf24';
    // Deterministic horizontal jitter so overlapping floaters (multi-hit turns) don't stack.
    const jitter = ((fx.id % 5) - 2) * 5;
    return (
      <div
        className="pointer-events-none absolute z-40 select-none font-display font-bold"
        style={{
          left: to.x + jitter,
          top: to.y,
          color,
          fontSize: fx.color === 'status' ? 13 : 19,
          textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.6)',
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
