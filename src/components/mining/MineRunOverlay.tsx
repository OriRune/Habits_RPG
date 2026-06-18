import { useState, useEffect, useRef } from 'react';
import { Heart, Zap, Coins, ChevronsDown, LogOut, Gem, Sparkles } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useMiningLoop } from '@/hooks/useMiningLoop';
import { canDescend, facedCell, type MineTile, type MineMonster } from '@/engine/mining';
import { cameraWindow, VIEW } from '@/engine/crawl';
import { bandForFloor, type CrawlPalette } from '@/engine/crawlBiomes';
import { useSmoothCamera, type SmoothCameraLayout } from '@/hooks/useSmoothCamera';
import { MINE_ORES, MINE_MONSTERS } from '@/content/mining';
import { getSpell } from '@/engine/spells';
import { mineRockSprite, mineFloorTile, mineOreSprite } from '@/lib/minigameArt';
import { getMaterial } from '@/engine/materials';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { MineControls } from './MineControls';
import { CrawlerAvatar } from '@/components/minigame/CrawlerAvatar';
import { useCoopStore } from '@/net/coop/session';
import { useAuthStore } from '@/net/auth';
import { usePartyStore } from '@/hooks/useParty';
import { CoopToasts } from '@/components/minigame/CoopToasts';

const CELL = 52;
const BOARD_PX = VIEW * CELL;
const MARGIN = 1;
const RENDER_VIEW = VIEW + 2 * MARGIN;

/** Deterministic 0..1 hash for a cell — stable across renders. */
function cellHash(r: number, c: number): number {
  let h = (Math.imul(r, 73856093) ^ Math.imul(c, 19349663)) >>> 0;
  h ^= h >>> 13;
  return (h % 1000) / 1000;
}

/** Per-cell floor background with decal variety. Palette drives the base colour. */
function floorStyle(r: number, c: number, palette: CrawlPalette): React.CSSProperties {
  const j1 = cellHash(r * 3 + 1, c * 3 + 2);
  const j2 = cellHash(r + 11, c + 5);
  const j3 = cellHash(r + 3, c + 8);
  const tint = 0.88 + 0.22 * cellHash(r, c);
  const [fr, fg, fb] = palette.floor;
  const base  = Math.round(fr * tint);
  const baseG = Math.round(fg * tint);
  const baseB = Math.round(fb * tint);

  let extra = '';
  if (j1 < 0.12) {
    // Crack streak
    const ang = Math.floor(j2 * 120) + 30;
    extra = `linear-gradient(${ang}deg, transparent 44%, rgba(0,0,0,0.28) 46%, rgba(0,0,0,0.28) 54%, transparent 56%),`;
  } else if (j1 < 0.24) {
    // Pebble cluster
    const px = Math.floor(j2 * 70) + 15;
    const py = Math.floor(j3 * 70) + 15;
    extra = `radial-gradient(circle at ${px}% ${py}%, rgba(80,60,40,0.55) 0%, transparent 18%),`;
  } else if (j1 < 0.34) {
    // Mineral speck
    const px = Math.floor(j3 * 60) + 20;
    const py = Math.floor(j2 * 60) + 20;
    extra = `radial-gradient(circle at ${px}% ${py}%, rgba(140,120,90,0.40) 0%, transparent 12%),`;
  }

  return {
    backgroundColor: `rgb(${base},${baseG},${baseB})`,
    backgroundImage:
      extra +
      'radial-gradient(circle at 50% 50%, rgba(60,44,26,0.28) 0%, transparent 68%)',
  };
}

/** Rock tile style — richer variation so walls look craggy. Palette drives the base colour. */
function rockStyle(r: number, c: number, palette: CrawlPalette): React.CSSProperties {
  const j = cellHash(r, c);
  const m = 0.78 + 0.36 * j;
  const jc = cellHash(r + 5, c + 3);
  const [rr, rg, rb] = palette.rock;
  const R = Math.round(Math.min(255, rr * m));
  const G = Math.round(Math.min(255, rg * m));
  const B = Math.round(Math.min(255, rb * m));
  const cragX = Math.floor(jc * 80) + 10;
  const cragY = Math.floor(cellHash(r + 2, c + 7) * 80) + 10;
  return {
    backgroundColor: `rgb(${R},${G},${B})`,
    backgroundImage:
      `radial-gradient(circle at ${cragX}% ${cragY}%, rgba(255,255,255,0.07) 0%, transparent 38%),` +
      'repeating-linear-gradient(135deg, rgba(0,0,0,0.20) 0px, rgba(0,0,0,0.20) 1px, transparent 1px, transparent 5px),' +
      'repeating-linear-gradient(45deg, rgba(0,0,0,0.10) 0px, rgba(0,0,0,0.10) 1px, transparent 1px, transparent 8px)',
  };
}

