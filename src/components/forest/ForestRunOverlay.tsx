import { useState, useEffect, useRef } from 'react';
import { Heart, Zap, Coins, ChevronsDown, LogOut, Trees, Skull, Sparkles } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useForestLoop } from '@/hooks/useForestLoop';
import {
  canAdvance,
  facedCell,
  isVisible,
  sightRadiusFor,
  splitHaul,
  FOREST_DEATH_KEEP,
  FOREST_WINDUP_MS,
  type ForestTile,
  type ForestBeast,
} from '@/engine/forest';
import { cameraWindow, VIEW } from '@/engine/crawl';
import { useSmoothCamera, type SmoothCameraLayout } from '@/hooks/useSmoothCamera';
import { bandForStage, type ForestBandId } from '@/engine/crawlBiomes';
import { getSpell } from '@/engine/spells';
import type { Reward } from '@/engine/challenges';
import { FOREST_NODES, FOREST_BEASTS, SHRINE_EVENTS } from '@/content/forest';
import { forestThicketTree, forestFloorTile, forestNodeSprite } from '@/lib/minigameArt';
import { getMaterial } from '@/engine/materials';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { ForestControls } from './ForestControls';
import { CrawlerAvatar } from '@/components/minigame/CrawlerAvatar';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';
import { usePartyStore } from '@/hooks/useParty';
import { CoopToasts } from '@/components/minigame/CoopToasts';

const CELL = 52; // px per tile
const BOARD_PX = VIEW * CELL; // 572px
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
function tileJitter(r: number, c: number): number {
  let h = (Math.imul(r, 73856093) ^ Math.imul(c, 19349663)) >>> 0;
  h ^= h >>> 13;
  return (h % 1000) / 1000;
}

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

type LootPop = { key: string; r: number; c: number; at: number; text: string; color: string };

function Gauge({ icon, value, max, fill }: { icon: React.ReactNode; value: number; max: number; fill: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <div className="h-2.5 w-24 overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: fill }} />
      </div>
      <span className="font-display text-[11px] tabular-nums text-parchment-300">
        {Math.max(0, Math.round(value))}/{max}
      </span>
    </div>
  );
}

function rewardChips(reward: Reward): Array<{ label: string; color: string }> {
  const out: Array<{ label: string; color: string }> = [];
  if (reward.gold) out.push({ label: `${reward.gold} gold`, color: '#e8c860' });
  for (const [key, n] of Object.entries(reward.materials ?? {})) {
    if (!n) continue;
    const mat = getMaterial(key);
    out.push({ label: `${n} ${mat?.name ?? key}`, color: mat?.color ?? '#f3e7c9' });
  }
  return out;
}

