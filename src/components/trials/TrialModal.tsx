// Full-screen modal shell for Skill Trials.
// Shows: intro → active trial → result (score, stars, reward, Claim button).

import { useState, useCallback } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { getTrial, scoreToStars, trialReward, type TrialId } from '@/engine/trials/trials';
import { marchStartStamina, MARCH_START_STA } from '@/engine/trials/longMarch';
import { lockTolerance, PICK_BUDGET, NUM_LOCKS } from '@/engine/trials/lockpicking';
import { resume as sfxResume } from '@/lib/sfx';
import { getStat } from '@/engine/stats';
import { Button } from '@/components/ui/Button';
import { Lockpicking } from './games/Lockpicking';
import { RooftopChase } from './games/RooftopChase';
import { ArmoryBreak } from './games/ArmoryBreak';
import { LongMarch } from './games/LongMarch';
import { SpiritGrove } from './games/SpiritGrove';
import { RoyalCourt, type CourtChoiceRecord } from './games/RoyalCourt';
import { AncientLibrary } from './games/AncientLibrary';
import { LastStand } from './games/LastStand';

interface TrialModalProps {
  trialId: TrialId;
  onClose: () => void;
}

type Stage = 'intro' | 'playing' | 'result';

const TRIAL_DESCRIPTIONS: Record<TrialId, string> = {
  lockpicking: 'A pick sits inside the keyhole. Rotate it left and right to search for the sweet spot, then hold "Turn Lock" to apply torque. The cylinder will turn as far as the pick allows — if you\'re in the right spot it opens, otherwise it jams and the pick bends. Hold against a jam too long and the pick snaps. Three locks of rising difficulty; you have six picks — use them wisely.',
  rooftop_chase: 'Leap roof to roof across a medieval town — miss a gap and it\'s a long way down. Jump (Space / ↑) to bound over chimney stacks and guards, double-jump midair to correct your arc, and land on a guard\'s head for a stomp. When a banner is strung across the path, Slide (↓ / S) to duck under it. A beast picks up your trail after a while — once it appears, Dash (Shift / D) for a speed burst that throws it off. Run as far as you can.',
  armory_break: 'Hold the Charge button to power up the needle, then release it when it enters the golden zone. The needle passes through the zone — release too early or too late and you miss. Three locks of rising difficulty; aim for the centre of the zone for maximum accuracy.',
  long_march: 'Choose your pace for each terrain tile: Rest to recover stamina, Walk for steady progress, or Push for distance at great cost. Running out of stamina ends the march early.',
  spirit_grove: 'Read the omen carefully, then choose the blessing the spirits are truly offering. Each round a different omen appears — your wisdom is what separates the correct blessing from the false ones.',
  royal_court: 'Navigate the social landscape of court by choosing how you respond to each speaker. The favour meter rises and falls with your choices — read the room and earn the queen\'s respect. Bold responses marked 🎲 are Charisma gambits: you\'ll roll a d20 plus your CH modifier against a Difficulty Class. Succeed and you impress; fail and you stumble.',
  ancient_library: 'A sequence of glyphs will flash before you. After the display, tap them back in the same order. The sequence grows longer with each successful round.',
  last_stand: 'Enemy attacks telegraph their direction — Left, Center, or Right. Tap the matching block button before the attack lands. Miss too many and your endurance fails.',
};

function Stars({ count }: { count: 1 | 2 | 3 }) {
  return (
    <div className="flex justify-center gap-1 text-2xl">
      {Array.from({ length: 3 }, (_, i) => (
        <span key={i} className={i < count ? 'text-gold-bright' : 'text-parchment-400/40'}>
          ★
        </span>
      ))}
    </div>
  );
}

function GameComponent({
  trialId,
  onFinish,
  enLevel,
  chLevel,
}: {
  trialId: TrialId;
  onFinish: (s: number, history?: CourtChoiceRecord[]) => void;
  enLevel: number;
  chLevel: number;
}) {
  switch (trialId) {
    case 'lockpicking':     return <Lockpicking onFinish={onFinish} />;
    case 'rooftop_chase':   return <RooftopChase onFinish={onFinish} />;
    case 'armory_break':    return <ArmoryBreak onFinish={onFinish} />;
    case 'long_march':      return <LongMarch enLevel={enLevel} onFinish={onFinish} />;
    case 'spirit_grove':    return <SpiritGrove onFinish={onFinish} />;
    case 'royal_court':     return <RoyalCourt chLevel={chLevel} onFinish={onFinish} />;
    case 'ancient_library': return <AncientLibrary onFinish={onFinish} />;
    case 'last_stand':      return <LastStand onFinish={onFinish} />;
  }
}

