import { useState, useEffect, useRef } from 'react';
import { Heart, Zap, Coins, ChevronsDown, LogOut, Pickaxe, Hammer, Gem } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useMiningLoop } from '@/hooks/useMiningLoop';
import { canDescend, facedCell, type MineTile, type MineMonster } from '@/engine/mining';
import { MINE_ORES, MINE_MONSTERS } from '@/content/mining';
import { mineRockSprite, mineFloorTile, mineOreSprite } from '@/lib/minigameArt';
import { getMaterial } from '@/engine/materials';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { MineControls } from './MineControls';

const CELL = 48; // px per tile

const TILE_STYLE: Record<MineTile['kind'], React.CSSProperties> = {
  bedrock: {
    backgroundColor: '#1a1410',
    backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 6px)',
  },
  rock: {
    backgroundColor: '#4a3a29',
    backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 6px)',
  },
  floor: { backgroundColor: '#2a1e12' },
  entrance: { backgroundColor: '#6b5320' },
  shaft: { backgroundColor: '#1c2a30' },
  ore: { backgroundColor: '#3a2c1c' },
};

type LootPop = { key: string; r: number; c: number; at: number; text: string; color: string };

function OreIcon({ oreKey, color }: { oreKey: string; color: string }) {
  const style = { color };
  if (oreKey === 'bronze_vein') return <Pickaxe className="h-6 w-6" style={style} />;
  if (oreKey === 'iron_vein') return <Hammer className="h-6 w-6" style={style} />;
  if (oreKey === 'gold_vein') return <Coins className="h-6 w-6" style={style} />;
  if (oreKey === 'energy_gem') return <Zap className="h-6 w-6" style={style} />;
  if (oreKey === 'crystal_node' || oreKey === 'gemstone_node') return <Gem className="h-6 w-6" style={style} />;
  const ore = MINE_ORES[oreKey];
  return <span style={style}>{ore?.glyph ?? '?'}</span>;
}

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

