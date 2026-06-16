// Spirit Grove trial — WI.
// Read an omen, pick the blessing the spirit is truly offering. 3 rounds.

import { useState, useMemo } from 'react';
import {
  SPIRIT_GROVE_ROUNDS,
  SPIRIT_GROVE_ROUND_COUNT,
} from '@/content/trials';

interface SpiritGroveProps {
  onFinish: (score01: number) => void;
}

function pickRounds(rounds: typeof SPIRIT_GROVE_ROUNDS): typeof SPIRIT_GROVE_ROUNDS {
  // Deterministic-ish selection per call: shuffle and take first N.
  const shuffled = [...rounds].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, SPIRIT_GROVE_ROUND_COUNT);
}

export function SpiritGrove({ onFinish }: SpiritGroveProps) {
  const rounds = useMemo(() => pickRounds(SPIRIT_GROVE_ROUNDS), []);
  const [roundIndex, setRoundIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [roundsCompleted, setRoundsCompleted] = useState<{ correct: boolean; chosen: number }[]>([]);
  const [done, setDone] = useState(false);

  const round = rounds[roundIndex];

  const choose = (choiceIdx: number) => {
    if (selected !== null || done) return;
    setSelected(choiceIdx);
    const correct = choiceIdx === round.correctIndex;
    const newCorrect = correctCount + (correct ? 1 : 0);
    const newCompleted = [...roundsCompleted, { correct, chosen: choiceIdx }];
    setCorrectCount(newCorrect);
    setRoundsCompleted(newCompleted);

    setTimeout(() => {
      if (roundIndex + 1 >= rounds.length) {
        setDone(true);
        onFinish(newCorrect / rounds.length);
      } else {
        setRoundIndex(roundIndex + 1);
        setSelected(null);
      }
    }, 900);
  };

  return (
    <div className="flex flex-col gap-5 px-2">
      {/* Header */}
      <div className="flex items-center justify-between text-xs font-display text-ink-muted">
        <span>Round {roundIndex + 1} of {rounds.length}</span>
        <span>
          {Array.from({ length: rounds.length }, (_, i) => {
            if (i >= roundsCompleted.length) return '○';
            return roundsCompleted[i].correct ? '✓' : '✗';
          }).join(' ')}
        </span>
      </div>

      {!done ? (
        <>
          {/* Omen */}
          <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-4">
            <div className="mb-1 font-display text-xs font-bold text-ink-muted uppercase tracking-wider">Omen</div>
            <p className="text-sm italic text-ink">{round.omen}</p>
          </div>

          {/* Choices */}
          <div className="space-y-2">
            {round.choices.map((choice, idx) => {
              const isSelected = selected === idx;
              const isCorrect = selected !== null && idx === round.correctIndex;
              const isWrong = isSelected && idx !== round.correctIndex;
              return (
                <button
                  key={idx}
                  onClick={() => choose(idx)}
                  disabled={selected !== null}
                  className={`w-full rounded-md border px-4 py-3 text-left font-display text-sm transition-colors ${
                    isCorrect
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : isWrong
                        ? 'border-rose-400 bg-rose-50 text-rose-800'
                        : selected !== null
                          ? 'border-gold-deep/20 bg-parchment-200/60 text-ink-muted opacity-50'
                          : 'border-gold-deep/40 bg-parchment-100/70 text-ink hover:border-gold-bright hover:bg-gold-bright/10'
                  }`}
                >
                  <span className="font-bold">{choice.label}</span>
                  {choice.clue && (
                    <span className="ml-2 text-xs opacity-60">{choice.clue}</span>
                  )}
                  {isCorrect && selected !== null && ' ✓'}
                  {isWrong && ' ✗'}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-3 text-center">
          <div className="text-3xl">{correctCount === rounds.length ? '🌿✨' : correctCount >= 2 ? '🌿' : '🍂'}</div>
          <p className="font-display text-sm text-ink">
            {correctCount === rounds.length
              ? 'The grove spirits bless you with full favour.'
              : correctCount >= 2
                ? 'The spirits nod their approval.'
                : 'The grove remains silent — seek deeper wisdom.'}
          </p>
          <p className="text-xs text-ink-muted">{correctCount} / {rounds.length} omens read correctly</p>
        </div>
      )}
    </div>
  );
}
