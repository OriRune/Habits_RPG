import { useState } from 'react';
import { Swords, Sparkles, Shield, FlaskConical, Wind, ChevronLeft } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { selectTopStats } from '@/store/selectors';
import { getItem } from '@/engine/items';
import { getSpell } from '@/engine/spells';
import { getWeapon } from '@/engine/weapons';
import { type BattleState, type CombatAction, type StatusEffect } from '@/engine/combat';
import { bossCrest, avatarCrest } from '@/lib/sprites';
import { cn } from '@/lib/cn';
import { Frame } from '@/components/ui/Frame';
import { Sprite } from '@/components/ui/Sprite';
import { Button } from '@/components/ui/Button';
import { SceneArt } from '@/components/ui/SceneArt';

const STATUS_ICON: Record<string, string> = { burn: '🔥', blind: '🌀', weaken: '⬇️', bless: '✨', freeze: '❄️', poison: '☠️' };

function Gauge({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-0.5 flex justify-between font-display text-[11px]">
        <span className="font-semibold text-parchment-200">{label}</span>
        <span className="tabular-nums text-parchment-300/80">
          {value}/{max}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full border border-gold-deep/60 bg-wood-900">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function Statuses({ list }: { list: StatusEffect[] }) {
  if (list.length === 0) return null;
  return (
    <div className="mt-1 flex gap-1.5 text-xs">
      {list.map((s) => (
        <span key={s.key} title={`${s.key} (${s.turns})`} className="text-parchment-200">
          {STATUS_ICON[s.key] ?? '●'}
          <span className="text-parchment-300/70">{s.turns}</span>
        </span>
      ))}
    </div>
  );
}

interface BattleSceneProps {
  battle: BattleState;
  onAction: (action: CombatAction) => void;
  onResolve: () => void;
  resolveWonLabel: string;
  resolveLostLabel: string;
  resolveFledLabel?: string;
  fullscreen?: boolean;
  allowFlee?: boolean;
}

export function BattleScene({
  battle,
  onAction,
  onResolve,
  resolveWonLabel,
  resolveLostLabel,
  resolveFledLabel = 'Leave',
  fullscreen = false,
  allowFlee = false,
}: BattleSceneProps) {
  const inventory = useGameStore((s) => s.inventory);
  const character = useGameStore((s) => s.character);
  const knownSpells = useGameStore((s) => s.knownSpells);
  const equippedWeapon = useGameStore((s) => s.equippedWeapon);
  const topStat = useGameStore(selectTopStats)[0];
  const [menu, setMenu] = useState<'main' | 'spell' | 'item'>('main');

  const active = battle.status === 'active';
  const weapon = getWeapon(equippedWeapon);
  const latest = battle.log[battle.log.length - 1];
  const prev = battle.log[battle.log.length - 2];

  const usableItems = Object.entries(inventory)
    .filter(([key, qty]) => qty > 0 && getItem(key)?.context === 'battle')
    .map(([key, qty]) => ({ key, qty, def: getItem(key)! }));

  function act(a: CombatAction) {
    onAction(a);
    setMenu('main');
  }

  const content = (
    <div className={cn('flex w-full flex-col', fullscreen ? 'mx-auto h-full max-w-2xl px-4 py-4' : '')}>
      {/* Foe */}
      <div className="flex items-center gap-3">
        <Frame tone="wood" className="shrink-0">
          <Sprite spriteKey={`boss:${battle.bossId}`} look={bossCrest(battle.bossName)} size="lg" />
        </Frame>
        <div className="min-w-0 flex-1">
          <h2 className="mb-1.5 truncate font-display text-lg font-bold text-ember-bright">{battle.bossName}</h2>
          <Gauge label="Foe" value={battle.bossHp} max={battle.bossMaxHp} color="#b23b2e" />
          <Statuses list={battle.enemyStatuses} />
        </div>
      </div>

      {/* Latest update (no scrolling — just the freshest events) */}
      <div className="texture-scroll my-3 rounded-md border-2 border-gold-deep/60 p-3 shadow-gold-sm">
        {prev && <div className="text-xs text-ink-light">{prev}</div>}
        <div className="font-display text-sm font-semibold text-ink">{latest}</div>
      </div>

      {/* Player */}
      <div className="mb-3 flex items-center gap-3">
        <Frame tone="wood" className="shrink-0">
          <Sprite
            spriteKey={`avatar:${character.classId ?? 'adventurer'}`}
            look={avatarCrest(character.classId, topStat)}
            size="md"
          />
        </Frame>
        <div className="min-w-0 flex-1 space-y-1">
          <Gauge label={character.classId ?? 'Adventurer'} value={battle.playerHp} max={battle.playerMaxHp} color="#2e8a5e" />
          <Gauge label="MP" value={battle.playerMp} max={battle.playerMaxMp} color="#3b82f6" />
          <Gauge label="STA" value={battle.playerSta} max={battle.playerMaxSta} color="#c9a227" />
          <Statuses list={battle.playerStatuses} />
        </div>
      </div>

      {/* Actions / resolution */}
      {active ? (
        menu === 'main' ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => act({ kind: 'attack' })} className="flex items-center justify-center gap-1.5 py-2.5">
                <Swords className="h-4 w-4" /> Attack
              </Button>
              <Button variant="secondary" onClick={() => setMenu('spell')} className="flex items-center justify-center gap-1.5 py-2.5">
                <Sparkles className="h-4 w-4" /> Spell
              </Button>
              <Button variant="secondary" onClick={() => setMenu('item')} className="flex items-center justify-center gap-1.5 py-2.5">
                <FlaskConical className="h-4 w-4" /> Item
              </Button>
              <Button variant="secondary" onClick={() => act({ kind: 'defend' })} className="flex items-center justify-center gap-1.5 py-2.5">
                <Shield className="h-4 w-4" /> Defend
              </Button>
            </div>
            {allowFlee && (
              <Button variant="secondary" onClick={() => act({ kind: 'flee' })} className="flex w-full items-center justify-center gap-1.5 py-2">
                <Wind className="h-4 w-4" /> Flee
              </Button>
            )}
            <div className="text-center font-display text-[11px] uppercase tracking-wider text-parchment-300/60">
              {weapon.name} · {weapon.attackStat === 'DX' ? 'Dexterity' : 'Strength'}
            </div>
          </div>
        ) : menu === 'spell' ? (
          <div className="space-y-2">
            <SubmenuHeader title="Cast a Spell" onBack={() => setMenu('main')} />
            <div className="grid grid-cols-1 gap-2">
              {knownSpells.map((key) => {
                const spell = getSpell(key);
                if (!spell) return null;
                const tooCostly = battle.playerMp < spell.mpCost;
                return (
                  <Button
                    key={key}
                    variant="secondary"
                    disabled={tooCostly}
                    onClick={() => act({ kind: 'spell', spellKey: key })}
                    className="flex items-center justify-between py-2"
                  >
                    <span>{spell.name}</span>
                    <span className="text-xs text-stat-KN">{spell.mpCost} MP</span>
                  </Button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <SubmenuHeader title="Use an Item" onBack={() => setMenu('main')} />
            {usableItems.length === 0 ? (
              <div className="rounded-md border border-gold-deep/30 p-3 text-center text-xs text-parchment-300/70">
                No battle items.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {usableItems.map(({ key, qty, def }) => (
                  <Button key={key} variant="secondary" onClick={() => act({ kind: 'item', itemKey: key })} className="flex items-center justify-center gap-1.5 py-2 text-xs">
                    <FlaskConical className="h-4 w-4" /> {def.name} ×{qty}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )
      ) : (
        <div className="space-y-3">
          <SceneArt
            sceneKey={battle.status === 'won' ? 'combat:victory' : battle.status === 'fled' ? 'dungeon:retreat' : 'combat:defeat'}
            size="md"
          />
          <Button
            variant={battle.status === 'won' ? 'primary' : 'secondary'}
            onClick={onResolve}
            className="w-full py-3"
          >
            {battle.status === 'won' ? resolveWonLabel : battle.status === 'fled' ? resolveFledLabel : resolveLostLabel}
          </Button>
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return <div className="texture-wood fixed inset-0 z-50 flex flex-col overflow-y-auto">{content}</div>;
  }
  return content;
}

function SubmenuHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onBack} className="text-parchment-300 hover:text-gold-bright">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="font-display text-sm font-semibold text-gold-bright">{title}</span>
    </div>
  );
}