function HaulChips({ reward, empty }: { reward: Reward; empty: string }) {
  const chips = rewardChips(reward);
  if (chips.length === 0) return <span className="text-parchment-300/50">{empty}</span>;
  return (
    <>
      {chips.map((chip) => (
        <span key={chip.label} style={{ color: chip.color }}>
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
  const beginForestBanking = useGameStore((s) => s.beginForestBanking);
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
  const playerRef = useRef<HTMLDivElement | null>(null);
  const moverRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const layoutRef = useRef<SmoothCameraLayout>({
    baseR0: 0, baseC0: 0, playerR: 0, playerC: 0, rows: 33, cols: 33,
    movers: [], snapKey: 0,
  });
  useSmoothCamera(worldRef, playerRef, moverRefs, layoutRef, { CELL, VIEW });

  // Moving flag — true for ~250 ms after any player step
  const [moving, setMoving] = useState(false);
  const prevPosRef = useRef<{ r: number; c: number } | null>(null);
  const movingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pops, setPops] = useState<Array<{ key: string; r: number; c: number; at: number }>>([]);
  const [lootPops, setLootPops] = useState<LootPop[]>([]);
  const prevRef = useRef<{
    tiles: ForestTile[][];
    beasts: ForestBeast[];
    haul: { gold?: number; materials?: Record<string, number> };
    sta: number;
  } | null>(null);

  useEffect(() => {
    if (!forest) { prevRef.current = null; prevPosRef.current = null; return; }

    // Moving detection
    const pos = forest.player;
    const prev2 = prevPosRef.current;
    if (prev2 && (prev2.r !== pos.r || prev2.c !== pos.c)) {
      setMoving(true);
      if (movingTimerRef.current) clearTimeout(movingTimerRef.current);
      movingTimerRef.current = setTimeout(() => setMoving(false), 250);
    }
    prevPosRef.current = { r: pos.r, c: pos.c };

    const prev = prevRef.current;
    prevRef.current = { tiles: forest.tiles, beasts: forest.beasts, haul: forest.haul, sta: forest.sta };
    if (!prev) return;
    const now = Date.now();
    const newPops: Array<{ key: string; r: number; c: number; at: number }> = [];
    let eventPos: { r: number; c: number } | null = null;

    // Node-gathered and tree-chopped pops
    forest.tiles.forEach((row, r) =>
      row.forEach((tile, c) => {
        const was = prev.tiles[r]?.[c];
        if (tile.kind === 'trail' && (was?.kind === 'node' || was?.kind === 'tree')) {
          newPops.push({ key: `t-${r}-${c}-${now}`, r, c, at: now });
          eventPos = { r, c };
        }
      }),
    );
    // Beast-killed pops
    const liveIds = new Set(forest.beasts.map((b) => b.id));
    prev.beasts.forEach((b) => {
      if (!liveIds.has(b.id)) {
        newPops.push({ key: `b-${b.id}-${now}`, r: b.r, c: b.c, at: now });
        eventPos = { r: b.r, c: b.c };
      }
    });
    if (newPops.length > 0) {
      setPops((ps) => [...ps.filter((p) => now - p.at < 550), ...newPops]);
      setTimeout(() => setPops((ps) => ps.filter((p) => Date.now() - p.at < 550)), 600);
    }
    if (eventPos) {
      const pos2 = eventPos as { r: number; c: number };
      const newLootPops: LootPop[] = [];
      const goldDelta = (forest.haul.gold ?? 0) - (prev.haul.gold ?? 0);
      if (goldDelta > 0) {
        newLootPops.push({ key: `lg-${now}`, ...pos2, at: now, text: `+${goldDelta} gold`, color: '#e8c860' });
      } else {
        for (const [matKey, val] of Object.entries(forest.haul.materials ?? {})) {
          const delta = val - ((prev.haul.materials ?? {})[matKey] ?? 0);
          if (delta > 0) {
            const mat = getMaterial(matKey);
            newLootPops.push({ key: `lm-${now}`, ...pos2, at: now, text: `+${delta} ${mat?.name ?? matKey}`, color: mat?.color ?? '#f3e7c9' });
            break;
          }
        }
      }
      const netSta = forest.sta - prev.sta;
      if (netSta > 0) {
        newLootPops.push({ key: `ls-${now}`, ...pos2, at: now, text: `+${netSta} sta`, color: '#22d3ee' });
      }
      if (newLootPops.length > 0) {
        setLootPops((ps) => [...ps.filter((p) => now - p.at < 900), ...newLootPops]);
        setTimeout(() => setLootPops((ps) => ps.filter((p) => Date.now() - p.at < 900)), 950);
      }
    }
  }, [forest]);

  if (!forest) return null;

  const band = bandForStage(forest.stage);
  const dead = forest.status === 'ended';
  const onTreeline = canAdvance(forest);
  const faced = facedCell(forest);
  const haulMats = Object.entries(forest.haul.materials ?? {}).filter(([, n]) => n > 0);

  // Camera: integer top-left of the centred 11×11 window.
  const { r0, c0 } = cameraWindow(forest.player, forest.rows, forest.cols);
  const baseR0 = Math.max(0, r0 - MARGIN);
  const baseC0 = Math.max(0, c0 - MARGIN);

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
    <div className="texture-wood fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-auto px-4 py-4">
      <CoopToasts />
      {/* HUD */}
      <div className="flex w-full max-w-[600px] items-center justify-between gap-3">
        <span className="font-display text-sm font-bold text-gold-bright">
          The Wild Forest · Depth {forest.stage}
          <span className="ml-2 text-[11px] font-normal opacity-70">{band.name}</span>
        </span>
        <div className="flex flex-col items-end gap-1">
          <Gauge icon={<Heart className="h-3.5 w-3.5 text-stat-HP" />} value={forest.hp} max={forest.maxHp} fill="#2e8a5e" />
          <Gauge icon={<Zap className="h-3.5 w-3.5 text-stat-AG" />} value={forest.sta} max={forest.maxSta} fill="#b8860b" />
          {forest.maxMp > 0 && (
            <Gauge icon={<Sparkles className="h-3.5 w-3.5 text-violet-400" />} value={forest.mp} max={forest.maxMp} fill="#7c3aed" />
          )}
        </div>
      </div>

      {/* Haul */}
      <div className="flex w-full max-w-[600px] flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment-200">
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

      {/* Forest board */}
      <div
        className="relative shrink-0 overflow-hidden rounded-md border-2 border-gold-deep/60"
        style={{
          width: BOARD_PX,
          height: BOARD_PX,
          boxShadow: 'inset 0 0 48px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,0,0,0.5)',
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
                    ? `inset 0 0 0 2px rgba(255,210,80,0.7), inset 0 0 12px rgba(255,190,40,0.4)`
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
                        filter: 'drop-shadow(0 0 6px rgba(255,200,60,0.9))',
                        animation: 'forest-shaft-pulse 3s ease-in-out infinite',
                      }}
                    >
                      {shrine.glyph}
                    </span>
                  ) : tile.kind === 'treeline' ? (
                    <Trees className="h-6 w-6 text-emerald-300" style={{ filter: 'drop-shadow(0 0 4px rgba(72,202,140,0.7))' }} />
                  ) : tile.kind === 'entrance' ? (
                    <span className="text-[16px] text-gold-bright">◇</span>
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
          if (!shot || Date.now() - shot.at > 180) return null;
          const progress = Math.max(0, 1 - (Date.now() - shot.at) / 180);
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

        {/* Beasts — rAF drives position; no CSS transition needed */}
        {forest.beasts.map((b) => {
          if (!isVisible(forest, b.r, b.c)) return null;
          if (!inView(b.r, b.c)) return null;
          const def = FOREST_BEASTS[b.key];
          const frozen = (b.frozenUntilMs ?? 0) > Date.now();
          const windingUp = b.windupUntilMs !== undefined && b.windupUntilMs > Date.now();
          const windupProgress = windingUp && b.windupUntilMs
            ? Math.max(0, Math.min(1, 1 - (b.windupUntilMs - Date.now()) / FOREST_WINDUP_MS))
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
              {!b.asleep && b.hp < b.maxHp && (
                <div className="absolute -top-1.5 left-0 right-0 h-[3px] overflow-hidden rounded-full bg-black/60">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${(b.hp / b.maxHp) * 100}%` }} />
                </div>
              )}
            </div>
          );
        })}

        {/* Co-op party members — positions arrive over the broadcast channel (~10 Hz).
            Registered as movers so the rAF loop interpolates them in world-pixel space
            (smooth glide + camera-locked), same path as beasts. Shown through fog. */}
        {Object.values(remotePlayers).map((p) => {
          if (p.floor !== forest.stage) return null;
          const vci = vc(p.c);
          const vri = vr(p.r);
          if (vri < 0 || vri >= RENDER_VIEW || vci < 0 || vci >= RENDER_VIEW) return null;
          return (
            <div
              key={p.userId}
              ref={(el) => {
                const id = `rp:${p.userId}`;
                if (el) moverRefs.current.set(id, el);
                else moverRefs.current.delete(id);
              }}
              className="pointer-events-none absolute z-[10]"
              style={{ width: CELL, height: CELL, transform: `translate(${vci * CELL}px, ${vri * CELL}px)` }}
            >
              <CrawlerAvatar variant="forager" facing={p.facing} moving dead={p.hp <= 0} cell={CELL} />
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/60 px-1 font-display text-[9px] text-gold-bright">
                {nameFor(p.userId, p.username)}
              </span>
            </div>
          );
        })}

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

        {/* Banking summary (voluntary leave) */}
        {forest.status === 'banking' && (
          <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-md bg-black/80 p-4 text-center">
            <Trees className="h-9 w-9 text-emerald-300" />
            <p className="font-display text-lg font-bold text-parchment-100">Haul Secured</p>
            <p className="font-display text-sm text-parchment-300">
              {forest.deepest > 1 ? `Reached Depth ${forest.deepest}` : 'Depth 1 explored'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs">
              <HaulChips reward={forest.haul} empty="nothing gathered" />
            </div>
            <Button variant="primary" onClick={endForest} className="mt-1 px-4 py-2 text-sm">
              Bank &amp; Leave
            </Button>
          </div>
        )}

        {/* Death summary */}
        {dead && (
          <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 rounded-md bg-black/85 p-4 text-center">
            <Skull className="h-9 w-9 text-ember-bright" />
            <p className="font-display text-lg font-bold text-parchment-100">Overcome by the Wild</p>
            <p className="font-display text-xs text-parchment-300">Felled at Depth {forest.deepest}</p>
            <div className="space-y-1.5">
              <div>
                <div className="font-display text-[10px] uppercase tracking-wider text-parchment-300/70">Carried home</div>
                <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 text-xs">
                  <HaulChips reward={death?.kept ?? {}} empty="nothing made it out" />
                </div>
              </div>
              <div>
                <div className="font-display text-[10px] uppercase tracking-wider text-ember-bright/80">Lost to the wild</div>
                <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-0.5 text-xs opacity-80">
                  <HaulChips reward={death?.lost ?? {}} empty="nothing lost" />
                </div>
              </div>
            </div>
            <Button variant="primary" onClick={endForest} className="mt-1 px-4 py-2 text-sm">
              Retrieve Haul &amp; Leave
            </Button>
          </div>
        )}
      </div>

      {/* Spell ability bar */}
      {forest.knownSpells.length > 0 && (
        <div className="flex w-full max-w-[600px] items-center gap-2">
          <span className="font-display text-[10px] uppercase tracking-wider text-parchment-300/60">Spells</span>
          {forest.knownSpells.slice(0, 4).map((key, i) => {
            const sp = getSpell(key);
            if (!sp) return null;
            const canCast = forest.mp >= sp.mpCost;
            return (
              <button
                key={key}
                onClick={() => controls.castSpell(key)}
                disabled={!canCast || forest.status !== 'active'}
                className={cn(
                  'flex flex-col items-center rounded border px-2 py-1 font-display text-[10px] transition-opacity',
                  canCast ? 'border-violet-500/60 bg-violet-900/30 text-violet-200 hover:bg-violet-800/40' : 'border-wood-700 bg-wood-900/50 text-parchment-300/40 opacity-60',
                )}
                title={`${sp.name} (${sp.mpCost} MP) — key [${i + 1}]`}
              >
                <span className="text-[9px] text-parchment-300/50">[{i + 1}]</span>
                <span className="truncate max-w-[60px]">{sp.name}</span>
                <span className="text-[9px] text-violet-400">{sp.mpCost}mp</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Push deeper / leave */}
      <div className="flex w-full max-w-[600px] flex-col items-center gap-1">
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
          <Button variant="danger" onClick={beginForestBanking} className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <LogOut className="h-4 w-4" /> Bank &amp; leave
          </Button>
        </div>
        {isCoopGuest && (
          <p className="text-[10px] text-parchment-300/50">The host leads the way deeper.</p>
        )}
      </div>

      {/* Touch controls */}
      <div className="w-full max-w-[600px]">
        <ForestControls controls={controls} />
      </div>

      <p className="text-center text-[10px] text-parchment-300/50">
        Move: arrows/WASD · Act (slash/gather/chop): space · Spells: [1-4] · Reach the{' '}
        <Trees className="inline h-3 w-3 text-emerald-300" /> tree line to push deeper.
      </p>
    </div>
  );
}
