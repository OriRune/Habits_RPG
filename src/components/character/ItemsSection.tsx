import { BookOpen } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { getItem } from '@/engine/items';
import { itemCrest } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';
import { EmptyState } from '@/components/ui/EmptyState';

/** Consumable items (potions, spellbooks, etc.) — displayed on the Hero tab. */
export function ItemsSection() {
  const inventory = useGameStore((s) => s.inventory);
  const knownSpells = useGameStore((s) => s.knownSpells);
  const learnFromSpellbook = useGameStore((s) => s.learnFromSpellbook);

  const owned = Object.entries(inventory).filter(([key, qty]) => {
    if (qty <= 0) return false;
    const def = getItem(key);
    return def !== null && def !== undefined;
  });

  if (owned.length === 0) {
    return (
      <Panel tone="parchment" className="p-4">
        <SectionTitle className="mb-3">Items</SectionTitle>
        <EmptyState message="No items yet — buy potions and spellbooks from the Merchant." />
      </Panel>
    );
  }

  return (
    <Panel tone="parchment" className="p-4">
      <SectionTitle className="mb-3">Items</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {owned.map(([key, qty]) => {
          const def = getItem(key);
          if (!def) return null;
          const isBook = def.kind === 'spellbook';
          const learned = isBook && def.effect.learnsSpell && knownSpells.includes(def.effect.learnsSpell);
          return (
            <div
              key={key}
              className="flex flex-col gap-2 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5"
            >
              <div className="flex items-center gap-3">
                <Sprite spriteKey={`item:${key}`} look={itemCrest(def.name, def.kind)} size="md" />
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
    </Panel>
  );
}
