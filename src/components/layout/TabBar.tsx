import { ListChecks, User, Trophy, Backpack } from 'lucide-react';
import { cn } from '@/lib/cn';

export type Tab = 'habits' | 'character' | 'challenges' | 'inventory';

const TABS: { id: Tab; label: string; icon: typeof ListChecks }[] = [
  { id: 'habits', label: 'Habits', icon: ListChecks },
  { id: 'character', label: 'Character', icon: User },
  { id: 'challenges', label: 'Challenges', icon: Trophy },
  { id: 'inventory', label: 'Inventory', icon: Backpack },
];

interface TabBarProps {
  active: Tab;
  onChange: (tab: Tab) => void;
}

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <nav className="sticky bottom-0 z-10 border-t border-gray-800 bg-[#0b0f1a]/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              'flex flex-1 flex-col items-center gap-1 py-2.5 text-xs transition-colors',
              active === id ? 'text-indigo-400' : 'text-gray-500 hover:text-gray-300',
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}
