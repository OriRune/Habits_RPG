import { useState, useEffect, useRef } from 'react';
import { Heart, Zap, Coins, ChevronsDown, LogOut, Trees, Skull, Sparkles, Archive } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useForestLoop } from '@/hooks/useForestLoop';
import {
  canAdvance,
  facedCell,
  isVisible,
  sightRadiusFor,
  pendingActKind,
  FOREST_DEATH_KEEP,
  FOREST_STASH_KEEP,
  FOREST_WINDUP_MS,
  type ForestTile,
  type PendingActKind,
} from '@/engine/forest';
import { cameraWindow, VIEW, splitHaul } from '@/engine/crawl';
import { useSmoothCamera, type SmoothCameraLayout } from '@/hooks/useSmoothCamera';
import { bandForStage, type ForestBandId } from '@/engine/crawlBiomes';
import { FOREST_NODES, FOREST_BEASTS, SHRINE_EVENTS, type ShrineEventKind } from '@/content/forest';
import { BOONS } from '@/content/boons';
import { forestThicketTree, forestFloorTile, forestNodeSprite, cellHash as tileJitter } from '@/lib/minigameArt';
import { getMaterial } from '@/engine/materials';
import { Button } from '@/components/ui/Button';
import { Divider } from '@/components/ui/Divider';
import { FitToWidth } from '@/components/ui/FitToWidth';
import { clientToTile, createTapTracker } from '@/components/minigame/boardTap';
import { cn } from '@/lib/cn';
import type { Reward } from '@/engine/challenges';
import { ForestControls } from './ForestControls';
import { CrawlerAvatar } from '@/components/minigame/CrawlerAvatar';
import { CrawlGauge } from '@/components/minigame/CrawlGauge';
import { RemoteCrawlers } from '@/components/minigame/RemoteCrawlers';
import { BoonChoicePanel } from '@/components/minigame/BoonChoicePanel';
import { useCrawlRunFx } from '@/components/minigame/useCrawlRunFx';
import { rewardChips } from '@/components/minigame/HaulChips';
import { CrawlSpellBar } from '@/components/minigame/CrawlSpellBar';
import { StreakBonusChip } from '@/components/character/StreakBonusChip';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';
import { usePartyStore } from '@/hooks/useParty';
import { CoopToasts } from '@/components/minigame/CoopToasts';
import * as sfx from '@/lib/sfx';

const CELL = 52; // px per tile
/** Desktop upscale cap for the board + HUD column (sizing plan Phase 1). */
const BOARD_MAX_SCALE = 1.5;
/** Extra border cells rendered around the viewport to fill gaps during smooth scroll. */
const MARGIN = 1;
const RENDER_VIEW = VIEW + 2 * MARGIN; // 13 rendered rows/cols

/** Base colour per tile kind (Thicket band / default). */
const TILE_BG: Record<ForestTile['kind'], [number, number, number]> = {
  tree:     [18,  34,  14],
  thicket:  [22,  56,  32],
  trail:    [58,  46,  30],
  clearing: [78, 106,  50],
  entrance: [107, 83,  32],
  treeline: [26,  58,  38],
  node:     [52,  48,  29],
  shrine:   [88,  72,  38],
  boon:     [120, 90,  10],  // gold hue
};

/** Per-shrine-kind border glow so Cache / Blessing / Den are visually distinct before activation. */
const SHRINE_KIND_BORDER: Record<ShrineEventKind, string> = {
  cache:    `inset 0 0 0 2px rgba(255,210,80,0.70), inset 0 0 12px rgba(255,190,40,0.40)`,
  blessing: `inset 0 0 0 2px rgba(100,220,150,0.70), inset 0 0 12px rgba(60,200,120,0.35)`,
  den:      `inset 0 0 0 2px rgba(220,80,80,0.75),  inset 0 0 12px rgba(200,40,40,0.35)`,
};
const SHRINE_KIND_GLOW: Record<ShrineEventKind, string> = {
  cache:    'drop-shadow(0 0 6px rgba(255,200,60,0.9))',
  blessing: 'drop-shadow(0 0 7px rgba(80,220,140,0.9))',
  den:      'drop-shadow(0 0 7px rgba(220,80,80,0.9))',
};

/** Act context hint labels rendered in the HUD while a run is active. */
const ACT_HINTS: Partial<Record<PendingActKind, { text: string; color: string }>> = {
  advance: { text: '▼ push deeper', color: '#34d399' },
  attack:  { text: '⚔ attack',      color: '#f87171' },
  shrine:  { text: '✦ activate shrine', color: '#fbbf24' },
  harvest: { text: '✿ harvest',     color: '#86efac' },
  chop:    { text: '🪓 chop',        color: '#d97706' },
};

/** Blend TILE_BG base colour toward the band's accent hue for visual differentiation. */
const BAND_TINTS: Partial<Record<ForestBandId, [number, number, number]>> = {
  deepwood: [80,  50, 120], // violet hue
  ancient:  [120, 90,  30], // amber hue
};
function tintForBand(bandId: ForestBandId, rgb: [number, number, number]): [number, number, number] {
  const tint = BAND_TINTS[bandId];
  if (!tint) return rgb; // thicket — no change
  const f = 0.20;
  return [
    Math.round(rgb[0] * (1 - f) + tint[0] * f),
    Math.round(rgb[1] * (1 - f) + tint[1] * f),
    Math.round(rgb[2] * (1 - f) + tint[2] * f),
  ];
}

