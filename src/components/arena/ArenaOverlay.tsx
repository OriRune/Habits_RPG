import { useEffect, useRef, useState } from 'react';
import { Heart, Zap, Sparkles, Swords, Crosshair, LogOut, Skull, Trophy, FlaskRound } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { useArenaLoop } from '@/hooks/useArenaLoop';
import type { ArenaStatusEffect, TelegraphKind, ArenaRune } from '@/engine/arena';
import { boardPixelSize, board, cellEquals, cellToPixel, step, neighbors, inBoard, type Cell, type Dir } from '@/engine/grid';
import { getSpell, type StatusKey } from '@/engine/spells';
import { getItem } from '@/engine/items';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { ArenaControls } from './ArenaControls';

/** Cell size (px) shrinks as the board grows so every size fits the same width. */
function sizeFor(radius: number): number {
  return radius >= 5 ? 26 : radius >= 4 ? 30 : 34;
}
function boardFor(radius: number) {
  return boardPixelSize(radius, sizeFor(radius));
}
function centerFor(h: Cell, radius: number): { x: number; y: number } {
  const size = sizeFor(radius);
  const b = boardFor(radius);
  const p = cellToPixel(h, size);
  return { x: b.width / 2 + p.x, y: b.height / 2 + p.y };
}

const STATUS_GLYPH: Record<StatusKey, string> = { bless: '🛡️', burn: '🔥', weaken: '🔻', blind: '💫', freeze: '❄️', poison: '☠️' };
const TELEGRAPH_GLYPH: Record<TelegraphKind, string> = { slam: '💥', line: '➡️', nova: '✸', volley: '⁂' };
const RUNE_GLYPH: Record<ArenaRune['kind'], string> = { fire: '🔥', ice: '❄️', poison: '☠️' };
const RUNE_COLOR: Record<ArenaRune['kind'], string> = { fire: 'rgba(239,68,68,0.35)', ice: 'rgba(96,165,250,0.35)', poison: 'rgba(134,239,172,0.30)' };

function bossGlyph(id: string): string {
  if (id.includes('slime')) return '🫧';
  if (id.includes('golem')) return '🗿';
  return '👹';
}
function obstacleGlyph(h: Cell): string {
  const x = Math.abs((Math.imul(h.x, 73856093) ^ Math.imul(h.y, 19349663)) >>> 0);
  return ['🪨', '🌲', '🪵'][x % 3];
}
function floorTint(h: Cell): string {
  const x = Math.abs((Math.imul(h.x, 19349663) ^ Math.imul(h.y, 83492791)) >>> 0) % 10;
  const l = 34 + x;
  return `rgb(${l},${l + 8},${l + 12})`;
}

/** Compute the nearest of 8 grid directions from pixel deltas (dx right=positive, dy down=positive). */
function pixelDir(dx: number, dy: number): Dir {
  const angle = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const idx = Math.round(angle / 45) % 8;
  return (['right', 'downRight', 'down', 'downLeft', 'left', 'upLeft', 'up', 'upRight'] as Dir[])[idx];
}
/** Convert a click position (board-local coords) to the nearest board cell. */
function pixelToCell(clickX: number, clickY: number, bw: number, bh: number, size: number): Cell {
  return { x: Math.round((clickX - bw / 2) / size), y: Math.round((clickY - bh / 2) / size) };
}

function Gauge({ icon, value, max, fill }: { icon: React.ReactNode; value: number; max: number; fill: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <div className="h-2.5 w-24 overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: fill }} />
      </div>
      <span className="font-display text-[11px] tabular-nums text-parchment-300">
        {Math.max(0, Math.round(value))}/{Math.round(max)}
      </span>
    </div>
  );
}

function StatusBadges({ statuses, x, y }: { statuses: ArenaStatusEffect[]; x: number; y: number }) {
  if (statuses.length === 0) return null;
  return (
    <div
      className="pointer-events-none absolute z-20 flex -translate-x-1/2 gap-0.5 text-[11px]"
      style={{ left: x, top: y, transform: 'translate(-50%, -100%)' }}
    >
      {statuses.map((st) => (
        <span key={st.key} title={st.key} style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.8))' }}>
          {STATUS_GLYPH[st.key]}
        </span>
      ))}
    </div>
  );
}

