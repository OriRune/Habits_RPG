import { useState } from 'react';
import { Minus, Plus, Sparkles, Sword } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { STATS, type StatId } from '@/engine/stats';
import { BASE_STAT_LEVEL, CREATION_STAT_MAX, STARTING_STAT_POINTS } from '@/engine/progression';
import { getWeapon, STARTER_WEAPON, STARTER_WEAPON_CHOICES } from '@/engine/weapons';
import { getSpell, SIGNATURE_SPELL_CHOICES } from '@/engine/spells';
import { weaponCrest, spellCrest } from '@/lib/sprites';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Sprite } from '@/components/ui/Sprite';
import { Divider, SectionTitle } from '@/components/ui/Divider';

const PER_STAT_MAX = CREATION_STAT_MAX - BASE_STAT_LEVEL;

/**
 * First-run onboarding: name the hero, spend the starting stat points, and pick a starting weapon
 * plus a signature spell. Commits through `createCharacter`, which flips the `created` gate so the
 * main app takes over. Shown by App when `!created`.
 */
export function CreationView() {
  const createCharacter = useGameStore((s) => s.createCharacter);

  const [name, setName] = useState('');
  const [alloc, setAlloc] = useState<Record<StatId, number>>(() =>
    STATS.reduce((acc, s) => ({ ...acc, [s.id]: 0 }), {} as Record<StatId, number>),
  );
  const [weaponKey, setWeaponKey] = useState<string | null>(null);
  const [spellKey, setSpellKey] = useState<string | null>(null);

  const spent = STATS.reduce((sum, s) => sum + alloc[s.id], 0);
  const remaining = STARTING_STAT_POINTS - spent;

  const bump = (id: StatId, delta: number) =>
    setAlloc((a) => {
      const next = a[id] + delta;
      if (next < 0 || next > PER_STAT_MAX) return a;
      if (delta > 0 && remaining <= 0) return a;
      return { ...a, [id]: next };
    });

  const begin = () => {
    if (!weaponKey || !spellKey) return;
    createCharacter({ name, allocations: alloc, weaponKey, spellKey });
  };

  const quickStart = () =>
    createCharacter({ name, allocations: {}, weaponKey: STARTER_WEAPON, spellKey: '' });

  return (
    <div className="texture-wood min-h-full overflow-y-auto px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="text-center">
          <h1 className="font-display text-3xl font-bold text-gold-bright drop-shadow">Forge Your Hero</h1>
          <p className="mt-1 text-sm text-parchment-300">
            Who do you begin as? Your habits will shape the rest.
          </p>
        </header>

        {/* Name */}
        <Panel tone="parchment" className="space-y-3 p-5">
          <SectionTitle>Name</SectionTitle>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Adventurer"
            maxLength={24}
            className="w-full rounded-md border border-gold-deep/50 bg-parchment-100/80 px-3 py-2 font-display text-lg text-ink placeholder:text-ink-light/60 focus:border-gold-deep focus:outline-none"
          />
        </Panel>

        {/* Stats */}
        <Panel tone="parchment" className="space-y-3 p-5">
          <SectionTitle>Starting Stats</SectionTitle>
          <p className="flex items-center justify-between text-sm text-ink-muted">
            <span>Spend your origin points — up to +{PER_STAT_MAX} in any one stat.</span>
            <span className="font-display font-bold tabular-nums text-gold-deep">
              {remaining} left
            </span>
          </p>
          <div className="space-y-1.5">
            {STATS.map((s) => {
              const value = BASE_STAT_LEVEL + alloc[s.id];
              return (
                <div key={s.id} className="flex items-center gap-3">
                  <div className="w-24 shrink-0">
                    <div className="font-display text-sm font-semibold text-ink">{s.name}</div>
                    <div className="text-[10px] text-ink-light">{s.represents}</div>
                  </div>
                  <div className="flex flex-1 items-center justify-end gap-2">
                    <button
                      onClick={() => bump(s.id, -1)}
                      disabled={alloc[s.id] <= 0}
                      aria-label={`Lower ${s.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-gold-deep/50 text-ink transition-colors hover:bg-parchment-300/60 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span
                      className="w-7 text-center font-display text-lg font-bold tabular-nums"
                      style={{ color: s.color }}
                    >
                      {value}
                    </span>
                    <button
                      onClick={() => bump(s.id, 1)}
                      disabled={remaining <= 0 || alloc[s.id] >= PER_STAT_MAX}
                      aria-label={`Raise ${s.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md border border-gold-deep/50 text-ink transition-colors hover:bg-parchment-300/60 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        {/* Weapon */}
        <Panel tone="parchment" className="space-y-3 p-5">
          <SectionTitle>Starting Weapon</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-3">
            {STARTER_WEAPON_CHOICES.map((key) => {
              const w = getWeapon(key);
              const selected = weaponKey === key;
              return (
                <button
                  key={key}
                  onClick={() => setWeaponKey(key)}
                  className={`flex flex-col items-center gap-2 rounded-md border p-3 text-center transition-colors ${
                    selected
                      ? 'border-gold-deep bg-gold-bright/15 ring-1 ring-gold-deep'
                      : 'border-gold-deep/30 bg-parchment-100/70 hover:border-gold-deep/70'
                  }`}
                >
                  <Sprite spriteKey={`weapon:${key}`} look={weaponCrest(w.name, w.attackStat)} size="md" />
                  <span className="font-display text-sm font-bold text-ink">{w.name}</span>
                  <span className="text-[11px] uppercase tracking-wide text-gold-deep">
                    +{w.bonus} · {w.attackStat === 'ST' ? 'Strength' : 'Dexterity'}
                  </span>
                  <span className="text-[11px] leading-snug text-ink-muted">{w.description}</span>
                </button>
              );
            })}
          </div>
        </Panel>

        {/* Spell */}
        <Panel tone="parchment" className="space-y-3 p-5">
          <SectionTitle>Signature Spell</SectionTitle>
          <p className="text-sm text-ink-muted">You also begin knowing Sparks and Mend.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SIGNATURE_SPELL_CHOICES.map((key) => {
              const sp = getSpell(key);
              if (!sp) return null;
              const selected = spellKey === key;
              return (
                <button
                  key={key}
                  onClick={() => setSpellKey(key)}
                  className={`flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                    selected
                      ? 'border-gold-deep bg-gold-bright/15 ring-1 ring-gold-deep'
                      : 'border-gold-deep/30 bg-parchment-100/70 hover:border-gold-deep/70'
                  }`}
                >
                  <Sprite spriteKey={`spell:${key}`} look={spellCrest(sp.name, sp.school)} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-display text-sm font-bold text-ink">{sp.name}</span>
                      <span className="text-[10px] uppercase tracking-wider text-gold-deep">
                        {sp.school} · {sp.mpCost} MP
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">{sp.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Panel>

        <Divider />

        <div className="flex flex-col items-center gap-3 pb-4">
          <Button onClick={begin} disabled={!weaponKey || !spellKey} className="w-full max-w-xs py-3 text-base">
            <Sword className="mr-2 inline h-4 w-4" />
            Begin Adventure
          </Button>
          {remaining > 0 && (
            <p className="text-xs text-parchment-300/80">
              {remaining} point{remaining === 1 ? '' : 's'} unspent — you can still begin.
            </p>
          )}
          <button
            onClick={quickStart}
            className="flex items-center gap-1.5 text-xs text-parchment-300/70 underline-offset-2 transition-colors hover:text-parchment-200 hover:underline"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Quick start with defaults
          </button>
        </div>
      </div>
    </div>
  );
}