export function TrialModal({ trialId, onClose }: TrialModalProps) {
  const def = getTrial(trialId);
  const stat = getStat(def.stat);
  const level   = useGameStore((s) => s.character.level);
  const enLevel = useGameStore((s) => s.character.statLevels?.EN ?? 0);
  const dxLevel = useGameStore((s) => s.character.statLevels?.DX ?? 0);
  const chLevel = useGameStore((s) => s.character.statLevels?.CH ?? 0);
  const bestTrialScore = useGameStore((s) => s.bestTrialScore);
  const completeTrial = useGameStore((s) => s.completeTrial);

  const prevBest = bestTrialScore[trialId] ?? 0;

  const [stage, setStage] = useState<Stage>('intro');
  const [score, setScore] = useState(0);
  const [claimed, setClaimed] = useState(false);
  const [isNewBest, setIsNewBest] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [courtHistory, setCourtHistory] = useState<CourtChoiceRecord[]>([]);

  const handleFinish = useCallback((s: number, history?: CourtChoiceRecord[]) => {
    completeTrial(trialId, s);
    setScore(s);
    setIsNewBest(s > prevBest);
    if (history && history.length > 0) setCourtHistory(history);
    setStage('result');
  }, [completeTrial, trialId, prevBest]);

  const handleClaim = () => {
    setClaimed(true);
  };

  const stars = scoreToStars(score);
  const reward = trialReward(def.stat, score, level);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-wood-900/95 backdrop-blur-sm overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gold-deep/30 px-4 py-3 texture-wood">
        <div className="flex items-center gap-2">
          <span className="text-xl">{def.glyph}</span>
          <div>
            <div className="font-display text-sm font-bold text-parchment-100">{def.name}</div>
            <div className="text-xs font-display" style={{ color: stat.color }}>{stat.name} Trial</div>
          </div>
        </div>
        {confirmingClose ? (
          <div className="flex items-center gap-2">
            <span className="text-xs font-display text-parchment-300">Abandon run?</span>
            <button
              onClick={onClose}
              className="rounded px-2 py-0.5 text-xs font-display text-red-400 hover:text-red-300 border border-red-400/40 hover:border-red-300/60"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmingClose(false)}
              className="rounded px-2 py-0.5 text-xs font-display text-parchment-300 hover:text-parchment-100 border border-parchment-400/30 hover:border-parchment-300/50"
            >
              No
            </button>
          </div>
        ) : (
          <button
            onClick={() => stage === 'playing' ? setConfirmingClose(true) : onClose()}
            className="rounded p-1 text-parchment-300 hover:text-parchment-100"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      {/* Body — rooftop chase uses a wider container to accommodate VIEW_W = 500 */}
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <div className={`w-full ${trialId === 'rooftop_chase' ? 'max-w-xl' : 'max-w-sm'}`}>
          {stage === 'intro' && (
            <div className="space-y-5">
              <div className="rounded-md border border-gold-deep/30 texture-parchment p-5 space-y-3">
                <p className="font-display text-sm font-bold text-ink">{def.name}</p>
                <p className="text-sm text-ink leading-relaxed">{TRIAL_DESCRIPTIONS[trialId]}</p>
                {trialId === 'long_march' && (() => {
                  const startSta = marchStartStamina(enLevel);
                  const bonus = startSta - MARCH_START_STA;
                  return (
                    <div className="rounded border border-emerald-600/30 bg-emerald-50/20 px-3 py-2 text-xs font-display text-ink-muted">
                      <span className="font-bold text-emerald-700">Endurance Lv.{enLevel}</span>
                      {bonus > 0
                        ? ` — grants +${bonus} starting stamina (${startSta} total).`
                        : ' — reach Lv. 3 to gain bonus starting stamina.'}
                    </div>
                  );
                })()}
                {trialId === 'lockpicking' && (() => {
                  const { toleranceDeg, openToleranceDeg } = lockTolerance(NUM_LOCKS - 1, level, dxLevel);
                  const dxBonus = dxLevel > 0;
                  return (
                    <div className="rounded border border-amber-600/30 bg-amber-50/20 px-3 py-2 text-xs font-display text-ink-muted">
                      <span className="font-bold text-amber-700">Dexterity Lv.{dxLevel}</span>
                      {dxBonus
                        ? ` — widens the Adept lock's turn zone to ${toleranceDeg.toFixed(1)}° (open zone ${openToleranceDeg.toFixed(1)}°).`
                        : ' — raising DX widens the sweet-spot zones for all locks.'}
                    </div>
                  );
                })()}
                {trialId === 'royal_court' && (
                  <div className="rounded border border-amber-600/30 bg-amber-50/20 px-3 py-2 text-xs font-display text-ink-muted">
                    <span className="font-bold text-amber-700">Charisma Lv.{chLevel}</span>
                    {chLevel > 0
                      ? ` — adds +${chLevel} to all 🎲 Charisma gambit rolls.`
                      : ' — raising CH adds a bonus to Charisma gambit rolls, making bold responses more reliable.'}
                  </div>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <div className="h-2 flex-1 rounded-full border border-gold-deep/20 bg-parchment-300/50" />
                  <span className="text-xs font-display text-ink-muted">Daily free attempt — stat XP + gold reward</span>
                  <div className="h-2 flex-1 rounded-full border border-gold-deep/20 bg-parchment-300/50" />
                </div>
                {prevBest > 0 && (
                  <div className="flex items-center gap-2 border-t border-gold-deep/20 pt-2">
                    <span className="text-xs text-ink-muted font-display">Best:</span>
                    <div className="flex gap-0.5 text-sm">
                      {Array.from({ length: 3 }, (_, i) => (
                        <span key={i} className={i < scoreToStars(prevBest) ? 'text-gold-bright' : 'text-parchment-400/40'}>★</span>
                      ))}
                    </div>
                    <span className="text-xs font-bold text-ink">{Math.round(prevBest * 100)}%</span>
                  </div>
                )}
              </div>
              <Button
                onClick={() => {
                  // Unlock the AudioContext from this user gesture before sounds
                  // need to play mid-trial (browser autoplay policy).
                  void sfxResume();
                  setStage('playing');
                }}
                className="w-full py-3 text-base"
              >
                Begin Trial
              </Button>
            </div>
          )}

          {stage === 'playing' && (
            <div className="space-y-4">
              <GameComponent trialId={trialId} onFinish={handleFinish} enLevel={enLevel} chLevel={chLevel} />
            </div>
          )}

          {stage === 'result' && (
            <div className="space-y-5">
              <div className="rounded-md border border-gold-deep/30 texture-parchment p-5 space-y-4">
                <div className="text-center space-y-2">
                  <div className="text-4xl">{def.glyph}</div>
                  <p className="font-display text-lg font-bold text-ink">Trial Complete</p>
                  <Stars count={stars} />
                  <p className="text-sm text-ink-muted">
                    Score: <strong className="text-ink">{Math.round(score * 100)}%</strong>
                  </p>
                  {isNewBest && (
                    <p className="text-xs font-display font-bold text-gold-deep animate-pulse">
                      ✨ New personal best!
                    </p>
                  )}
                </div>

                <div className="rounded-md border border-gold-deep/20 bg-parchment-100/60 p-3 space-y-1">
                  <p className="font-display text-xs font-bold text-ink-muted uppercase tracking-wider">Reward</p>
                  {reward.gold != null && (
                    <div className="flex items-center justify-between text-sm text-ink">
                      <span>Gold</span>
                      <span className="font-bold text-gold-deep">+{reward.gold} 🪙</span>
                    </div>
                  )}
                  {reward.statXp && Object.entries(reward.statXp).map(([s, xp]) => (
                    <div key={s} className="flex items-center justify-between text-sm text-ink">
                      <span>{getStat(s as typeof def.stat).name} XP</span>
                      <span className="font-bold" style={{ color: getStat(s as typeof def.stat).color }}>
                        +{xp} XP
                      </span>
                    </div>
                  ))}
                  {/* Picks saved — derived from score using the linear formula score = 0.5 + 0.5 * picks / budget */}
                  {trialId === 'lockpicking' && score >= 0.5 && (() => {
                    const saved = Math.round((score - 0.5) * 2 * PICK_BUDGET);
                    return (
                      <div className="flex items-center justify-between text-sm text-ink border-t border-gold-deep/20 pt-1 mt-1">
                        <span>Picks saved</span>
                        <span className="font-bold text-amber-700">{saved} / {PICK_BUDGET} 🗝️</span>
                      </div>
                    );
                  })()}
                </div>

                {/* Per-exchange recap — only rendered after a Royal Court run */}
                {courtHistory.length > 0 && (
                  <div className="rounded-md border border-gold-deep/20 bg-parchment-100/60 p-3 space-y-2">
                    <p className="font-display text-xs font-bold text-ink-muted uppercase tracking-wider">Exchange Recap</p>
                    {courtHistory.map((record, i) => (
                      <div key={i} className="space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-display font-semibold text-ink-muted truncate">{record.npc}</span>
                          <span className={`shrink-0 text-[11px] font-bold ${
                            record.favorDelta > 0 ? 'text-emerald-700' : record.favorDelta < 0 ? 'text-rose-600' : 'text-ink-muted'
                          }`}>
                            {record.favorDelta > 0 ? `+${record.favorDelta}` : record.favorDelta === 0 ? '±0' : record.favorDelta}
                          </span>
                        </div>
                        <p className="text-[11px] text-ink-muted italic leading-snug line-clamp-2">{record.label}</p>
                        {record.check && (
                          <p className={`text-[10px] font-display ${record.check.success ? 'text-emerald-700' : 'text-rose-600'}`}>
                            {record.check.natural === 'crit'
                              ? '🎲 Natural 20 — Critical Success!'
                              : record.check.natural === 'fumble'
                                ? '🎲 Natural 1 — Critical Fumble!'
                                : `🎲 ${record.check.roll}${record.check.modifier !== 0 ? ` ${record.check.modifier >= 0 ? '+' : '−'} ${Math.abs(record.check.modifier)} = ${record.check.total}` : ` = ${record.check.total}`} vs DC ${record.check.dc} — ${record.check.success ? 'Success' : 'Failed'}`
                            }
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!claimed ? (
                <Button onClick={handleClaim} className="w-full py-3">
                  Continue
                </Button>
              ) : (
                <Button variant="secondary" onClick={onClose} className="w-full py-3">
                  Return to Trials
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
