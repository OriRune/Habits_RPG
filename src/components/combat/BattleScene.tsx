import { useState, useEffect, useRef } from 'react';
import { Swords, Sparkles, Shield, FlaskConical, Wind, ChevronLeft, Volume2, VolumeX } from 'lucide-react';
import * as sfx from '@/lib/sfx';
import { useGameStore } from '@/store/useGameStore';
import { selectTopStats } from '@/store/selectors';
import { getItem } from '@/engine/items';
import { getSpell } from '@/engine/spells';
import { getWeapon } from '@/engine/weapons';
import { type BattleState, type CombatAction, type StatusEffect } from '@/engine/combat';
import { bossCrest, avatarCrest } from '@/lib/sprites';
import { biomeBattlefieldSvg } from '@/lib/placeholderArt';
import { cn } from '@/lib/cn';
import { Sprite } from '@/components/ui/Sprite';
import { Button } from '@/components/ui/Button';
import { SceneArt } from '@/components/ui/SceneArt';

const STATUS_ICON: Record<string, string> = {
  burn: '🔥', blind: '🌀', weaken: '⬇️', bless: '✨', freeze: '❄️', poison: '☠️',
};

// ── Enemy intent display helpers ──────────────────────────────────────────────

type IntentStyle = { label: string; fallbackIcon: string; tone: 'danger' | 'caution' | 'neutral' };

