import { useState } from 'react';
import { X } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { getWeapon } from '@/engine/weapons';
import { getGear, aggregateGear, type GearSlot } from '@/engine/gear';
import { getStat, type StatId } from '@/engine/stats';
import { CRAFT_TIERS, NORMAL, asCraftTier, scaleGearDef, scaleWeaponDef, type CraftTier } from '@/engine/crafting';
import { tierPrefix } from '@/components/inventory/GearSection';
import { Sprite } from '@/components/ui/Sprite';
import { weaponCrest, gearCrest } from '@/lib/sprites';
import { CharacterSilhouette } from './CharacterSilhouette';

type SlotKey = 'weapon' | GearSlot;
const GEAR_SLOTS: GearSlot[] = ['armor', 'trinket', 'tool'];
const SLOT_LABEL: Record<SlotKey, string> = {
  weapon: 'Weapon',
  armor: 'Armor',
  trinket: 'Trinket',
  tool: 'Tool',
};

/** One slot on the doll — shows the equipped item's icon, or a dashed empty frame. */
function Slot({
  label,
  spriteKey,
  look,
  name,
  tier,
  onClick,
}: {
  label: string;
  spriteKey?: string;
  look?: { glyph: string; color: string };
  name?: string;
  /** Quality tier of the equipped item; a badge shows for non-Normal tiers. */
  tier?: CraftTier;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative flex w-20 flex-col items-center gap-1 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-1.5 text-center transition-colors hover:border-gold-deep/70 hover:bg-parchment-300/50"
    >
      {tier !== undefined && tier !== NORMAL && (
        <span
          className="absolute right-1 top-1 text-[12px] leading-none"
          style={{ color: CRAFT_TIERS[tier].color }}
          title={CRAFT_TIERS[tier].name}
          aria-label={CRAFT_TIERS[tier].name}
        >
          {CRAFT_TIERS[tier].glyph}
        </span>
      )}
      {look && spriteKey ? (
        <Sprite spriteKey={spriteKey} look={look} size="md" />
      ) : (
        <span className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-ink-light/40 text-[10px] text-ink-light">
          empty
        </span>
      )}
      <span className="font-display text-[10px] uppercase tracking-wider text-ink-muted">{label}</span>
      <span className="line-clamp-1 text-[11px] text-ink">{name ?? '—'}</span>
    </button>
  );
}

