import { useState } from 'react';
import { Coins, Hammer } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import {
  RECIPES,
  canCraft,
  reforgeCost,
  reforgeAnchorOf,
  asCraftTier,
  CRAFT_TIERS,
  MASTERWORK,
} from '@/engine/crafting';
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
import { ForgeMinigame } from './ForgeMinigame';

/** Effect-only subtitle — the row title already shows the recipe (= item) name. */
function resultLabel(kind: string, key: string): string {
  if (kind === 'gear') {
    const g = getGear(key);
    return g ? gearBonusText(g) : key;
  }
  if (kind === 'weapon') {
    const w = getWeapon(key);
    return `+${w.bonus} ${w.attackStat === 'DX' ? 'ranged' : 'melee'}`;
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

/** Best-crafted quality chip on a recipe row — name + glyph + colour (never colour-only). */
function TierChip({ tier }: { tier: number }) {
  const t = asCraftTier(tier);
  const d = CRAFT_TIERS[t];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: d.color, borderColor: d.color }}
      title={`Best crafted: ${d.name}`}
    >
      {d.name} {d.glyph}
    </span>
  );
}

export function ForgeSection() {
  const materials = useGameStore((s) => s.materials);
  const gold = useGameStore((s) => s.character.gold);
  const craft = useGameStore((s) => s.craft);
  const gearQuality = useGameStore((s) => s.gearQuality);
  const weaponQuality = useGameStore((s) => s.weaponQuality);
  const ownedGear = useGameStore((s) => s.ownedGear);
  const ownedWeapons = useGameStore((s) => s.ownedWeapons);
  // gear/weapon recipes open the interactive Forge (its result sets the quality tier);
  // item-kind recipes (none today, defensive) still craft directly with no tier.
  const [forgeTarget, setForgeTarget] = useState<{ key: string; mode: 'craft' | 'reforge' } | null>(
    null,
  );

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
          // Best tier crafted so far — an honest "you made this at X" / re-forge cue.
          const storedTier =
            recipe.result.kind === 'weapon'
              ? weaponQuality[recipe.result.key]
              : recipe.result.kind === 'gear'
                ? gearQuality[recipe.result.key]
                : undefined;
          // Re-forge (§5): only for owned gear/weapon below Masterwork. Absent tier ⇒ Normal.
          const owned =
            recipe.result.kind === 'weapon'
              ? ownedWeapons.includes(recipe.result.key)
              : recipe.result.kind === 'gear'
                ? ownedGear.includes(recipe.result.key)
                : false;
          const canReforge = owned && asCraftTier(storedTier) < MASTERWORK;
          const rfCost = reforgeCost(recipe);
          const anchorName =
            getMaterial(reforgeAnchorOf(recipe))?.name ?? reforgeAnchorOf(recipe);
          const rfAffordable =
            gold >= rfCost && (materials[reforgeAnchorOf(recipe)] ?? 0) >= 1;
          return (
            <div key={recipe.key} className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {(() => {
                    const art = resultArt(recipe.result.kind, recipe.result.key);
                    return <Sprite spriteKey={art.spriteKey} look={art.look} size="md" />;
                  })()}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink">{recipe.name}</span>
                      {storedTier !== undefined && <TierChip tier={storedTier} />}
                    </div>
                    <div className="truncate text-[11px] text-ink-muted">{resultLabel(recipe.result.kind, recipe.result.key)}</div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button
                    onClick={() =>
                      recipe.result.kind === 'item'
                        ? craft(recipe.key)
                        : setForgeTarget({ key: recipe.key, mode: 'craft' })
                    }
                    disabled={!affordable}
                    className="px-3 py-1.5 text-xs"
                  >
                    Craft
                  </Button>
                  {canReforge && (
                    <Button
                      variant="secondary"
                      onClick={() => setForgeTarget({ key: recipe.key, mode: 'reforge' })}
                      disabled={!rfAffordable}
                      className="px-3 py-1.5 text-xs"
                      title={`Re-forge: ${rfCost}g + 1 ${anchorName} — quality can only improve, never downgrade`}
                    >
                      Re-forge
                    </Button>
                  )}
                </div>
              </div>
              {canReforge && (
                <div className="mt-1 text-[10px] text-ink-muted">
                  Re-forge: {rfCost}g + 1 {anchorName} — quality can only improve, never downgrade
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                {Object.entries(recipe.materials).map(([matKey, qty]) => {
                  const have = materials[matKey] ?? 0;
                  const short = have < qty;
                  return (
                    <span key={matKey} className={cn(short ? 'text-ember' : 'text-emerald-700')}>
                      {qty}× {getMaterial(matKey)?.name ?? matKey}
                      <span className={cn(short ? 'text-ink-light' : 'text-emerald-700/70')}> ({have})</span>
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
      {forgeTarget && (
        <ForgeMinigame
          recipeKey={forgeTarget.key}
          mode={forgeTarget.mode}
          onClose={() => setForgeTarget(null)}
        />
      )}
    </Panel>
  );
}
