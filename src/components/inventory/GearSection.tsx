import { useGameStore } from '@/store/useGameStore';
import { type GearDef, getGear } from '@/engine/gear';
import { getStat, type StatId } from '@/engine/stats';
import { gearCrest } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';

export function gearBonusText(g: GearDef): string {
  const parts: string[] = [];
  if (g.statBonuses) {
    for (const [s, n] of Object.entries(g.statBonuses)) parts.push(`+${n} ${getStat(s as StatId).short}`);
  }
  if (g.defense) parts.push(`+${g.defense} Def`);
  if (g.ward) parts.push(`+${g.ward} Ward`);
  if (g.xpBonus) {
    const who = g.xpBonus.tag ?? (g.xpBonus.stat ? getStat(g.xpBonus.stat).name : 'matching');
    parts.push(`+${g.xpBonus.pct}% ${who} XP`);
  }
  return parts.join(' · ');
}

export function GearSection() {
  const ownedGear = useGameStore((s) => s.ownedGear);
  const equipment = useGameStore((s) => s.equipment);
  const equipGear = useGameStore((s) => s.equipGear);
  const unequipGear = useGameStore((s) => s.unequipGear);

  if (ownedGear.length === 0) return null;

  return (
    <Panel tone="parchment" className="p-4">
      <SectionTitle className="mb-3">Gear</SectionTitle>
      <div className="space-y-2">
        {ownedGear.map((key) => {
          const g = getGear(key);
          if (!g) return null;
          const equipped = equipment[g.slot] === key;
          return (
            <div key={key} className="flex items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <Sprite spriteKey={`gear:${key}`} look={gearCrest(g.name, g.slot)} size="sm" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink">{g.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-ink-light">{g.slot}</span>
                  </div>
                  <div className="truncate text-[11px] text-ink-muted">{gearBonusText(g)}</div>
                </div>
              </div>
              <Button
                variant={equipped ? 'primary' : 'secondary'}
                onClick={() => (equipped ? unequipGear(g.slot) : equipGear(key))}
                className="shrink-0 px-3 py-1.5 text-xs"
              >
                {equipped ? 'Unequip' : 'Equip'}
              </Button>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
