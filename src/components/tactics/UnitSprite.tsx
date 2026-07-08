// Board unit + effect sprites for Hex Tactics — DOM overlays positioned above the SVG board.
// Extracted from TacticsOverlay so the overlay stays orchestration-only; the token art itself
// lives in tokenArt.tsx (procedural SVG creatures with an emoji fallback for unknown ids).
import type { EnemyIntent, TacticalEffect, UnitStatus } from '@/engine/hexBattle';
import type { StatusKey } from '@/engine/spells';
import { cn } from '@/lib/cn';
import { CreatureToken, HeroToken, hasToken } from './tokenArt';

const STATUS_GLYPH: Record<StatusKey, string> = {
  bless: '🛡️', burn: '🔥', weaken: '🔻', blind: '💫', freeze: '❄️', poison: '☠️',
};

/** Spell glyph + burst animation, shared by the action bar buttons and the cast effect. */
export const SPELL_FX: Record<string, { anim: string; glyph: string }> = {
  sparks:  { anim: 'tactics-sparks',  glyph: '⚡' },
  firebolt:{ anim: 'tactics-firebolt',glyph: '🔥' },
  mend:    { anim: 'tactics-mend',    glyph: '✚' },
  bless:   { anim: 'tactics-bless',   glyph: '✨' },
  dazzle:  { anim: 'tactics-dazzle',  glyph: '💫' },
  hex:     { anim: 'tactics-hex',     glyph: '🟣' },
  // Tactics positional spells (always available)
  push:    { anim: 'tactics-cast',    glyph: '💨' },
  blink:   { anim: 'tactics-cast',    glyph: '🌀' },
  cleave:  { anim: 'tactics-cast',    glyph: '⚡' },
};

const FLOATER_COLOR: Record<NonNullable<TacticalEffect['color']>, string> = {
  'dmg-enemy': '#fbbf24',  // amber — damage dealt by player
  'dmg-player': '#f87171', // red — damage taken
  'heal': '#34d399',       // green
  'status': '#c084fc',     // purple — status inflicted
};

function StatusRow({ statuses }: { statuses: UnitStatus[] }) {
  if (statuses.length === 0) return null;
  return (
    <div className="pointer-events-none flex gap-0.5 text-[10px]" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.8))' }}>
      {statuses.map((st) => (
        <span key={st.key} title={`${st.key} (${st.turns}t)`}>{STATUS_GLYPH[st.key]}</span>
      ))}
    </div>
  );
}

