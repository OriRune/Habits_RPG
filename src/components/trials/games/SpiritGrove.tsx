// Spirit Grove trial — WI.
// Read an omen, pick the blessing the spirit is truly offering. 5 rounds.

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import * as sfx from '@/lib/sfx';
import {
  SPIRIT_GROVE_ROUNDS,
} from '@/content/trials';
import {
  type RoundResult,
  prepareRounds,
  spiritGroveScore,
  validateSpiritGroveRounds,
  clueVisible,
} from '@/engine/trials/spiritGrove';
import { seededRng, dailySeed } from '@/engine/trials/ancientLibrary';
import { toISODate } from '@/engine/date';
import { useGameStore } from '@/store/useGameStore';

const ROUND_TRANSITION_MS = 700;

interface SpiritGroveProps {
  onFinish: (score01: number) => void;
  /** MINI-11: per-attempt nonce seeds the round draft so reopening can't redraw-scum for an easy set. */
  attemptNonce: number;
}

if (import.meta.env.DEV) {
  validateSpiritGroveRounds(SPIRIT_GROVE_ROUNDS);
}

export function SpiritGrove({ onFinish, attemptNonce }: SpiritGroveProps) {
  // WI gates clue visibility; best score triggers mastery mode (harder draft).
  const wi   = useGameStore((s) => s.character.statLevels.WI ?? 0);
  const best = useGameStore((s) => s.bestTrialScore['spirit_grove'] ?? 0);
  // MINI-16: bias the draft toward rounds the player hasn't seen yet.
  const spiritGroveSeen = useGameStore((s) => s.spiritGroveSeen);
  const markSpiritGroveSeen = useGameStore((s) => s.markSpiritGroveSeen);

  const prepared = useMemo(
    // MINI-11: draft off the daily seed XOR the per-attempt nonce instead of raw Math.random, so
    // the round set is deterministic within an attempt (matches Library's mechanism, and is
    // testable). NOTE: this does NOT by itself close reroll-for-a-known-draw — the nonce advances
    // on every Begin, so reopening still yields a fresh set. That residual is inherent to free
    // abandonment (MINI-11's named root cause) and would need a cost on abandon to close; left out
    // of this seed-scoped item. The difficulty mix is fixed (1E/2M/2H) so there's no strictly
    // easier set to fish for, only a familiar-questions one.
    // `spiritGroveSeen` is intentionally NOT a dep: the draft must stay stable within an attempt,
    // and seen only changes on completion (which unmounts this component via the result stage), so
    // the mount-time value is correct.
    () => prepareRounds(SPIRIT_GROVE_ROUNDS, seededRng(dailySeed(toISODate()) ^ attemptNonce), { harder: best >= 1, seen: new Set(spiritGroveSeen) }),
    // Re-draft only when mastery mode changes (best crosses 0→1) or a new attempt begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [best >= 1, attemptNonce],
  );

  const [roundIndex, setRoundIndex] = useState(0);
  const [selectedDisplay, setSelectedDisplay] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [done, setDone] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stores the pending advance function so skip-tap can fire it early. */
  const advanceFnRef = useRef<(() => void) | null>(null);

  // Cancel any pending transition on unmount.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const { round, displayOrder } = prepared[roundIndex];
  const correctDisplayPos = displayOrder.indexOf(round.correctIndex);
  // Whether clue text is visible at the player's current Wisdom level.
  const showClues = clueVisible(round.difficulty, wi);

  const skipTransition = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (advanceFnRef.current) { const fn = advanceFnRef.current; advanceFnRef.current = null; fn(); }
  };

  const choose = useCallback((displayIdx: number) => {
    if (selectedDisplay !== null || done) return;

    const originalIdx = displayOrder[displayIdx];
    const correct = originalIdx === round.correctIndex;
    const newCorrect = correctCount + (correct ? 1 : 0);
    const newResults = [...results, { correct, chosenDisplay: displayIdx }];

    setSelectedDisplay(displayIdx);
    setCorrectCount(newCorrect);
    setResults(newResults);
    setShowFeedback(true);

    sfx.play(correct ? 'groveCorrect' : 'groveWrong');

    const isFinal = roundIndex + 1 >= prepared.length;
    const advance = () => {
      advanceFnRef.current = null;
      if (isFinal) {
        setDone(true);
        // MINI-16: mark every drafted round seen on completion only (not per-round, not on abandon).
        markSpiritGroveSeen(prepared.map((p) => p.round.id));
        onFinish(spiritGroveScore(newCorrect, prepared.length));
      } else {
        setRoundIndex((prev) => prev + 1);
        setSelectedDisplay(null);
        setShowFeedback(false);
      }
    };

    advanceFnRef.current = advance;
    timerRef.current = setTimeout(advance, ROUND_TRANSITION_MS);
  }, [selectedDisplay, done, displayOrder, round.correctIndex, correctCount, results, roundIndex, prepared, onFinish]);

  // Keys 1–4 select the choice at that display position.
  useEffect(() => {
    if (done || selectedDisplay !== null) return;
    const handler = (e: KeyboardEvent) => {
      const idx = parseInt(e.key, 10) - 1;
      if (idx >= 0 && idx < round.choices.length) choose(idx);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [done, selectedDisplay, round.choices.length, choose]);

  const totalRounds = prepared.length;

  return (
    <div className="flex flex-col gap-5 px-2">

      {/* ── Header ── */}
      <div className="flex items-center justify-between text-xs font-display text-ink-muted">
        <span>Round {roundIndex + 1} of {totalRounds}</span>
        <span className="flex gap-1.5" aria-label="Round results">
          {Array.from({ length: totalRounds }, (_, i) => {
            const isDone = i < results.length;
            const isCorrect = isDone && results[i].correct;
            return (
              <span
                key={i}
                className={`inline-block transition-all duration-300 ${isDone ? 'scale-110' : ''} ${
                  isCorrect ? 'text-emerald-600' : isDone ? 'text-rose-500' : 'text-ink-muted/40'
                }`}
              >
                {isDone ? (isCorrect ? '✓' : '✗') : '○'}
              </span>
            );
          })}
        </span>
      </div>

      {!done ? (
        <>
          {/* ── Omen ── */}
          <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-4">
            <div className="mb-1 font-display text-xs font-bold text-ink-muted uppercase tracking-wider">Omen</div>
            <p className="text-sm italic text-ink">{round.omen}</p>
          </div>

          {/* ── Choices ── */}
          <div className="space-y-2" role="group" aria-label="Choose a blessing">
            {displayOrder.map((originalIdx, displayIdx) => {
              const choice = round.choices[originalIdx];
              const isSelected = selectedDisplay === displayIdx;
              const isCorrectReveal = selectedDisplay !== null && displayIdx === correctDisplayPos;
              const isWrong = isSelected && originalIdx !== round.correctIndex;
              return (
                <button
                  key={displayIdx}
                  onClick={() => choose(displayIdx)}
                  disabled={selectedDisplay !== null}
                  aria-label={`${displayIdx + 1}. ${choice.label}${(showClues && choice.clue) ? ` — ${choice.clue}` : ''}`}
                  aria-pressed={isSelected}
                  className={`w-full rounded-md border px-4 py-3 text-left font-display text-sm transition-all duration-200 ${
                    isCorrectReveal
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800 scale-[1.02] shadow-sm shadow-emerald-200/60'
                      : isWrong
                        ? 'border-rose-400 bg-rose-50 text-rose-800 animate-shake'
                        : selectedDisplay !== null
                          ? 'border-gold-deep/20 bg-parchment-200/60 text-ink-muted opacity-50'
                          : 'border-gold-deep/40 bg-parchment-100/70 text-ink hover:border-gold-bright hover:bg-gold-bright/10'
                  }`}
                >
                  <span className="text-[10px] text-ink-muted/50 mr-2 font-mono select-none">[{displayIdx + 1}]</span>
                  <span className="font-bold">{choice.label}</span>
                  {showClues && choice.clue && (
                    <span className="ml-2 text-xs opacity-60">{choice.clue}</span>
                  )}
                  {isCorrectReveal && selectedDisplay !== null && <span className="ml-1">✓</span>}
                  {isWrong && <span className="ml-1">✗</span>}
                </button>
              );
            })}
          </div>

          {/* ── Feedback / explanation (shown after selection) ── */}
          {showFeedback && (
            <button
              onClick={skipTransition}
              className="w-full rounded-md border border-gold-deep/20 bg-parchment-200/50 px-4 py-2.5 text-left text-xs text-ink-muted hover:bg-parchment-200/80 transition-colors"
            >
              {round.explanation && (
                <span className="italic">{round.explanation}</span>
              )}
              <span className={`block text-[10px] text-ink-muted/50 not-italic ${round.explanation ? 'mt-1' : ''}`}>
                Tap to continue →
              </span>
            </button>
          )}
        </>
      ) : (
        <>
          {/* ── Result summary ── */}
          <div className="space-y-2 text-center">
            <div className="text-3xl">
              {correctCount === totalRounds
                ? '🌿✨'
                : correctCount >= Math.ceil(totalRounds * 0.6)
                  ? '🌿'
                  : '🍂'}
            </div>
            <p className="font-display text-sm text-ink">
              {correctCount === totalRounds
                ? 'The grove spirits bless you with full favour.'
                : correctCount >= Math.ceil(totalRounds * 0.6)
                  ? 'The spirits nod their approval.'
                  : 'The grove remains silent — seek deeper wisdom.'}
            </p>
            <p className="text-xs text-ink-muted">{correctCount} / {totalRounds} omens read correctly</p>
          </div>

          {/* ── Per-round recap ── */}
          <div className="space-y-2">
            {results.map((result, i) => {
              const pr = prepared[i];
              const chosenLabel = pr.round.choices[pr.displayOrder[result.chosenDisplay]].label;
              const correctLabel = pr.round.choices[pr.round.correctIndex].label;
              return (
                <div
                  key={i}
                  className={`rounded-md border px-3 py-2 text-xs ${
                    result.correct
                      ? 'border-emerald-500/40 bg-emerald-50/50'
                      : 'border-rose-400/40 bg-rose-50/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 font-bold">
                      {result.correct ? '✓' : '✗'}
                    </span>
                    <div className="min-w-0">
                      <p className="italic text-ink-muted leading-snug">{pr.round.omen}</p>
                      <p className="mt-0.5 font-bold text-ink">{correctLabel}</p>
                      {!result.correct && (
                        <p className="text-rose-600/70">You chose: {chosenLabel}</p>
                      )}
                      {pr.round.explanation && (
                        <p className="mt-1 text-ink-muted/70 not-italic leading-snug">
                          {pr.round.explanation}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
