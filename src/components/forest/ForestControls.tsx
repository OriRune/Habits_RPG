import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Scissors, Zap } from 'lucide-react';
import type { Dir } from '@/engine/forest';
import type { ForestControlsApi } from '@/hooks/useForestLoop';
import { useGameStore } from '@/store/useGameStore';
import { getSpell } from '@/engine/spells';
import { cn } from '@/lib/cn';

/** On-screen D-pad + Act button for touch (keyboard is the desktop path). */
export function ForestControls({ controls }: { controls: ForestControlsApi }) {
  const forest = useGameStore((s) => s.forest);
  const hold = (dir: Dir) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      controls.press(dir);
    },
    onPointerUp: () => controls.release(dir),
    onPointerLeave: () => controls.release(dir),
    onPointerCancel: () => controls.release(dir),
  });

  const pad =
    'flex items-center justify-center rounded-md texture-wood border border-gold-deep/70 ' +
    'text-parchment-200 active:border-gold active:text-gold-bright select-none touch-none';

  const Btn = ({ dir, icon: Icon }: { dir: Dir; icon: typeof ChevronUp }) => (
    <button {...hold(dir)} aria-label={`Move ${dir}`} className={cn(pad, 'h-11 w-11')}>
      <Icon className="h-5 w-5" />
    </button>
  );
  const blank = <span className="h-11 w-11" />;

  const spells = forest?.knownSpells.slice(0, 4) ?? [];
  const mp = forest?.mp ?? 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="grid grid-cols-3 gap-1">
          {blank}
          <Btn dir="up" icon={ChevronUp} />
          {blank}
          <Btn dir="left" icon={ChevronLeft} />
          {blank}
          <Btn dir="right" icon={ChevronRight} />
          {blank}
          <Btn dir="down" icon={ChevronDown} />
          {blank}
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              controls.swing();
            }}
            onPointerUp={() => controls.releaseCharge()}
            onPointerLeave={() => controls.releaseCharge()}
            onPointerCancel={() => controls.releaseCharge()}
            aria-label="Slash / gather"
            className={cn(
              pad,
              'h-20 w-20 flex-col gap-0.5 rounded-full font-display text-xs uppercase tracking-wider',
            )}
          >
            <Scissors className="h-7 w-7" />
            Act
          </button>
          <button
            onPointerDown={(e) => {
              e.preventDefault();
              controls.dash();
            }}
            aria-label="Dash"
            className={cn(
              pad,
              'h-10 w-20 flex-row gap-1 rounded-full font-display text-xs uppercase tracking-wider',
            )}
          >
            <Zap className="h-4 w-4" />
            Dash
          </button>
        </div>
      </div>

      {/* Touch spell buttons — only shown when the player has spells */}
      {spells.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="font-display text-[10px] uppercase tracking-wider text-parchment-300/50 w-10 shrink-0">
            Spells
          </span>
          {spells.map((key, i) => {
            const sp = getSpell(key);
            if (!sp) return null;
            const canCast = mp >= sp.mpCost && forest?.status === 'active';
            return (
              <button
                key={key}
                onPointerDown={(e) => {
                  e.preventDefault();
                  controls.castSpell(key);
                }}
                aria-label={`Cast ${sp.name}`}
                disabled={!canCast}
                className={cn(
                  'flex flex-col items-center rounded border px-2 py-1 font-display text-[10px] select-none touch-none',
                  canCast
                    ? 'border-violet-500/60 bg-violet-900/40 text-violet-200 active:bg-violet-700/50'
                    : 'border-wood-700 bg-wood-900/50 text-parchment-300/30 opacity-50',
                )}
              >
                <span className="text-[9px] text-parchment-300/50">[{i + 1}]</span>
                <span className="truncate max-w-[52px]">{sp.name}</span>
                <span className="text-[9px] text-violet-400">{sp.mpCost}mp</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