const INTENT_STYLE: Record<string, IntentStyle> = {
  attack:  { label: 'Attacks',   fallbackIcon: '⚔️',  tone: 'neutral'  },
  heavy:   { label: 'Heavy hit', fallbackIcon: '💢',  tone: 'danger'   },
  multi:   { label: 'Flurry',    fallbackIcon: '⚡',  tone: 'danger'   },
  drain:   { label: 'Drains',    fallbackIcon: '🩸',  tone: 'danger'   },
  guard:   { label: 'Guards',    fallbackIcon: '🛡️',  tone: 'caution'  },
  enrage:  { label: 'Enrages',   fallbackIcon: '😤',  tone: 'caution'  },
  inflict: { label: 'Inflicts',  fallbackIcon: '☠️',  tone: 'caution'  },
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
          transition: 'width 900ms ease-out, background-color 600ms ease',
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

// ── Per-foe-move VFX ──────────────────────────────────────────────────────────

interface FoeVfx { glyph: string; cls: string; target: 'player' | 'foe' }

function foeVfx(kind: string): FoeVfx {
  switch (kind) {
    case 'attack':  return { glyph: '⚔️', cls: 'battle-spell-sparks',   target: 'player' };
    case 'heavy':   return { glyph: '💥', cls: 'battle-spell-firebolt', target: 'player' };
    case 'multi':   return { glyph: '⚡', cls: 'battle-spell-dazzle',   target: 'player' };
    case 'drain':   return { glyph: '🩸', cls: 'battle-spell-hex',      target: 'player' };
    case 'inflict': return { glyph: '☠️', cls: 'battle-spell-hex',      target: 'player' };
    case 'guard':   return { glyph: '🛡',  cls: 'battle-spell-bless',   target: 'foe'    };
    case 'enrage':  return { glyph: '😤', cls: 'battle-spell-firebolt', target: 'foe'    };
    default:        return { glyph: '⚔️', cls: 'battle-spell-sparks',   target: 'player' };
  }
}

// ── Animation state ───────────────────────────────────────────────────────────

interface Anim {
  // Player action phase
  playerLunge: boolean;
  spellKind: string | null;
  spellTarget: 'foe' | 'self';
  // Impact phase (foe takes damage)
  foeHit: boolean;
  foeFloater: string | null;
  foeFlash: boolean;       // full-screen gold flash (player hits foe)
  foeShake: boolean;       // battlefield shake on heavy foe hit
  foeImpactRing: boolean;  // expanding ring on foe unit
  // Enemy action phase
  foeLunge: boolean;
  foeActionKind: string | null;  // drives the per-kind foe VFX glyph
  playerHit: boolean;
  playerFloater: string | null;
  playerFlash: boolean;     // full-screen red damage vignette (foe hits player)
  playerShake: boolean;     // battlefield shake when player takes a hit
  playerImpactRing: boolean;
}

const ANIM_NONE: Anim = {
  playerLunge: false, spellKind: null, spellTarget: 'foe',
  foeHit: false, foeFloater: null, foeFlash: false, foeShake: false, foeImpactRing: false,
  foeLunge: false, foeActionKind: null,
  playerHit: false, playerFloater: null, playerFlash: false, playerShake: false, playerImpactRing: false,
};

// ── Burst particle positions (fanned outward from impact point) ───────────────
const FOE_BURSTS   = [[-28,-22],[ 0,-32],[28,-22],[32,0],[20,24],[-20,24],[-32,0]];
const SELF_BURSTS  = [[-24,-18],[0,-28],[24,-18],[26,6],[14,22],[-14,22],[-26,6]];

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
  const soundEnabled = useGameStore((s) => s.settings.soundEnabled);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const [menu, setMenu] = useState<'main' | 'spell' | 'item'>('main');
  const [anim, setAnim] = useState<Anim>(ANIM_NONE);
  // Displayed HP — lags behind engine state so the drain plays after VFX
  const [disp, setDisp] = useState({ bossHp: battle.bossHp, playerHp: battle.playerHp });
  // Whether a timeline is currently running (shows "tap to skip" hint)
  const [animating, setAnimating] = useState(false);

  // Per-biome full-bleed battlefield SVG background
  const battlefieldSrc = biomeBattlefieldSvg(biomeKey);

  // Timeline refs — cleared on skip
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevRef = useRef({
    logLen: battle.log.length,
    bossHp: battle.bossHp,
    playerHp: battle.playerHp,
    status: battle.status,
  });

  // Snap displayed HP immediately when battle identity changes (new fight, mount)
  const battleIdRef = useRef(battle.bossId);
  useEffect(() => {
    if (battle.bossId !== battleIdRef.current) {
      battleIdRef.current = battle.bossId;
      setDisp({ bossHp: battle.bossHp, playerHp: battle.playerHp });
      prevRef.current = { logLen: battle.log.length, bossHp: battle.bossHp, playerHp: battle.playerHp, status: battle.status };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.bossId]);

  // Sync mute state with the store's soundEnabled setting
  useEffect(() => {
    sfx.setMuted(!soundEnabled);
  }, [soundEnabled]);

  // Resume AudioContext and play battle start sting once per encounter
  useEffect(() => {
    void sfx.resume().then(() => sfx.play('battleStart'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.bossId]);

  // Tap-to-skip: clear all pending timers and snap state to engine values
  function skipAnimation() {
    if (!animating) return;
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setAnim(ANIM_NONE);
    setDisp({ bossHp: battle.bossHp, playerHp: battle.playerHp });
    setAnimating(false);
    if (battle.status === 'won')  sfx.play('victory');
    if (battle.status === 'lost') sfx.play('defeat');
  }

  function schedule(fn: () => void, ms: number) {
    const t = setTimeout(fn, ms);
    timersRef.current.push(t);
  }

  // Staged VFX + HP drain timeline
  useEffect(() => {
    const prev = prevRef.current;
    if (battle.log.length === prev.logLen && battle.status === prev.status) return;

    const bossDmg   = prev.bossHp   - battle.bossHp;
    const playerDmg = prev.playerHp - battle.playerHp;
    const la = battle.lastAction;
    const isSpell = la?.kind === 'spell';

    // Update prevRef immediately so re-fires don't double-trigger
    prevRef.current = {
      logLen: battle.log.length,
      bossHp: battle.bossHp,
      playerHp: battle.playerHp,
      status: battle.status,
    };

    // If nothing visual happened (status-only change like flee success), skip
    if (bossDmg === 0 && playerDmg === 0 && !isSpell) {
      setDisp({ bossHp: battle.bossHp, playerHp: battle.playerHp });
      return;
    }

    // Clear any existing timeline
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setAnimating(true);

    // ── PHASE 1 (t=0): player action VFX (~950 ms dwell before HP drains) ──
    if (bossDmg > 0 || (isSpell && la && la.target === 'foe')) {
      setAnim({
        ...ANIM_NONE,
        playerLunge: !isSpell,
        spellKind:   isSpell && la ? (la.spellKey ?? la.school ?? null) : null,
        spellTarget: 'foe',
      });
      // Play spell/weapon sound immediately on action
      if (isSpell && la) {
        const key = la.spellKey ?? la.school ?? '';
        if (key === 'firebolt' || key === 'ring_of_fire') sfx.play('fireSpell');
        else if (key === 'hex') sfx.play('blink');
        else sfx.play('cast');
      } else {
        sfx.play('swing');
      }
    } else if (isSpell && la && la.target === 'self') {
      setAnim({
        ...ANIM_NONE,
        spellKind: la.spellKey ?? la.school ?? null,
        spellTarget: 'self',
      });
      sfx.play('heal');
    }

    const VFX_DWELL = 950;   // ms before HP starts draining
    const DRAIN_DUR = 900;   // HP bar transition duration (must match HpBar style)

    // ── PHASE 2 (t≈950): foe HP drain + impact ──────────────────────────────
    if (bossDmg > 0) {
      schedule(() => {
        setAnim({ ...ANIM_NONE, foeHit: true, foeFloater: `-${bossDmg}`, foeFlash: true, foeImpactRing: true, foeShake: bossDmg > 8 });
        setDisp(d => ({ ...d, bossHp: battle.bossHp }));
        sfx.play('hit');
        if (battle.status === 'won') {
          schedule(() => sfx.play('victory'), DRAIN_DUR + 400);
        }
      }, VFX_DWELL);
    } else if (isSpell && la && la.target === 'self' && la.amount && la.amount > 0) {
      // Heal — show green floater timed with the VFX
      schedule(() => {
        setAnim(prev2 => ({ ...prev2, playerFloater: `+${la.amount}` }));
        setDisp(d => ({ ...d, playerHp: battle.playerHp }));
      }, VFX_DWELL);
    }

    const foeDrainEnd = bossDmg > 0 ? VFX_DWELL + DRAIN_DUR : VFX_DWELL;

    // ── PHASE 3 (after foe drain): clear foe impact ─────────────────────────
    schedule(() => {
      setAnim(ANIM_NONE);
    }, foeDrainEnd + 200);

    const foeActed = !!battle.lastEnemyAction;
    const lastEnemyKind = battle.lastEnemyAction?.kind ?? 'attack';
    // `foeDealt` is the damage actually struck before any post-action HP restoration (e.g.
    // Invincibility), so hit-reaction VFX fire correctly even when playerDmg ends up 0.
    const foeDealt = battle.lastEnemyAction?.dealt ?? 0;
    const foeMeleeKinds = ['attack', 'heavy', 'multi', 'drain'];

    if (foeActed) {
      // ── PHASE 3b: foe executes its move — glyph VFX + lunge if melee ─────
      schedule(() => {
        setAnim({
          ...ANIM_NONE,
          foeLunge: foeMeleeKinds.includes(lastEnemyKind),
          foeActionKind: lastEnemyKind,
        });
        if (battle.status === 'active') {
          switch (lastEnemyKind) {
            case 'heavy':   sfx.play('heavyStrike'); break;
            case 'drain':   sfx.play('drainAttack'); break;
            case 'inflict': sfx.play('blink');       break;
            case 'guard':   sfx.play('lastStandBlock'); break;
            case 'enrage':  sfx.play('bossEnrage');  break;
            default:        sfx.play('swing');        break; // attack, multi
          }
        }
      }, foeDrainEnd + 350);

      if (foeDealt > 0) {
        // ── PHASE 4: player HP drain + impact ────────────────────────────────
        // Gate on `foeDealt` (damage struck by the engine) rather than `playerDmg`
        // (net HP change), so the hit reaction fires correctly even when Invincibility
        // restores HP after the action and keeps playerDmg at 0.
        schedule(() => {
          setAnim({ ...ANIM_NONE, playerHit: true, playerFloater: `-${foeDealt}`, playerFlash: true, playerShake: foeDealt > 8, playerImpactRing: true });
          setDisp(d => ({ ...d, playerHp: battle.playerHp }));
          sfx.play('playerHurt');
          if (battle.status === 'lost') {
            schedule(() => sfx.play('defeat'), DRAIN_DUR + 400);
          }
        }, foeDrainEnd + 350 + VFX_DWELL);

        // ── PHASE 5: clear all ──────────────────────────────────────────────
        schedule(() => {
          setAnim(ANIM_NONE);
          setAnimating(false);
        }, foeDrainEnd + 350 + VFX_DWELL + DRAIN_DUR + 200);
      } else if (lastEnemyKind === 'inflict') {
        // Non-damaging inflict — show a status floater on the player, then clear
        schedule(() => {
          setAnim({ ...ANIM_NONE, playerFloater: '☠' });
        }, foeDrainEnd + 350 + VFX_DWELL);
        schedule(() => {
          setAnim(ANIM_NONE);
          setAnimating(false);
          setDisp({ bossHp: battle.bossHp, playerHp: battle.playerHp });
        }, foeDrainEnd + 350 + VFX_DWELL + 700);
      } else {
        // guard / enrage — glyph lands on the foe, no player hit
        schedule(() => {
          setAnim(ANIM_NONE);
          setAnimating(false);
          setDisp({ bossHp: battle.bossHp, playerHp: battle.playerHp });
        }, foeDrainEnd + 350 + VFX_DWELL + 400);
      }
    } else if (playerDmg > 0) {
      // Foe was frozen/blinded but player has DoT — show player hit without foe lunge
      schedule(() => {
        setAnim({ ...ANIM_NONE, playerHit: true, playerFloater: `-${playerDmg}`, playerFlash: true, playerShake: playerDmg > 8, playerImpactRing: true });
        setDisp(d => ({ ...d, playerHp: battle.playerHp }));
      }, foeDrainEnd + 350);

      schedule(() => {
        setAnim(ANIM_NONE);
        setAnimating(false);
      }, foeDrainEnd + 350 + DRAIN_DUR + 200);
    } else {
      // No foe action + no damage — quick cleanup (heal/defend/rune with no counter)
      schedule(() => {
        setAnim(ANIM_NONE);
        setAnimating(false);
        setDisp({ bossHp: battle.bossHp, playerHp: battle.playerHp });
      }, foeDrainEnd + 400);
    }

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
      {/* Battlefield — click/tap while animating to skip to the result */}
      <div
        className={cn(
          'relative h-52 w-full overflow-hidden rounded-md border-2 border-gold-deep/60',
          active && (anim.foeShake || anim.playerShake) && 'motion-safe:animate-[battle-shake_0.5s_ease]',
        )}
        style={{
          backgroundImage: `url('${battlefieldSrc}')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
        onClick={animating ? skipAnimation : undefined}
        role={animating ? 'button' : undefined}
        aria-label={animating ? 'Skip animation' : undefined}
        tabIndex={animating ? 0 : undefined}
        onKeyDown={animating ? (e) => { if (e.key === 'Enter' || e.key === ' ') skipAnimation(); } : undefined}
      >
        {/* Full-screen flash overlays — red = foe hit player, gold = player hit foe */}
        {anim.foeFlash && (
          <div className="battle-flash pointer-events-none absolute inset-0 motion-safe:animate-[battle-flash_0.5s_ease_forwards]"
            style={{ background: 'radial-gradient(ellipse at 75% 35%, #ffe08a 0%, transparent 70%)', opacity: 0 }} />
        )}
        {anim.playerFlash && (
          <div className="battle-flash pointer-events-none absolute inset-0 motion-safe:animate-[battle-flash_0.55s_ease_forwards]"
            style={{ background: 'radial-gradient(ellipse at center, rgba(255,90,90,0) 30%, rgba(220,30,30,0.55) 72%, rgba(180,10,10,0.85) 100%)', opacity: 0 }} />
        )}

        {/* ── Foe info card — upper-left ── */}
        <div className="absolute left-2 top-2 max-w-[46%]">
          <div className="truncate font-display text-xs font-bold text-ember-bright">
            {battle.bossName}
          </div>
          <div className="mt-0.5 w-28">
            <div className="mb-0.5 text-right font-display text-[9px] tabular-nums text-parchment-300/60">
              {disp.bossHp} / {battle.bossMaxHp}
            </div>
            <HpBar value={disp.bossHp} max={battle.bossMaxHp} />
          </div>
          <Statuses list={battle.enemyStatuses} />
          {active && battle.enemyIntent && (() => {
            const style = INTENT_STYLE[battle.enemyIntent.kind] ?? INTENT_STYLE.attack;
            const icon = battle.enemyIntent.icon ?? style.fallbackIcon;
            const toneClass =
              style.tone === 'danger'  ? 'border-ember-bright/40 bg-ember-bright/10 text-ember-bright' :
              style.tone === 'caution' ? 'border-gold-deep/50 bg-gold-deep/15 text-gold-bright' :
                                         'border-gold-deep/30 bg-wood-900/50 text-parchment-300';
            const pipColor =
              style.tone === 'danger'  ? 'bg-ember-bright' :
              style.tone === 'caution' ? 'bg-gold-bright' :
                                         'bg-parchment-300/60';
            return (
              <div className={cn('mt-1.5 rounded border px-1.5 py-1', toneClass)}>
                <div className="flex items-center gap-1 font-display text-[8px] font-bold uppercase tracking-widest opacity-70">
                  <span className={cn('inline-block h-1.5 w-1.5 rounded-sm', pipColor)} />
                  Next Move
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="text-base leading-none">{icon}</span>
                  <span className="font-display text-[11px] font-semibold leading-tight">
                    {style.label} — {battle.enemyIntent.label}
                  </span>
                </div>
              </div>
            );
          })()}
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
          {/* Impact ring on foe */}
          {anim.foeImpactRing && (
            <div className="battle-impact pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 rounded-full border-2 border-amber-300/80 motion-safe:animate-[battle-impact-ring_0.55s_ease-out_forwards]" />
          )}
          {/* Burst particles on foe */}
          {anim.foeImpactRing && FOE_BURSTS.map(([bx, by], i) => (
            <div
              key={i}
              className="battle-burst pointer-events-none absolute left-1/2 top-1/2 text-[10px] motion-safe:animate-[battle-burst_0.6s_ease-out_forwards]"
              style={{ '--bx': `${bx}px`, '--by': `${by}px`, animationDelay: `${i * 30}ms` } as React.CSSProperties}
            >✦</div>
          ))}
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
          {/* Impact ring on player */}
          {anim.playerImpactRing && (
            <div className="battle-impact pointer-events-none absolute left-1/2 top-1/2 h-10 w-10 rounded-full border-2 border-red-400/80 motion-safe:animate-[battle-impact-ring_0.55s_ease-out_forwards]" />
          )}
          {/* Burst particles on player */}
          {anim.playerImpactRing && SELF_BURSTS.map(([bx, by], i) => (
            <div
              key={i}
              className="battle-burst pointer-events-none absolute left-1/2 top-1/2 text-[10px] text-red-400 motion-safe:animate-[battle-burst_0.6s_ease-out_forwards]"
              style={{ '--bx': `${bx}px`, '--by': `${by}px`, animationDelay: `${i * 30}ms` } as React.CSSProperties}
            >✦</div>
          ))}
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
              {disp.playerHp} / {battle.playerMaxHp}
            </div>
            <HpBar value={disp.playerHp} max={battle.playerMaxHp} />
          </div>
          <Statuses list={battle.playerStatuses} />
        </div>

        {/* ── Per-spell VFX ─────────────────────────────────────────────────────
            Positioned on the target (foe = upper-right, self = lower-left).
            Inline animation style avoids Tailwind JIT class-name interpolation.
            `battle-spell-vfx` satisfies the [class*="battle-"] reduced-motion guard. */}
        {anim.spellKind && (() => {
          const { glyph, cls } = spellVfx(anim.spellKind);
          const isForSelf = anim.spellTarget === 'self';
          return (
            <div
              className={cn(
                'battle-spell-vfx pointer-events-none absolute text-3xl',
                isForSelf ? 'bottom-[22%] left-[12%]' : 'bottom-[38%] right-[8%]',
              )}
              style={{ animation: `${cls} 1.0s ease forwards` }}
            >
              {glyph}
            </div>
          );
        })()}

        {/* ── Foe-action VFX ────────────────────────────────────────────────────
            Rendered on the target: player (lower-left) for attack/heavy/multi/drain/inflict;
            foe (upper-right) for guard/enrage. `battle-foe-vfx` satisfies reduced-motion guard. */}
        {anim.foeActionKind && (() => {
          const { glyph, cls, target } = foeVfx(anim.foeActionKind);
          const isOnFoe = target === 'foe';
          return (
            <div
              className={cn(
                'battle-foe-vfx pointer-events-none absolute text-3xl',
                isOnFoe ? 'bottom-[38%] right-[8%]' : 'bottom-[22%] left-[12%]',
              )}
              style={{ animation: `${cls} 1.0s ease forwards` }}
            >
              {glyph}
            </div>
          );
        })()}

        {/* Mute toggle */}
        <button
          className="absolute right-1.5 top-1.5 z-10 rounded p-0.5 text-parchment-300/40 transition-colors hover:text-parchment-200"
          onClick={(e) => { e.stopPropagation(); updateSettings({ soundEnabled: !soundEnabled }); void sfx.resume(); }}
          title={soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
          aria-label={soundEnabled ? 'Mute' : 'Unmute'}
        >
          {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
        </button>

        {/* Tap-to-skip hint */}
        {animating && (
          <div className="pointer-events-none absolute bottom-1 right-2 font-display text-[9px] text-parchment-300/50 uppercase tracking-wider">
            tap to skip
          </div>
        )}
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