/** Deterministic 0..1 hash for a cell — stable across renders. */
/** Per-cell floor background — richer than a flat colour. Band tints the base palette. */
function floorStyle(kind: ForestTile['kind'], r: number, c: number, bandId: ForestBandId): React.CSSProperties {
  const [R0, G0, B0] = tintForBand(bandId, TILE_BG[kind]);
  const m = 0.84 + 0.3 * tileJitter(r, c);
  const [R, G, B] = [R0, G0, B0].map((v) => Math.round(Math.min(255, v * m)));
  const bg = `rgb(${R},${G},${B})`;

  if (kind === 'trail') {
    const j1 = tileJitter(r * 3 + 1, c * 3 + 2);
    const j2 = tileJitter(r + 13, c + 7);
    const ang = Math.floor(tileJitter(r, c + 1) * 140) + 20;
    // ~15% of cells get a root/crack streak; ~15% a fallen-leaf radial
    const extra =
      j1 < 0.15
        ? `linear-gradient(${ang}deg, transparent 40%, rgba(28,16,6,0.32) 44%, rgba(28,16,6,0.32) 56%, transparent 60%),`
        : j1 < 0.30
        ? `radial-gradient(circle at ${Math.floor(j2 * 70) + 15}% ${Math.floor(tileJitter(r + 2, c) * 70) + 15}%, rgba(52,70,28,0.45) 0%, transparent 26%),`
        : '';
    return {
      backgroundColor: bg,
      backgroundImage:
        extra +
        'radial-gradient(circle at 50% 42%, rgba(90,70,44,0.32) 0%, transparent 62%),' +
        'radial-gradient(circle at 22% 78%, rgba(36,24,12,0.38) 0%, transparent 40%)',
    };
  }
  if (kind === 'clearing') {
    const j1 = tileJitter(r * 3 + 7, c * 3 + 5);
    const j2 = tileJitter(r + 5, c + 9);
    const extra =
      j1 < 0.20
        ? `radial-gradient(ellipse at ${Math.floor(j2 * 60) + 20}% 82%, rgba(110,170,58,0.5) 0%, transparent 24%),`
        : j1 < 0.35
        ? `radial-gradient(circle at ${Math.floor(j2 * 80) + 10}% ${Math.floor(tileJitter(r, c + 4) * 80) + 10}%, rgba(80,130,44,0.35) 0%, transparent 18%),`
        : '';
    return {
      backgroundColor: bg,
      backgroundImage:
        extra +
        'radial-gradient(circle at 50% 30%, rgba(164,200,110,0.40) 0%, transparent 66%),' +
        'radial-gradient(circle at 76% 74%, rgba(48,76,32,0.42) 0%, transparent 44%)',
    };
  }
  if (kind === 'entrance') {
    return {
      backgroundColor: bg,
      backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(232,200,96,0.38) 0%, transparent 72%)',
    };
  }
  if (kind === 'treeline') {
    return {
      backgroundColor: bg,
      backgroundImage: 'radial-gradient(circle at 50% 46%, rgba(72,202,140,0.42) 0%, transparent 72%)',
    };
  }
  if (kind === 'node') {
    return { backgroundColor: bg };
  }
  if (kind === 'shrine') {
    return {
      backgroundColor: bg,
      backgroundImage: 'radial-gradient(circle at 50% 44%, rgba(255,220,100,0.55) 0%, rgba(200,140,40,0.20) 50%, transparent 72%)',
    };
  }
  // tree / thicket — dark base, sprite rendered separately
  return { backgroundColor: '#111d0d' };
}


/**
 * End-of-run summary card — a parchment scroll floating over the dimmed canvas
 * (the board stays visible behind so the player can see where the run ended).
 * accent 'gold' frames the voluntary bank; 'ember' frames a death. Mirrors the
 * same structure in MineRunOverlay so both crawlers end on the same beat.
 */
function EndOfRunPanel({ accent, children }: { accent: 'gold' | 'ember'; children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center rounded-md bg-black/60 p-4">
      <div
        className={cn(
          'texture-parchment flex w-full max-w-xs flex-col items-center gap-2.5 rounded-md border-2 p-4 text-center',
          accent === 'ember'
            ? 'border-ember/80 shadow-[0_0_24px_rgba(156,58,37,0.45),0_8px_28px_rgba(0,0,0,0.65)]'
            : 'border-gold-deep/80 shadow-[0_0_24px_rgba(201,162,39,0.35),0_8px_28px_rgba(0,0,0,0.65)]',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** One side of the kept/lost ledger — material-colored dots with ink labels, readable on parchment. */
function HaulLedger({ reward, empty, lost }: { reward: Reward; empty: string; lost?: boolean }) {
  const chips = rewardChips(reward);
  if (chips.length === 0) return <span className="text-sm italic text-ink-light">{empty}</span>;
  return (
    <>
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap text-sm',
            lost ? 'text-ink-light line-through' : 'text-ink',
          )}
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full ring-1 ring-black/25"
            style={{ backgroundColor: chip.color }}
          />
          {chip.label}
        </span>
      ))}
    </>
  );
}

