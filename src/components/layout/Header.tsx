import { Coins, Zap } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { Sprite } from '@/components/ui/Sprite';
import { brandLook } from '@/lib/sprites';

/** Slim carved-wood title bar with the wordmark and persistent currency chips. */
export function Header() {
  const gold = useGameStore((s) => s.character.gold);
  const energy = useGameStore((s) => s.character.energy);

  return (
    <header className="texture-wood sticky top-0 z-10 border-b-2 border-gold-deep shadow-wood">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sprite spriteKey="brand:logo" look={brandLook()} size="sm" label="logo" />
          <span className="font-display text-lg font-bold tracking-wide text-gold-bright">Habits RPG</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-gold-bright">
            <Coins className="h-4 w-4" />
            <span className="tabular-nums">{gold}</span>
          </span>
          <span className="flex items-center gap-1.5 text-stat-AG">
            <Zap className="h-4 w-4" />
            <span className="tabular-nums">{energy}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
