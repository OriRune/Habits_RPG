import { Coins, Zap, Settings, Sun, Moon } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { Sprite } from '@/components/ui/Sprite';
import { brandLook } from '@/lib/sprites';

/** Slim carved-wood title bar with the wordmark, currency chips, dark mode toggle, and settings gear. */
export function Header({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const gold = useGameStore((s) => s.character.gold);
  const energy = useGameStore((s) => s.character.energy);
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const devActive = settings.unlimitedGold || settings.unlimitedEnergy || settings.invincible;

  return (
    <header className="texture-wood sticky top-0 z-10 border-b-2 border-gold-deep shadow-wood">
      <div className="mx-auto flex max-w-full items-center justify-between px-4 py-2.5 lg:max-w-none">
        <div className="flex items-center gap-2">
          <Sprite spriteKey="brand:logo" look={brandLook()} size="sm" label="logo" />
          <span className="font-display text-lg font-bold tracking-wide text-gold-bright">Habits RPG</span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 text-gold-bright">
            <Coins className="h-4 w-4" />
            <span className="tabular-nums">{settings.unlimitedGold ? '∞' : gold}</span>
          </span>
          <span className="flex items-center gap-1.5 text-stat-AG">
            <Zap className="h-4 w-4" />
            <span className="tabular-nums">{settings.unlimitedEnergy ? '∞' : energy}</span>
          </span>
          {devActive && (
            <span className="rounded-sm border border-gold-deep/60 bg-gold/15 px-1.5 py-0.5 font-display text-[10px] font-bold uppercase tracking-wider text-gold-bright">
              Dev
            </span>
          )}
          {/* Dark / light mode toggle */}
          <button
            onClick={() => updateSettings({ darkMode: !settings.darkMode })}
            className="text-on-wood-mid transition-colors hover:text-gold-bright"
            aria-label={settings.darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={settings.darkMode}
          >
            {settings.darkMode ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={onOpenSettings}
            className="text-on-wood-mid transition-colors hover:text-gold-bright"
            aria-label="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