type Float = { key: string; x: number; y: number; text: string; color: string; at: number };

// A slot action — identifies what fires when a board-click slot is used.
type SlotKey = 'melee' | 'ranged' | `spell:${string}` | `item:${string}`;

export function ArenaOverlay() {
  const controls = useArenaLoop();
  const arena = useGameStore((s) => s.arena);
  const endArena = useGameStore((s) => s.endArena);
  const beginArenaBanking = useGameStore((s) => s.beginArenaBanking);

  const [floats, setFloats] = useState<Float[]>([]);
  const [hitAt, setHitAt] = useState(0);
  const [castAt, setCastAt] = useState(0);

  // Click-to-aim slot assignments (not persisted — reset each run).
  const [leftSlot, setLeftSlot] = useState<SlotKey>('melee');
  const [rightSlot, setRightSlot] = useState<SlotKey>('ranged');

  const boardRef = useRef<HTMLDivElement>(null);
  const prev = useRef<{ bossHp: number; hp: number; mp: number } | null>(null);

  useEffect(() => {
    if (!arena) { prev.current = null; return; }
    const p = prev.current;
    prev.current = { bossHp: arena.bossHp, hp: arena.hp, mp: arena.mp };
    if (!p) return;
    const now = Date.now();
    const R = arena.radius;
    const next: Float[] = [];
    const bossDmg = p.bossHp - arena.bossHp;
    if (bossDmg > 0) {
      const c = centerFor(arena.bossPos, R);
      next.push({ key: `b-${now}-${Math.random()}`, x: c.x, y: c.y - 16, text: `-${Math.round(bossDmg)}`, color: '#fbbf24', at: now });
    }
    const playerDmg = p.hp - arena.hp;
    if (playerDmg > 0) {
      const c = centerFor(arena.player.pos, R);
      next.push({ key: `p-${now}-${Math.random()}`, x: c.x, y: c.y - 16, text: `-${Math.round(playerDmg)}`, color: '#f87171', at: now });
      setHitAt(now);
    } else if (playerDmg < 0) {
      const c = centerFor(arena.player.pos, R);
      next.push({ key: `h-${now}-${Math.random()}`, x: c.x, y: c.y - 16, text: `+${Math.round(-playerDmg)}`, color: '#34d399', at: now });
    }
    if (p.mp - arena.mp >= 2) setCastAt(now);
    if (next.length > 0) {
      setFloats((fs) => [...fs.filter((f) => now - f.at < 850), ...next]);
      setTimeout(() => setFloats((fs) => fs.filter((f) => Date.now() - f.at < 850)), 900);
    }
  }, [arena]);

  if (!arena) return null;

  const R = arena.radius;
  const SIZE = sizeFor(R);
  const CELL = SIZE;
  const BOARD = boardFor(R);
  const center = (h: Cell) => centerFor(h, R);
  const cellBox = (h: Cell): React.CSSProperties => {
    const c = center(h);
    const s = SIZE - 2;
    return { position: 'absolute', left: c.x - s / 2, top: c.y - s / 2, width: s, height: s, borderRadius: 5 };
  };
  const spriteBox = (h: Cell, size: number): React.CSSProperties => {
    const c = center(h);
    return {
      position: 'absolute',
      left: -size / 2,
      top: -size / 2,
      width: size,
      height: size,
      transform: `translate(${c.x}px, ${c.y}px)`,
      transition: 'transform 120ms linear',
    };
  };

  const dead = arena.status === 'ended';
  const won = arena.status === 'won';
  const banking = arena.status === 'banking';
  const faced = step(arena.player.pos, arena.player.facing);
  const bossPct = arena.bossMaxHp > 0 ? Math.max(0, (arena.bossHp / arena.bossMaxHp) * 100) : 0;
  const showHit = Date.now() - hitAt < 450;
  const playerC = center(arena.player.pos);
  const ringActive = arena.ringOfFire != null && Date.now() < arena.ringOfFire.expiresAtMs;

  const spells = arena.knownSpells.map((k) => getSpell(k)).filter((s): s is NonNullable<typeof s> => !!s);
  const items = Object.entries(arena.inventory)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ def: getItem(key), key, n }))
    .filter((x): x is { def: NonNullable<ReturnType<typeof getItem>>; key: string; n: number } => !!x.def);

  // Fire the action bound to a slot, aimed in the given direction.
  const fireSlot = (slot: SlotKey, dir: Dir, clickX: number, clickY: number) => {
    if (slot === 'melee') {
      controls.melee(dir);
    } else if (slot === 'ranged') {
      controls.ranged(dir);
    } else if (slot.startsWith('spell:')) {
      const spellKey = slot.slice(6);
      const spell = getSpell(spellKey);
      const isRune = spell?.mechanic?.startsWith('rune-');
      if (isRune && boardRef.current) {
        const target = pixelToCell(clickX, clickY, BOARD.width, BOARD.height, SIZE);
        controls.cast(spellKey, { dir, target });
      } else {
        controls.cast(spellKey, { dir });
      }
    } else if (slot.startsWith('item:')) {
      controls.useItem(slot.slice(5));
    }
  };

  const handleBoardClick = (clientX: number, clientY: number, isRight: boolean) => {
    if (!arena || arena.status !== 'active' || !boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;
    const pc = centerFor(arena.player.pos, R);
    const ddx = clickX - pc.x;
    const ddy = clickY - pc.y;
    if (Math.abs(ddx) < SIZE * 0.4 && Math.abs(ddy) < SIZE * 0.4) return;
    const dir = pixelDir(ddx, ddy);
    fireSlot(isRight ? rightSlot : leftSlot, dir, clickX, clickY);
  };

  return (
    <div className="texture-wood fixed inset-0 z-50 flex flex-col items-center gap-3 overflow-auto px-4 py-4">
      {/* Damage-taken vignette flash */}
      {showHit && (
        <div key={hitAt} className="pointer-events-none fixed inset-0 z-[60]" style={{ animation: 'arena-hit 0.45s ease-out forwards' }} />
      )}

      {/* HUD: boss bar */}
      <div className="w-full max-w-md space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-display text-sm font-bold text-gold-bright">{arena.bossName}</span>
          <div className="flex items-center gap-2">
            {arena.totalPhases > 1 && (
              <span className="flex gap-0.5">
                {Array.from({ length: arena.totalPhases }).map((_, i) => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: i <= arena.phaseIndex ? '#e8c860' : 'rgba(232,200,96,0.25)' }}
                  />
                ))}
              </span>
            )}
            <span className="font-display text-[11px] text-parchment-300">Tier {arena.tier}</span>
          </div>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full border border-gold-deep/50 bg-wood-900">
          <div className="h-full rounded-full bg-ember-bright transition-all" style={{ width: `${bossPct}%` }} />
        </div>
      </div>

      {/* HUD: player gauges */}
      <div className="flex w-full max-w-md flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Gauge icon={<Heart className="h-3.5 w-3.5 text-stat-HP" />} value={arena.hp} max={arena.maxHp} fill="#2e8a5e" />
        <Gauge icon={<Sparkles className="h-3.5 w-3.5 text-stat-WI" />} value={arena.mp} max={arena.maxMp} fill="#6c7bd6" />
        <Gauge icon={<Zap className="h-3.5 w-3.5 text-stat-AG" />} value={arena.sta} max={arena.maxSta} fill="#b8860b" />
      </div>

      {/* Arena board */}
      <div
        ref={boardRef}
        className="relative shrink-0 overflow-visible"
        style={{ width: BOARD.width, height: BOARD.height }}
        onPointerDown={(e) => { if (e.button === 0) handleBoardClick(e.clientX, e.clientY, false); }}
        onContextMenu={(e) => { e.preventDefault(); handleBoardClick(e.clientX, e.clientY, true); }}
      >
        {/* Floor cells */}
        {board(R).map((h) => {
          const isFaced = cellEquals(h, faced);
          return (
            <div
              key={`${h.x},${h.y}`}
              style={{
                ...cellBox(h),
                backgroundColor: isFaced ? '#3a4d3f' : floorTint(h),
                boxShadow: isFaced ? 'inset 0 0 0 2px rgba(251,191,36,0.55)' : 'inset 0 0 0 1px rgba(0,0,0,0.45)',
              }}
            />
          );
        })}

        {/* Obstacles (cover) */}
        {arena.obstacles.map((h) => (
          <div
            key={`ob-${h.x},${h.y}`}
            className="pointer-events-none flex items-center justify-center"
            style={{ ...cellBox(h), backgroundColor: '#16181c' }}
          >
            <span style={{ fontSize: SIZE, lineHeight: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }}>
              {obstacleGlyph(h)}
            </span>
          </div>
        ))}

        {/* Rune traps */}
        {arena.runes.map((r) => (
          <div
            key={`rune-${r.id}`}
            className="pointer-events-none flex items-center justify-center"
            style={{ ...cellBox(r.pos), backgroundColor: RUNE_COLOR[r.kind], animation: 'arena-telegraph 2s ease-in-out infinite alternate' }}
          >
            <span style={{ fontSize: SIZE * 0.65, lineHeight: 1, filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.6))' }}>
              {RUNE_GLYPH[r.kind]}
            </span>
          </div>
        ))}

        {/* Ring of fire — glowing ring on 8 adjacent cells around player */}
        {ringActive && neighbors(arena.player.pos).filter((h) => inBoard(h, R)).map((h) => (
          <div
            key={`ring-${h.x},${h.y}`}
            className="pointer-events-none"
            style={{
              ...cellBox(h),
              backgroundColor: 'rgba(251,146,60,0.25)',
              boxShadow: 'inset 0 0 6px 2px rgba(251,146,60,0.5)',
              animation: 'arena-telegraph 400ms ease-in-out infinite alternate',
            }}
          />
        ))}

        {/* Telegraphs — danger zones that brighten as the blow lands */}
        {arena.telegraphs.map((t) => (
          <div key={`tg-${t.id}`} className="pointer-events-none">
            {t.tiles.map((h, i) => (
              <div
                key={i}
                style={{
                  ...cellBox(h),
                  backgroundColor: t.school === 'magic' ? '#a855f7' : '#ef4444',
                  animation: `arena-telegraph ${Math.max(120, t.firesAtMs - t.startedAtMs)}ms ease-in forwards`,
                }}
              />
            ))}
            <div className="pointer-events-none z-[7] flex items-center justify-center opacity-80" style={spriteBox(t.tiles[0] ?? arena.bossPos, CELL)}>
              <span className="text-[14px]">{TELEGRAPH_GLYPH[t.kind]}</span>
            </div>
          </div>
        ))}

        {/* Player ranged bolts */}
        {arena.projectiles.map((p) => (
          <div key={`pj-${p.id}`} className="pointer-events-none" style={spriteBox(p.pos, 14)}>
            <span className="block h-full w-full rounded-full bg-cyan-300" style={{ boxShadow: '0 0 8px 2px rgba(103,232,249,0.8)' }} />
          </div>
        ))}

        {/* Damage floaters */}
        {floats.map((f) => (
          <div
            key={f.key}
            className="pointer-events-none absolute z-30 font-display text-sm font-bold"
            style={{ left: f.x, top: f.y, color: f.color, textShadow: '0 1px 3px rgba(0,0,0,0.9)', animation: 'loot-float 0.85s ease-out forwards' }}
          >
            {f.text}
          </div>
        ))}

        {/* Minions */}
        {arena.minions.map((m) => {
          const c = center(m.pos);
          const frozen = m.frozenUntilMs > Date.now();
          return (
            <div key={`mn-${m.id}`}>
              <div className="pointer-events-none z-[8] flex items-center justify-center" style={spriteBox(m.pos, CELL * 0.62)}>
                <span style={{ fontSize: SIZE * 0.9, lineHeight: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', opacity: frozen ? 0.6 : 1 }}>
                  {frozen ? '🧊' : '🦇'}
                </span>
              </div>
              {m.hp < m.maxHp && (
                <div
                  className="pointer-events-none absolute z-[9] h-[3px] w-7 -translate-x-1/2 overflow-hidden rounded-full bg-black/60"
                  style={{ left: c.x, top: c.y - SIZE * 0.7 }}
                >
                  <div className="h-full rounded-full bg-red-400" style={{ width: `${(m.hp / m.maxHp) * 100}%` }} />
                </div>
              )}
              {m.poisonDmg > 0 && m.poisonExpiresMs > Date.now() && (
                <div className="pointer-events-none absolute z-20 text-[10px]" style={{ left: c.x + CELL * 0.3, top: c.y - CELL * 0.6 }}>
                  ☠️
                </div>
              )}
            </div>
          );
        })}

        {/* Boss + its debuff badges */}
        <div className="pointer-events-none z-[8] flex items-center justify-center" style={spriteBox(arena.bossPos, CELL)}>
          <span className="leading-none" style={{ fontSize: SIZE * 1.15, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.85))', opacity: won ? 0.25 : 1 }}>
            {won ? '💥' : bossGlyph(arena.bossId)}
          </span>
        </div>
        <StatusBadges statuses={arena.enemyStatuses} x={center(arena.bossPos).x} y={center(arena.bossPos).y - CELL / 2} />

        {/* Player + cast ring + ring-of-fire glow + buff badges */}
        {Date.now() - castAt < 400 && (
          <div
            key={castAt}
            className="pointer-events-none absolute z-[9] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-violet-300"
            style={{ left: playerC.x, top: playerC.y, width: CELL, height: CELL, animation: 'arena-cast 0.4s ease-out forwards' }}
          />
        )}
        {ringActive && (
          <div
            className="pointer-events-none absolute z-[9] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-orange-400"
            style={{ left: playerC.x, top: playerC.y, width: CELL * 3, height: CELL * 3, boxShadow: '0 0 12px 4px rgba(251,146,60,0.45)', animation: 'arena-cast 1s ease-in-out infinite alternate' }}
          />
        )}
        <div className="pointer-events-none z-10 flex items-center justify-center" style={spriteBox(arena.player.pos, CELL)}>
          <span className="leading-none" style={{ fontSize: SIZE, filter: 'drop-shadow(0 0 5px rgba(255,240,200,0.55))', opacity: arena.playerFrozenUntilMs > arena.lastTickMs ? 0.6 : 1 }}>
            {dead ? '💀' : arena.playerFrozenUntilMs > arena.lastTickMs ? '🧊' : '🧝'}
          </span>
        </div>
        <StatusBadges statuses={arena.playerStatuses} x={playerC.x} y={playerC.y - CELL / 2} />

        {/* Outcome overlays */}
        {(won || dead || banking) && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 rounded-md bg-black/85 p-4 text-center">
            {won ? <Trophy className="h-9 w-9 text-gold-bright" /> : dead ? <Skull className="h-9 w-9 text-ember-bright" /> : <LogOut className="h-9 w-9 text-parchment-300" />}
            <p className="font-display text-lg font-bold text-parchment-100">
              {won ? 'Boss Vanquished!' : dead ? 'You Have Fallen' : 'Retreat'}
            </p>
            <p className="max-w-xs font-display text-xs text-parchment-300">
              {won
                ? `${arena.bossName} is defeated. Claim the full bounty.`
                : dead
                  ? 'Carried out with half of what you earned this bout.'
                  : 'Withdraw with the share you earned so far.'}
            </p>
            <Button variant="primary" onClick={endArena} className="mt-1 px-4 py-2 text-sm">
              {won ? 'Claim Reward' : 'Leave the Arena'}
            </Button>
          </div>
        )}
      </div>

      {/* Ability bar — left-click fires + binds to left slot; right-click binds to right slot */}
      <div className="w-full max-w-md space-y-1.5">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <AbilityButton
            icon={<Swords className="h-4 w-4" />}
            label="Melee"
            leftBound={leftSlot === 'melee'}
            rightBound={rightSlot === 'melee'}
            onClick={() => { controls.melee(); setLeftSlot('melee'); }}
            onRightClick={() => setRightSlot('melee')}
          />
          <AbilityButton
            icon={<Crosshair className="h-4 w-4" />}
            label="Shoot"
            leftBound={leftSlot === 'ranged'}
            rightBound={rightSlot === 'ranged'}
            onClick={() => { controls.ranged(); setLeftSlot('ranged'); }}
            onRightClick={() => setRightSlot('ranged')}
          />
          {spells.map((sp) => {
            const key: SlotKey = `spell:${sp.key}`;
            return (
              <AbilityButton
                key={sp.key}
                icon={<Sparkles className="h-4 w-4" />}
                label={sp.name}
                sub={`${sp.mpCost} MP`}
                disabled={arena.mp < sp.mpCost}
                leftBound={leftSlot === key}
                rightBound={rightSlot === key}
                onClick={() => { controls.cast(sp.key); setLeftSlot(key); }}
                onRightClick={() => setRightSlot(key)}
              />
            );
          })}
          {items.map(({ def, key, n }) => {
            const slotKey: SlotKey = `item:${key}`;
            return (
              <AbilityButton
                key={key}
                icon={<FlaskRound className="h-4 w-4" />}
                label={def.name}
                sub={`×${n}`}
                leftBound={leftSlot === slotKey}
                rightBound={rightSlot === slotKey}
                onClick={() => { controls.useItem(key); setLeftSlot(slotKey); }}
                onRightClick={() => setRightSlot(slotKey)}
              />
            );
          })}
        </div>
        <p className="text-center text-[9px] text-parchment-300/50">
          Left-click a button to bind it to left-click · Right-click to bind to right-click · Click the board to aim and fire
        </p>
      </div>

      {/* Touch movement pad */}
      <div className="w-full max-w-md">
        <ArenaControls controls={controls} />
      </div>

      {/* Retreat */}
      {arena.status === 'active' && (
        <Button variant="danger" onClick={beginArenaBanking} className="flex items-center gap-1.5 px-3 py-1.5 text-xs">
          <LogOut className="h-4 w-4" /> Retreat
        </Button>
      )}

      <p className="max-w-md text-center text-[10px] text-parchment-300/50">
        Move: W/A/S/D or arrows — hold two for diagonals (or use the pad). Space attacks. Click the board to fire in that direction.
      </p>
    </div>
  );
}

function AbilityButton({
  icon, label, sub, onClick, onRightClick, disabled, leftBound, rightBound,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
  onRightClick?: () => void;
  disabled?: boolean;
  leftBound?: boolean;
  rightBound?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => { e.preventDefault(); onRightClick?.(); }}
      disabled={disabled}
      className={cn(
        'relative flex min-w-[64px] flex-col items-center gap-0.5 rounded-md texture-wood border px-2 py-1.5',
        'font-display text-[10px] uppercase tracking-wider text-parchment-200',
        'active:border-gold active:text-gold-bright disabled:opacity-40',
        leftBound || rightBound ? 'border-gold/60' : 'border-gold-deep/70',
      )}
    >
      {icon}
      <span>{label}</span>
      {sub && <span className="text-[9px] text-parchment-300/70">{sub}</span>}
      {/* Slot binding badges */}
      {leftBound && (
        <span className="absolute -left-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-cyan-600 text-[7px] font-bold text-white">
          L
        </span>
      )}
      {rightBound && (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-600 text-[7px] font-bold text-white">
          R
        </span>
      )}
    </button>
  );
}

