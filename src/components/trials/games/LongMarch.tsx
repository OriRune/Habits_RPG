// Long March trial — EN.
// Navigate MARCH_TILES terrain tiles by choosing a pace for each tile.

import { useState, useMemo } from 'react';
import {
  generateTerrain,
  marchStep,
  marchScore,
  MARCH_TILES,
  MARCH_START_STA,
  MARCH_MAX_STA,
  type MarchPace,
} from '@/engine/trials/longMarch';
import { Button } from '@/components/ui/Button';

interface LongMarchProps {
  onFinish: (score01: number) => void;
}

interface LogEntry {
  tileIndex: number;
  pace: MarchPace;
  message: string;
  distanceDelta: number;
  staminaDelta: number;
}

export function LongMarch({ onFinish }: LongMarchProps) {
  const terrain = useMemo(() => generateTerrain(Math.random), []);
  const [tileIndex, setTileIndex] = useState(0);
  const [stamina, setStamina] = useState(MARCH_START_STA);
  const [distance, setDistance] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [done, setDone] = useState(false);

  const choosePace = (pace: MarchPace) => {
    if (done) return;
    const tile = terrain[tileIndex];
    const result = marchStep(tile, pace);
    const newSta = Math.min(MARCH_MAX_STA, Math.max(0, stamina + result.staminaDelta));
    const newDist = Math.max(0, distance + result.distanceDelta);
    const newTile = tileIndex + 1;

    setStamina(newSta);
    setDistance(newDist);
    setLog((prev) => [
      ...prev,
      { tileIndex, pace, message: result.message, distanceDelta: result.distanceDelta, staminaDelta: result.staminaDelta },
    ]);

    if (newSta <= 0 || newTile >= MARCH_TILES) {
      setTileIndex(newTile);
      setDone(true);
      onFinish(marchScore(newTile));
    } else {
      setTileIndex(newTile);
    }
  };

  const tile = terrain[tileIndex];
  const staminaPct = (stamina / MARCH_MAX_STA) * 100;

  return (
    <div className="flex flex-col items-center gap-4 px-2">
      {/* Progress bar */}
      <div className="w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs font-display text-ink-muted">
          <span>Progress: {tileIndex} / {MARCH_TILES}</span>
          <span>Distance: {distance}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/50">
          <div
            className="h-full bg-gold-bright/70 transition-all duration-300"
            style={{ width: `${(tileIndex / MARCH_TILES) * 100}%` }}
          />
        </div>
      </div>

      {/* Stamina bar */}
      <div className="w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs font-display text-ink-muted">
          <span>Stamina</span>
          <span>{stamina} / {MARCH_MAX_STA}</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/50">
          <div
            className={`h-full transition-all duration-300 ${
              staminaPct > 50 ? 'bg-emerald-500/70' : staminaPct > 25 ? 'bg-amber-400/70' : 'bg-rose-500/70'
            }`}
            style={{ width: `${staminaPct}%` }}
          />
        </div>
      </div>

      {/* Current tile */}
      {!done && tile && (
        <div className="w-full max-w-xs rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3 text-center">
          <div className="text-2xl">{tile.emoji}</div>
          <div className="font-display text-sm font-bold text-ink">{tile.label}</div>
        </div>
      )}

      {/* Last log entry */}
      {log.length > 0 && (
        <p className="max-w-xs text-center text-xs italic text-ink-muted">
          {log[log.length - 1].message}
        </p>
      )}

      {/* Choices */}
      {!done ? (
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Button variant="secondary" onClick={() => choosePace('rest')} className="text-left">
            😴 Rest <span className="text-xs opacity-70 ml-2">(+2 stamina, 0 progress)</span>
          </Button>
          <Button onClick={() => choosePace('walk')} className="text-left">
            🚶 Walk <span className="text-xs opacity-70 ml-2">(-1 stamina, +1 progress)</span>
          </Button>
          <Button variant="danger" onClick={() => choosePace('push')} className="text-left">
            💨 Push <span className="text-xs opacity-70 ml-2">(-3 stamina, +2 progress)</span>
          </Button>
        </div>
      ) : (
        <div className="text-center">
          <p className="font-display text-sm text-ink">
            {stamina <= 0 ? '⚡ You collapsed from exhaustion!' : '🏆 You completed the march!'}
          </p>
          <p className="text-xs text-ink-muted mt-1">
            Covered {distance} leagues across {tileIndex} tiles.
          </p>
        </div>
      )}
    </div>
  );
}
