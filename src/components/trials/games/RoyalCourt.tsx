// Royal Court trial — CH.
// Navigate social exchanges at court; choose responses that build favour with the queen.

import { useState, useMemo } from 'react';
import * as sfx from '@/lib/sfx';
import {
  ROYAL_COURT_EXCHANGES,
  ROYAL_COURT_EXCHANGE_COUNT,
  type CourtExchange,
} from '@/content/trials';

// Time (ms) a chosen response is visible before the scene transitions.
const ADVANCE_DELAY_MS = 700;
// Duration (ms) of the fade-out/fade-in between exchanges.
const TRANSITION_MS = 180;

export interface CourtChoiceRecord {
  npc: string;
  label: string;
  favorDelta: number;
}

interface RoyalCourtProps {
  onFinish: (score01: number, history: CourtChoiceRecord[]) => void;
}

function pickExchanges(exchanges: CourtExchange[]): CourtExchange[] {
  const arr = [...exchanges];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, ROYAL_COURT_EXCHANGE_COUNT);
}

export function RoyalCourt({ onFinish }: RoyalCourtProps) {
  const exchanges = useMemo(() => pickExchanges(ROYAL_COURT_EXCHANGES), []);
  // Max possible favour = sum of the best choice delta across all selected exchanges.
  const maxFavor = useMemo(
    () => exchanges.reduce((sum, e) => sum + Math.max(...e.choices.map((c) => c.favorDelta)), 0),
    [exchanges],
  );

  if (import.meta.env.DEV && maxFavor <= 0) {
    console.error('RoyalCourt: maxFavor is 0 or negative — every exchange needs at least one positive favorDelta (see src/content/trials.ts)');
  }

  const [exchangeIndex, setExchangeIndex] = useState(0);
  const [favor, setFavor] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [choiceHistory, setChoiceHistory] = useState<CourtChoiceRecord[]>([]);

  const exchange = exchanges[exchangeIndex];

  const choose = (choiceIdx: number) => {
    if (selected !== null || done || transitioning) return;
    const choice = exchange.choices[choiceIdx];
    setSelected(choiceIdx);

    const newFavor = Math.max(0, favor + choice.favorDelta);
    setFavor(newFavor);

    const newHistory: CourtChoiceRecord[] = [
      ...choiceHistory,
      { npc: exchange.npc, label: choice.label, favorDelta: choice.favorDelta },
    ];
    setChoiceHistory(newHistory);

    if (choice.favorDelta > 0) sfx.play('courtFavor');
    else if (choice.favorDelta < 0) sfx.play('courtDisfavor');

    const isLast = exchangeIndex + 1 >= exchanges.length;
    setTimeout(() => {
      if (isLast) {
        setDone(true);
        sfx.play('courtComplete');
        onFinish(Math.min(1, Math.max(0, newFavor / maxFavor)), newHistory);
      } else {
        setTransitioning(true);
        setTimeout(() => {
          setExchangeIndex((i) => i + 1);
          setSelected(null);
          setTransitioning(false);
        }, TRANSITION_MS);
      }
    }, ADVANCE_DELAY_MS);
  };

  const favorPct = maxFavor > 0 ? Math.min(100, (favor / maxFavor) * 100) : 0;

  // Bar shifts from rose → amber → emerald as the player crosses star thresholds.
  const barColor =
    favorPct >= 75 ? 'bg-emerald-500/70' : favorPct >= 40 ? 'bg-amber-400/70' : 'bg-rose-400/60';

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
            className={`h-full transition-all duration-500 ${barColor}`}
            style={{ width: `${favorPct}%` }}
          />
        </div>
      </div>

      {/* Exchange counter */}
      <div className="text-xs font-display text-ink-muted">
        Exchange {exchangeIndex + 1} of {exchanges.length}
      </div>

      {!done ? (
        <div
          className="space-y-3"
          style={{
            opacity: transitioning ? 0 : 1,
            transition: `opacity ${TRANSITION_MS}ms ease`,
          }}
        >
          {/* NPC dialogue */}
          <div className="rounded-md border border-gold-deep/30 bg-parchment-100/70 p-4">
            <div className="mb-1 flex items-center gap-1.5 font-display text-xs font-bold text-ink-muted">
              {exchange.icon && <span>{exchange.icon}</span>}
              <span>{exchange.npc}</span>
            </div>
            <p className="text-sm italic text-ink">{exchange.dialogue}</p>
          </div>

          {/* Choices — delta is hidden until the result recap */}
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
                </button>
              );
            })}
          </div>
        </div>
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
