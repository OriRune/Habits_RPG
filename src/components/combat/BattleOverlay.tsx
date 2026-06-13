import { Swords, Sparkles, Shield, FlaskConical } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { getItem } from '@/engine/items';
import { cn } from '@/lib/cn';

function HpBar({ label, hp, max, color }: { label: string; hp: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.round((hp / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="font-medium text-gray-200">{label}</span>
        <span className="tabular-nums text-gray-400">
          {hp} / {max}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-gray-800">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function BattleOverlay() {
  const battle = useGameStore((s) => s.battle);
  const inventory = useGameStore((s) => s.inventory);
  const battleAction = useGameStore((s) => s.battleAction);
  const dismissBattle = useGameStore((s) => s.dismissBattle);

  if (!battle) return null;
  const active = battle.status === 'active';

  // Battle-usable items the player owns.
  const usableItems = Object.entries(inventory)
    .filter(([key, qty]) => qty > 0 && getItem(key)?.context === 'battle')
    .map(([key, qty]) => ({ key, qty, def: getItem(key)! }));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0f1a]">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-4 py-5">
        <div className="flex items-center gap-2 text-amber-300">
          <Swords className="h-5 w-5" />
          <h2 className="text-lg font-bold">{battle.bossName}</h2>
        </div>

        <div className="mt-5 space-y-4">
          <HpBar label={battle.bossName} hp={battle.bossHp} max={battle.bossMaxHp} color="#ef4444" />
          <HpBar label="You" hp={battle.playerHp} max={battle.playerMaxHp} color="#10b981" />
        </div>

        {/* Battle log */}
        <div className="mt-4 flex-1 overflow-y-auto rounded-xl border border-gray-800 bg-black/30 p-3 text-sm">
          {battle.log.map((line, i) => (
            <div
              key={i}
              className={cn(
                'py-0.5',
                i === battle.log.length - 1 ? 'font-medium text-gray-100' : 'text-gray-500',
              )}
            >
              {line}
            </div>
          ))}
        </div>

        {/* Actions */}
        {active ? (
          <div className="mt-4 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <ActionButton icon={Swords} label="Attack" onClick={() => battleAction({ kind: 'attack' })} />
              <ActionButton icon={Sparkles} label="Skill" onClick={() => battleAction({ kind: 'skill' })} />
              <ActionButton icon={Shield} label="Defend" onClick={() => battleAction({ kind: 'defend' })} />
            </div>
            {usableItems.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {usableItems.map(({ key, qty, def }) => (
                  <button
                    key={key}
                    onClick={() => battleAction({ kind: 'item', itemKey: key })}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-700 bg-gray-900 py-2 text-xs hover:border-indigo-500"
                  >
                    <FlaskConical className="h-4 w-4 text-pink-300" />
                    {def.name} ×{qty}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={dismissBattle}
            className={cn(
              'mt-4 w-full rounded-lg py-3 text-sm font-semibold',
              battle.status === 'won' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-gray-700 hover:bg-gray-600',
            )}
          >
            {battle.status === 'won' ? 'Claim Victory & Level Up' : 'Retreat (keep your XP)'}
          </button>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Swords;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 py-3 text-xs font-medium hover:border-indigo-500 hover:bg-indigo-500/5"
    >
      <Icon className="h-5 w-5 text-indigo-300" />
      {label}
    </button>
  );
}