export function ForestRunOverlay() {
  const controls = useForestLoop();
  const forest = useGameStore((s) => s.forest);
  const endForest = useGameStore((s) => s.endForest);
  const forestAdvance = useGameStore((s) => s.forestAdvance);
  const chooseForestBoon = useGameStore((s) => s.chooseForestBoon);
  const skipForestBoon = useGameStore((s) => s.skipForestBoon);
  const beginForestBanking = useGameStore((s) => s.beginForestBanking);
  const forestStash = useGameStore((s) => s.forestStash);
  const habitBonus = useGameStore((s) => s.character.habitBonus);
  const remotePlayers = useCoopStore((s) => s.remotePlayers);
  const coopSession = useCoopStore((s) => s.session);
  const coopJoined = useCoopStore((s) => s.joined);
  const partyMembers = usePartyStore((s) => s.members);
  const myId = useAuthStore((s) => s.session?.user?.id);
  // Prefer the authoritative party-roster name; fall back to the broadcast name.
  const nameFor = (userId: string, fallback: string) =>
    partyMembers.find((m) => m.user_id === userId)?.username ?? fallback;
  // In co-op the host leads the descent; guests follow via the world slice.
  const isCoopGuest = coopJoined && !!coopSession && coopSession.host_id !== myId;

  // Smooth-camera refs
  const worldRef = useRef<HTMLDivElement>(null);
  // Tap-to-act: the board frame anchors the client→tile inversion (scale via its rect).
  const boardFrameRef = useRef<HTMLDivElement>(null);
  const tapTracker = useRef(createTapTracker());
  const playerRef = useRef<HTMLDivElement | null>(null);
  const moverRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const layoutRef = useRef<SmoothCameraLayout>({
    baseR0: 0, baseC0: 0, playerR: 0, playerC: 0, rows: 33, cols: 33,
    movers: [], snapKey: 0,
  });
  const { shake } = useSmoothCamera(worldRef, playerRef, moverRefs, layoutRef, { CELL, VIEW });

  const [wipeAt, setWipeAt] = useState(0);
  const stageMountRef = useRef(false);
  // Charge bar — updated imperatively each rAF frame to avoid 60fps React re-renders.
  const chargeBarRef = useRef<HTMLDivElement>(null);
  // Guardian arrival alert (timestamp; 0 = none active).
  const [guardianAlert, setGuardianAlert] = useState(0);
  const prevGuardianStageRef = useRef<number | null>(null);

  // Shared state-diff FX (destruction pops, loot/damage floaters, dash rings, shake).
  // Forest is silent (no sfx bag) and omits the mine-only descent/defeat stings.
  const { moving, pops, lootPops, dmgPops, vfxPops, hitAt } = useCrawlRunFx(forest ?? null, {
    moverRefs, playerRef, shake, cell: CELL,
    materialName: getMaterial,
    unitsOf: (f) => f.beasts,
    tileBreak: (tile, was) =>
      tile.kind === 'trail' && (was?.kind === 'node' || was?.kind === 'tree') ? was.kind : null,
    dashColor: 'rgba(140,230,120,0.75)',
    lootPopWindow: 900,
    lootPopTimeout: 950,
  });

  // Phase 6: stage-change wipe (skip first mount).
  useEffect(() => {
    if (!stageMountRef.current) { stageMountRef.current = true; return; }
    setWipeAt(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forest?.stage]);

  // Adaptive tension drone — starts when the overlay mounts, stops on unmount.
  useEffect(() => {
    sfx.startDrone();
    return () => sfx.stopDrone();
  }, []);

  // Drive drone intensity from visible, awake predators.
  useEffect(() => {
    if (!forest || forest.status !== 'active') { sfx.setDroneIntensity(0); return; }
    const now = performance.now(); // engine timebase — windupUntilMs is rAF-clock

    const sight = sightRadiusFor(forest);
    const nearby = forest.beasts.filter((b) => {
      if (b.asleep || FOREST_BEASTS[b.key]?.flees) return false;
      return Math.abs(b.r - forest.player.r) + Math.abs(b.c - forest.player.c) <= sight + 1;
    });
    const windupActive = nearby.some((b) => b.windupUntilMs && b.windupUntilMs > now);
    sfx.setDroneIntensity(Math.min(1, nearby.length * 0.28 + (windupActive ? 0.45 : 0)));
  }); // runs every render — fast enough via forest state changes

  // Charge bar DOM update — runs every rAF frame without triggering React re-renders.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = controls.chargeRef.current.progress01;
      const el = chargeBarRef.current;
      if (!el) return;
      el.style.width = `${Math.round(p * 100)}%`;
      el.style.opacity = p > 0.04 ? '1' : '0';
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guardian arrival announcement — fires once when the new stage has a guardian.
  useEffect(() => {
    if (!forest) return;
    if (
      prevGuardianStageRef.current !== null &&
      prevGuardianStageRef.current !== forest.stage &&
      forest.beasts.some((b) => FOREST_BEASTS[b.key]?.isGuardian)
    ) {
      setGuardianAlert(Date.now());
      shake(8, 450);
      sfx.play('arenaBossPhase');
    }
    prevGuardianStageRef.current = forest.stage;
  }, [forest?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!forest) return null;

  const band = bandForStage(forest.stage);
  const dead = forest.status === 'ended';
  const onTreeline = canAdvance(forest);
  const onClearing = forest.tiles[forest.player.r]?.[forest.player.c]?.kind === 'clearing';
  const hasLoot = (forest.haul.gold ?? 0) > 0 || Object.keys(forest.haul.materials ?? {}).length > 0;
  /** Stash is available on clearing tiles with a non-empty haul. */
  const canStash = onClearing && hasLoot;
  const faced = facedCell(forest);
  const haulMats = Object.entries(forest.haul.materials ?? {}).filter(([, n]) => n > 0);

  // Camera: integer top-left of the centred 11×11 window.
  const { r0, c0 } = cameraWindow(forest.player, forest.rows, forest.cols);
  const baseR0 = Math.max(0, r0 - MARGIN);
  const baseC0 = Math.max(0, c0 - MARGIN);

  // Board size — clamped to the map when it's smaller than the fixed view window,
  // so a small stage doesn't leave a dead black band inside the canvas.
  const boardW = Math.min(VIEW, forest.cols) * CELL;
  const boardH = Math.min(VIEW, forest.rows) * CELL;

  // Desktop upscale (sizing plan Phase 1): FitToWidth may magnify the board up to
  // 1.5× on wide viewports; the dvh budget still shrinks it on short ones. HUD rows
  // track the same width expression so the controls stay visually attached to the
  // board — floored at the old 600px so short viewports keep today's layout.
  const boardAspect = boardW / boardH;
  const boardCap = `min(${boardW * BOARD_MAX_SCALE}px, max(280px, calc((100dvh - 300px) * ${boardAspect})))`;
  const hudCap = `min(${boardW * BOARD_MAX_SCALE}px, max(600px, calc((100dvh - 300px) * ${boardAspect})))`;

  const vr = (worldR: number) => worldR - baseR0;
  const vc = (worldC: number) => worldC - baseC0;
  const inView = (worldR: number, worldC: number) => {
    const vri = vr(worldR);
    const vci = vc(worldC);
    return vri >= 0 && vri < RENDER_VIEW && vci >= 0 && vci < RENDER_VIEW;
  };

  layoutRef.current = {
    baseR0,
    baseC0,
    playerR: forest.player.r,
    playerC: forest.player.c,
    rows: forest.rows,
    cols: forest.cols,
    snapKey: forest.stage,
    // Beasts (only when in sight) + co-op party members on this stage. Teammates are
    // shown through fog so the party stays visible; the `rp:` id namespace avoids
    // colliding with beast ids. Both ride the rAF mover path for smooth motion.
    movers: [
      ...forest.beasts
        .filter((b) => isVisible(forest, b.r, b.c) && inView(b.r, b.c))
        .map((b) => ({ id: b.id, r: b.r, c: b.c })),
      ...Object.values(remotePlayers)
        .filter((p) => p.floor === forest.stage && inView(p.r, p.c))
        .map((p) => ({ id: `rp:${p.userId}`, r: p.r, c: p.c })),
    ],
  };

  // Torch-glow radius and position in world-container space
  const litR = (sightRadiusFor(forest) + 0.5) * CELL;
  const lightX = (forest.player.c - baseC0) * CELL + CELL / 2;
  const lightY = (forest.player.r - baseR0) * CELL + CELL / 2;

  const death = dead ? splitHaul(forest.haul, FOREST_DEATH_KEEP) : null;

  return (
    <div className="texture-wood fixed inset-0 z-50 flex flex-col items-center gap-2 overflow-auto px-4 py-3">
      <CoopToasts />
      {/* HUD */}
      <div className="flex w-full items-center justify-between gap-3" style={{ maxWidth: hudCap }}>
        <span className="font-display text-sm font-bold text-gold-bright">
          {/* Keep "Depth N" atomic so a narrow HUD never wraps between label and number */}
          The Wild Forest · <span className="whitespace-nowrap">Depth {forest.stage}</span>
          <span className="ml-2 text-[11px] font-normal opacity-70">{band.name}</span>
          {forest.beasts.some((b) => FOREST_BEASTS[b.key]?.isGuardian) && (
            <span className="ml-2 rounded px-1 py-0.5 text-[10px] font-bold text-amber-300 bg-amber-900/40 border border-amber-600/50">
              ⚔ Guardian
            </span>
          )}
          {forest.activeBoons?.map((key) => {
            const boon = BOONS[key];
            if (!boon) return null;
            return (
              <span key={key} title={boon.desc}
                className="ml-1 rounded px-1 py-0.5 text-[10px] font-bold text-emerald-300 bg-emerald-900/40 border border-emerald-600/50">
                {boon.icon} {boon.name}
              </span>
            );
          })}
        </span>
        <div className="flex flex-col items-end gap-1">
          <CrawlGauge icon={<Heart className="h-3.5 w-3.5 text-stat-HP" />} value={forest.hp} max={forest.maxHp} fill="#2e8a5e" />
          <CrawlGauge icon={<Zap className="h-3.5 w-3.5 text-stat-AG" />} value={forest.sta} max={forest.maxSta} fill="#b8860b" />
          {forest.maxMp > 0 && (
            <CrawlGauge icon={<Sparkles className="h-3.5 w-3.5 text-violet-400" />} value={forest.mp} max={forest.maxMp} fill="#7c3aed" />
          )}
          {/* Charge bar — filled while holding Space; updated imperatively via rAF */}
          <div className="flex items-center gap-1.5">
            <span className="h-3.5 w-3.5" />
            <div className="h-1.5 w-24 overflow-hidden rounded-full border border-amber-600/40 bg-wood-900">
              <div ref={chargeBarRef} style={{ height: '100%', borderRadius: 9999, backgroundColor: '#fbbf24', width: '0%', opacity: 0 }} />
            </div>
            <span className="font-display text-[10px] text-amber-400/70">charge</span>
          </div>
          {/* Act context hint */}
          {forest.status === 'active' && (() => {
            const hint = ACT_HINTS[pendingActKind(forest)];
            return hint
              ? <span className="font-display text-[10px]" style={{ color: hint.color }}>{hint.text}</span>
              : null;
          })()}
        </div>
      </div>

      {/* Haul */}
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment-200" style={{ maxWidth: hudCap }}>
        <span className="font-display uppercase tracking-wider text-parchment-300/70">Haul</span>
        <span className="flex items-center gap-1 text-gold-bright">
          <Coins className="h-3.5 w-3.5" /> {forest.haul.gold ?? 0}
        </span>
        {haulMats.map(([key, n]) => (
          <span key={key} className="text-parchment-200">
            {getMaterial(key)?.name ?? key} ×{n}
          </span>
        ))}
        {haulMats.length === 0 && (forest.haul.gold ?? 0) === 0 && (
          <span className="text-parchment-300/50">nothing yet — forage and slash</span>
        )}
      </div>

      {/* Forest board — FitToWidth scales it down on narrow screens and up to 1.5× on
          wide ones; the dvh cap shrinks it on short desktop viewports so the action row
          stays above the fold (~300px is the HUD + haul + spells + buttons + hints
          budget). Tap-to-act: a clean tap (≤8px movement) inverts through the world
          rect to a tile and lets the loop resolve face/step/act (bows can tap-shoot
          down an orthogonal line). */}
      <div
        className="flex w-full shrink-0 justify-center"
        style={{ maxWidth: boardCap }}
      >
      <FitToWidth contentWidth={boardW} contentHeight={boardH} maxScale={BOARD_MAX_SCALE}>
      <div
        ref={boardFrameRef}
        className="relative shrink-0 overflow-hidden rounded-md border-2 border-gold-deep/60"
        style={{
          width: boardW,
          height: boardH,
          boxShadow: 'inset 0 0 48px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,0,0,0.5)',
        }}
        onPointerDown={(e) => tapTracker.current.down(e)}
        onPointerCancel={() => tapTracker.current.cancel()}
        onPointerUp={(e) => {
          const pt = tapTracker.current.up(e);
          if (!pt || forest.status !== 'active') return;
          const tile = clientToTile(pt.x, pt.y, {
            frame: boardFrameRef.current,
            world: worldRef.current,
            boardW,
            cell: CELL,
            baseR0,
            baseC0,
          });
          if (tile && tile.r >= 0 && tile.r < forest.rows && tile.c >= 0 && tile.c < forest.cols) {
            controls.tapAct(tile.r, tile.c);
          }
        }}
      >
        {/* World container — translated continuously by useSmoothCamera */}
        <div ref={worldRef} className="absolute" style={{ willChange: 'transform' }}>

        {/* Tile layer — includes tree sprites inline so they render reliably */}
        {Array.from({ length: RENDER_VIEW }, (_, vi) =>
          Array.from({ length: RENDER_VIEW }, (_, vj) => {
            const r = baseR0 + vi;
            const c = baseC0 + vj;
            const tile = forest.tiles[r]?.[c];
            if (!tile) {
              return (
                <div
                  key={`oob-${vi}-${vj}`}
                  className="absolute"
                  style={{ left: vj * CELL, top: vi * CELL, width: CELL, height: CELL, backgroundColor: '#050a05' }}
                />
              );
            }
            const seen = forest.seen[r]?.[c];
            if (!seen) {
              return (
                <div
                  key={`fog-${vi}-${vj}`}
                  className="absolute"
                  style={{ left: vj * CELL, top: vi * CELL, width: CELL, height: CELL, backgroundColor: '#050a05' }}
                />
              );
            }
            const vis = isVisible(forest, r, c);
            const node = tile.kind === 'node' && tile.nodeKey ? FOREST_NODES[tile.nodeKey] : null;
            const shrine = tile.kind === 'shrine' && tile.shrineKey ? SHRINE_EVENTS[tile.shrineKey] : null;
            const isTree = tile.kind === 'tree';
            const isThicket = tile.kind === 'thicket';
            const floorImg = !isThicket && !isTree ? forestFloorTile(tile.kind, r, c) : undefined;
            const nodeImg = node && tile.nodeKey ? forestNodeSprite(tile.nodeKey) : undefined;

            // Thicket tree sprite — oversized and bottom-anchored, overflows cell for depth
            let thicketSprite: React.ReactNode = null;
            if (isThicket) {
              const treeImg = forestThicketTree(r, c);
              if (treeImg) {
                const j1 = tileJitter(r, c);
                const j2 = tileJitter(r + 7, c + 3);
                const j3 = tileJitter(r * 2 + 1, c + 11);
                const scale = 1.45 + j1 * 0.55; // 1.45–2.0× so canopies massively overlap
                const size = CELL * scale;
                const dx = (j2 - 0.5) * CELL * 0.3; // lateral nudge ±15% of cell
                const flip = j3 > 0.50;
                // Bottom-anchor: bottom of sprite aligns ~10% below cell bottom (roots in ground)
                const bottom = -CELL * 0.08;
                const left = (CELL - size) / 2 + dx;
                thicketSprite = (
                  <img
                    src={treeImg}
                    alt=""
                    className="pointer-events-none image-pixel"
                    style={{
                      position: 'absolute',
                      zIndex: 4,
                      width: size,
                      height: size,
                      bottom,
                      left,
                      objectFit: 'contain',
                      objectPosition: 'bottom',
                      opacity: vis ? 1 : 0.55,
                      transform: flip ? 'scaleX(-1)' : undefined,
                    }}
                  />
                );
              }
            }

            return (
              <div
                key={`${vi}-${vj}`}
                className="absolute flex items-center justify-center text-[20px] leading-none"
                style={{
                  ...(isThicket || isTree
                    ? { backgroundColor: '#111d0d' }
                    : {
                        ...floorStyle(tile.kind, r, c, band.id),
                        ...(floorImg
                          ? {
                              backgroundColor: '#0f1a10',
                              backgroundImage: `url(${floorImg})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              imageRendering: 'pixelated',
                            }
                          : {}),
                      }),
                  left: vj * CELL,
                  top: vi * CELL,
                  width: CELL,
                  height: CELL,
                  overflow: 'visible',
                  boxShadow: node
                    ? `inset 0 0 0 1px rgba(0,0,0,0.3), inset 0 0 8px ${node.color}77`
                    : shrine
                    ? SHRINE_KIND_BORDER[shrine.kind]
                    : tile.kind === 'treeline'
                    ? `inset 0 0 0 2px rgba(72,202,140,0.55), inset 0 0 16px rgba(72,202,140,0.28)`
                    : isTree
                    ? 'inset 0 0 0 2px rgba(110,170,70,0.5)'
                    : 'inset 0 0 0 1px rgba(0,0,0,0.28)',
                }}
              >
                {/* Thicket: tree sprite (oversized, overflows cell) */}
                {thicketSprite}

                {/* Choppable tree: emoji so it's visually distinct from wall sprites */}
                {isTree && (
                  <span
                    className="relative z-[3]"
                    style={{ fontSize: CELL * 0.7, lineHeight: 1, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))' }}
                  >
                    🌲
                  </span>
                )}

                {/* Node art or glyph */}
                {!isTree && (
                  nodeImg ? (
                    <img
                      src={nodeImg}
                      alt={node?.name}
                      title={node?.name}
                      className="pointer-events-none absolute inset-0 h-full w-full object-contain image-pixel"
                      style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}
                    />
                  ) : node ? (
                    <span title={node.name} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}>
                      {node.glyph}
                    </span>
                  ) : shrine ? (
                    <span
                      title={shrine.name}
                      style={{
                        fontSize: CELL * 0.52,
                        lineHeight: 1,
                        filter: SHRINE_KIND_GLOW[shrine.kind],
                        animation: 'forest-shaft-pulse 3s ease-in-out infinite',
                      }}
                    >
                      {shrine.glyph}
                    </span>
                  ) : tile.kind === 'treeline' ? (
                    <Trees className="h-6 w-6 text-emerald-300" style={{ filter: 'drop-shadow(0 0 7px rgba(72,202,140,0.95))', animation: 'forest-shaft-pulse 2s ease-in-out infinite' }} />
                  ) : tile.kind === 'entrance' ? (
                    <span className="text-[16px] text-gold-bright">◇</span>
                  ) : tile.kind === 'boon' ? (
                    <span className="text-[22px] leading-none" style={{ filter: 'drop-shadow(0 0 6px rgba(255,200,0,0.9))' }}>🎁</span>
                  ) : null
                )}

                {/* Durability bar for choppable trees */}
                {isTree && tile.maxDurability != null && tile.durability != null && tile.durability < tile.maxDurability && (
                  <div className="absolute bottom-1 left-1 right-1 z-[5] h-[3px] overflow-hidden rounded-full bg-black/60">
                    <div className="h-full rounded-full bg-amber-500" style={{ width: `${(tile.durability / tile.maxDurability) * 100}%` }} />
                  </div>
                )}

                {/* Fog-of-war dim on seen-but-not-visible cells */}
                {!vis && <div className="absolute inset-0 z-[6] bg-black/58" />}
              </div>
            );
          })
        )}

        {/* Torch-glow vignette — the further from the torch, the darker */}
        <div
          className="pointer-events-none absolute inset-0 z-[7]"
          style={{
            background: `radial-gradient(circle ${litR}px at ${lightX}px ${lightY}px, transparent 52%, rgba(5,11,6,0.45) 76%, rgba(3,7,4,0.88) 100%)`,
          }}
        />

        {/* Facing indicator */}
        {inView(faced.r, faced.c) && (
          <div
            className="pointer-events-none absolute z-[8]"
            style={{
              width: CELL,
              height: CELL,
              transform: `translate(${vc(faced.c) * CELL}px, ${vr(faced.r) * CELL}px)`,
              boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.7)',
              transition: 'transform 150ms linear',
            }}
          />
        )}

        {/* Rune overlays */}
        {forest.runes.map((rune) => {
          if (!inView(rune.r, rune.c)) return null;
          const color = rune.kind === 'fire' ? '#ff6b35' : rune.kind === 'ice' ? '#7dd3fc' : '#86efac';
          return (
            <div
              key={rune.id}
              className="pointer-events-none absolute z-[9] flex items-center justify-center"
              style={{
                width: CELL,
                height: CELL,
                transform: `translate(${vc(rune.c) * CELL}px, ${vr(rune.r) * CELL}px)`,
              }}
            >
              <span style={{ fontSize: CELL * 0.4, color, filter: `drop-shadow(0 0 4px ${color})`, lineHeight: 1 }}>✦</span>
            </div>
          );
        })}

        {/* Ranged shot tracer — a brief arrow streak along the shot path */}
        {(() => {
          const shot = forest.lastShot;
          if (!shot || performance.now() - shot.at > 180) return null;
          const progress = Math.max(0, 1 - (performance.now() - shot.at) / 180);
          // Trace each cell along the path (horizontal or vertical corridor).
          const cells: React.ReactNode[] = [];
          const dr = shot.toR === shot.fromR ? 0 : shot.toR > shot.fromR ? 1 : -1;
          const dc = shot.toC === shot.fromC ? 0 : shot.toC > shot.fromC ? 1 : -1;
          let r = shot.fromR + dr;
          let c = shot.fromC + dc;
          let idx = 0;
          while (true) {
            if (inView(r, c)) {
              cells.push(
                <div
                  key={idx}
                  className="pointer-events-none absolute z-[9]"
                  style={{
                    width: dc !== 0 ? CELL : CELL * 0.25,
                    height: dr !== 0 ? CELL : CELL * 0.25,
                    left: vc(c) * CELL + (dc !== 0 ? 0 : CELL * 0.375),
                    top: vr(r) * CELL + (dr !== 0 ? 0 : CELL * 0.375),
                    backgroundColor: 'rgba(255,220,80,0.7)',
                    opacity: progress * 0.9,
                    borderRadius: 2,
                    boxShadow: '0 0 6px rgba(255,200,40,0.8)',
                  }}
                />
              );
            }
            idx++;
            if (r === shot.toR && c === shot.toC) break;
            if (idx > 10) break; // safety
            r += dr; c += dc;
          }
          return cells;
        })()}

        {/* Clear / harvest pops */}
        {pops.map((p) => {
          if (!inView(p.r, p.c)) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-20 rounded-full"
              style={{
                width: CELL * 0.7,
                height: CELL * 0.7,
                left: vc(p.c) * CELL + CELL * 0.15,
                top: vr(p.r) * CELL + CELL * 0.15,
                backgroundColor: 'rgba(140,231,160,0.8)',
                animation: 'mine-pop 0.5s ease-out forwards',
              }}
            />
          );
        })}

        {/* Loot popups */}
        {lootPops.map((p) => {
          if (!inView(p.r, p.c)) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-30 whitespace-nowrap font-display text-[11px] font-bold"
              style={{
                left: vc(p.c) * CELL + CELL / 2,
                top: vr(p.r) * CELL,
                color: p.color,
                textShadow: '0 1px 3px rgba(0,0,0,0.9)',
                animation: 'loot-float 0.9s ease-out forwards',
              }}
            >
              {p.text}
            </div>
          );
        })}

        {/* Combat damage / heal numbers (Phase 6) */}
        {dmgPops.map((p) => {
          if (!inView(p.r, p.c)) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-30 whitespace-nowrap font-display font-bold"
              style={{
                left: vc(p.c) * CELL + CELL / 2,
                top: vr(p.r) * CELL + CELL / 2,
                fontSize: p.color === '#fbbf24' ? 15 : 13,
                color: p.color,
                textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9)',
                animation: 'tactics-floater 0.85s ease-out forwards',
              }}
            >
              {p.text}
            </div>
          );
        })}

        {/* One-shot VFX bursts: impact flashes + dash rings (Phase 6) */}
        {vfxPops.map((p) => {
          if (!inView(p.r, p.c)) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-25"
              style={{
                width: p.size,
                height: p.size,
                left: vc(p.c) * CELL + CELL / 2,
                top: vr(p.r) * CELL + CELL / 2,
                borderRadius: '50%',
                border: `2px solid ${p.color}`,
                animation: p.anim,
              }}
            />
          );
        })}

        {/* Beasts — rAF drives position; no CSS transition needed */}
        {forest.beasts.map((b) => {
          if (!isVisible(forest, b.r, b.c)) return null;
          if (!inView(b.r, b.c)) return null;
          const def = FOREST_BEASTS[b.key];
          const frozen = (b.frozenUntilMs ?? 0) > performance.now();
          const windingUp = b.windupUntilMs !== undefined && b.windupUntilMs > performance.now();
          const windupProgress = windingUp && b.windupUntilMs
            ? Math.max(0, Math.min(1, 1 - (b.windupUntilMs - performance.now()) / FOREST_WINDUP_MS))
            : 0;
          return (
            <div
              key={b.id}
              ref={(el) => {
                if (el) moverRefs.current.set(b.id, el);
                else moverRefs.current.delete(b.id);
              }}
              className={cn(
                'pointer-events-none absolute z-[10] flex items-center justify-center',
                b.asleep && 'opacity-70',
              )}
              style={{ width: CELL, height: CELL, transform: `translate(${vc(b.c) * CELL}px, ${vr(b.r) * CELL}px)` }}
              title={def?.name}
            >
              {frozen && (
                <div className="absolute inset-0 rounded-sm bg-blue-400/30 ring-1 ring-blue-300/60" />
              )}
              {windingUp && (
                <div
                  className="absolute inset-0 rounded-sm ring-2 ring-red-500/80"
                  style={{
                    backgroundColor: `rgba(220,38,38,${0.08 + windupProgress * 0.18})`,
                    boxShadow: `0 0 ${4 + windupProgress * 8}px rgba(220,38,38,0.6)`,
                  }}
                />
              )}
              <span className="text-[22px] leading-none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))' }}>
                {def?.glyph ?? '?'}
              </span>
              {!b.asleep && (b.hp < b.maxHp || !!FOREST_BEASTS[b.key]?.isGuardian) && (
                <div className={cn(
                  'absolute left-0 right-0 overflow-hidden rounded-full bg-black/60',
                  FOREST_BEASTS[b.key]?.isGuardian ? '-top-3 h-[5px]' : '-top-1.5 h-[3px]',
                )}>
                  <div
                    className={cn('h-full rounded-full', FOREST_BEASTS[b.key]?.isGuardian ? 'bg-amber-400' : 'bg-red-400')}
                    style={{ width: `${(b.hp / b.maxHp) * 100}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Co-op party members — see RemoteCrawlers. Forest draws them at z 10 (own player z 11), shown through fog. */}
        <RemoteCrawlers
          remotePlayers={remotePlayers}
          currentDepth={forest.stage}
          baseR0={baseR0}
          baseC0={baseC0}
          RENDER_VIEW={RENDER_VIEW}
          CELL={CELL}
          moverRefs={moverRefs}
          nameFor={nameFor}
          variant="forager"
          zIndex={10}
        />

        {/* Player — rAF drives position */}
        <div
          ref={playerRef}
          className="pointer-events-none absolute z-[11]"
          style={{ width: CELL, height: CELL, transform: `translate(${vc(forest.player.c) * CELL}px, ${vr(forest.player.r) * CELL}px)` }}
        >
          <CrawlerAvatar
            variant="forager"
            facing={forest.player.facing}
            moving={moving}
            dead={dead}
            cell={CELL}
          />
        </div>

        </div>{/* end world container */}

        {/* Player-struck vignette (Phase 6) */}
        {hitAt > 0 && (
          <div
            key={hitAt}
            className="pointer-events-none absolute inset-0 z-[60]"
            style={{ animation: 'arena-hit 0.45s ease-out forwards' }}
          />
        )}

        {/* Stage-advance wipe — band-tinted flash on depth change (Phase 6) */}
        {wipeAt > 0 && (
          <div
            key={wipeAt}
            className="pointer-events-none absolute inset-0 z-[55]"
            style={{
              backgroundColor: band.palette.accent,
              animation: 'crawl-wipe 0.5s ease-out forwards',
            }}
          />
        )}

        {/* Forest ambient atmosphere — viewport-fixed, doesn't scroll */}
        {!dead && forest.status === 'active' && (
          <div className="forest-ambient pointer-events-none absolute inset-0 z-[15] overflow-hidden">
            {/* Dense ground mist along the bottom */}
            <div
              className="absolute bottom-0 left-0 right-0"
              style={{ height: '28%', background: 'linear-gradient(to top, rgba(6,18,8,0.62) 0%, rgba(8,20,10,0.30) 40%, transparent 100%)' }}
            />
            {/* Left-edge shadow — trees lean in from the sides */}
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: '12%', background: 'linear-gradient(to right, rgba(4,10,5,0.55) 0%, transparent 100%)' }}
            />
            <div
              className="absolute inset-y-0 right-0"
              style={{ width: '12%', background: 'linear-gradient(to left, rgba(4,10,5,0.55) 0%, transparent 100%)' }}
            />
            {/* God-ray light shafts */}
            <div
              className="absolute"
              style={{
                left: '12%', top: '-20%', width: 38, height: '85%',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(160,240,140,0.11) 35%, rgba(140,220,120,0.06) 70%, transparent 100%)',
                transform: 'rotate(8deg)',
                animation: 'forest-shaft-pulse 9s ease-in-out infinite',
                filter: 'blur(3px)',
              }}
            />
            <div
              className="absolute"
              style={{
                left: '58%', top: '-12%', width: 26, height: '72%',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(180,255,160,0.09) 40%, transparent 100%)',
                transform: 'rotate(14deg)',
                animation: 'forest-shaft-pulse 12s ease-in-out infinite 3.2s',
                filter: 'blur(2px)',
              }}
            />
            <div
              className="absolute"
              style={{
                left: '34%', top: '-5%', width: 18, height: '55%',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(200,255,180,0.07) 50%, transparent 100%)',
                transform: 'rotate(5deg)',
                animation: 'forest-shaft-pulse 15s ease-in-out infinite 6s',
                filter: 'blur(2px)',
              }}
            />
            {/* Pollen / firefly motes — larger and brighter than before */}
            {[
              { left: '16%', top: '58%', size: 4, dur: '10s', delay: '0s',   glow: 'rgba(190,255,145,0.85)' },
              { left: '43%', top: '34%', size: 5, dur: '13s', delay: '2.8s', glow: 'rgba(210,255,160,0.80)' },
              { left: '68%', top: '72%', size: 4, dur: '8s',  delay: '5.6s', glow: 'rgba(180,245,140,0.85)' },
              { left: '80%', top: '25%', size: 4, dur: '11s', delay: '1.2s', glow: 'rgba(200,255,155,0.75)' },
              { left: '53%', top: '80%', size: 5, dur: '9s',  delay: '4.0s', glow: 'rgba(215,255,165,0.80)' },
              { left: '28%', top: '46%', size: 3, dur: '14s', delay: '7.5s', glow: 'rgba(185,250,140,0.70)' },
              { left: '74%', top: '52%', size: 3, dur: '12s', delay: '9.0s', glow: 'rgba(200,255,155,0.75)' },
            ].map((m, i) => (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  left: m.left,
                  top: m.top,
                  width: m.size,
                  height: m.size,
                  backgroundColor: m.glow,
                  filter: 'blur(0.8px)',
                  boxShadow: `0 0 ${m.size * 2}px ${m.glow}`,
                  animation: `forest-mote-float ${m.dur} ease-in-out infinite ${m.delay}`,
                }}
              />
            ))}
          </div>
        )}

        {/* Boon choice panel (pauses the run while the player picks). Forest deals the
            cards in with a staggered animation and plays no sound. */}
        <BoonChoicePanel
          status={forest.status}
          pendingBoonChoice={forest.pendingBoonChoice}
          onChoose={(key) => chooseForestBoon(key)}
          onSkip={() => skipForestBoon()}
          staggerIn
        />

        {/* Guardian arrival alert — brief red flash + banner on descent into a guardian stage */}
        {guardianAlert > 0 && (
          <div key={guardianAlert} className="pointer-events-none absolute inset-0 z-[58]"
            style={{ backgroundColor: 'rgba(200,60,20,0.30)', animation: 'forest-guardian-alert 1.8s ease-out forwards' }}
          />
        )}
        {guardianAlert > 0 && (
          <div key={`ga-${guardianAlert}`}
            className="pointer-events-none absolute inset-x-0 top-8 z-[59] flex justify-center px-3"
            style={{ animation: 'boon-deal-in 0.28s ease-out both' }}
          >
            <span className="max-w-full rounded-md border border-amber-600/60 bg-amber-900/90 px-3 py-1 text-center font-display text-xs font-bold text-amber-300">
              ⚔ A guardian prowls this depth
            </span>
          </div>
        )}

        {/* Banking summary (voluntary leave) */}
        {forest.status === 'banking' && (
          <EndOfRunPanel accent="gold">
            <Trees className="h-9 w-9 text-emerald-700" />
            <p className="font-display text-xl font-bold leading-tight text-ink">Haul Secured</p>
            <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {forest.deepest > 1 ? `Reached Depth ${forest.deepest}` : 'Depth 1 explored'}
            </p>
            {forest.score > 0 && (
              <p className="font-display text-xs font-bold text-gold-deep">Score {forest.score.toLocaleString()}</p>
            )}
            <Divider className="w-full" />
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <HaulLedger
                reward={{ ...forest.haul, gold: Math.round((forest.haul.gold ?? 0) * habitBonus) }}
                empty="nothing gathered"
              />
            </div>
            <div className="empty:hidden rounded-full bg-wood-800/90 px-2.5 py-1">
              <StreakBonusChip className="text-[11px]" />
            </div>
            <Button variant="primary" onClick={endForest} className="mt-1 w-full px-4 py-2 text-sm">
              Bank &amp; Leave
            </Button>
          </EndOfRunPanel>
        )}

        {/* Death summary */}
        {dead && (
          <EndOfRunPanel accent="ember">
            <Skull className="h-9 w-9 text-ember" />
            <p className="font-display text-xl font-bold leading-tight text-ember">Overcome by the Wild</p>
            <p className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Felled at Depth {forest.deepest}
            </p>
            {forest.score > 0 && (
              <p className="font-display text-xs font-bold text-gold-deep">Score {forest.score.toLocaleString()}</p>
            )}
            <Divider className="w-full" />
            <div className="flex w-full items-stretch justify-center gap-3">
              <div className="flex flex-1 flex-col items-center gap-1">
                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Carried home
                </span>
                <HaulLedger
                  reward={death?.kept ? { ...death.kept, gold: Math.round((death.kept.gold ?? 0) * habitBonus) } : {}}
                  empty="nothing made it out"
                />
              </div>
              <div className="w-px bg-ink/15" />
              <div className="flex flex-1 flex-col items-center gap-1">
                <span className="font-display text-[10px] font-bold uppercase tracking-wider text-ember">
                  Lost to the wild
                </span>
                <HaulLedger reward={death?.lost ?? {}} empty="nothing lost" lost />
              </div>
            </div>
            <div className="empty:hidden rounded-full bg-wood-800/90 px-2.5 py-1">
              <StreakBonusChip className="text-[11px]" />
            </div>
            <Button variant="primary" onClick={endForest} className="mt-1 w-full px-4 py-2 text-sm">
              Retrieve Haul &amp; Leave
            </Button>
          </EndOfRunPanel>
        )}
      </div>
      </FitToWidth>
      </div>

      {/* Spell ability bar — violet accent, always shown (buttons disable off-active), 3-line cards. */}
      <CrawlSpellBar
        knownSpells={forest.knownSpells}
        mp={forest.mp}
        status={forest.status}
        onCast={(key) => controls.castSpell(key)}
        accent="violet"
        hideWhenInactive={false}
        tooltip={(sp, i) => `${sp.name} (${sp.mpCost} MP) — key [${i + 1}]`}
        layout="three-line"
        maxWidth={hudCap}
      />

      {/* Push deeper / stash / leave */}
      <div className="flex w-full flex-col items-center gap-1" style={{ maxWidth: hudCap }}>
        <div className="flex items-center justify-center gap-2">
          <Button
            variant={onTreeline && !isCoopGuest ? 'primary' : 'secondary'}
            onClick={forestAdvance}
            disabled={!onTreeline || isCoopGuest}
            title={isCoopGuest ? 'The host leads the way deeper' : undefined}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs',
              (!onTreeline || isCoopGuest) && 'opacity-60',
            )}
          >
            <ChevronsDown className="h-4 w-4" /> Push deeper
          </Button>
          <Button
            variant="secondary"
            onClick={forestStash}
            disabled={!canStash}
            title={
              !onClearing
                ? 'Move to a clearing to stash your haul'
                : !hasLoot
                  ? 'Nothing to stash yet'
                  : `Stash ${Math.round(FOREST_STASH_KEEP * 100)}% of your haul and keep going`
            }
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs',
              !canStash && 'opacity-60',
              canStash && 'border-amber-500/60 text-amber-200 hover:bg-amber-900/30',
            )}
          >
            <Archive className="h-4 w-4" /> Stash {Math.round(FOREST_STASH_KEEP * 100)}%
          </Button>
          <Button variant="danger" onClick={beginForestBanking} className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <LogOut className="h-4 w-4" /> Bank &amp; leave
          </Button>
        </div>
        {isCoopGuest && (
          <p className="text-[10px] text-parchment-300/50">The host leads the way deeper.</p>
        )}
        {canStash && (
          <p className="text-[10px] text-amber-300/70">
            ✦ Clearing — stash {Math.round(FOREST_STASH_KEEP * 100)}% of your haul to keep it safe.
          </p>
        )}
        {onClearing && !hasLoot && (
          <p className="text-[10px] text-parchment-300/40">✦ Clearing</p>
        )}
      </div>

      {/* Touch controls — coarse-pointer devices only; desktop plays on the keyboard */}
      <div className="pointer-coarse-only w-full" style={{ maxWidth: hudCap }}>
        <ForestControls controls={controls} />
      </div>

      {/* Keyboard hints — fine-pointer devices only (noise on phones) */}
      <p className="pointer-fine-only text-center text-[10px] text-parchment-300/50">
        Move: arrows/WASD · Act (slash/gather/chop): space, or click a tile · Spells: [1-4] · Reach the{' '}
        <Trees className="inline h-3 w-3 text-emerald-300" /> tree line to push deeper.
      </p>
    </div>
  );
}
