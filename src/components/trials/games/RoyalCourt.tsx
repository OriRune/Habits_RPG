// Royal Court trial — CH.
// Navigate social exchanges at court; choose responses that build favour with the queen.

import { useState, useMemo } from 'react';
import {
  ROYAL_COURT_EXCHANGES,
  ROYAL_COURT_EXCHANGE_COUNT,
} from '@/content/trials';

interface RoyalCourtProps {
  onFinish: (score01: number) => void;
}

function pickExchanges(exchanges: typeof ROYAL_COURT_EXCHANGES): typeof ROYAL_COURT_EXCHANGES {
  const shuffled = [...exchanges].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, ROYAL_COURT_EXCHANGE_COUNT);
}

export function RoyalCourt({ onFinish }: RoyalCourtProps) {
  const exchanges = useMemo(() => pickExchanges(ROYAL_COURT_EXCHANGES), []);
  // Max possible favour = sum of best choice per exchange
  const maxFavor = useMemo(
    () => exchanges.reduce((sum, e) => sum + Math.max(...e.choices.map((c) => c.favorDelta)), 0),
    [exchanges],
  );

  const [exchangeIndex, setExchangeIndex] = useState(0);
  const [favor, setFavor] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const exchange = exchanges[exchangeIndex];

  const choose = (choiceIdx: number) => {
    if (selected !== null || done) return;
    const choice = exchange.choices[choiceIdx];
    setSelected(choiceIdx);
    const newFavor = Math.max(0, favor + choice.favorDelta);
    setFavor(newFavor);

    setTimeout(() => {
      if (exchangeIndex + 1 >= exchanges.length) {
        setDone(true);
        // Score = clamp(favor / maxFavor, 0, 1)
        onFinish(Math.min(1, Math.max(0, newFavor / maxFavor)));
      } else {
        setExchangeIndex(exchangeIndex + 1);
        setSelected(null);
      }
    }, 900);
  };

  const favorPct = maxFavor > 0 ? Math.min(100, (favor / maxFavor) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 px-2">
      {/* Favour bar */}
      <div>
        <div className="mb-1 flex justify-between text-xs font-display text-ink-muted">
          <span>👑 Court Favour</span>
          <span>{Math.round(favorPct)}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full border border-gold-deep/30 bg-parchment-300/50">
          <div
            className="h-full bg-gold-bright/70 transition-all duration-500"
            style={{ width: `${favorPct}%` }}
          />
        </div>
      </div>

      {/* Exchange header */}
      <div className="text-xs font-display text-ink-muted">
        Exchange {exchangeIndex + 1} of {exchanges.length}
      </div>

      {!done ? (
        <>
          {/* NPC dialogue */}
          <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-4">
            <div className="mb-1 font-display text-xs font-bold text-ink-muted">{exchange.npc}</div>
            <p className="text-sm italic text-ink">{exchange.dialogue}</p>
          </div>

          {/* Choices */}
          <div className="space-y-2">
            {exchange.choices.map((choice, idx) => {
              const isSelected = selected === idx;
              const positive = choice.favorDelta > 0;
              const negative = choice.favorDelta < 0;
              return (
                <button
                  key={idx}
                  onClick={() => choose(idx)}
                  disabled={selected !== null}
                  className={`w-full rounded-md border px-4 py-3 text-left font-display text-sm transition-colors ${
                    isSelected && positive
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                      : isSelected && negative
                        ? 'border-rose-400 bg-rose-50 text-rose-800'
                        : isSelected
                          ? 'border-gold-deep/40 bg-parchment-200/60 text-ink'
                          : selected !== null
                            ? 'border-gold-deep/20 bg-parchment-200/40 text-ink-muted opacity-40'
                            : 'border-gold-deep/40 bg-parchment-100/70 text-ink hover:border-gold-bright hover:bg-gold-bright/10'
                  }`}
                >
                  {choice.label}
                  {isSelected && (
                    <span className="ml-2 text-xs font-bold">
                      {positive ? `(+${choice.favorDelta} favour ✓)` : negative ? `(${choice.favorDelta} favour ✗)` : '(neutral)'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-3 text-center">
          <div className="text-3xl">{favorPct >= 75 ? '👑✨' : favorPct >= 40 ? '👑' : '🎭'}</div>
          <p className="font-display text-sm text-ink">
            {favorPct >= 75
              ? 'The queen is most impressed. You leave with her full backing.'
              : favorPct >= 40
                ? 'A reasonable performance. The queen grants a modest nod of approval.'
                : 'The court whispers. You leave with your dignity, at least.'}
          </p>
          <p className="text-xs text-ink-muted">Final favour: {Math.round(favorPct)}%</p>
        </div>
      )}
    </div>
  );
}
