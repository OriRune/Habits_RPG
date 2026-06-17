import { type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface SubModeFrameProps {
  /** Label on the back button, e.g. "Back to Explore". */
  backLabel: string;
  onBack: () => void;
  children: ReactNode;
}

/**
 * Wraps a sub-view (DungeonView, MiningView, etc.) with a lightweight back-to-hub
 * control. The child view's own padding and layout are unchanged.
 */
export function SubModeFrame({ backLabel, onBack, children }: SubModeFrameProps) {
  return (
    <div>
      <div className="px-4 pt-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-on-wood-dim transition-colors hover:text-gold-bright"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="font-display text-xs uppercase tracking-wider">{backLabel}</span>
        </button>
      </div>
      {children}
    </div>
  );
}
