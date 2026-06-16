// Ancient Library trial — KN.
// Simon-style glyph memory: watch the sequence, then repeat it. Grows each round.

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  generateSequence,
  libraryScore,
  GLYPHS,
  LIBRARY_START_LENGTH,
  LIBRARY_MAX_ROUNDS,
  type Glyph,
} from '@/engine/trials/ancientLibrary';

interface AncientLibraryProps {
  onFinish: (score01: number) => void;
}

type Phase = 'showing' | 'input' | 'wrong' | 'correct' | 'done';

export function AncientLibrary({ onFinish }: AncientLibraryProps) {
  const masterSeq = useMemo(() => generateSequence(Math.random), []);
  const [round, setRound] = useState(0); // 0-based; length = START_LENGTH + round
  const [phase, setPhase] = useState<Phase>('showing');
  const [showIndex, setShowIndex] = useState(0);
  const [playerInput, setPlayerInput] = useState<Glyph[]>([]);
  const [roundsCompleted, setRoundsCompleted] = useState(0);

  const currentLength = LIBRARY_START_LENGTH + round;
  const sequence = masterSeq.slice(0, currentLength);

  const finish = useCallback(
    (completed: number) => {
      setPhase('done');
      onFinish(libraryScore(completed));
    },
    [onFinish],
  );

  // Show the sequence one glyph at a time
  useEffect(() => {
    if (phase !== 'showing') return;
    if (showIndex >= sequence.length) {
      setTimeout(() => setPhase('input'), 400);
      return;
    }
    const t = setTimeout(() => setShowIndex((i) => i + 1), 700);
    return () => clearTimeout(t);
  }, [phase, showIndex, sequence.length]);

  // Start a new round
  const startRound = useCallback(
    (r: number) => {
      setRound(r);
      setShowIndex(0);
      setPlayerInput([]);
      setPhase('showing');
    },
    [],
  );

  const handleGlyphTap = (g: Glyph) => {
    if (phase !== 'input') return;
    const next = [...playerInput, g];
    const pos = next.length - 1;

    if (g !== sequence[pos]) {
      // Wrong
      setPhase('wrong');
      setTimeout(() => finish(roundsCompleted), 1000);
      return;
    }

    if (next.length === sequence.length) {
      // Round complete
      const newCompleted = roundsCompleted + 1;
      setRoundsCompleted(newCompleted);
      setPhase('correct');
      if (round + 1 >= LIBRARY_MAX_ROUNDS) {
        setTimeout(() => finish(newCompleted), 800);
      } else {
        setTimeout(() => startRound(round + 1), 900);
      }
    } else {
      setPlayerInput(next);
    }
  };

  const activeGlyph = phase === 'showing' && showIndex < sequence.length ? sequence[showIndex] : null;

  return (
    <div className="flex flex-col items-center gap-5 px-2">
      <div className="flex items-center justify-between w-full max-w-xs text-xs font-display text-ink-muted">
        <span>Round {round + 1} of {LIBRARY_MAX_ROUNDS}</span>
        <span>Sequence length: {currentLength}</span>
      </div>

      {/* Glyph display area */}
      <div className="flex h-20 w-full max-w-xs items-center justify-center rounded-md border border-gold-deep/30 bg-parchment-100/70">
        {phase === 'showing' && activeGlyph ? (
          <span className="text-5xl animate-pulse">{activeGlyph}</span>
        ) : phase === 'input' ? (
          <div className="text-sm text-ink-muted font-display">Your turn — repeat the sequence</div>
        ) : phase === 'correct' ? (
          <span className="text-4xl">✅</span>
        ) : phase === 'wrong' ? (
          <span className="text-4xl">❌</span>
        ) : phase === 'done' ? (
          <span className="text-4xl">📚</span>
        ) : null}
      </div>

      {/* Player input display */}
      {phase === 'input' && (
        <div className="flex min-h-8 gap-1">
          {playerInput.map((g, i) => (
            <span key={i} className="text-2xl">{g}</span>
          ))}
          {Array.from({ length: currentLength - playerInput.length }, (_, i) => (
            <span key={`empty-${i}`} className="text-2xl opacity-20">○</span>
          ))}
        </div>
      )}

      {/* Glyph buttons */}
      {phase === 'input' && (
        <div className="grid grid-cols-3 gap-2 w-full max-w-xs">
          {GLYPHS.map((g) => (
            <button
              key={g}
              onClick={() => handleGlyphTap(g)}
              className="rounded-md border border-gold-deep/40 bg-parchment-100/70 py-3 text-2xl hover:border-gold-bright hover:bg-gold-bright/10 active:scale-95 transition-transform"
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {phase === 'showing' && (
        <div className="flex gap-1">
          {sequence.map((g, i) => (
            <span key={i} className={`text-xl transition-opacity ${i < showIndex ? 'opacity-30' : i === showIndex ? 'opacity-100' : 'opacity-10'}`}>
              {i < showIndex ? '•' : i === showIndex ? g : '○'}
            </span>
          ))}
        </div>
      )}

      <p className="text-xs text-ink-muted">
        {phase === 'showing' && 'Watch the glyphs carefully…'}
        {phase === 'input' && 'Tap the glyphs in order.'}
        {phase === 'correct' && `Round ${round + 1} complete! Next round…`}
        {phase === 'wrong' && 'Wrong glyph!'}
        {phase === 'done' && `Completed ${roundsCompleted} of ${LIBRARY_MAX_ROUNDS} rounds.`}
      </p>
    </div>
  );
}
