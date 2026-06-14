import { Coins, Hammer } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { RECIPES, canCraft } from '@/engine/crafting';
import { getGear } from '@/engine/gear';
import { getWeapon } from '@/engine/weapons';
import { getItem } from '@/engine/items';
import { getMaterial } from '@/engine/materials';
import { cn } from '@/lib/cn';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { gearCrest, weaponCrest, itemCrest, type CrestLook } from '@/lib/sprites';
import { SectionTitle } from '@/components/ui/Divider';
import { gearBonusText } from './GearSection';

function resultLabel(kind: string, key: string): string {
  if (kind === 'gear') {
    const g = getGear(key);
    return g ? `${g.name} — ${gearBonusText(g)}` : key;
  }
  if (kind === 'weapon') {
    const w = getWeapon(key);
    return `${w.name} — +${w.bonus} ${w.attackStat === 'DX' ? 'ranged' : 'melee'}`;
  }
  return getItem(key)?.name ?? key;
}

/** Sprite key + crest for a recipe's result, by its kind. */
function resultArt(kind: string, key: string): { spriteKey: string; look: CrestLook } {
  if (kind === 'gear') {
    const g = getGear(key);
    return { spriteKey: `gear:${key}`, look: gearCrest(g?.name ?? key, g?.slot) };
  }
  if (kind === 'weapon') {
    const w = getWeapon(key);
    return { spriteKey: `weapon:${key}`, look: weaponCrest(w.name, w.attackStat) };
  }
  const it = getItem(key);
  return { spriteKey: `item:${key}`, look: itemCrest(it?.name ?? key, it?.kind) };
}

export function ForgeSection() {
  const materials = useGameStore((s) => s.materials);
  const gold = useGameStore((s) => s.character.gold);
  const craft = useGameStore((s) => s.craft);

  return (
    <Panel tone="parchment" className="p-4">
      <SectionTitle className="mb-3">
        <span className="inline-flex items-center gap-1.5">
          <Hammer className="h-4 w-4" /> Forge
        </span>
      </SectionTitle>
      <div className="space-y-2">
        {Object.values(RECIPES).map((recipe) => {
          const affordable = canCraft(recipe, materials, gold);
          return (
            <div key={recipe.key} className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {(() => {
                    const art = resultArt(recipe.result.kind, recipe.result.key);
                    return <Sprite spriteKey={art.spriteKey} look={art.look} size="sm" />;
                  })()}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{recipe.name}</div>
                    <div className="truncate text-[11px] text-ink-muted">{resultLabel(recipe.result.kind, recipe.result.key)}</div>
                  </div>
                </div>
                <Button onClick={() => craft(recipe.key)} disabled={!affordable} className="shrink-0 px-3 py-1.5 text-xs">
                  Craft
                </Button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                {Object.entries(recipe.materials).map(([matKey, qty]) => {
                  const have = materials[matKey] ?? 0;
                  const short = have < qty;
                  return (
                    <span key={matKey} className={cn(short ? 'text-ember' : 'text-ink-muted')}>
                      {qty}× {getMaterial(matKey)?.name ?? matKey}
                      <span className="text-ink-light"> ({have})</span>
                    </span>
                  );
                })}
                {recipe.gold ? (
                  <span className={cn('flex items-center gap-0.5', gold < recipe.gold ? 'text-ember' : 'text-gold-deep')}>
                    <Coins className="h-3 w-3" /> {recipe.gold}
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
