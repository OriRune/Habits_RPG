import { useState, useEffect, useRef } from 'react';
import { Swords, Sparkles, Shield, FlaskConical, Wind, ChevronLeft } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { selectTopStats } from '@/store/selectors';
import { getItem } from '@/engine/items';
import { getSpell } from '@/engine/spells';
import { getWeapon } from '@/engine/weapons';
import { type BattleState, type CombatAction, type StatusEffect } from '@/engine/combat';
import { bossCrest, avatarCrest } from '@/lib/sprites';
import { getScene, scenePlaceholderImage } from '@/lib/scenes';
import { cn } from '@/lib/cn';
import { Sprite } from '@/components/ui/Sprite';
import { Button } from '@/components/ui/Button';
import { SceneArt } from '@/components/ui/SceneArt';

const STATUS_ICON: Record<string, string> = {
  burn: '🔥', blind: '🌀', weaken: '⬇️', bless: '✨', freeze: '❄️', poison: '☠️',
};

// ── HpBar: GBC-style animated health bar ─────────────────────────────────────

function HpBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const barColor =
    pct > 50 ? '#22c55e' :
    pct > 20 ? '#f59e0b' :
               '#ef4444';
  return (
    <div className="h-2.5 overflow-hidden rounded-sm border border-gold-deep/40 bg-wood-900">
      <div
        className="h-full rounded-sm"
        style={{
          width: `${pct}%`,
          backgroundColor: barColor,
          transition: 'width 400ms ease, background-color 400ms ease',
        }}
      />
    </div>
  );
}

// ── Gauge: thin MP/STA bar ────────────────────────────────────────────────────

