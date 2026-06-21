import {
  ListChecks, User, Trophy, Target, Compass, Swords, Backpack, Users,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { isBackendConfigured } from '@/net/env';

export type Tab =
  | 'habits'
  | 'challenges'
  | 'character'
  | 'skills'
  | 'explore'
  | 'battle'
  | 'inventory'
  | 'party';

interface NavItem {
  id: Tab;
  label: string;
  icon: typeof ListChecks;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'habits',     label: 'Quests',   icon: ListChecks },
  { id: 'challenges', label: 'Trials',   icon: Trophy },
  { id: 'character',  label: 'Hero',     icon: User },
  { id: 'skills',     label: 'Skills',   icon: Target },
  { id: 'explore',    label: 'Explore',  icon: Compass },
  { id: 'battle',     label: 'Battle',   icon: Swords },
  { id: 'inventory',  label: 'Crafting', icon: Backpack },
  // Party tab only when a backend is configured (multiplayer build).
  ...(isBackendConfigured() ? [{ id: 'party' as Tab, label: 'Party', icon: Users }] : []),
];

interface NavProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

// ---------------------------------------------------------------------------
// Bottom bar — mobile / narrow screens (hidden on lg+)
// ---------------------------------------------------------------------------

export function BottomBar({ active, onChange }: NavProps) {
  return (
    <nav className="texture-wood sticky bottom-0 z-10 border-t-2 border-gold-deep shadow-wood lg:hidden">
      <div className="mx-auto flex max-w-2xl">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={cn(
                'relative flex min-w-0 flex-1 flex-col items-center gap-1 px-0.5 py-2.5 font-display text-[11px] uppercase leading-none tracking-tight transition-colors',
                isActive ? 'text-gold-bright' : 'text-on-wood-dim hover:text-on-wood-hi',
              )}
            >
              {isActive && (
                <span className="absolute top-0 h-0.5 w-10 rounded-full bg-gold-bright shadow-glow" />
              )}
              <Icon
                className={cn('h-5 w-5', isActive && 'drop-shadow-[0_0_4px_rgba(232,200,96,0.6)]')}
              />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — desktop / wide screens (hidden below lg)
// ---------------------------------------------------------------------------

export function Sidebar({ active, onChange }: NavProps) {
  return (
    <nav className="hidden lg:flex lg:w-52 lg:shrink-0 lg:flex-col texture-wood border-r-2 border-gold-deep shadow-wood">
      <div className="flex flex-col py-2">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={cn(
                'relative flex items-center gap-3 border-l-2 px-4 py-3 font-display text-xs uppercase tracking-wider transition-colors',
                isActive
                  ? 'border-gold-bright bg-gold/10 text-gold-bright'
                  : 'border-transparent text-on-wood-dim hover:bg-gold/5 hover:text-on-wood-hi',
              )}
            >
              <Icon
                className={cn(
                  'h-5 w-5 shrink-0',
                  isActive && 'drop-shadow-[0_0_4px_rgba(232,200,96,0.6)]',
                )}
              />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// Keep old name as alias so any stale import still resolves during migration.
export { BottomBar as TabBar };