/** A paper-doll: a character silhouette ringed by equipment slots, with a backpack of spares. */
export function PaperDoll() {
  const equippedWeapon = useGameStore((s) => s.equippedWeapon);
  const equipment = useGameStore((s) => s.equipment);
  const ownedWeapons = useGameStore((s) => s.ownedWeapons);
  const ownedGear = useGameStore((s) => s.ownedGear);
  const gearQuality = useGameStore((s) => s.gearQuality);
  const weaponQuality = useGameStore((s) => s.weaponQuality);
  const equipWeapon = useGameStore((s) => s.equipWeapon);
  const equipGear = useGameStore((s) => s.equipGear);
  const unequipGear = useGameStore((s) => s.unequipGear);

  const [picking, setPicking] = useState<SlotKey | null>(null);

  const weapon = getWeapon(equippedWeapon);
  const weaponTier = asCraftTier(weaponQuality[equippedWeapon]);

  // Aggregated bonuses across the equipped gear (weapon excluded — its bonus is its Attack).
  // Scale each def by its quality tier so the shown totals match what combat (fighterFor) fields.
  const agg = aggregateGear(
    GEAR_SLOTS.map((sl) => {
      const k = equipment[sl];
      if (!k) return undefined;
      const def = getGear(k);
      return def ? scaleGearDef(def, asCraftTier(gearQuality[k])) : undefined;
    }),
  );
  const bonusParts: string[] = [];
  for (const [s, n] of Object.entries(agg.statBonuses)) bonusParts.push(`+${n} ${getStat(s as StatId).short}`);
  if (agg.defense) bonusParts.push(`+${agg.defense} Def`);
  if (agg.ward) bonusParts.push(`+${agg.ward} Ward`);
  for (const xb of agg.xpBonuses) bonusParts.push(`+${xb.pct}% ${xb.tag ?? (xb.stat ? getStat(xb.stat).short : '')} XP`);

  // Spares not currently equipped, for the backpack strip.
  const spareWeapons = ownedWeapons.filter((k) => k !== equippedWeapon);
  const equippedGearKeys = GEAR_SLOTS.map((sl) => equipment[sl]).filter(Boolean) as string[];
  const spareGear = ownedGear.filter((k) => !equippedGearKeys.includes(k));

  const gearSlot = (sl: GearSlot) => {
    const key = equipment[sl];
    const def = key ? getGear(key) : undefined;
    const tier = key ? asCraftTier(gearQuality[key]) : undefined;
    return (
      <Slot
        key={sl}
        label={SLOT_LABEL[sl]}
        spriteKey={def ? `gear:${def.key}` : undefined}
        look={def ? gearCrest(def.name, def.slot) : undefined}
        name={def ? tierPrefix(def.name, gearQuality[key!]) : undefined}
        tier={tier}
        onClick={() => setPicking(sl)}
      />
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-2">
        {/* Left: weapon */}
        <div className="flex flex-col gap-2">
          <Slot
            label={SLOT_LABEL.weapon}
            spriteKey={`weapon:${equippedWeapon}`}
            look={weaponCrest(weapon.name, weapon.attackStat)}
            name={tierPrefix(weapon.name, weaponQuality[equippedWeapon])}
            tier={weaponTier}
            onClick={() => setPicking('weapon')}
          />
        </div>
        {/* Center: figure */}
        <CharacterSilhouette className="h-40 w-24 shrink-0" />
        {/* Right: armor / trinket / tool */}
        <div className="flex flex-col gap-2">{GEAR_SLOTS.map(gearSlot)}</div>
      </div>

      {bonusParts.length > 0 && (
        <div className="rounded bg-parchment-300/50 px-2 py-1 text-center text-[11px] text-ink">
          Bonuses: {bonusParts.join(' · ')}
        </div>
      )}

      {/* Backpack — spares you can tap to equip. */}
      {(spareWeapons.length > 0 || spareGear.length > 0) && (
        <div className="space-y-1.5">
          <div className="font-display text-[11px] uppercase tracking-wider text-ink-muted">Backpack</div>
          <div className="flex flex-wrap gap-2">
            {spareWeapons.map((k) => {
              const w = getWeapon(k);
              return (
                <button key={`w:${k}`} onClick={() => equipWeapon(k)} title={`Equip ${tierPrefix(w.name, weaponQuality[k])}`}>
                  <Sprite spriteKey={`weapon:${k}`} look={weaponCrest(w.name, w.attackStat)} size="md" />
                </button>
              );
            })}
            {spareGear.map((k) => {
              const g = getGear(k);
              if (!g) return null;
              return (
                <button key={`g:${k}`} onClick={() => equipGear(k)} title={`Equip ${tierPrefix(g.name, gearQuality[k])} (${g.slot})`}>
                  <Sprite spriteKey={`gear:${k}`} look={gearCrest(g.name, g.slot)} size="md" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {picking && (
        <EquipPicker
          slot={picking}
          onClose={() => setPicking(null)}
          equippedWeapon={equippedWeapon}
          equipment={equipment}
          ownedWeapons={ownedWeapons}
          ownedGear={ownedGear}
          gearQuality={gearQuality}
          weaponQuality={weaponQuality}
          onEquipWeapon={(k) => {
            equipWeapon(k);
            setPicking(null);
          }}
          onEquipGear={(k) => {
            equipGear(k);
            setPicking(null);
          }}
          onUnequip={(sl) => {
            unequipGear(sl);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function EquipPicker({
  slot,
  onClose,
  equippedWeapon,
  equipment,
  ownedWeapons,
  ownedGear,
  gearQuality,
  weaponQuality,
  onEquipWeapon,
  onEquipGear,
  onUnequip,
}: {
  slot: SlotKey;
  onClose: () => void;
  equippedWeapon: string;
  equipment: Record<GearSlot, string | null>;
  ownedWeapons: string[];
  ownedGear: string[];
  gearQuality: Record<string, number>;
  weaponQuality: Record<string, number>;
  onEquipWeapon: (key: string) => void;
  onEquipGear: (key: string) => void;
  onUnequip: (slot: GearSlot) => void;
}) {
  const isWeapon = slot === 'weapon';
  const options = isWeapon ? ownedWeapons : ownedGear.filter((k) => getGear(k)?.slot === slot);
  const equippedKey = isWeapon ? equippedWeapon : equipment[slot as GearSlot];

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="texture-parchment w-full max-w-sm space-y-2 rounded-lg border-2 border-gold-deep p-4 shadow-gold"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-ink">Equip {SLOT_LABEL[slot]}</h3>
          <button onClick={onClose} className="text-ink-light hover:text-ember" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {!isWeapon && equippedKey && (
            <button
              onClick={() => onUnequip(slot as GearSlot)}
              className="w-full rounded-md border border-ink-light/30 px-3 py-2 text-left text-xs text-ink-muted hover:border-ember/50 hover:text-ember"
            >
              Unequip current
            </button>
          )}
          {options.length === 0 && (
            <p className="px-1 py-2 text-xs italic text-ink-muted">
              No {SLOT_LABEL[slot].toLowerCase()} owned. Buy or craft one first.
            </p>
          )}
          {options.map((k) => {
            const w = isWeapon ? getWeapon(k) : undefined;
            const g = isWeapon ? undefined : getGear(k);
            // Scale the shown stats + prefix the name by quality tier (matches combat/inventory).
            const tier = asCraftTier(isWeapon ? weaponQuality[k] : gearQuality[k]);
            const wScaled = w ? scaleWeaponDef(w, tier) : undefined;
            const gScaled = g ? scaleGearDef(g, tier) : undefined;
            const name = tierPrefix(w?.name ?? g?.name ?? k, isWeapon ? weaponQuality[k] : gearQuality[k]);
            const look = w ? weaponCrest(w.name, w.attackStat) : g ? gearCrest(g.name, g.slot) : undefined;
            const detail = wScaled
              ? `${wScaled.attackStat === 'DX' ? 'Dexterity' : 'Strength'} · +${wScaled.bonus} Attack`
              : gScaled
                ? gearDetail(gScaled)
                : '';
            const equipped = k === equippedKey;
            return (
              <button
                key={k}
                onClick={() => (isWeapon ? onEquipWeapon(k) : onEquipGear(k))}
                disabled={equipped}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left ${
                  equipped
                    ? 'border-gold-deep/60 bg-gold/15'
                    : 'border-gold-deep/25 bg-parchment-100/60 hover:border-gold-deep/60 hover:bg-parchment-300/50'
                }`}
              >
                {look && <Sprite spriteKey={`${isWeapon ? 'weapon' : 'gear'}:${k}`} look={look} size="md" />}
                <span className="min-w-0 flex-1">
                  <span
                    className="block text-sm font-semibold text-ink"
                    style={tier !== NORMAL ? { color: CRAFT_TIERS[tier].color } : undefined}
                  >
                    {name}
                  </span>
                  <span className="block text-[11px] text-ink-muted">{detail}</span>
                </span>
                {equipped && <span className="text-[10px] font-bold uppercase text-gold-deep">Equipped</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function gearDetail(g: NonNullable<ReturnType<typeof getGear>>): string {
  const parts: string[] = [];
  if (g.statBonuses) for (const [s, n] of Object.entries(g.statBonuses)) parts.push(`+${n} ${getStat(s as StatId).short}`);
  if (g.defense) parts.push(`+${g.defense} Def`);
  if (g.ward) parts.push(`+${g.ward} Ward`);
  if (g.xpBonus) parts.push(`+${g.xpBonus.pct}% ${g.xpBonus.tag ?? (g.xpBonus.stat ? getStat(g.xpBonus.stat).short : '')} XP`);
  return parts.join(' · ') || g.slot;
}