type LootPop = { key: string; r: number; c: number; at: number; text: string; color: string };

function OreIcon({ oreKey, color }: { oreKey: string; color: string }) {
  if (oreKey === 'gold_vein') return <Coins className="h-6 w-6" style={{ color }} />;
  if (oreKey === 'energy_gem') return <Zap className="h-6 w-6" style={{ color }} />;
  if (oreKey === 'crystal_node' || oreKey === 'gemstone_node') return <Gem className="h-6 w-6" style={{ color }} />;
  const ore = MINE_ORES[oreKey];
  return <span style={{ color }}>{ore?.glyph ?? '?'}</span>;
}

function Gauge({
  icon, value, max, fill,
}: { icon: React.ReactNode; value: number; max: number; fill: string }) {
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

export function MineRunOverlay() {
  const controls = useMiningLoop();
  const mine = useGameStore((s) => s.mining);
  const endMining = useGameStore((s) => s.endMining);
  const beginBanking = useGameStore((s) => s.beginBanking);
  const mineDescend = useGameStore((s) => s.mineDescend);
  const remotePlayers = useCoopStore((s) => s.remotePlayers);
  const coopSession = useCoopStore((s) => s.session);
  const coopJoined = useCoopStore((s) => s.joined);
  const partyMembers = usePartyStore((s) => s.members);
  const myId = useAuthStore((s) => s.session?.user?.id);
  // Prefer the authoritative party-roster name (every client has it), fall back to
  // the player's self-reported broadcast name.
  const nameFor = (userId: string, fallback: string) =>
    partyMembers.find((m) => m.user_id === userId)?.username ?? fallback;
  // In co-op the host leads the descent; guests follow via the world slice and
  // can't change the floor themselves.
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
    tiles: MineTile[][];
    monsters: MineMonster[];
    haul: { gold?: number; materials?: Record<string, number> };
    sta: number;
    hp: number;
  } | null>(null);

  useEffect(() => {
    if (!mine) { prevRef.current = null; prevPosRef.current = null; return; }

    // Moving detection
    const pos = mine.player;
    const prev2 = prevPosRef.current;
    if (prev2 && (prev2.r !== pos.r || prev2.c !== pos.c)) {
      setMoving(true);
      if (movingTimerRef.current) clearTimeout(movingTimerRef.current);
      movingTimerRef.current = setTimeout(() => setMoving(false), 250);
    }
    prevPosRef.current = { r: pos.r, c: pos.c };

    const prev = prevRef.current;
    prevRef.current = { tiles: mine.tiles, monsters: mine.monsters, haul: mine.haul, sta: mine.sta, hp: mine.hp };
    if (!prev) return;
    const now = Date.now();
    const newPops: Array<{ key: string; r: number; c: number; at: number }> = [];
    let eventPos: { r: number; c: number } | null = null;
    mine.tiles.forEach((row, r) =>
      row.forEach((tile, c) => {
        const was = prev.tiles[r]?.[c];
        if (tile.kind === 'floor' && (was?.kind === 'rock' || was?.kind === 'ore')) {
          newPops.push({ key: `t-${r}-${c}-${now}`, r, c, at: now });
          eventPos = { r, c };
        }
      }),
    );
    const liveIds = new Set(mine.monsters.map((m) => m.id));
    prev.monsters.forEach((m) => {
      if (!liveIds.has(m.id)) {
        newPops.push({ key: `m-${m.id}-${now}`, r: m.r, c: m.c, at: now });
        eventPos = { r: m.r, c: m.c };
      }
    });
    if (newPops.length > 0) {
      setPops((ps) => [...ps.filter((p) => now - p.at < 550), ...newPops]);
      setTimeout(() => setPops((ps) => ps.filter((p) => Date.now() - p.at < 550)), 600);
    }
    if (eventPos) {
      const pos2 = eventPos as { r: number; c: number };
      const newLootPops: LootPop[] = [];
      const goldDelta = (mine.haul.gold ?? 0) - (prev.haul.gold ?? 0);
      if (goldDelta > 0) {
        newLootPops.push({ key: `lg-${now}`, ...pos2, at: now, text: `+${goldDelta} gold`, color: '#e8c860' });
      } else {
        for (const [matKey, val] of Object.entries(mine.haul.materials ?? {})) {
          const delta = val - ((prev.haul.materials ?? {})[matKey] ?? 0);
          if (delta > 0) {
            const mat = getMaterial(matKey);
            newLootPops.push({
              key: `lm-${now}`, ...pos2, at: now,
              text: `+${delta} ${mat?.name ?? matKey}`,
              color: mat?.color ?? '#f3e7c9',
            });
            break;
          }
        }
      }
      const netSta = mine.sta - prev.sta;
      if (netSta > 0) {
        newLootPops.push({ key: `ls-${now}`, ...pos2, at: now, text: `+${netSta} sta`, color: '#22d3ee' });
      }
      if (newLootPops.length > 0) {
        setLootPops((ps) => [...ps.filter((p) => now - p.at < 1400), ...newLootPops]);
        setTimeout(() => setLootPops((ps) => ps.filter((p) => Date.now() - p.at < 1400)), 1450);
      }
    }
  }, [mine]);

  if (!mine) return null;

  const band = bandForFloor(mine.floor);
  const dead = mine.status === 'ended';
  const onShaft = canDescend(mine);
  const faced = facedCell(mine);
  const haulMats = Object.entries(mine.haul.materials ?? {}).filter(([, n]) => n > 0);

  const { r0, c0 } = cameraWindow(mine.player, mine.rows, mine.cols);
  const baseR0 = Math.max(0, r0 - MARGIN);
  const baseC0 = Math.max(0, c0 - MARGIN);

  const inView = (mr: number, mc: number) => {
    const vi = mr - baseR0;
    const vj = mc - baseC0;
    return vi >= 0 && vi < RENDER_VIEW && vj >= 0 && vj < RENDER_VIEW;
  };

  layoutRef.current = {
    baseR0,
    baseC0,
    playerR: mine.player.r,
    playerC: mine.player.c,
    rows: mine.rows,
    cols: mine.cols,
    snapKey: mine.floor,
    // Monsters and co-op party members share the rAF interpolation path so both
    // glide smoothly and stay locked to the camera. Remote players use an
    // `rp:` id namespace so they never collide with a monster id.
    movers: [
      ...mine.monsters.filter((m) => inView(m.r, m.c)).map((m) => ({ id: m.id, r: m.r, c: m.c })),
      ...Object.values(remotePlayers)
        .filter((p) => p.floor === mine.floor && inView(p.r, p.c))
        .map((p) => ({ id: `rp:${p.userId}`, r: p.r, c: p.c })),
    ],
  };

  // Torch glow in world-container space
  const lightX = (mine.player.c - baseC0) * CELL + CELL / 2;
  const lightY = (mine.player.r - baseR0) * CELL + CELL / 2;

  return (
    <div className="texture-wood fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-auto px-4 py-4">
      <CoopToasts />
      {/* HUD */}
      <div className="flex w-full max-w-lg items-center justify-between gap-3">
        <span className="font-display text-sm font-bold text-gold-bright">
          The Deep Mine · Floor {mine.floor}
          <span className="ml-2 text-[11px] font-normal opacity-70">{band.name}</span>
        </span>
        <div className="flex flex-col items-end gap-1">
          <Gauge icon={<Heart className="h-3.5 w-3.5 text-stat-HP" />} value={mine.hp} max={mine.maxHp} fill="#2e8a5e" />
          <Gauge icon={<Zap className="h-3.5 w-3.5 text-stat-AG" />} value={mine.sta} max={mine.maxSta} fill="#b8860b" />
          {mine.maxMp > 0 && (
            <Gauge icon={<Sparkles className="h-3.5 w-3.5 text-blue-400" />} value={mine.mp} max={mine.maxMp} fill="#4f7ed4" />
          )}
        </div>
      </div>

      {/* Haul */}
      <div className="flex w-full max-w-lg flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment-200">
        <span className="font-display uppercase tracking-wider text-parchment-300/70">Haul</span>
        <span className="flex items-center gap-1 text-gold-bright">
          <Coins className="h-3.5 w-3.5" /> {mine.haul.gold ?? 0}
        </span>
        {haulMats.map(([key, n]) => (
          <span key={key} className="text-parchment-200">
            {getMaterial(key)?.name ?? key} ×{n}
          </span>
        ))}
        {haulMats.length === 0 && (mine.haul.gold ?? 0) === 0 && (
          <span className="text-parchment-300/50">nothing yet — dig in</span>
        )}
      </div>

      {/* Cavern viewport */}
      <div
        className="relative shrink-0 overflow-hidden rounded-md border-2 border-gold-deep/60"
        style={{
          width: BOARD_PX,
          height: BOARD_PX,
          boxShadow: 'inset 0 0 56px rgba(0,0,0,0.92), 0 0 0 1px rgba(0,0,0,0.5)',
        }}
      >
        {/* World container */}
        <div ref={worldRef} className="absolute" style={{ willChange: 'transform' }}>

        {/* Tile layer */}
        {Array.from({ length: RENDER_VIEW }, (_, vi) => {
          const r = baseR0 + vi;
          return Array.from({ length: RENDER_VIEW }, (_, vj) => {
            const c = baseC0 + vj;
            const tile = mine.tiles[r]?.[c];
            if (!tile) return null;
            const ore = tile.kind === 'ore' && tile.oreKey ? MINE_ORES[tile.oreKey] : null;
            const isFloor = tile.kind === 'floor' || tile.kind === 'entrance';
            const floorImg = isFloor ? mineFloorTile(r, c) : undefined;
            const rockImg = tile.kind === 'rock' ? mineRockSprite(r, c) : undefined;
            const oreImg = ore && tile.oreKey ? mineOreSprite(tile.oreKey) : undefined;
            const px = vj * CELL;
            const py = vi * CELL;

            const tileStyleProp: React.CSSProperties =
              tile.kind === 'bedrock'
                ? {
                    backgroundColor: '#0c0803',
                    backgroundImage:
                      'repeating-linear-gradient(45deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 8px)',
                  }
                : tile.kind === 'rock'
                ? rockStyle(r, c, band.palette)
                : tile.kind === 'shaft'
                ? { backgroundColor: '#1c2a30', backgroundImage: `radial-gradient(circle at 50% 50%, ${band.palette.accent}22 0%, transparent 65%)` }
                : isFloor
                ? floorImg
                  ? {
                      backgroundColor: '#1a1008',
                      backgroundImage: `url(${floorImg})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      imageRendering: 'pixelated',
                    }
                  : floorStyle(r, c, band.palette)
                : tile.kind === 'ore'
                ? { backgroundColor: '#3a2c1c', backgroundImage: ore ? `radial-gradient(circle at 55% 42%, ${ore.color}22 0%, transparent 60%)` : undefined }
                : { backgroundColor: '#2a1e12' };

            return (
              <div
                key={`${r}-${c}`}
                className="absolute flex items-center justify-center text-[24px] leading-none"
                style={{
                  ...tileStyleProp,
                  left: px,
                  top: py,
                  width: CELL,
                  height: CELL,
                  boxShadow:
                    tile.kind === 'bedrock'
                      ? 'none'
                      : ore
                      ? `inset 0 0 0 1px rgba(0,0,0,0.3), inset 0 0 10px ${ore.color}66`
                      : tile.kind === 'rock'
                      ? 'inset 0 0 0 1px rgba(0,0,0,0.35), inset -1px -1px 0 rgba(255,255,255,0.04)'
                      : 'inset 0 0 0 1px rgba(0,0,0,0.22)',
                }}
              >
                {rockImg ? (
                  <img src={rockImg} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain image-pixel" />
                ) : oreImg ? (
                  <img src={oreImg} alt={ore?.name} title={ore?.name} className="pointer-events-none absolute inset-0 h-full w-full object-contain image-pixel" />
                ) : ore ? (
                  <OreIcon oreKey={tile.oreKey!} color={ore.color} />
                ) : tile.kind === 'shaft' ? (
                  <ChevronsDown className="h-7 w-7 text-cyan-300" />
                ) : tile.kind === 'entrance' ? (
                  <span className="text-[20px] text-gold-bright">◇</span>
                ) : null}
                {tile.maxDurability != null && tile.durability != null && tile.durability < tile.maxDurability && (
                  <div className="absolute bottom-1 left-1 right-1 h-[3px] overflow-hidden rounded-full bg-black/60">
                    <div className="h-full rounded-full bg-red-400" style={{ width: `${(tile.durability / tile.maxDurability) * 100}%` }} />
                  </div>
                )}
              </div>
            );
          });
        })}

        {/* Torch-glow vignette — deeper and more dramatic than before */}
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            background: `radial-gradient(circle ${4.2 * CELL}px at ${lightX}px ${lightY}px, transparent 40%, rgba(8,4,1,0.38) 62%, rgba(5,2,0,0.72) 82%, rgba(2,1,0,0.90) 100%)`,
            animation: 'mine-torch-flicker 3.2s ease-in-out infinite',
          }}
        />

        {/* Stalactite shadow along the top edge */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-[5]"
          style={{
            height: '15%',
            background: 'linear-gradient(to bottom, rgba(3,2,1,0.65) 0%, transparent 100%)',
          }}
        />

        {/* Facing indicator */}
        {(() => {
          const fvj = faced.c - baseC0;
          const fvi = faced.r - baseR0;
          if (fvi < 0 || fvi >= RENDER_VIEW || fvj < 0 || fvj >= RENDER_VIEW) return null;
          return (
            <div
              className="pointer-events-none absolute z-[6]"
              style={{
                width: CELL,
                height: CELL,
                transform: `translate(${fvj * CELL}px, ${fvi * CELL}px)`,
                boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.7)',
                transition: 'transform 150ms linear',
              }}
            />
          );
        })()}

        {/* Active runes */}
        {mine.runes.map((rune) => {
          const vj = rune.c - baseC0;
          const vi = rune.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          const runeColors = { fire: '#ff6b35', ice: '#7dd3fc', poison: '#86efac' };
          return (
            <div
              key={`rune-${rune.id}`}
              className="pointer-events-none absolute z-[7] flex items-center justify-center text-[18px] leading-none"
              style={{
                width: CELL,
                height: CELL,
                left: vj * CELL,
                top: vi * CELL,
                color: runeColors[rune.kind],
                textShadow: `0 0 8px ${runeColors[rune.kind]}`,
              }}
            >
              ✦
            </div>
          );
        })}

        {/* Destruction pops */}
        {pops.map((p) => {
          const vj = p.c - baseC0;
          const vi = p.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-20 rounded-full"
              style={{
                width: CELL * 0.7,
                height: CELL * 0.7,
                left: vj * CELL + CELL * 0.15,
                top: vi * CELL + CELL * 0.15,
                backgroundColor: 'rgba(251,191,36,0.75)',
                animation: 'mine-pop 0.5s ease-out forwards',
              }}
            />
          );
        })}

        {/* Loot popups */}
        {lootPops.map((p) => {
          const vj = p.c - baseC0;
          const vi = p.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          return (
            <div
              key={p.key}
              className="pointer-events-none absolute z-30 whitespace-nowrap font-display text-[13px] font-bold"
              style={{
                left: vj * CELL + CELL / 2,
                top: vi * CELL + CELL / 2,
                color: p.color,
                textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9)',
                animation: 'loot-float 1.4s ease-out forwards',
              }}
            >
              {p.text}
            </div>
          );
        })}

        {/* Monsters — rAF drives position */}
        {mine.monsters.map((m) => {
          const vj = m.c - baseC0;
          const vi = m.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          const def = MINE_MONSTERS[m.key];
          return (
            <div
              key={m.id}
              ref={(el) => {
                if (el) moverRefs.current.set(m.id, el);
                else moverRefs.current.delete(m.id);
              }}
              className="pointer-events-none absolute z-[8] flex items-center justify-center"
              style={{ width: CELL, height: CELL, transform: `translate(${vj * CELL}px, ${vi * CELL}px)` }}
              title={def?.name}
            >
              <span className="text-[28px] leading-none drop-shadow">{def?.glyph ?? '?'}</span>
              {m.hp < m.maxHp && (
                <div className="absolute -top-1.5 left-0 right-0 h-[3px] overflow-hidden rounded-full bg-black/60">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${(m.hp / m.maxHp) * 100}%` }} />
                </div>
              )}
              {(m.frozenUntilMs ?? 0) > Date.now() && (
                <div className="absolute inset-0 rounded bg-blue-400/25 ring-1 ring-blue-300" />
              )}
            </div>
          );
        })}

        {/* Co-op party members — positions arrive over the broadcast channel (~10 Hz).
            Registered as movers so the rAF loop interpolates them in world-pixel space
            (smooth cell-to-cell glide) and keeps the baseC0/baseR0 offset cancelled, so
            they stay locked to their cell as the camera scrolls — same path as monsters. */}
        {Object.values(remotePlayers).map((p) => {
          if (p.floor !== mine.floor) return null;
          const vj = p.c - baseC0;
          const vi = p.r - baseR0;
          if (vi < 0 || vi >= RENDER_VIEW || vj < 0 || vj >= RENDER_VIEW) return null;
          return (
            <div
              key={p.userId}
              ref={(el) => {
                const id = `rp:${p.userId}`;
                if (el) moverRefs.current.set(id, el);
                else moverRefs.current.delete(id);
              }}
              className="pointer-events-none absolute z-[9]"
              style={{
                width: CELL,
                height: CELL,
                transform: `translate(${vj * CELL}px, ${vi * CELL}px)`,
              }}
            >
              <CrawlerAvatar variant="miner" facing={p.facing} moving dead={p.hp <= 0} cell={CELL} />
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/60 px-1 font-display text-[9px] text-gold-bright">
                {nameFor(p.userId, p.username)}
              </span>
            </div>
          );
        })}

        {/* Player — rAF drives position */}
        <div
          ref={playerRef}
          className="pointer-events-none absolute z-[9]"
          style={{
            width: CELL,
            height: CELL,
            transform: `translate(${(mine.player.c - baseC0) * CELL}px, ${(mine.player.r - baseR0) * CELL}px)`,
          }}
        >
          <CrawlerAvatar
            variant="miner"
            facing={mine.player.facing}
            moving={moving}
            dead={dead}
            cell={CELL}
          />
        </div>

        </div>{/* end world container */}

        {/* Ambient mine atmosphere — viewport-fixed */}
        {mine.status === 'active' && (
          <div className="mine-ambient pointer-events-none absolute inset-0 z-[15] overflow-hidden">
            {/* Falling dust motes */}
            {[
              { left: '20%', top: '2%',  size: 2, dur: '7s',  delay: '0s'   },
              { left: '46%', top: '8%',  size: 2, dur: '10s', delay: '2.2s' },
              { left: '72%', top: '3%',  size: 3, dur: '8s',  delay: '4.8s' },
              { left: '34%', top: '14%', size: 2, dur: '9s',  delay: '0.8s' },
              { left: '84%', top: '1%',  size: 2, dur: '6s',  delay: '3.0s' },
              { left: '58%', top: '7%',  size: 2, dur: '11s', delay: '6.5s' },
              { left: '12%', top: '11%', size: 2, dur: '8.5s',delay: '1.5s' },
            ].map((d, i) => (
              <div
                key={i}
                className="absolute rounded-full"
                style={{
                  left: d.left,
                  top: d.top,
                  width: d.size,
                  height: d.size,
                  backgroundColor: 'rgba(215,190,148,0.62)',
                  filter: 'blur(0.4px)',
                  animation: `mine-dust-fall ${d.dur} linear infinite ${d.delay}`,
                }}
              />
            ))}
            {/* Crystal sparkles — brighter and larger */}
            {[
              { left: '10%', top: '32%', size: 7,  dur: '4.5s', delay: '0s'   },
              { left: '77%', top: '55%', size: 8,  dur: '6.5s', delay: '1.6s' },
              { left: '51%', top: '18%', size: 6,  dur: '5.5s', delay: '3.0s' },
              { left: '88%', top: '22%', size: 5,  dur: '7s',   delay: '4.8s' },
              { left: '30%', top: '68%', size: 7,  dur: '5s',   delay: '2.5s' },
            ].map((s, i) => (
              <div
                key={`sp-${i}`}
                className="absolute rounded-full"
                style={{
                  left: s.left,
                  top: s.top,
                  width: s.size,
                  height: s.size,
                  background: 'radial-gradient(circle, rgba(160,220,255,0.95) 0%, rgba(110,175,240,0.50) 50%, transparent 100%)',
                  boxShadow: '0 0 8px rgba(140,210,255,0.6)',
                  animation: `mine-sparkle ${s.dur} ease-in-out infinite ${s.delay}`,
                }}
              />
            ))}
          </div>
        )}

        {/* Banking overlay */}
        {mine.status === 'banking' && (
          <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-md bg-black/80 p-4 text-center">
            <span className="text-4xl leading-none">⛏️</span>
            <p className="font-display text-lg font-bold text-parchment-100">Haul Secured</p>
            <p className="font-display text-sm text-parchment-300">
              {mine.deepest > 1 ? `Reached floor ${mine.deepest}` : 'Floor 1 cleared'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-parchment-200">
              <span className="flex items-center gap-1 text-gold-bright">
                <Coins className="h-3.5 w-3.5" /> {mine.haul.gold ?? 0}
              </span>
              {haulMats.map(([key, n]) => (
                <span key={key}>{getMaterial(key)?.name ?? key} ×{n}</span>
              ))}
              {haulMats.length === 0 && (mine.haul.gold ?? 0) === 0 && (
                <span className="text-parchment-300/50">nothing gathered</span>
              )}
            </div>
            <Button variant="primary" onClick={endMining} className="mt-1 px-4 py-2 text-sm">
              Bank &amp; Leave
            </Button>
          </div>
        )}

        {/* Death overlay */}
        {mine.status === 'ended' && (
          <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-md bg-black/80 p-4 text-center">
            <span className="text-4xl leading-none">💀</span>
            <p className="font-display text-lg font-bold text-parchment-100">Fallen in the Deep</p>
            <p className="font-display text-sm text-parchment-300">Reached floor {mine.deepest}</p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-parchment-200">
              <span className="flex items-center gap-1 text-gold-bright">
                <Coins className="h-3.5 w-3.5" /> {mine.haul.gold ?? 0}
              </span>
              {haulMats.map(([key, n]) => (
                <span key={key}>{getMaterial(key)?.name ?? key} ×{n}</span>
              ))}
              {haulMats.length === 0 && (mine.haul.gold ?? 0) === 0 && (
                <span className="text-parchment-300/50">empty-handed</span>
              )}
            </div>
            <Button variant="primary" onClick={endMining} className="mt-1 px-4 py-2 text-sm">
              Retrieve Haul &amp; Leave
            </Button>
          </div>
        )}
      </div>

      {/* Spell ability bar */}
      {mine.knownSpells.length > 0 && mine.status === 'active' && (
        <div className="flex w-full max-w-lg items-center gap-2">
          <span className="font-display text-[10px] uppercase tracking-wider text-parchment-300/60">Spells</span>
          {mine.knownSpells.slice(0, 4).map((key, i) => {
            const spell = getSpell(key);
            if (!spell) return null;
            const canCast = mine.mp >= spell.mpCost;
            return (
              <button
                key={key}
                onClick={() => controls.castSpell(key)}
                title={`${spell.name} — ${spell.description}`}
                disabled={!canCast}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded border px-2 py-1 text-[11px] font-display transition-colors',
                  canCast
                    ? 'border-blue-400/50 bg-blue-900/40 text-blue-300 hover:bg-blue-800/50'
                    : 'border-parchment-300/20 bg-wood-900/40 text-parchment-300/40',
                )}
              >
                <span className="text-[13px]">{spell.name}</span>
                <span className="text-[10px] text-blue-300/70">[{i + 1}] {spell.mpCost}mp</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Descend / leave */}
      <div className="flex w-full max-w-lg flex-col items-center gap-1">
        <div className="flex items-center justify-center gap-2">
          <Button
            variant={onShaft && !isCoopGuest ? 'primary' : 'secondary'}
            onClick={mineDescend}
            disabled={!onShaft || isCoopGuest}
            title={isCoopGuest ? 'The host leads the descent' : undefined}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs',
              (!onShaft || isCoopGuest) && 'opacity-60',
            )}
          >
            <ChevronsDown className="h-4 w-4" /> Descend
          </Button>
          <Button variant="danger" onClick={beginBanking} className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <LogOut className="h-4 w-4" /> Bank &amp; leave
          </Button>
        </div>
        {isCoopGuest && (
          <p className="text-[10px] text-parchment-300/50">The host leads the descent.</p>
        )}
      </div>

      {/* Touch controls */}
      <div className="w-full max-w-lg">
        <MineControls controls={controls} />
      </div>

      <p className="text-center text-[10px] text-parchment-300/50">
        Move: arrow keys / WASD · Mine/Attack: space · Spells: 1–4 or tap above · Stand on{' '}
        <ChevronsDown className="inline h-3 w-3 text-cyan-300" /> shaft to descend.
      </p>
    </div>
  );
}
