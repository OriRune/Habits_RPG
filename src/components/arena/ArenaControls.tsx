import { Swords } from 'lucide-react';
import type { Dir } from '@/engine/grid';
import type { ArenaControlsApi } from '@/hooks/useArenaLoop';
import { cn } from '@/lib/cn';

/** On-screen 8-direction D-pad + Attack button for touch (keyboard is W/A/S/D + diagonal holds). */
export function ArenaControls({ controls }: { controls: ArenaControlsApi }) {
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
    'flex h-11 w-11 items-center justify-center rounded-md texture-wood border border-gold-deep/70 ' +
    'font-display text-sm text-parchment-200 active:border-gold active:text-gold-bright select-none touch-none';

  const Btn = ({ dir, label }: { dir: Dir; label: string }) => (
    <button {...hold(dir)} aria-label={`Move ${dir}`} className={pad}>
      {label}
    </button>
  );

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Eight-direction pad — tap any cell to move there. */}
      <div className="grid grid-cols-3 gap-1">
        <Btn dir="upLeft" label="↖" />
        <Btn dir="up" label="↑" />
        <Btn dir="upRight" label="↗" />
        <Btn dir="left" label="←" />
        <span className="h-11 w-11" />
        <Btn dir="right" label="→" />
        <Btn dir="downLeft" label="↙" />
        <Btn dir="down" label="↓" />
        <Btn dir="downRight" label="↘" />
      </div>

      <button
        onPointerDown={(e) => {
          e.preventDefault();
          controls.act();
        }}
        aria-label="Attack"
        className={cn(
          pad,
          'h-20 w-20 flex-col gap-0.5 rounded-full text-xs uppercase tracking-wider',
        )}
      >
        <Swords className="h-7 w-7" />
        Attack
      </button>
    </div>
  );
}
