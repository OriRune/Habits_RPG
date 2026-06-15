import { Heart, Zap, Coins, ChevronsDown, LogOut } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useMiningLoop } from '@/hooks/useMiningLoop';
import { canDescend, type MineTile } from '@/engine/mining';
import { MINE_ORES, MINE_MONSTERS } from '@/content/mining';
import { getMaterial } from '@/engine/materials';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { MineControls } from './MineControls';

const CELL = 32; // px per tile

const TILE_BG: Record<MineTile['kind'], string> = {
  bedrock: '#241c14',
  rock: '#4a3a29',
  floor: '#322619',
  entrance: '#6b5320',
  shaft: '#1c2a30',
  ore: '#4a3a29',
};

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
  const mineDescend = useGameStore((s) => s.mineDescend);

  if (!mine) return null;

  const onShaft = canDescend(mine);
  const haulMats = Object.entries(mine.haul.materials ?? {}).filter(([, n]) => n > 0);
  const width = mine.cols * CELL;
  const height = mine.rows * CELL;

  return (
    <div className="texture-wood fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-y-auto px-4 py-4">
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
            return (
              <div
                key={`${r}-${c}`}
                className="absolute flex items-center justify-center text-[15px] leading-none"
                style={{
                  left: c * CELL,
                  top: r * CELL,
                  width: CELL,
                  height: CELL,
                  backgroundColor: ore ? '#3a2c1c' : TILE_BG[tile.kind],
                  boxShadow: tile.kind === 'bedrock' ? 'none' : 'inset 0 0 0 1px rgba(0,0,0,0.25)',
                }}
              >
                {ore ? (
                  <span style={{ color: ore.color }}>{ore.glyph}</span>
                ) : tile.kind === 'shaft' ? (
                  <ChevronsDown className="h-4 w-4 text-cyan-300" />
                ) : tile.kind === 'entrance' ? (
                  <span className="text-[12px] text-gold-bright">◇</span>
                ) : null}
              </div>
            );
          }),
        )}

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
              <span className="text-[17px] leading-none drop-shadow">{def?.glyph ?? '?'}</span>
            </div>
          );
        })}
        <div
          className="pointer-events-none absolute z-10 flex items-center justify-center transition-transform duration-150 ease-linear"
          style={{ width: CELL, height: CELL, transform: `translate(${mine.player.c * CELL}px, ${mine.player.r * CELL}px)` }}
        >
          <span className="text-[18px] leading-none drop-shadow">⛏️</span>
        </div>
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
        <Button variant="danger" onClick={endMining} className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
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
