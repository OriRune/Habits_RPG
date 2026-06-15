import { useState, useEffect, useRef } from 'react';
import { Heart, Zap, Coins, ChevronsDown, LogOut, Trees, Skull } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useForestLoop } from '@/hooks/useForestLoop';
import {
  canAdvance,
  facedCell,
  isVisible,
  sightRadiusFor,
  splitHaul,
  FOREST_DEATH_KEEP,
  type ForestTile,
  type ForestBeast,
} from '@/engine/forest';
import type { Reward } from '@/engine/challenges';
import { FOREST_NODES, FOREST_BEASTS } from '@/content/forest';
import { getMaterial } from '@/engine/materials';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { ForestControls } from './ForestControls';

const CELL = 26; // px per tile (the forest is a larger grid than the mine)

/** Base colour + texture per tile kind; the colour gets a little per-tile jitter for variety. */
const TILE_BASE: Record<ForestTile['kind'], { bg: [number, number, number]; image?: string }> = {
  thicket: {
    bg: [22, 56, 32],
    image:
      'radial-gradient(circle at 32% 30%, rgba(54,104,62,0.55) 0%, transparent 42%),' +
      'radial-gradient(circle at 72% 68%, rgba(18,48,28,0.7) 0%, transparent 48%),' +
      'repeating-linear-gradient(125deg, rgba(0,0,0,0.16) 0px, rgba(0,0,0,0.16) 1px, transparent 1px, transparent 5px)',
  },
  trail: {
    bg: [60, 48, 31],
    image:
      'radial-gradient(circle at 50% 42%, rgba(102,82,52,0.4) 0%, transparent 62%),' +
      'radial-gradient(circle at 22% 78%, rgba(40,30,18,0.5) 0%, transparent 40%)',
  },
  clearing: {
    bg: [80, 108, 52],
    image:
      'radial-gradient(circle at 50% 30%, rgba(176,206,116,0.45) 0%, transparent 66%),' +
      'radial-gradient(circle at 76% 74%, rgba(50,78,34,0.5) 0%, transparent 44%)',
  },
  entrance: {
    bg: [107, 83, 32],
    image: 'radial-gradient(circle at 50% 50%, rgba(232,200,96,0.4) 0%, transparent 72%)',
  },
  treeline: {
    bg: [26, 58, 38],
    image: 'radial-gradient(circle at 50% 46%, rgba(72,202,140,0.45) 0%, transparent 72%)',
  },
  node: { bg: [52, 48, 29] },
};

/** Deterministic 0..1 hash so a tile's tint is stable across re-renders. */
function tileJitter(r: number, c: number): number {
  let h = (Math.imul(r, 73856093) ^ Math.imul(c, 19349663)) >>> 0;
  h ^= h >>> 13;
  return (h % 1000) / 1000;
}

