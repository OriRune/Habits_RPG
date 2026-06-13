import { Coins, FlaskConical, Snowflake } from 'lucide-react';
import { useGameStore, SHOP_ITEMS } from '@/store/useGameStore';
import { getItem } from '@/engine/items';
import { isHabitDoneToday } from '@/store/selectors';

export function InventoryView() {
  const inventory = useGameStore((s) => s.inventory);
  const gold = useGameStore((s) => s.character.gold);
  const habits = useGameStore((s) => s.habits);
  const buyItem = useGameStore((s) => s.buyItem);
  const useStreakFreeze = useGameStore((s) => s.useStreakFreeze);

  const owned = Object.entries(inventory).filter(([, qty]) => qty > 0);
  const freezes = inventory['streak_freeze'] ?? 0;
  const protectable = habits.filter((h) => h.streak > 0 && !isHabitDoneToday(h));

  return (
    <div className="mx-auto max-w-2xl px-4 py-5">
      <h1 className="mb-3 text-base font-semibold text-gray-200">Inventory</h1>

      {/* Owned */}
      {owned.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">
          No items yet. Win battles and challenges, or buy from the shop below.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {owned.map(([key, qty]) => {
            const def = getItem(key);
            if (!def) return null;
            return (
              <div key={key} className="rounded-xl border border-gray-800 bg-[#11151f] p-3">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-pink-300" />
                  <span className="text-sm font-medium">{def.name}</span>
                  <span className="ml-auto text-xs text-gray-500">×{qty}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{def.description}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Protect a streak */}
      {protectable.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 flex items-center gap-1.5 text-sm font-semibold text-gray-300">
            <Snowflake className="h-4 w-4 text-cyan-300" /> Protect a Streak
            <span className="text-xs font-normal text-gray-500">({freezes} freeze{freezes === 1 ? '' : 's'})</span>
          </h2>
          <div className="space-y-2">
            {protectable.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-xl border border-gray-800 bg-[#11151f] p-3">
                <div className="text-sm">
                  {h.name} <span className="text-xs text-amber-400">🔥 {h.streak}</span>
                </div>
                <button
                  onClick={() => useStreakFreeze(h.id)}
                  disabled={freezes <= 0}
                  className="rounded-lg border border-cyan-700/50 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/10 disabled:opacity-40"
                >
                  Freeze
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Shop */}
      <h2 className="mb-2 mt-6 flex items-center gap-1.5 text-sm font-semibold text-gray-300">
        Shop <Coins className="h-4 w-4 text-amber-300" />
        <span className="text-xs font-normal text-gray-500">{gold} gold</span>
      </h2>
      <div className="space-y-2">
        {SHOP_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center justify-between rounded-xl border border-gray-800 bg-[#11151f] p-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{item.name}</div>
              <div className="truncate text-xs text-gray-500">{item.description}</div>
            </div>
            <button
              onClick={() => buyItem(item.key)}
              disabled={gold < (item.price ?? 0)}
              className="ml-3 flex shrink-0 items-center gap-1 rounded-lg bg-amber-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40"
            >
              <Coins className="h-3.5 w-3.5" /> {item.price}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
