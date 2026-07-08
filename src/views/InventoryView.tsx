import { Coins, Snowflake, HeartPulse } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { useGameStore, SHOP_ITEMS } from '@/store/useGameStore';
import { getMaterial } from '@/engine/materials';
import { WEAPONS } from '@/engine/weapons';
import { GEAR } from '@/engine/gear';
import { currentStreak, mostRecentMissedScheduledDay } from '@/engine/habits';
import { toISODate } from '@/engine/date';
import { isHabitDoneToday } from '@/store/selectors';
import { itemCrest, materialCrest, weaponCrest, gearCrest } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';
import { ForgeSection } from '@/components/inventory/ForgeSection';
import { gearBonusText } from '@/components/inventory/GearSection';

export function InventoryView() {
  const materials = useGameStore((s) => s.materials);
  const gold = useGameStore((s) => s.character.gold);
  const habits = useGameStore((s) => s.habits);
  const inventory = useGameStore((s) => s.inventory);
  const ownedWeapons = useGameStore((s) => s.ownedWeapons);
  const ownedGear = useGameStore((s) => s.ownedGear);
  const buyItem = useGameStore((s) => s.buyItem);
  const buyWeapon = useGameStore((s) => s.buyWeapon);
  const buyGear = useGameStore((s) => s.buyGear);
  const useStreakFreeze = useGameStore((s) => s.useStreakFreeze);
  const useRecoveryElixir = useGameStore((s) => s.useRecoveryElixir);

  const today = toISODate();
  const ownedMaterials = Object.entries(materials).filter(([, qty]) => qty > 0);
  const freezes = inventory['streak_freeze'] ?? 0;
  const elixirs = inventory['recovery_elixir'] ?? 0;
  const protectable = habits.filter((h) => currentStreak(h, today) > 0 && !isHabitDoneToday(h));
  const repairable = habits.filter((h) => mostRecentMissedScheduledDay(h, today) !== undefined);
  const weaponsForSale = Object.values(WEAPONS).filter(
    (w) => w.price !== undefined && !ownedWeapons.includes(w.key),
  );
  const gearForSale = Object.values(GEAR).filter(
    (g) => g.price !== undefined && !ownedGear.includes(g.key),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">Crafting</SectionTitle>

      {/* Materials */}
      <Panel tone="parchment" className="p-4">
        <SectionTitle className="mb-3">Materials</SectionTitle>
        {ownedMaterials.length === 0 ? (
          <EmptyState message="No materials yet — gather ore in the Deep Mine and plants in the Wild Forest." />
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {ownedMaterials.map(([key, qty]) => (
              <div key={key} className="flex flex-col items-center gap-1 text-center">
                <Sprite spriteKey={`material:${key}`} look={materialCrest(key)} size="lg" />
                <div className="text-xs font-semibold text-ink">{getMaterial(key)?.name ?? key}</div>
                <div className="text-[11px] text-ink-light">×{qty}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <ForgeSection />

      {/* Protect a Streak */}
      {protectable.length > 0 && (
        <Panel tone="parchment" className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <SectionTitle className="flex-1">Protect a Streak</SectionTitle>
            <span className="flex shrink-0 items-center gap-1 text-xs text-ink-muted">
              <Snowflake className="h-4 w-4 text-stat-AG" /> {freezes}
            </span>
          </div>
          <div className="space-y-2">
            {protectable.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5"
              >
                <div className="text-sm text-ink">
                  {h.name} <span className="text-xs text-ember">🔥 {currentStreak(h, today)}</span>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => useStreakFreeze(h.id)}
                  disabled={freezes <= 0}
                  className="px-3 py-1.5"
                >
                  Freeze
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Repair a Missed Day */}
      {repairable.length > 0 && (
        <Panel tone="parchment" className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <SectionTitle className="flex-1">Repair a Missed Day</SectionTitle>
            <span className="flex shrink-0 items-center gap-1 text-xs text-ink-muted">
              <HeartPulse className="h-4 w-4 text-stat-EN" /> {elixirs}
            </span>
          </div>
          <div className="space-y-2">
            {repairable.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5"
              >
                <div className="text-sm text-ink">
                  {h.name}{' '}
                  <span className="text-xs text-ink-muted">
                    missed {mostRecentMissedScheduledDay(h, today)}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => useRecoveryElixir(h.id)}
                  disabled={elixirs <= 0}
                  className="px-3 py-1.5"
                >
                  Repair
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Merchant */}
      <div className="flex items-center gap-2">
        <SectionTitle tone="wood" className="flex-1">Merchant</SectionTitle>
        <span className="flex shrink-0 items-center gap-1 text-sm text-gold-bright">
          <Coins className="h-4 w-4" /> {gold}
        </span>
      </div>
      <Panel tone="parchment" className="space-y-2 p-4">
        {weaponsForSale.map((w) => (
          <div
            key={w.key}
            className="flex items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Sprite spriteKey={`weapon:${w.key}`} look={weaponCrest(w.name, w.attackStat)} size="md" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{w.name}</div>
                <div className="truncate text-[11px] text-ink-muted">{w.description}</div>
              </div>
            </div>
            <Button
              onClick={() => buyWeapon(w.key)}
              disabled={gold < (w.price ?? 0)}
              className="ml-2 flex shrink-0 items-center gap-1 px-3 py-1.5"
            >
              <Coins className="h-3.5 w-3.5" /> {w.price}
            </Button>
          </div>
        ))}
        {gearForSale.map((g) => (
          <div
            key={g.key}
            className="flex items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Sprite spriteKey={`gear:${g.key}`} look={gearCrest(g.name, g.slot)} size="md" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{g.name}</div>
                <div className="truncate text-[11px] text-ink-muted">{gearBonusText(g)}</div>
              </div>
            </div>
            <Button
              onClick={() => buyGear(g.key)}
              disabled={gold < (g.price ?? 0)}
              className="ml-2 flex shrink-0 items-center gap-1 px-3 py-1.5"
            >
              <Coins className="h-3.5 w-3.5" /> {g.price}
            </Button>
          </div>
        ))}
        {SHOP_ITEMS.map((item) => (
          <div
            key={item.key}
            className="flex items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Sprite
                spriteKey={`item:${item.key}`}
                look={itemCrest(item.name, item.kind)}
                size="md"
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{item.name}</div>
                <div className="truncate text-[11px] text-ink-muted">{item.description}</div>
              </div>
            </div>
            <Button
              onClick={() => buyItem(item.key)}
              disabled={gold < (item.price ?? 0)}
              className="ml-2 flex shrink-0 items-center gap-1 px-3 py-1.5"
            >
              <Coins className="h-3.5 w-3.5" /> {item.price}
            </Button>
          </div>
        ))}
      </Panel>
    </div>
  );
}
