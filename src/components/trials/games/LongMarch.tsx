// Long March trial — EN.
// Navigate MARCH_TILES terrain tiles by choosing a pace for each tile.

import { useState } from 'react';
import { play as sfxPlay } from '@/lib/sfx';
import {
  generateTerrain,
  marchStep,
  marchScore,
  marchStartStamina,
  marchStaminaCap,
  MARCH_TILES,
  PACE_COSTS,
  type MarchPace,
  type TerrainTile,
} from '@/engine/trials/longMarch';

interface LongMarchProps {
  enLevel: number;
  onFinish: (score01: number) => void;
}

export function LongMarch({ enLevel, onFinish }: LongMarchProps) {
  const startStamina = marchStartStamina(enLevel);
  const [terrain] = useState<TerrainTile[]>(() => generateTerrain(Math.random));
  const [tileIndex, setTileIndex] = useState(0);
  const [stamina, setStamina] = useState(startStamina);
  const [distance, setDistance] = useState(0);
  const [lastMessage, setLastMessage] = useState('');
  const [done, setDone] = useState(false);

  const choosePace = (pace: MarchPace) => {
    if (done) return;
    const tile = terrain[tileIndex];
    const result = marchStep(tile, pace);
    const newSta = Math.min(marchStaminaCap(startStamina), Math.max(0, stamina + result.staminaDelta));
    const newDist = Math.max(0, distance + result.distanceDelta);
    const newTile = tileIndex + 1;
    const exhausted = newSta <= 0;
    const finished = exhausted || newTile >= MARCH_TILES;

    setStamina(newSta);
    setDistance(newDist);
    setLastMessage(result.message);
    setTileIndex(newTile);

    if (finished) {
      setDone(true);
      onFinish(marchScore(newTile, newDist));
    }

    // Fire one SFX cue per step. End-state and spring take priority over pace.
    if (finished && exhausted)       sfxPlay('marchCollapse');
    else if (finished)               sfxPlay('marchComplete');
    else if (tile.kind === 'spring') sfxPlay('marchSpring');
    else if (pace === 'rest')        sfxPlay('marchRest');
    else if (pace === 'walk')        sfxPlay('marchWalk');
    else                             sfxPlay('marchPush');
  };

  const tile = terrain[tileIndex];
  const staminaPct = (stamina / startStamina) * 100;
  const isCritical = staminaPct <= 25;

  return (
    <div className="flex flex-col items-center gap-4 px-2">
      {/* Progress bar */}
      <div className="w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs font-display text-ink-muted">
          <span>Progress: {tileIndex} / {MARCH_TILES}</span>
          <span>{distance} leagues</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/50">
          <div
            className="h-full bg-gold-bright/70 transition-all duration-300"
            style={{ width: `${(tileIndex / MARCH_TILES) * 100}%` }}
          />
        </div>
      </div>

      {/* Terrain strip — completed tiles + current + next tile revealed; future = dots */}
      <div className="w-full max-w-xs flex gap-0.5 overflow-x-auto">
        {terrain.map((t, i) => {
          const isCompleted = i < tileIndex;
          const isCurrent = i === tileIndex && !done;
          const isNext = i === tileIndex + 1 && !done;
          return (
            <div
              key={i}
              className={`flex-1 flex items-center justify-center h-5 rounded-sm text-[10px] leading-none ${
                isCurrent
                  ? 'ring-1 ring-gold-bright/70 bg-gold-bright/10'
                  : ''
              }`}
            >
              {isCompleted ? (
                <span className="opacity-55">{t.emoji}</span>
              ) : isCurrent ? (
                <span>{t.emoji}</span>
              ) : isNext ? (
                <span className="opacity-40">{t.emoji}</span>
              ) : (
                <span className="text-ink-muted/40">·</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Stamina bar */}
      <div className="w-full max-w-xs">
        <div className="mb-1 flex justify-between text-xs font-display text-ink-muted">
          <span>Stamina</span>
          <span>{stamina} / {startStamina}</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/50">
          <div
            className={`h-full transition-all duration-300 ${
              staminaPct > 50
                ? 'bg-emerald-500/70'
                : staminaPct > 25
                  ? 'bg-amber-400/70'
                  : `bg-rose-500/70 ${isCritical ? 'animate-pulse' : ''}`
            }`}
            style={{ width: `${staminaPct}%` }}
          />
        </div>
      </div>

      {/* Current tile (key forces fade-in on each new tile) */}
      {!done && tile && (
        <div
          key={tileIndex}
          className="w-full max-w-xs rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3 text-center animate-fade-in"
        >
          <div className="text-2xl">{tile.emoji}</div>
          <div className="font-display text-sm font-bold text-ink">{tile.label}</div>
        </div>
      )}

      {/* Narrative message */}
      {lastMessage && (
        <p className="max-w-xs text-center text-xs italic text-ink-muted">{lastMessage}</p>
      )}

      {/* Pace buttons */}
      {!done && (
        <div className="flex w-full max-w-xs flex-col gap-2">
          {(['rest', 'walk', 'push'] as MarchPace[]).map((pace) => {
            const { sta, dist } = PACE_COSTS[pace][tile.kind];
            const staSign = sta > 0 ? `+${sta}` : `${sta}`;
            const distStr = dist === 0 ? '0 dist' : `+${dist} dist`;
            const label = pace === 'rest' ? '😴 Rest' : pace === 'walk' ? '🚶 Walk' : '💨 Push';
            const hint = `(${staSign} sta, ${distStr})`;

            return (
              <button
                key={pace}
                onClick={() => choosePace(pace)}
                className={`w-full rounded-md px-4 py-2 font-display text-sm font-semibold tracking-wide transition-colors text-left flex items-center justify-between disabled:cursor-not-allowed disabled:opacity-40 ${
                  pace === 'rest'
                    ? 'bg-emerald-700/80 text-parchment-100 border border-emerald-600 hover:bg-emerald-600/80'
                    : pace === 'walk'
                      ? 'bg-gradient-to-b from-gold-bright to-gold-deep text-wood-900 border border-gold-deep hover:from-gold hover:to-gold-deep shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]'
                      : 'bg-gradient-to-b from-amber-500 to-amber-600 text-parchment-100 border border-amber-600 hover:from-amber-400 hover:to-amber-500'
                }`}
              >
                <span>{label}</span>
                <span className="text-xs opacity-70">{hint}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
