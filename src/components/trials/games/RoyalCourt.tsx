// Royal Court trial — CH.
// Navigate social exchanges at court; choose responses that build favour with the queen.
// Some responses are Charisma gambits: resolved by a d20 + CH modifier roll vs. a DC.

import { useState, useMemo, useRef } from 'react';
import * as sfx from '@/lib/sfx';
import {
  ROYAL_COURT_EXCHANGES,
  ROYAL_COURT_EXCHANGE_COUNT,
  type CourtExchange,
} from '@/content/trials';
import {
  courtCheckModifier,
  resolveCourtCheck,
  rollD20,
  type CourtCheckResult,
} from '@/engine/trials/royalCourt';

// Time (ms) a chosen response is visible before the scene transitions.
const ADVANCE_DELAY_MS = 700;
// Duration (ms) of the fade-out/fade-in between exchanges.
const TRANSITION_MS = 180;
// Duration (ms) of the die-face cycling animation before the result is revealed.
const ROLL_ANIM_MS = 650;

export interface CourtChoiceRecord {
  npc: string;
  label: string;
  /** Actual favour applied — success delta on a passed check, failDelta on a failed one. */
  favorDelta: number;
  /** Present only when the chosen response was a Charisma gambit. */
  check?: {
    dc: number;
    roll: number;
    modifier: number;
    total: number;
    success: boolean;
    natural: CourtCheckResult['natural'];
  };
}

interface RoyalCourtProps {
  onFinish: (score01: number, history: CourtChoiceRecord[]) => void;
  chLevel: number;
}

function pickExchanges(exchanges: CourtExchange[]): CourtExchange[] {
  const arr = [...exchanges];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, ROYAL_COURT_EXCHANGE_COUNT);
}

export function RoyalCourt({ onFinish, chLevel }: RoyalCourtProps) {
  const exchanges = useMemo(() => pickExchanges(ROYAL_COURT_EXCHANGES), []);
  // Max possible favour = sum of the best choice delta across all selected exchanges.
  // Gambit favorDelta = success payoff, so a perfect run = passing every gambit.
  const maxFavor = useMemo(
    () => exchanges.reduce((sum, e) => sum + Math.max(...e.choices.map((c) => c.favorDelta)), 0),
    [exchanges],
  );

  if (import.meta.env.DEV && maxFavor <= 0) {
    console.error('RoyalCourt: maxFavor is 0 or negative — every exchange needs at least one positive favorDelta (see src/content/trials.ts)');
  }

  const modifier = courtCheckModifier(chLevel);

  const [exchangeIndex, setExchangeIndex] = useState(0);
  const [favor, setFavor] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [choiceHistory, setChoiceHistory] = useState<CourtChoiceRecord[]>([]);
  // Die animation
  const [rolling, setRolling] = useState(false);
  const [rollDisplay, setRollDisplay] = useState<number | null>(null);
  // Resolved check result shown after the animation
  const [checkResult, setCheckResult] = useState<(CourtCheckResult & { dc: number }) | null>(null);
  const rollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const exchange = exchanges[exchangeIndex];

  const choose = (choiceIdx: number) => {
    if (selected !== null || done || transitioning) return;
    const choice = exchange.choices[choiceIdx];
    setSelected(choiceIdx);

    if (choice.check) {
      // ── Gambit path ────────────────────────────────────────────────────────
      sfx.play('courtRoll');
      setRolling(true);
      // Cycle random die faces every 60 ms to simulate a tumbling die.
      rollIntervalRef.current = setInterval(() => {
        setRollDisplay(Math.floor(Math.random() * 20) + 1);
      }, 60);

      setTimeout(() => {
        if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
        const roll = rollD20();
        const result = resolveCourtCheck(roll, chLevel, choice.check!.dc);
        setRollDisplay(roll);
        setRolling(false);
        setCheckResult({ ...result, dc: choice.check!.dc });

        const delta = result.success ? choice.favorDelta : choice.check!.failDelta;
        const newFavor = Math.max(0, favor + delta);
        setFavor(newFavor);

        if (result.success) sfx.play('courtFavor');
        else sfx.play('courtDisfavor');

        const newHistory: CourtChoiceRecord[] = [
          ...choiceHistory,
          {
            npc: exchange.npc,
            label: choice.label,
            favorDelta: delta,
            check: {
              dc: choice.check!.dc,
              roll: result.roll,
              modifier: result.modifier,
              total: result.total,
              success: result.success,
              natural: result.natural,
            },
          },
        ];
        setChoiceHistory(newHistory);

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
              setCheckResult(null);
              setRollDisplay(null);
              setTransitioning(false);
            }, TRANSITION_MS);
          }
        }, ADVANCE_DELAY_MS);
      }, ROLL_ANIM_MS);
    } else {
      // ── Safe choice path (unchanged) ────────────────────────────────────────
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
    }
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
          <span className="flex items-center gap-2">
            {modifier !== 0 && (
              <span className="text-amber-700 font-semibold">
                🎲 {modifier >= 0 ? `+${modifier}` : modifier}
              </span>
            )}
            {Math.round(favorPct)}%
          </span>
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

          {/* Choices — gambits show 🎲 + DC; delta is hidden until the result recap */}
          <div className="space-y-2">
            {exchange.choices.map((choice, idx) => {
              const isSelected = selected === idx;
              const isGambit = !!choice.check;
              const positive = isSelected && (checkResult ? checkResult.success : choice.favorDelta > 0);
              const negative = isSelected && (checkResult ? !checkResult.success : choice.favorDelta < 0);
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
                            : isGambit
                              ? 'border-amber-500/50 bg-amber-50/40 text-ink hover:border-amber-500 hover:bg-amber-50/70'
                              : 'border-gold-deep/40 bg-parchment-100/70 text-ink hover:border-gold-bright hover:bg-gold-bright/10'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span>{choice.label}</span>
                    {isGambit && selected === null && (
                      <span className="shrink-0 rounded bg-amber-200/60 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        🎲 DC {choice.check!.dc}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Die-roll result line — visible after a gambit resolves */}
          {selected !== null && exchange.choices[selected]?.check && (
            <div className={`rounded-md border px-3 py-2 text-xs font-display text-center ${
              rolling
                ? 'border-amber-400/40 bg-amber-50/30 text-amber-800'
                : checkResult?.success
                  ? 'border-emerald-500/40 bg-emerald-50/40 text-emerald-800'
                  : 'border-rose-400/40 bg-rose-50/40 text-rose-800'
            }`}>
              {rolling ? (
                <span className="font-bold text-lg">🎲 {rollDisplay ?? '?'}</span>
              ) : checkResult ? (
                <span>
                  🎲{' '}
                  {checkResult.natural === 'crit'
                    ? <strong>Natural 20 — Critical Success!</strong>
                    : checkResult.natural === 'fumble'
                      ? <strong>Natural 1 — Critical Fumble!</strong>
                      : <>
                          {checkResult.roll}
                          {checkResult.modifier !== 0 && (
                            <> {checkResult.modifier >= 0 ? '+' : '−'} {Math.abs(checkResult.modifier)} = <strong>{checkResult.total}</strong></>
                          )}
                          {checkResult.modifier === 0 && <> = <strong>{checkResult.total}</strong></>}
                          {' vs DC '}{checkResult.dc}
                          {' — '}
                          <strong>{checkResult.success ? '✓ Success!' : '✗ Failed'}</strong>
                        </>
                  }
                </span>
              ) : null}
            </div>
          )}
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
