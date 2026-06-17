import { useGameStore } from '@/store/useGameStore';
import { getWeapon } from '@/engine/weapons';
import { weaponCrest } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { SectionTitle } from '@/components/ui/Divider';

/** Owned weapon list with equip toggle — displayed on the Hero tab. */
export function WeaponsSection() {
  const ownedWeapons = useGameStore((s) => s.ownedWeapons);
  const equippedWeapon = useGameStore((s) => s.equippedWeapon);
  const equipWeapon = useGameStore((s) => s.equipWeapon);

  if (ownedWeapons.length === 0) return null;

  return (
    <Panel tone="parchment" className="p-4">
      <SectionTitle className="mb-3">Weapons</SectionTitle>
      <div className="space-y-2">
        {ownedWeapons.map((key) => {
          const w = getWeapon(key);
          const equipped = key === equippedWeapon;
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-2.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Sprite spriteKey={`weapon:${key}`} look={weaponCrest(w.name, w.attackStat)} size="md" />
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
  );
}