function Gauge({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-0.5 flex justify-between font-display text-[11px]">
        <span className="font-semibold text-parchment-200">{label}</span>
        <span className="tabular-nums text-parchment-300/80">{value}/{max}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-gold-deep/60 bg-wood-900">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ── Statuses ──────────────────────────────────────────────────────────────────

function Statuses({ list }: { list: StatusEffect[] }) {
  if (list.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px]">
      {list.map((s) => (
        <span key={s.key} title={`${s.key} (${s.turns})`} className="text-parchment-200">
          {STATUS_ICON[s.key] ?? '●'}
          <span className="text-parchment-300/70">{s.turns}</span>
        </span>
      ))}
    </div>
  );
}

// ── Biome battle backgrounds ──────────────────────────────────────────────────

const DEFAULT_BATTLE_BG =
  'linear-gradient(to bottom, #1c0f07 0%, #2d1a0a 47%, #3e2510 49%, #5a3a18 54%, #3e2510 100%)';

const BIOME_BATTLE_BG: Record<string, string> = {
  catacombs: 'linear-gradient(to bottom, #1a0e22 0%, #2a1535 47%, #3a1e4a 49%, #4a2a58 54%, #3a1e4a 100%)',
  ruins:     'linear-gradient(to bottom, #0c1a0e 0%, #182e14 47%, #243e1e 49%, #2e5a28 54%, #243e1e 100%)',
  frozen:    'linear-gradient(to bottom, #0a1520 0%, #162535 47%, #1e3548 49%, #284f62 54%, #1e3548 100%)',
};

// ── Per-spell VFX ─────────────────────────────────────────────────────────────

interface SpellVfx { glyph: string; cls: string }

function spellVfx(kind: string): SpellVfx {
  switch (kind) {
    case 'sparks':
    case 'chaotic_blink': return { glyph: '⚡', cls: 'battle-spell-sparks' };
    case 'firebolt':
    case 'ring_of_fire':  return { glyph: '🔥', cls: 'battle-spell-firebolt' };
    case 'mend':          return { glyph: '✨', cls: 'battle-spell-mend' };
    case 'bless':         return { glyph: '🛡', cls: 'battle-spell-bless' };
    case 'dazzle':        return { glyph: '💫', cls: 'battle-spell-dazzle' };
    case 'hex':           return { glyph: '🔮', cls: 'battle-spell-hex' };
    case 'fire_rune':     return { glyph: '🔥', cls: 'battle-spell-rune' };
    case 'ice_rune':      return { glyph: '❄️', cls: 'battle-spell-rune' };
    case 'poison_rune':   return { glyph: '☠️', cls: 'battle-spell-rune' };
    // School-level fallbacks
    case 'damage':        return { glyph: '⚡', cls: 'battle-spell-sparks' };
    case 'support':       return { glyph: '✨', cls: 'battle-spell-mend' };
    case 'illusion':      return { glyph: '💫', cls: 'battle-spell-dazzle' };
    default:              return { glyph: '✨', cls: 'battle-spell' };
  }
}

// ── Animation state ───────────────────────────────────────────────────────────

interface Anim {
  foeLunge: boolean;
  foeHit: boolean;
  playerLunge: boolean;
  playerHit: boolean;
  foeFloater: string | null;
  playerFloater: string | null;
  /** Spell key or school name to drive per-spell VFX; null when no spell was cast. */
  spellKind: string | null;
  /** 'foe' for damage/illusion; 'self' for support spells (mend, bless, teleport). */
  spellTarget: 'foe' | 'self';
}

const ANIM_NONE: Anim = {
  foeLunge: false, foeHit: false,
  playerLunge: false, playerHit: false,
  foeFloater: null, playerFloater: null,
  spellKind: null, spellTarget: 'foe',
};

// ── BattleSceneProps ──────────────────────────────────────────────────────────

interface BattleSceneProps {
  battle: BattleState;
  onAction: (action: CombatAction) => void;
  onResolve: () => void;
  resolveWonLabel: string;
  resolveLostLabel: string;
  resolveFledLabel?: string;
  fullscreen?: boolean;
  allowFlee?: boolean;
  /** Optional biome key — when set, themes the battlefield gradient + shows a faint biome motif. */
  biomeKey?: string;
}

// ── BattleScene ───────────────────────────────────────────────────────────────

export function BattleScene({
  battle,
  onAction,
  onResolve,
  resolveWonLabel,
  resolveLostLabel,
  resolveFledLabel = 'Leave',
  fullscreen = false,
  allowFlee = false,
  biomeKey,
}: BattleSceneProps) {
  const inventory = useGameStore((s) => s.inventory);
  const character = useGameStore((s) => s.character);
  const knownSpells = useGameStore((s) => s.knownSpells);
  const equippedWeapon = useGameStore((s) => s.equippedWeapon);
  const topStat = useGameStore(selectTopStats)[0];
  const [menu, setMenu] = useState<'main' | 'spell' | 'item'>('main');
  const [anim, setAnim] = useState<Anim>(ANIM_NONE);

  // Biome-themed battlefield background + faint motif overlay
  const battleBg = biomeKey ? (BIOME_BATTLE_BG[biomeKey] ?? DEFAULT_BATTLE_BG) : DEFAULT_BATTLE_BG;
  const biomeSrc = biomeKey
    ? scenePlaceholderImage(getScene(`biome:${biomeKey}`), undefined, `biome:${biomeKey}`)
    : null;

  // VFX diff — compare the previous battle snapshot after each turn to classify
  // what happened (player hit foe, foe hit player, spell cast) and trigger the
  // matching CSS keyframe token. Pattern mirrors ArenaOverlay/tactics floaters.
  const prevRef = useRef({
    logLen: battle.log.length,
    bossHp: battle.bossHp,
    playerHp: battle.playerHp,
    status: battle.status,
  });

  useEffect(() => {
    const prev = prevRef.current;
    if (battle.log.length === prev.logLen && battle.status === prev.status) return;

    const bossDmg   = prev.bossHp   - battle.bossHp;
    const playerDmg = prev.playerHp - battle.playerHp;
    const la = battle.lastAction;
    const isSpell = la?.kind === 'spell';

    const next: Anim = { ...ANIM_NONE };

    if (bossDmg > 0) {
      next.foeHit     = true;
      next.foeFloater = `-${bossDmg}`;
      if (isSpell && la) {
        next.spellKind   = la.spellKey ?? la.school ?? null;
        next.spellTarget = 'foe';
      } else {
        next.playerLunge = true;      // melee: player charges the foe
      }
    } else if (isSpell && la && la.target === 'self') {
      // Support spell on self (mend, bless, teleport) — no foe damage
      next.spellKind   = la.spellKey ?? la.school ?? null;
      next.spellTarget = 'self';
    }

    if (playerDmg > 0) {
      next.foeLunge      = true;      // foe charges the player
      next.playerHit     = true;
      next.playerFloater = `-${playerDmg}`;
    }

    // Heal floater on support spells that restored HP
    if (la?.kind === 'spell' && la.target === 'self' && la.amount && la.amount > 0) {
      next.playerFloater = `+${la.amount}`;
    }

    prevRef.current = {
      logLen: battle.log.length,
      bossHp: battle.bossHp,
      playerHp: battle.playerHp,
      status: battle.status,
    };

    if (!Object.values(next).some(Boolean)) return;
    setAnim(next);
    const t = setTimeout(() => setAnim(ANIM_NONE), 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.log.length, battle.bossHp, battle.playerHp, battle.status]);

  const active = battle.status === 'active';
  const isWon  = battle.status === 'won';
  const isLost = battle.status === 'lost';

  const weapon    = getWeapon(equippedWeapon);
  const latest    = battle.log[battle.log.length - 1];
  const prevLog   = battle.log[battle.log.length - 2];

  const usableItems = Object.entries(inventory)
    .filter(([key, qty]) => qty > 0 && getItem(key)?.context === 'battle')
    .map(([key, qty]) => ({ key, qty, def: getItem(key)! }));

  function act(a: CombatAction) {
    onAction(a);
    setMenu('main');
  }

  const content = (
    <div className={cn('flex w-full flex-col gap-3', fullscreen ? 'mx-auto h-full max-w-2xl px-4 py-4' : '')}>

      {/* ── Battlefield (GBC layout) ─────────────────────────────────────────
          Sky/wall gradient in the upper half, a floor band at ~50%.
          Foe info card upper-left + foe sprite upper-right (classic GBC convention).
          Player sprite lower-left + player info card lower-right.         */}
      <div
        className="relative h-52 w-full overflow-hidden rounded-md border-2 border-gold-deep/60"
        style={{ background: battleBg }}
      >
        {/* Faint biome motif overlay — only when a biome key is set */}
        {biomeSrc && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `url('${biomeSrc}')`,
              backgroundSize: 'cover',
              backgroundPosition: 'bottom center',
              opacity: 0.1,
            }}
          />
        )}
        {/* ── Foe info card — upper-left ── */}
        <div className="absolute left-2 top-2 max-w-[46%]">
          <div className="truncate font-display text-xs font-bold text-ember-bright">
            {battle.bossName}
          </div>
          <div className="mt-0.5 w-28">
            <div className="mb-0.5 text-right font-display text-[9px] tabular-nums text-parchment-300/60">
              {battle.bossHp} / {battle.bossMaxHp}
            </div>
            <HpBar value={battle.bossHp} max={battle.bossMaxHp} />
          </div>
          <Statuses list={battle.enemyStatuses} />
          {active && battle.enemyIntent && (
            <div className="mt-1 flex items-center gap-0.5 text-[9px] text-parchment-300/70">
              <span className="shrink-0">{battle.enemyIntent.icon ?? '⚔️'}</span>
              <span className="truncate">{battle.enemyIntent.label}…</span>
            </div>
          )}
        </div>

        {/* ── Foe sprite — upper-right, on a raised platform ── */}
        <div className="absolute bottom-[38%] right-3">
          {/* Elliptical shadow platform */}
          <div className="absolute -bottom-2 left-1/2 h-3 w-16 -translate-x-1/2 rounded-full bg-black/25" />
          {/* Combat animation wrapper (lunge / hit / faint) */}
          <div
            className={cn(
              active && anim.foeLunge && 'animate-[battle-lunge-foe_0.4s_ease]',
              active && anim.foeHit   && 'animate-[battle-hit_0.45s_ease]',
              !active && isWon        && 'animate-[battle-faint-foe_0.8s_ease_forwards]',
            )}
          >
            {/* Idle bob — skipped when prefers-reduced-motion is set */}
            <div
              className="motion-safe:animate-[battle-idle_2.2s_ease-in-out_infinite]"
              style={{ animationDelay: '0.4s' }}
            >
              <Sprite
                spriteKey={`boss:${battle.bossId}`}
                look={bossCrest(battle.bossName)}
                size="xl"
              />
            </div>
          </div>
          {/* Damage floater over foe */}
          {anim.foeFloater && (
            <span className="pointer-events-none absolute left-1/2 top-0 font-display text-sm font-bold leading-none text-red-400 motion-safe:animate-[battle-floater_0.65s_ease_forwards]">
              {anim.foeFloater}
            </span>
          )}
        </div>

        {/* ── Player sprite — lower-left ── */}
        <div className="absolute bottom-2 left-3">
          {/* Combat animation wrapper */}
          <div
            className={cn(
              active && anim.playerLunge && 'animate-[battle-lunge-player_0.4s_ease]',
              active && anim.playerHit   && 'animate-[battle-hit_0.45s_ease]',
              !active && isLost          && 'animate-[battle-faint-player_0.8s_ease_forwards]',
            )}
          >
            {/* Idle bob — staggered so foe and player don't bob in sync */}
            <div
              className="motion-safe:animate-[battle-idle_2s_ease-in-out_infinite]"
              style={{ animationDelay: '0.9s' }}
            >
              <Sprite
                spriteKey={`avatar:${character.classId ?? 'adventurer'}`}
                look={avatarCrest(character.classId, topStat)}
                size="lg"
              />
            </div>
          </div>
          {/* Damage / heal floater over player (green when gaining HP) */}
          {anim.playerFloater && (
            <span
              className={cn(
                'pointer-events-none absolute left-1/2 top-0 font-display text-sm font-bold leading-none motion-safe:animate-[battle-floater_0.65s_ease_forwards]',
                anim.playerFloater.startsWith('+') ? 'text-emerald-400' : 'text-red-400',
              )}
            >
              {anim.playerFloater}
            </span>
          )}
        </div>

        {/* ── Player info card — lower-right ── */}
        <div className="absolute bottom-2 right-2 max-w-[46%]">
          <div className="truncate font-display text-xs font-bold text-parchment-200">
            {character.classId ?? 'Adventurer'}
          </div>
          <div className="mt-0.5 w-28">
            <div className="mb-0.5 font-display text-[9px] tabular-nums text-parchment-300/60">
              {battle.playerHp} / {battle.playerMaxHp}
            </div>
            <HpBar value={battle.playerHp} max={battle.playerMaxHp} />
          </div>
          <Statuses list={battle.playerStatuses} />
        </div>

        {/* ── Per-spell VFX ─────────────────────────────────────────────────────
            Positioned on the target (foe = upper-right, self = lower-left).
            Uses inline style for the animation name so Tailwind JIT scan is not
            needed for the dynamic keyframe name. The `battle-spell-vfx` class
            satisfies the [class*="battle-"] reduced-motion guard in index.css.  */}
        {anim.spellKind && (() => {
          const { glyph, cls } = spellVfx(anim.spellKind);
          const isForSelf = anim.spellTarget === 'self';
          return (
            <div
              className={cn(
                'battle-spell-vfx pointer-events-none absolute text-xl',
                isForSelf ? 'bottom-[20%] left-[10%]' : 'bottom-[42%] right-[10%]',
              )}
              style={{ animation: `${cls} 0.7s ease forwards` }}
            >
              {glyph}
            </div>
          );
        })()}
      </div>

      {/* MP + STA bars (below battlefield, full-width) */}
      <div className="space-y-1">
        <Gauge label="MP"  value={battle.playerMp}  max={battle.playerMaxMp}  color="#3b82f6" />
        <Gauge label="STA" value={battle.playerSta} max={battle.playerMaxSta} color="#c9a227" />
      </div>

      {/* Latest battle log — GBC-style text box */}
      <div className="texture-scroll rounded-md border-2 border-gold-deep/60 p-3 shadow-gold-sm">
        {prevLog && <div className="text-xs text-ink-light">{prevLog}</div>}
        <div className="font-display text-sm font-semibold text-ink">{latest}</div>
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
                  <Button
                    key={key}
                    variant="secondary"
                    onClick={() => act({ kind: 'item', itemKey: key })}
                    className="flex items-center justify-center gap-1.5 py-2 text-xs"
                  >
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
            sceneKey={
              battle.status === 'won'  ? 'combat:victory'  :
              battle.status === 'fled' ? 'dungeon:retreat' :
                                         'combat:defeat'
            }
            size="md"
          />
          <Button
            variant={battle.status === 'won' ? 'primary' : 'secondary'}
            onClick={onResolve}
            className="w-full py-3"
          >
            {battle.status === 'won'  ? resolveWonLabel  :
             battle.status === 'fled' ? resolveFledLabel :
                                        resolveLostLabel}
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
