// MashMeter — a vertical power meter that sweeps up while held, back down when released.
// Used by the Armory Break trial.

import { SWEET_ZONE_START, SWEET_ZONE_WIDTH } from '@/engine/trials/armoryBreak';

interface MashMeterProps {
  /** Current needle position 0..1. */
  power: number;
  /** Whether a lock was already taken (frozen state). */
  locked?: boolean;
  /** Accuracy of the lock when frozen. */
  lockedAccuracy?: number;
  /** Label shown above the meter. */
  label?: string;
}

export function MashMeter({ power, locked, lockedAccuracy, label }: MashMeterProps) {
  const inZone = power >= SWEET_ZONE_START;
  const displayPower = locked ? (lockedAccuracy !== undefined ? lockedAccuracy : power) : power;

  return (
    <div className="flex flex-col items-center gap-1">
      {label && <div className="font-display text-xs text-ink-muted">{label}</div>}
      <div className="relative h-36 w-10 overflow-hidden rounded-full border border-gold-deep/40 bg-parchment-300/50">
        {/* Sweet zone */}
        <div
          className="absolute w-full bg-gold-bright/30 border-y border-gold-bright/60"
          style={{
            bottom: `${SWEET_ZONE_START * 100}%`,
            height: `${SWEET_ZONE_WIDTH * 100}%`,
          }}
        />
        {/* Power fill */}
        <div
          className={`absolute bottom-0 w-full transition-none ${
            locked
              ? lockedAccuracy !== undefined && lockedAccuracy >= 0.7
                ? 'bg-emerald-500/70'
                : lockedAccuracy !== undefined && lockedAccuracy >= 0.35
                  ? 'bg-amber-400/70'
                  : 'bg-rose-500/70'
              : inZone
                ? 'bg-gold-bright/60'
                : 'bg-parchment-400/60'
          }`}
          style={{ height: `${displayPower * 100}%` }}
        />
        {/* Needle line */}
        {!locked && (
          <div
            className={`absolute w-full h-0.5 ${inZone ? 'bg-gold-bright' : 'bg-ink/50'} transition-none`}
            style={{ bottom: `${power * 100}%` }}
          />
        )}
      </div>
      {locked && (
        <div className="font-display text-xs font-bold text-ink">
          {lockedAccuracy !== undefined
            ? lockedAccuracy >= 0.7
              ? '✓ Great'
              : lockedAccuracy >= 0.35
                ? '✓ OK'
                : '✗ Missed'
            : '✓'}
        </div>
      )}
    </div>
  );
}
