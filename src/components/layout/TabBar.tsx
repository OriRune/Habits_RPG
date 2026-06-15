import { ListChecks, User, Trophy, DoorOpen, Pickaxe, Trees, Backpack } from 'lucide-react';
import { cn } from '@/lib/cn';

export type Tab = 'habits' | 'character' | 'challenges' | 'dungeon' | 'mine' | 'forest' | 'inventory';

const TABS: { id: Tab; label: string; icon: typeof ListChecks }[] = [
  { id: 'habits', label: 'Quests', icon: ListChecks },
  { id: 'character', label: 'Hero', icon: User },
  { id: 'challenges', label: 'Trials', icon: Trophy },
  { id: 'dungeon', label: 'Delve', icon: DoorOpen },
  { id: 'mine', label: 'Mine', icon: Pickaxe },
  { id: 'forest', label: 'Forest', icon: Trees },
  { id: 'inventory', label: 'Satchel', icon: Backpack },
];

interface TabBarProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="texture-wood sticky bottom-0 z-10 border-t-2 border-gold-deep shadow-wood">
      <div className="mx-auto flex max-w-2xl">
        {TABS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={cn(
                'relative flex flex-1 flex-col items-center gap-1 py-2.5 font-display text-[11px] uppercase tracking-wider transition-colors',
                isActive ? 'text-gold-bright' : 'text-parchment-300/60 hover:text-parchment-200',
              )}
            >
              {isActive && (
                <span className="absolute top-0 h-0.5 w-10 rounded-full bg-gold-bright shadow-glow" />
              )}
              <Icon className={cn('h-5 w-5', isActive && 'drop-shadow-[0_0_4px_rgba(232,200,96,0.6)]')} />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
