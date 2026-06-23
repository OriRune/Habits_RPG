import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { STATS } from '@/engine/stats';

// ---------------------------------------------------------------------------
// Tiny layout helpers (local — not exported)
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <span className="text-[11px] font-bold tabular-nums text-gold-deep">{value}</span>
    </div>
  );
}

function Chip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={
        'rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight ' +
        (on
          ? 'bg-gold/20 text-gold-deep'
          : 'bg-wood-900/40 text-ink-light')
      }
    >
      {label}
    </span>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display text-[10px] font-bold uppercase tracking-wider text-ink-muted">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Collapsible read-only panel showing key game-state values.
 * Placed at the bottom of Settings → Developer; collapsed by default.
 */
export function DevStateInspector() {
  const [open, setOpen] = useState(false);

  // Character
  const level      = useGameStore((s) => s.character.level);
  const gold       = useGameStore((s) => s.character.gold);
  const energy     = useGameStore((s) => s.character.energy);
  const classId    = useGameStore((s) => s.character.classId);
  const statLevels = useGameStore((s) => s.character.statLevels);

  // Depth records
  const deepestFloor        = useGameStore((s) => s.deepestFloor);
  const deepestMineFloor    = useGameStore((s) => s.deepestMineFloor);
  const deepestForestStage  = useGameStore((s) => s.deepestForestStage);
  const deepestArenaTier    = useGameStore((s) => s.deepestArenaTier);
  const deepestTacticsTier  = useGameStore((s) => s.deepestTacticsTier);

  // Pending states
  const pendingLevelUp     = useGameStore((s) => s.pendingLevelUp);
  const pendingClassChoice = useGameStore((s) => s.pendingClassChoice);

  // Active runs (presence as boolean)
  const hasBattle   = useGameStore((s) => s.battle !== null);
  const hasDungeon  = useGameStore((s) => s.dungeon !== null);
  const hasMining   = useGameStore((s) => s.mining !== null);
  const hasForest   = useGameStore((s) => s.forest !== null);
  const hasArena    = useGameStore((s) => s.arena !== null);
  const hasTactics  = useGameStore((s) => s.tactics !== null);
  const hasTombstone = useGameStore((s) => s.mineTombstone !== null);

  // Cheat flags
  const unlimitedGold     = useGameStore((s) => s.settings.unlimitedGold);
  const unlimitedEnergy   = useGameStore((s) => s.settings.unlimitedEnergy);
  const invincible        = useGameStore((s) => s.settings.invincible);
  const repeatMinigames   = useGameStore((s) => s.settings.repeatMinigames);
  const adventureRitual   = useGameStore((s) => s.settings.showAdventureRitual);

  return (
    <div className="border-t border-gold-deep/20 pt-3">
      {/* Collapse toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
        aria-expanded={open}
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-muted" />}
        <span className="font-display text-xs font-bold uppercase tracking-wider text-ink-muted">
          State inspector
        </span>
        <span className="ml-auto text-[10px] text-ink-light">read-only</span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">

          {/* Character */}
          <div className="space-y-1.5">
            <GroupLabel>Character</GroupLabel>
            <Row label="Level"  value={level} />
            <Row label="Class"  value={classId ?? 'none'} />
            <Row label="Gold"   value={gold} />
            <Row label="Energy" value={energy} />
          </div>

          {/* Stat levels — 2-column grid */}
          <div className="space-y-1.5">
            <GroupLabel>Stat levels</GroupLabel>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {STATS.map((s) => (
                <div key={s.id} className="flex items-baseline justify-between">
                  <span className="text-[11px] text-ink-muted">{s.short}</span>
                  <span className="text-[11px] font-bold tabular-nums text-gold-deep">
                    {statLevels[s.id]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Depth records */}
          <div className="space-y-1.5">
            <GroupLabel>Depth records</GroupLabel>
            <Row label="Dungeon floor"  value={deepestFloor} />
            <Row label="Mine floor"     value={deepestMineFloor} />
            <Row label="Forest stage"   value={deepestForestStage} />
            <Row label="Arena tier"     value={deepestArenaTier} />
            <Row label="Tactics tier"   value={deepestTacticsTier} />
          </div>

          {/* Pending */}
          <div className="space-y-1.5">
            <GroupLabel>Pending</GroupLabel>
            <Row
              label="Level-up trial"
              value={pendingLevelUp !== null ? `Lv ${pendingLevelUp}` : '—'}
            />
            <Row
              label="Class choice"
              value={pendingClassChoice !== null ? 'queued' : '—'}
            />
          </div>

          {/* Active runs */}
          <div className="space-y-1.5">
            <GroupLabel>Active runs</GroupLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="battle"    on={hasBattle} />
              <Chip label="dungeon"   on={hasDungeon} />
              <Chip label="mine"      on={hasMining} />
              <Chip label="forest"    on={hasForest} />
              <Chip label="arena"     on={hasArena} />
              <Chip label="tactics"   on={hasTactics} />
              <Chip label="tombstone" on={hasTombstone} />
            </div>
          </div>

          {/* Cheat flags */}
          <div className="space-y-1.5">
            <GroupLabel>Cheats active</GroupLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip label="∞ gold"      on={unlimitedGold} />
              <Chip label="∞ energy"    on={unlimitedEnergy} />
              <Chip label="invincible"  on={invincible} />
              <Chip label="re-trials"   on={repeatMinigames} />
              <Chip label="ritual"      on={adventureRitual} />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