export function MineRunOverlay() {
  const controls = useMiningLoop();
  const mine = useGameStore((s) => s.mining);
  const endMining = useGameStore((s) => s.endMining);
  const beginBanking = useGameStore((s) => s.beginBanking);
  const mineDescend = useGameStore((s) => s.mineDescend);

  const [pops, setPops] = useState<Array<{ key: string; r: number; c: number; at: number }>>([]);
  const [lootPops, setLootPops] = useState<LootPop[]>([]);
  const prevRef = useRef<{
    tiles: MineTile[][];
    monsters: MineMonster[];
    haul: { gold?: number; materials?: Record<string, number> };
    sta: number;
  } | null>(null);

  useEffect(() => {
    if (!mine) { prevRef.current = null; return; }
    const prev = prevRef.current;
    prevRef.current = { tiles: mine.tiles, monsters: mine.monsters, haul: mine.haul, sta: mine.sta };
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
      const pos = eventPos as { r: number; c: number };
      const newLootPops: LootPop[] = [];
      const goldDelta = (mine.haul.gold ?? 0) - (prev.haul.gold ?? 0);
      if (goldDelta > 0) {
        newLootPops.push({ key: `lg-${now}`, ...pos, at: now, text: `+${goldDelta} gold`, color: '#e8c860' });
      } else {
        for (const [matKey, val] of Object.entries(mine.haul.materials ?? {})) {
          const delta = val - ((prev.haul.materials ?? {})[matKey] ?? 0);
          if (delta > 0) {
            const mat = getMaterial(matKey);
            newLootPops.push({ key: `lm-${now}`, ...pos, at: now, text: `+${delta} ${mat?.name ?? matKey}`, color: mat?.color ?? '#f3e7c9' });
            break;
          }
        }
      }
      const netSta = mine.sta - prev.sta;
      if (netSta > 0) {
        newLootPops.push({ key: `ls-${now}`, ...pos, at: now, text: `+${netSta} sta`, color: '#22d3ee' });
      }
      if (newLootPops.length > 0) {
        setLootPops((ps) => [...ps.filter((p) => now - p.at < 1400), ...newLootPops]);
        setTimeout(() => setLootPops((ps) => ps.filter((p) => Date.now() - p.at < 1400)), 1450);
      }
    }
  }, [mine]);

  if (!mine) return null;

  const onShaft = canDescend(mine);
  const faced = facedCell(mine);
  const haulMats = Object.entries(mine.haul.materials ?? {}).filter(([, n]) => n > 0);
  const width = mine.cols * CELL;
  const height = mine.rows * CELL;

  return (
    <div className="texture-wood fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-auto px-4 py-4">
      {/* HUD */}
      <div className="flex w-full max-w-md items-center justify-between gap-3">
        <span className="font-display text-sm font-bold text-gold-bright">
          The Deep Mine · Floor {mine.floor}
        </span>
        <div className="flex flex-col items-end gap-1">
          <Gauge icon={<Heart className="h-3.5 w-3.5 text-stat-HP" />} value={mine.hp} max={mine.maxHp} fill="#2e8a5e" />
          <Gauge icon={<Zap className="h-3.5 w-3.5 text-stat-AG" />} value={mine.sta} max={mine.maxSta} fill="#b8860b" />
        </div>
      </div>

      {/* Haul */}
      <div className="flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-1 text-xs text-parchment-200">
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

      {/* Cavern */}
      <div className="relative shrink-0 rounded-md border-2 border-gold-deep/60 shadow-gold-sm" style={{ width, height }}>
        {/* Tile layer */}
        {mine.tiles.map((row, r) =>
          row.map((tile, c) => {
            const ore = tile.kind === 'ore' && tile.oreKey ? MINE_ORES[tile.oreKey] : null;
            // Real art: cave-floor tiles paint open ground, boulders fill diggable rock, and
            // mapped ores show their sprite. Bedrock and unmapped ores keep their CSS/glyph look.
            const floorImg = tile.kind === 'floor' || tile.kind === 'entrance' ? mineFloorTile(r, c) : undefined;
            const rockImg = tile.kind === 'rock' ? mineRockSprite(r, c) : undefined;
            const oreImg = ore && tile.oreKey ? mineOreSprite(tile.oreKey) : undefined;
            return (
              <div
                key={`${r}-${c}`}
                className="absolute flex items-center justify-center text-[22px] leading-none"
                style={{
                  ...TILE_STYLE[tile.kind],
                  ...(floorImg
                    ? {
                        backgroundColor: '#1c140d',
                        backgroundImage: `url(${floorImg})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        imageRendering: 'pixelated',
                      }
                    : {}),
                  left: c * CELL,
                  top: r * CELL,
                  width: CELL,
                  height: CELL,
                  boxShadow: tile.kind === 'bedrock'
                    ? 'none'
                    : ore
                    ? `inset 0 0 0 1px rgba(0,0,0,0.25), inset 0 0 8px ${ore.color}55`
                    : 'inset 0 0 0 1px rgba(0,0,0,0.25)',
                }}
              >
                {rockImg ? (
                  <img src={rockImg} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain image-pixel" />
                ) : oreImg ? (
                  <img
                    src={oreImg}
                    alt={ore?.name}
                    title={ore?.name}
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain image-pixel"
                  />
                ) : ore ? (
                  <OreIcon oreKey={tile.oreKey!} color={ore.color} />
                ) : tile.kind === 'shaft' ? (
                  <ChevronsDown className="h-6 w-6 text-cyan-300" />
                ) : tile.kind === 'entrance' ? (
                  <span className="text-[18px] text-gold-bright">◇</span>
                ) : null}
                {tile.maxDurability != null && tile.durability != null && tile.durability < tile.maxDurability && (
                  <div className="absolute bottom-1 left-1 right-1 h-[3px] overflow-hidden rounded-full bg-black/60">
                    <div className="h-full rounded-full bg-red-400" style={{ width: `${(tile.durability / tile.maxDurability) * 100}%` }} />
                  </div>
                )}
              </div>
            );
          }),
        )}

        {/* Facing indicator — highlights the tile the player is targeting. */}
        <div
          className="pointer-events-none absolute z-[5]"
          style={{
            width: CELL,
            height: CELL,
            transform: `translate(${faced.c * CELL}px, ${faced.r * CELL}px)`,
            boxShadow: 'inset 0 0 0 2px rgba(251,191,36,0.7)',
            transition: 'transform 150ms linear',
          }}
        />

        {/* Destruction pops */}
        {pops.map((p) => (
          <div
            key={p.key}
            className="pointer-events-none absolute z-20 rounded-full"
            style={{
              width: CELL * 0.7,
              height: CELL * 0.7,
              left: p.c * CELL + CELL * 0.15,
              top: p.r * CELL + CELL * 0.15,
              backgroundColor: 'rgba(251,191,36,0.75)',
              animation: 'mine-pop 0.5s ease-out forwards',
            }}
          />
        ))}

        {/* Loot popups */}
        {lootPops.map((p) => (
          <div
            key={p.key}
            className="pointer-events-none absolute z-30 whitespace-nowrap font-display text-[13px] font-bold"
            style={{
              left: p.c * CELL + CELL / 2,
              top: p.r * CELL + CELL / 2,
              color: p.color,
              textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9)',
              animation: 'loot-float 1.4s ease-out forwards',
            }}
          >
            {p.text}
          </div>
        ))}

        {/* Entity layer — CSS-transitioned transforms give the tile-step a smooth glide. */}
        {mine.monsters.map((m) => {
          const def = MINE_MONSTERS[m.key];
          return (
            <div
              key={m.id}
              className="pointer-events-none absolute flex items-center justify-center transition-transform duration-150 ease-linear"
              style={{ width: CELL, height: CELL, transform: `translate(${m.c * CELL}px, ${m.r * CELL}px)` }}
              title={def?.name}
            >
              <span className="text-[26px] leading-none drop-shadow">{def?.glyph ?? '?'}</span>
              {m.hp < m.maxHp && (
                <div className="absolute -top-1.5 left-0 right-0 h-[3px] overflow-hidden rounded-full bg-black/60">
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${(m.hp / m.maxHp) * 100}%` }} />
                </div>
              )}
            </div>
          );
        })}
        <div
          className="pointer-events-none absolute z-10 flex items-center justify-center transition-transform duration-150 ease-linear"
          style={{ width: CELL, height: CELL, transform: `translate(${mine.player.c * CELL}px, ${mine.player.r * CELL}px)` }}
        >
          <span className="text-[27px] leading-none drop-shadow">⛏️</span>
        </div>

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

      {/* Descend / leave */}
      <div className="flex w-full max-w-md items-center justify-center gap-2">
        <Button
          variant={onShaft ? 'primary' : 'secondary'}
          onClick={mineDescend}
          disabled={!onShaft}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs', !onShaft && 'opacity-60')}
        >
          <ChevronsDown className="h-4 w-4" /> Descend
        </Button>
        <Button variant="danger" onClick={beginBanking} className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
          <LogOut className="h-4 w-4" /> Bank &amp; leave
        </Button>
      </div>

      {/* Touch controls */}
      <div className="w-full max-w-md">
        <MineControls controls={controls} />
      </div>

      <p className="text-center text-[10px] text-parchment-300/50">
        Move: arrow keys / WASD · Mine: space · or use the pad above. Stand on the{' '}
        <ChevronsDown className="inline h-3 w-3 text-cyan-300" /> shaft to descend.
      </p>
    </div>
  );
}
