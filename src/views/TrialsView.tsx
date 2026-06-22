// Skill Trials hub — shows 8 stat-specific daily challenge cards.
// One attempt per trial per calendar day; costs 1 energy per trial (§6.1).
// Each trial also requires a habit of its stat completed within the last 7 days (§4.4).

import { useState } from 'react';
import { Target } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { TRIALS, TRIALS_UNLOCK_LEVEL, TRIAL_ENERGY_COST, scoreToStars, type TrialId } from '@/engine/trials/trials';
import { statCompletedWithin } from '@/engine/habits';
import { getStat } from '@/engine/stats';
import { toISODate } from '@/engine/date';
import { SectionTitle } from '@/components/ui/Divider';
import { Panel } from '@/components/ui/Panel';
import { TrialModal } from '@/components/trials/TrialModal';
import { AdventureRitualModal } from '@/components/minigame/AdventureRitualModal';

function formatShortDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(parts[1], 10) - 1]} ${parseInt(parts[2], 10)}`;
}

function StarRow({ count }: { count: 0 | 1 | 2 | 3 }) {
  if (count === 0) return null;
  return (
    <div className="flex gap-0.5 text-xs">
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className={i < count ? 'text-gold-bright' : 'text-parchment-400/30'}>★</span>
      ))}
    </div>
  );
}

export function TrialsView() {
  const level = useGameStore((s) => s.character.level);
  const energy = useGameStore((s) => s.character.energy);
  const unlimitedEnergy = useGameStore((s) => s.settings.unlimitedEnergy);
  const trialsClearedOn = useGameStore((s) => s.trialsClearedOn);
  const bestTrialScore = useGameStore((s) => s.bestTrialScore);
  const repeatMinigames = useGameStore((s) => s.settings.repeatMinigames);
  const habits = useGameStore((s) => s.habits);
  const showAdventureRitual = useGameStore((s) => s.settings.showAdventureRitual);
  const [openTrial, setOpenTrial] = useState<TrialId | null>(null);
  const [pendingTrialId, setPendingTrialId] = useState<TrialId | null>(null);

  const today = toISODate();
  const unlocked = level >= TRIALS_UNLOCK_LEVEL;
  const canAfford = unlimitedEnergy || energy >= TRIAL_ENERGY_COST;

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
      <SectionTitle tone="wood">Skill Trials</SectionTitle>

      <Panel tone="parchment" className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-gold-deep" />
          <p className="font-display text-sm text-ink">
            Eight daily challenges — one for each stat. Each trial costs <span className="font-semibold">⚡ {TRIAL_ENERGY_COST}</span> and is playable once per day, rewarding stat XP and gold scaled by your score. Complete a habit of the matching stat within 7 days to unlock each trial.
          </p>
        </div>
        {!unlocked && (
          <p className="text-sm text-ink-muted">
            Trials unlock at Level {TRIALS_UNLOCK_LEVEL}. Keep completing habits to level up.
          </p>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-3">
        {TRIALS.map((trial) => {
          const stat = getStat(trial.stat);
          const clearedToday = !repeatMinigames && trialsClearedOn[trial.id] === today;
          const best = bestTrialScore[trial.id] ?? 0;
          const bestStars = best > 0 ? scoreToStars(best) : 0;
          // Stat gate: must have a habit of this stat completed within 7 days (§4.4).
          const statReady = repeatMinigames || statCompletedWithin(habits, trial.stat, today, 7);
          const blocked = !unlocked || clearedToday || !statReady || !canAfford;

          return (
            <button
              key={trial.id}
              onClick={() => {
                if (blocked) return;
                if (showAdventureRitual) { setPendingTrialId(trial.id); } else { setOpenTrial(trial.id); }
              }}
              disabled={blocked}
              className={`relative rounded-md border-2 p-3 text-left transition-all ${
                !unlocked
                  ? 'border-gold-deep/20 bg-parchment-300/30 opacity-50 cursor-not-allowed'
                  : clearedToday
                    ? 'border-emerald-500/40 bg-emerald-50/30 cursor-default'
                    : !statReady
                      ? 'border-ink-light/30 bg-parchment-300/30 opacity-60 cursor-not-allowed'
                      : !canAfford
                        ? 'border-ink-light/30 bg-parchment-300/30 opacity-60 cursor-not-allowed'
                        : 'border-gold-deep/40 bg-parchment-100/80 hover:border-gold-bright hover:shadow-gold active:scale-95 cursor-pointer'
              }`}
            >
              {/* Status badge — priority: done → locked → no-stat → no-energy → ready */}
              <div className="absolute right-2 top-2">
                {clearedToday ? (
                  <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-display font-bold text-emerald-700">
                    ✓ Done
                  </span>
                ) : !unlocked ? (
                  <span className="text-[10px] text-ink-muted">🔒</span>
                ) : !statReady ? (
                  <span className="rounded-full bg-ink-light/10 px-1.5 py-0.5 text-[10px] font-display font-bold text-ink-muted">
                    Need {stat.name}
                  </span>
                ) : !canAfford ? (
                  <span className="rounded-full bg-ink-light/10 px-1.5 py-0.5 text-[10px] font-display font-bold text-ink-muted">
                    Need ⚡
                  </span>
                ) : (
                  <span className="rounded-full bg-gold-bright/20 px-1.5 py-0.5 text-[10px] font-display font-bold text-gold-deep">
                    ⚡ {TRIAL_ENERGY_COST}
                  </span>
                )}
              </div>

              {/* Icon + name */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xl">{trial.glyph}</span>
                <div>
                  <div className="font-display text-sm font-bold text-ink leading-tight">{trial.name}</div>
                  <div className="text-[11px] font-display font-semibold" style={{ color: stat.color }}>
                    {stat.name}
                  </div>
                </div>
              </div>

              {/* Blurb */}
              <p className="text-[11px] text-ink-muted leading-snug mb-2">{trial.blurb}</p>

              {/* Best score stars + percentage */}
              {bestStars > 0 ? (
                <div className="flex items-center gap-2">
                  <StarRow count={bestStars as 1 | 2 | 3} />
                  <span className="text-[10px] text-ink-muted font-display">{Math.round(best * 100)}%</span>
                </div>
              ) : (
                <div className="text-[10px] text-ink-muted/60 font-display">No record yet</div>
              )}
              {/* Last-cleared date (shown when cleared on a previous day) */}
              {trialsClearedOn[trial.id] && !clearedToday && (
                <div className="text-[10px] text-ink-muted/50 font-display mt-0.5">
                  Last: {formatShortDate(trialsClearedOn[trial.id])}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Adventure ritual gate */}
      {pendingTrialId && (
        <AdventureRitualModal
          energyCost={TRIAL_ENERGY_COST}
          onConfirm={() => { setOpenTrial(pendingTrialId); setPendingTrialId(null); }}
          onCancel={() => setPendingTrialId(null)}
        />
      )}

      {/* Trial modal */}
      {openTrial && (
        <TrialModal
          trialId={openTrial}
          onClose={() => setOpenTrial(null)}
        />
      )}
    </div>
  );
}
