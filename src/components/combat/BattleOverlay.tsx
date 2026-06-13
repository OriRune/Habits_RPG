import { Swords, Sparkles, Shield, FlaskConical } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { selectTopStats } from '@/store/selectors';
import { getItem } from '@/engine/items';
import { bossCrest, avatarCrest } from '@/lib/sprites';
import { cn } from '@/lib/cn';
import { Frame } from '@/components/ui/Frame';
import { Sprite } from '@/components/ui/Sprite';
import { Button } from '@/components/ui/Button';

function HpGauge({ label, hp, max, color }: { label: string; hp: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.round((hp / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between font-display text-xs">
        <span className="font-semibold text-parchment-200">{label}</span>
        <span className="tabular-nums text-parchment-300/80">
          {hp} / {max}
        </span>
      </div>
      <div className="h-3.5 overflow-hidden rounded-full border border-gold-deep/70 bg-wood-900">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

export function BattleOverlay() {
  const battle = useGameStore((s) => s.battle);
  const inventory = useGameStore((s) => s.inventory);
  const character = useGameStore((s) => s.character);
  const topStat = useGameStore(selectTopStats)[0];
  const battleAction = useGameStore((s) => s.battleAction);
  const dismissBattle = useGameStore((s) => s.dismissBattle);

  if (!battle) return null;
  const active = battle.status === 'active';

  const usableItems = Object.entries(inventory)
    .filter(([key, qty]) => qty > 0 && getItem(key)?.context === 'battle')
    .map(([key, qty]) => ({ key, qty, def: getItem(key)! }));

  return (
    <div className="texture-wood fixed inset-0 z-50 flex flex-col">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-4 py-5">
        {/* Boss */}
        <div className="flex items-center gap-3">
          <Frame tone="wood" className="shrink-0">
            <Sprite spriteKey={`boss:${battle.bossId}`} look={bossCrest(battle.bossName)} size="lg" />
          </Frame>
          <div className="min-w-0 flex-1">
            <h2 className="mb-2 truncate font-display text-lg font-bold text-ember-bright">{battle.bossName}</h2>
            <HpGauge label="Foe" hp={battle.bossHp} max={battle.bossMaxHp} color="#b23b2e" />
          </div>
        </div>

        {/* Battle log on an aged scroll */}
        <div className="texture-scroll my-4 flex-1 overflow-y-auto rounded-md border-2 border-gold-deep/60 p-3 text-sm shadow-gold-sm">
          {battle.log.map((line, i) => (
            <div
              key={i}
              className={cn(
                'py-0.5',
                i === battle.log.length - 1 ? 'font-semibold text-ink' : 'text-ink-muted',
              )}
            >
              {line}
            </div>
          ))}
        </div>

        {/* Player */}
        <div className="mb-4 flex items-center gap-3">
          <Frame tone="wood" className="shrink-0">
            <Sprite
              spriteKey={`avatar:${character.classId ?? 'adventurer'}`}
              look={avatarCrest(character.classId, topStat)}
              size="md"
            />
          </Frame>
          <div className="min-w-0 flex-1">
            <HpGauge label={character.classId ?? 'Adventurer'} hp={battle.playerHp} max={battle.playerMaxHp} color="#2e8a5e" />
          </div>
        </div>

        {/* Actions */}
        {active ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Button onClick={() => battleAction({ kind: 'attack' })} className="flex flex-col items-center gap-1 py-3">
                <Swords className="h-5 w-5" /> Attack
              </Button>
              <Button variant="secondary" onClick={() => battleAction({ kind: 'skill' })} className="flex flex-col items-center gap-1 py-3">
                <Sparkles className="h-5 w-5" /> Skill
              </Button>
              <Button variant="secondary" onClick={() => battleAction({ kind: 'defend' })} className="flex flex-col items-center gap-1 py-3">
                <Shield className="h-5 w-5" /> Defend
              </Button>
            </div>
            {usableItems.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {usableItems.map(({ key, qty, def }) => (
                  <Button
                    key={key}
                    variant="secondary"
                    onClick={() => battleAction({ kind: 'item', itemKey: key })}
                    className="flex items-center justify-center gap-1.5 py-2 text-xs"
                  >
                    <FlaskConical className="h-4 w-4" />
                    {def.name} ×{qty}
                  </Button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <Button
            variant={battle.status === 'won' ? 'primary' : 'secondary'}
            onClick={dismissBattle}
            className="w-full py-3"
          >
            {battle.status === 'won' ? 'Claim Victory & Ascend' : 'Retreat (keep your XP)'}
          </Button>
        )}
      </div>
    </div>
  );
}
