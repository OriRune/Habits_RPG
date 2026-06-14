import { Coins, Snowflake, Sword, BookOpen } from 'lucide-react';
import { useGameStore, SHOP_ITEMS } from '@/store/useGameStore';
import { getItem } from '@/engine/items';
import { getMaterial } from '@/engine/materials';
import { WEAPONS, getWeapon } from '@/engine/weapons';
import { isHabitDoneToday } from '@/store/selectors';
import { itemCrest, materialCrest } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';
import { GearSection } from '@/components/inventory/GearSection';
import { ForgeSection } from '@/components/inventory/ForgeSection';

export function InventoryView() {
  const inventory = useGameStore((s) => s.inventory);
  const materials = useGameStore((s) => s.materials);
  const gold = useGameStore((s) => s.character.gold);
  const habits = useGameStore((s) => s.habits);
  const ownedWeapons = useGameStore((s) => s.ownedWeapons);
  const equippedWeapon = useGameStore((s) => s.equippedWeapon);
  const knownSpells = useGameStore((s) => s.knownSpells);
  const buyItem = useGameStore((s) => s.buyItem);
  const buyWeapon = useGameStore((s) => s.buyWeapon);
  const equipWeapon = useGameStore((s) => s.equipWeapon);
  const learnFromSpellbook = useGameStore((s) => s.learnFromSpellbook);
  const useStreakFreeze = useGameStore((s) => s.useStreakFreeze);

  const owned = Object.entries(inventory).filter(([, qty]) => qty > 0);
  const ownedMaterials = Object.entries(materials).filter(([, qty]) => qty > 0);
  const freezes = inventory['streak_freeze'] ?? 0;
  const protectable = habits.filter((h) => h.streak > 0 && !isHabitDoneToday(h));
  const weaponsForSale = Object.values(WEAPONS).filter((w) => w.price !== undefined && !ownedWeapons.includes(w.key));

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">Satchel</SectionTitle>

      <Panel tone="parchment" className="p-4">
        {owned.length === 0 ? (
          <div className="rounded-md border border-dashed border-ink-light/50 p-6 text-center text-sm text-ink-muted">
            Your satchel is empty. Win trials and challenges, or visit the merchant below.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {owned.map(([key, qty]) => {
              const def = getItem(key);
              if (!def) return null;
              const isBook = def.kind === 'spellbook';
              const learned = isBook && def.effect.learnsSpell && knownSpells.includes(def.effect.learnsSpell);
              return (
                <div key={key} className="flex flex-col gap-2 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
                  <div className="flex items-center gap-3">
                    <Sprite spriteKey={`item:${key}`} look={itemCrest(def.name, def.kind)} size="sm" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">{def.name}</span>
                        <span className="text-xs text-ink-light">×{qty}</span>
                      </div>
                      <p className="text-[11px] leading-tight text-ink-muted">{def.description}</p>
                    </div>
                  </div>
                  {isBook && (
                    <Button
                      variant="secondary"
                      onClick={() => learnFromSpellbook(key)}
                      disabled={!!learned}
                      className="flex items-center justify-center gap-1 py-1 text-xs"
                    >
                      <BookOpen className="h-3.5 w-3.5" /> {learned ? 'Learned' : 'Learn'}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Weapons */}
      <Panel tone="parchment" className="p-4">
        <SectionTitle className="mb-3">Weapons</SectionTitle>
        <div className="space-y-2">
          {ownedWeapons.map((key) => {
            const w = getWeapon(key);
            const equipped = key === equippedWeapon;
            return (
              <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <Sword className="h-4 w-4 shrink-0 text-ink-muted" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">{w.name}</div>
                    <div className="truncate text-[11px] text-ink-muted">
                      {w.attackStat === 'DX' ? 'Dexterity' : 'Strength'} · +{w.bonus}
                    </div>
                  </div>
                </div>
                <Button
                  variant={equipped ? 'primary' : 'secondary'}
                  onClick={() => equipWeapon(key)}
                  disabled={equipped}
                  className="shrink-0 px-3 py-1.5 text-xs"
                >
                  {equipped ? 'Equipped' : 'Equip'}
                </Button>
              </div>
            );
          })}
        </div>
      </Panel>

      <GearSection />

      {ownedMaterials.length > 0 && (
        <Panel tone="parchment" className="p-4">
          <SectionTitle className="mb-3">Materials</SectionTitle>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {ownedMaterials.map(([key, qty]) => (
              <div key={key} className="flex flex-col items-center gap-1 text-center">
                <Sprite spriteKey={`material:${key}`} look={materialCrest(key)} size="md" />
                <div className="text-xs font-semibold text-ink">{getMaterial(key)?.name ?? key}</div>
                <div className="text-[11px] text-ink-light">×{qty}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <ForgeSection />

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
              <div key={h.id} className="flex items-center justify-between rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
                <div className="text-sm text-ink">
                  {h.name} <span className="text-xs text-ember">🔥 {h.streak}</span>
                </div>
                <Button variant="secondary" onClick={() => useStreakFreeze(h.id)} disabled={freezes <= 0} className="px-3 py-1.5">
                  Freeze
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="flex items-center gap-2">
        <SectionTitle tone="wood" className="flex-1">Merchant</SectionTitle>
        <span className="flex shrink-0 items-center gap-1 text-sm text-gold-bright">
          <Coins className="h-4 w-4" /> {gold}
        </span>
      </div>
      <Panel tone="parchment" className="space-y-2 p-4">
        {weaponsForSale.map((w) => (
          <div key={w.key} className="flex items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <Sword className="h-5 w-5 shrink-0 text-ink-muted" />
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
        {SHOP_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <Sprite spriteKey={`item:${item.key}`} look={itemCrest(item.name, item.kind)} size="sm" />
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