export function UnitSprite({
  x, y, glyph, hp, maxHp, statuses, friendly, name, scale = 1,
  slideMs = 200,
  intent, archetypeColor, archetypeBlurb, weakResist, onClick, onHover,
  templateId, heroKind, cloakColor, classId, facing = 'right', hitId, idleDelay = 0,
}: {
  x: number; y: number; glyph: string; hp: number; maxHp: number; statuses: UnitStatus[];
  friendly?: boolean; name?: string; scale?: number;
  /**
   * CSS transition duration for the position transform (ms).
   * 0 = instant snap (used when holding a unit at prevHex before its stagger fires).
   * MOVE_ANIM_MS = smooth slide after stagger timer fires.
   */
  slideMs?: number;
  intent?: EnemyIntent;
  /** Archetype ring color (hex string); absent for the player. */
  archetypeColor?: string;
  /** Short archetype label + blurb shown in the intent badge tooltip. */
  archetypeBlurb?: string;
  /** Whether the current player action hits a weakness (⬆) or resistance (⬇) of this enemy. */
  weakResist?: 'weak' | 'resist' | null;
  onClick?: () => void;
  /** Hover pass-through: the sprite sits above its tile polygon and swallows mouse events,
   *  so without this the damage preview never fires when pointing at the unit itself. */
  onHover?: (over: boolean) => void;
  /** Enemy template id → procedural token from tokenArt; missing/unknown falls back to `glyph`. */
  templateId?: string;
  /** Renders the hero rig instead of a creature: 'player' (class-tinted) or 'ally' (emerald). */
  heroKind?: 'player' | 'ally';
  /** Class tint for the player's cloak (avatarCrest color). */
  cloakColor?: string;
  classId?: string | null;
  /** Horizontal facing — tokens are authored facing right; 'left' mirrors them. */
  facing?: 'left' | 'right';
  /** Id of the freshest damage floater on this unit; remounts the token art to restart tx-hit. */
  hitId?: number;
  /** Seconds of breathe-cycle offset so a crowd doesn't bob in lockstep. */
  idleDelay?: number;
}) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const tooltipText = archetypeBlurb ? `${name ?? ''}\n${archetypeBlurb}` : (name ?? undefined);
  const tokenSize = Math.round(30 * scale);
  const art = heroKind ? (
    <HeroToken variant={heroKind} classId={classId} cloakColor={cloakColor} sizePx={tokenSize} facing={facing} hitId={hitId} />
  ) : templateId && hasToken(templateId) ? (
    <CreatureToken templateId={templateId} sizePx={tokenSize} facing={facing} hitId={hitId} idleDelay={idleDelay} />
  ) : (
    <span
      style={{
        fontSize: Math.round(26 * scale),
        lineHeight: 1,
        animation: !friendly ? 'tactics-idle-pulse 2.8s ease-in-out infinite' : undefined,
      }}
    >
      {glyph}
    </span>
  );
  return (
    <div
      // hover:z-30 raises the pointed-at unit above overlapping neighbours (iso rows crowd).
      className={cn('absolute z-20 flex flex-col items-center hover:z-30', onClick ? 'cursor-pointer' : 'pointer-events-none')}
      style={{ left: 0, top: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -78%)`, transition: slideMs > 0 ? `transform ${slideMs}ms ease-out` : 'none' }}
      title={tooltipText}
      onClick={onClick}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      {/* Intent badge — shows planned action icon + creature name (audit U3) */}
      {intent && !friendly && (
        <div
          className="pointer-events-none flex items-center gap-0.5 rounded-sm bg-wood-950/70 px-0.5 text-[9px]"
          title={archetypeBlurb ? `${archetypeBlurb}\n${intent.attackLabel}` : intent.attackLabel}
        >
          {intent.willAttack ? (
            <span style={{ fontSize: Math.round(10 * scale) }}>{intent.lunge ? '💨' : ''}{intent.attackIcon === '💨' ? '⚔️' : intent.attackIcon}</span>
          ) : intent.lunge ? (
            // Winding up a catch-up lunge — reach next turn is 2×move+1, mirrored by the danger zone.
            <span style={{ fontSize: Math.round(10 * scale) }} title="Winding up a lunge!">💨</span>
          ) : intent.attackIcon === '❄️' ? (
            <span className="text-blue-300">❄️</span>
          ) : null}
          {(name || archetypeBlurb) && (
            // Creature name, colored by archetype — the log speaks in names ("Wailing Wisp hits…"),
            // so the board must too; the archetype lives in the ring color + tooltip (audit U3).
            <span
              className="ml-0.5 truncate font-display leading-none"
              style={{ fontSize: Math.round(8 * scale), color: archetypeColor ?? '#aaa', maxWidth: Math.round(64 * scale) }}
            >
              {name ?? archetypeBlurb!.split(' ')[0]}
            </span>
          )}
        </div>
      )}
      <StatusRow statuses={statuses} />
      <div className="h-1 overflow-hidden rounded-full border border-black/50 bg-black/60" style={{ width: Math.round(26 * scale) }}>
        <div className="h-full" style={{ width: `${pct}%`, backgroundColor: friendly ? '#34d399' : '#ef4444' }} />
      </div>
      {/* Token art — with subtle archetype glow and weak/resist indicator */}
      <div
        className="relative flex items-center justify-center"
        style={{
          filter: archetypeColor
            ? `drop-shadow(0 0 ${Math.round(5 * scale)}px ${archetypeColor}88) drop-shadow(0 2px 2px rgba(0,0,0,0.7))`
            : 'drop-shadow(0 2px 2px rgba(0,0,0,0.7))',
        }}
      >
        {art}
        {/* Weak/resist affinity indicator — shown when the player's selected action has an affinity */}
        {weakResist && (
          <span
            className="absolute -right-1 -bottom-0.5 leading-none"
            style={{
              fontSize: Math.round(10 * scale),
              color: weakResist === 'weak' ? '#4ade80' : '#f87171',
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.8))',
            }}
            title={weakResist === 'weak' ? 'Weak to this attack (+damage)' : 'Resists this attack (-damage)'}
          >
            {weakResist === 'weak' ? '⬆' : '⬇'}
          </span>
        )}
      </div>
      {/* Name tag — visible label for co-op heroes so each player knows who is who */}
      {friendly && name && (
        <div
          className="pointer-events-none rounded bg-wood-950/75 px-1 py-px text-center font-display leading-tight"
          style={{ fontSize: Math.round(7 * scale), color: '#c9b57a', whiteSpace: 'nowrap', maxWidth: Math.round(54 * scale) }}
        >
          {name}
        </div>
      )}
    </div>
  );
}

export function EffectSprite({ fx, from, to }: { fx: TacticalEffect; from: { x: number; y: number }; to: { x: number; y: number } }) {
  if (fx.kind === 'floater') {
    const color = fx.color ? FLOATER_COLOR[fx.color] : '#fbbf24';
    // Deterministic horizontal jitter so overlapping floaters (multi-hit turns) don't stack.
    const jitter = ((fx.id % 5) - 2) * 5;
    return (
      <div
        className="pointer-events-none absolute z-40 select-none font-display font-bold"
        style={{
          left: to.x + jitter,
          top: to.y,
          color,
          fontSize: fx.color === 'status' ? 13 : 19,
          textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.6)',
          animation: `tactics-floater ${fx.durationMs}ms ease-out forwards`,
        }}
      >
        {fx.label}
      </div>
    );
  }
  if (fx.kind === 'arrow') {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const rot = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (
      <div
        className="pointer-events-none absolute z-30 text-lg"
        style={{
          left: from.x, top: from.y,
          ['--dx' as string]: `${dx}px`, ['--dy' as string]: `${dy}px`, ['--rot' as string]: `${rot}deg`,
          transform: 'translate(-50%, -50%)',
          animation: `tactics-arrow ${fx.durationMs}ms linear forwards`,
        }}
      >
        ➶
      </div>
    );
  }
  if (fx.kind === 'melee') {
    return (
      <div
        className="pointer-events-none absolute z-30 text-2xl"
        style={{ left: to.x, top: to.y, transform: 'translate(-50%, -50%)', animation: `tactics-melee ${fx.durationMs}ms ease-out forwards` }}
      >
        💥
      </div>
    );
  }
  const key = fx.kind.slice('spell:'.length);
  const conf = SPELL_FX[key] ?? { anim: 'tactics-cast', glyph: '✨' };
  return (
    <div
      className="pointer-events-none absolute z-30 text-2xl"
      style={{ left: to.x, top: to.y, transform: 'translate(-50%, -50%)', animation: `${conf.anim} ${fx.durationMs}ms ease-out forwards` }}
    >
      {conf.glyph}
    </div>
  );
}
