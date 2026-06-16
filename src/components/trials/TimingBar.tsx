// Reusable timing-bar widget used by Lockpicking and similar trials.
// Shows a track with a target zone and a bouncing cursor; `position` is 0..1.

interface TimingBarProps {
  /** Cursor position 0..1. */
  position: number;
  /** Zone start 0..1. */
  zoneStart: number;
  /** Zone width 0..1. */
  zoneWidth: number;
  /** Optional label. */
  label?: string;
  /** Whether the player already locked this pin (disables visual cursor movement). */
  locked?: boolean;
  /** Accuracy of the lock (0..1); shown as green/amber/red fill when locked. */
  lockedAccuracy?: number;
}

function accuracyColor(acc: number): string {
  if (acc >= 0.7) return 'bg-emerald-500';
  if (acc >= 0.35) return 'bg-amber-400';
  return 'bg-rose-500';
}

export function TimingBar({ position, zoneStart, zoneWidth, label, locked, lockedAccuracy }: TimingBarProps) {
  return (
    <div className="w-full">
      {label && <div className="mb-1 text-center font-display text-xs text-ink-muted">{label}</div>}
      <div className="relative h-6 w-full overflow-hidden rounded-full border border-gold-deep/40 bg-parchment-300/50">
        {/* Target zone */}
        <div
          className="absolute top-0 h-full bg-gold-bright/30 border-x border-gold-bright/60"
          style={{
            left: `${zoneStart * 100}%`,
            width: `${zoneWidth * 100}%`,
          }}
        />
        {/* Cursor */}
        {!locked && (
          <div
            className="absolute top-0 h-full w-1.5 -translate-x-1/2 rounded-full bg-ink shadow-[0_0_4px_rgba(0,0,0,0.6)] transition-none"
            style={{ left: `${position * 100}%` }}
          />
        )}
        {/* Locked state: show accuracy fill */}
        {locked && lockedAccuracy !== undefined && (
          <div
            className={`absolute left-0 top-0 h-full rounded-full opacity-70 transition-none ${accuracyColor(lockedAccuracy)}`}
            style={{ width: `${lockedAccuracy * 100}%` }}
          />
        )}
        {locked && (
          <div className="absolute inset-0 flex items-center justify-center text-xs font-display text-ink font-bold">
            {locked && lockedAccuracy !== undefined
              ? lockedAccuracy >= 0.7 ? '✓ Great' : lockedAccuracy >= 0.35 ? '✓ OK' : '✗ Missed'
              : '✓'}
          </div>
        )}
      </div>
    </div>
  );
}