function tileStyle(kind: ForestTile['kind'], r: number, c: number): React.CSSProperties {
  const base = TILE_BASE[kind];
  const jittered = kind === 'thicket' || kind === 'trail' || kind === 'clearing';
  const m = jittered ? 0.82 + 0.32 * tileJitter(r, c) : 1;
  const [R, G, B] = base.bg.map((v) => Math.round(Math.min(255, v * m)));
  return { backgroundColor: `rgb(${R},${G},${B})`, backgroundImage: base.image };
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

/** Flatten a reward into labelled, coloured chips for the summary screens. */
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

  const [pops, setPops] = useState<Array<{ key: string; r: number; c: number; at: number }>>([]);
  const [lootPops, setLootPops] = useState<LootPop[]>([]);
  const prevRef = useRef<{
    tiles: ForestTile[][];
    beasts: ForestBeast[];
    haul: { gold?: number; materials?: Record<string, number> };
    sta: number;
  } | null>(null);

  useEffect(() => {
    if (!forest) { prevRef.current = null; return; }
    const prev = prevRef.current;
    prevRef.current = { tiles: forest.tiles, beasts: forest.beasts, haul: forest.haul, sta: forest.sta };
    if (!prev) return;
    const now = Date.now();
    const newPops: Array<{ key: string; r: number; c: number; at: number }> = [];
    let eventPos: { r: number; c: number } | null = null;
    forest.tiles.forEach((row, r) =>
      row.forEach((tile, c) => {
        const was = prev.tiles[r]?.[c];
        if (tile.kind === 'trail' && was?.kind === 'node') {
          newPops.push({ key: `t-${r}-${c}-${now}`, r, c, at: now });
          eventPos = { r, c };
        }
      }),
    );
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
      const pos = eventPos as { r: number; c: number };
      const newLootPops: LootPop[] = [];
      const goldDelta = (forest.haul.gold ?? 0) - (prev.haul.gold ?? 0);
      if (goldDelta > 0) {
        newLootPops.push({ key: `lg-${now}`, ...pos, at: now, text: `+${goldDelta} gold`, color: '#e8c860' });
      } else {
        for (const [matKey, val] of Object.entries(forest.haul.materials ?? {})) {
          const delta = val - ((prev.haul.materials ?? {})[matKey] ?? 0);
          if (delta > 0) {
            const mat = getMaterial(matKey);
            newLootPops.push({ key: `lm-${now}`, ...pos, at: now, text: `+${delta} ${mat?.name ?? matKey}`, color: mat?.color ?? '#f3e7c9' });
            break;
          }
        }
      }
      const netSta = forest.sta - prev.sta;
      if (netSta > 0) {
        newLootPops.push({ key: `ls-${now}`, ...pos, at: now, text: `+${netSta} sta`, color: '#22d3ee' });
      }
      if (newLootPops.length > 0) {
        setLootPops((ps) => [...ps.filter((p) => now - p.at < 900), ...newLootPops]);
        setTimeout(() => setLootPops((ps) => ps.filter((p) => Date.now() - p.at < 900)), 950);
      }
    }
  }, [forest]);

  if (!forest) return null;

  const dead = forest.status === 'ended';
  const onTreeline = canAdvance(forest);
  const faced = facedCell(forest);
  const haulMats = Object.entries(forest.haul.materials ?? {}).filter(([, n]) => n > 0);
  const width = forest.cols * CELL;
  const height = forest.rows * CELL;
  // Circular torch glow centred on the forager — softens the fog edge into a disc.
  const litR = (sightRadiusFor(forest) + 0.5) * CELL;
  const lightX = forest.player.c * CELL + CELL / 2;
  const lightY = forest.player.r * CELL + CELL / 2;
  // On death, half the haul is forfeit; show what's carried out vs lost.
  const death = dead ? splitHaul(forest.haul, FOREST_DEATH_KEEP) : null;

  return (
    <div className="texture-wood fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-y-auto px-4 py-4">
      {/* HUD */}
      <div className="flex w-full max-w-md items-center justify-between gap-3">
        <span className="font-display text-sm font-bold text-gold-bright">
          The Wild Forest · Depth {forest.stage}
        </span>
        <div className="flex flex-col items-end gap-1">
          <Gauge icon={<Heart className="h-3.5 w-3.5 text-stat-HP" />} value={forest.hp} max={forest.maxHp} fill="#2e8a5e" />
          <Gauge icon={<Zap className="h-3.5 w-3.5 text-stat-AG" />} value={forest.sta} max={forest.maxSta} fill="#b8860b" />
        </div>
      </div>

      {/* Haul */}
      <div className="flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment-200">
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

      {/* Forest */}
      <div
        className="relative shrink-0 overflow-hidden rounded-md border-2 border-gold-deep/60 shadow-gold-sm"
        style={{ width, height, boxShadow: 'inset 0 0 36px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4)' }}
      >
        {/* Tile layer with fog: lit (in sight) → full, explored → dimmed, unseen → dark. */}
        {forest.tiles.map((row, r) =>
          row.map((tile, c) => {
            const seen = forest.seen[r]?.[c];
            const vis = isVisible(forest, r, c);
            if (!seen) {
              return (
                <div
                  key={`${r}-${c}`}
                  className="absolute"
                  style={{ left: c * CELL, top: r * CELL, width: CELL, height: CELL, backgroundColor: '#080d08' }}
                />
              );
            }
            const node = tile.kind === 'node' && tile.nodeKey ? FOREST_NODES[tile.nodeKey] : null;
            return (
              <div
                key={`${r}-${c}`}
                className="absolute flex items-center justify-center text-[13px] leading-none"
                style={{
                  ...tileStyle(tile.kind, r, c),
                  left: c * CELL,
                  top: r * CELL,
                  width: CELL,
                  height: CELL,
                  boxShadow: node
                    ? `inset 0 0 0 1px rgba(0,0,0,0.3), inset 0 0 8px ${node.color}77`
                    : 'inset 0 0 0 1px rgba(0,0,0,0.28)',
                }}
              >
                {node ? (
                  <span title={node.name} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}>
                    {node.glyph}
                  </span>
                ) : tile.kind === 'treeline' ? (
                  <Trees className="h-4 w-4 text-emerald-300" style={{ filter: 'drop-shadow(0 0 4px rgba(72,202,140,0.7))' }} />
                ) : tile.kind === 'entrance' ? (
                  <span className="text-[11px] text-gold-bright">◇</span>
                ) : null}
                {/* Explored-but-out-of-sight tiles are veiled by the dark. */}
                {!vis && <div className="absolute inset-0 bg-black/55" />}
              </div>
            );
          }),
        )}

        {/* Circular torch-glow vignette — darkens everything beyond the lit disc. */}
        <div
          className="pointer-events-none absolute inset-0 z-[6]"
          style={{
            background: `radial-gradient(circle ${litR}px at ${lightX}px ${lightY}px, transparent 58%, rgba(6,12,7,0.4) 82%, rgba(4,8,5,0.82) 100%)`,
          }}
        />

        {/* Facing indicator — highlights the tile the player is targeting. */}
        <div
          className="pointer-events-none absolute z-[7]"
          style={{
            width: CELL,
            height: CELL,
            transform: `translate(${faced.c * CELL}px, ${faced.r * CELL}px)`,
            boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.7)',
            transition: 'transform 150ms linear',
          }}
        />

        {/* Clear / harvest pops */}
        {pops.map((p) => (
          <div
            key={p.key}
            className="pointer-events-none absolute z-20 rounded-full"
            style={{
              width: CELL * 0.7,
              height: CELL * 0.7,
              left: p.c * CELL + CELL * 0.15,
              top: p.r * CELL + CELL * 0.15,
              backgroundColor: 'rgba(140,231,160,0.8)',
              animation: 'mine-pop 0.5s ease-out forwards',
            }}
          />
        ))}

        {/* Loot popups */}
        {lootPops.map((p) => (
          <div
            key={p.key}
            className="pointer-events-none absolute z-30 whitespace-nowrap font-display text-[11px] font-bold"
            style={{
              left: p.c * CELL + CELL / 2,
              top: p.r * CELL,
              color: p.color,
              textShadow: '0 1px 3px rgba(0,0,0,0.9)',
              animation: 'loot-float 0.9s ease-out forwards',
            }}
          >
            {p.text}
          </div>
        ))}

        {/* Beasts — only the ones inside the current sight radius (ambush hides the rest). */}
        {forest.beasts.map((b) => {
          if (!isVisible(forest, b.r, b.c)) return null;
          const def = FOREST_BEASTS[b.key];
          return (
            <div
              key={b.id}
              className={cn(
                'pointer-events-none absolute z-[8] flex items-center justify-center transition-transform duration-150 ease-linear',
                b.asleep && 'opacity-70',
              )}
              style={{ width: CELL, height: CELL, transform: `translate(${b.c * CELL}px, ${b.r * CELL}px)` }}
              title={def?.name}
            >
              <span className="text-[15px] leading-none" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))' }}>
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

        {/* Player */}
        <div
          className="pointer-events-none absolute z-10 flex items-center justify-center transition-transform duration-150 ease-linear"
          style={{ width: CELL, height: CELL, transform: `translate(${forest.player.c * CELL}px, ${forest.player.r * CELL}px)` }}
        >
          <span className="text-[16px] leading-none" style={{ filter: 'drop-shadow(0 0 5px rgba(255,240,200,0.55))' }}>
            {dead ? '💀' : '🚶'}
          </span>
        </div>

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

        {/* Death summary (forfeit half the haul) */}
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

      {/* Push deeper / leave */}
      <div className="flex w-full max-w-md items-center justify-center gap-2">
        <Button
          variant={onTreeline ? 'primary' : 'secondary'}
          onClick={forestAdvance}
          disabled={!onTreeline}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs', !onTreeline && 'opacity-60')}
        >
          <ChevronsDown className="h-4 w-4" /> Push deeper
        </Button>
        <Button variant="danger" onClick={beginForestBanking} className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
          <LogOut className="h-4 w-4" /> Bank &amp; leave
        </Button>
      </div>

      {/* Touch controls */}
      <div className="w-full max-w-md">
        <ForestControls controls={controls} />
      </div>

      <p className="text-center text-[10px] text-parchment-300/50">
        Move: arrow keys / WASD · Slash &amp; gather: space · or use the pad above. Reach the far{' '}
        <Trees className="inline h-3 w-3 text-emerald-300" /> tree line to push deeper.
      </p>
    </div>
  );
}
