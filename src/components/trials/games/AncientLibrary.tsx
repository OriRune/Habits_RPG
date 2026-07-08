// Ancient Library trial — KN.
// Simon-style glyph memory: watch the sequence, then repeat it. Grows each round.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { toISODate } from '@/engine/date';
import * as sfx from '@/lib/sfx';
import {
  generateSequence,
  libraryScore,
  buildShowSchedule,
  seededRng,
  dailySeed,
  glyphShowMs,
  GLYPHS,
  GLYPH_TONES,
  GLYPH_COLORS,
  LIBRARY_START_LENGTH,
  LIBRARY_MAX_ROUNDS,
  PRE_INPUT_PAUSE_MS,
  CORRECT_FLASH_MS,
  NEXT_ROUND_DELAY_MS,
  WRONG_FLASH_MS,
  TAP_FLASH_MS,
  type Glyph,
} from '@/engine/trials/ancientLibrary';

interface AncientLibraryProps {
  onFinish: (score01: number) => void;
  /** MINI-11: per-attempt nonce XOR'd into the daily seed so a reopened trial isn't replayable. */
  attemptNonce: number;
}

type Phase = 'showing' | 'input' | 'wrong' | 'correct' | 'done';

export function AncientLibrary({ onFinish, attemptNonce }: AncientLibraryProps) {
  const knLevel = useGameStore((s) => s.character.statLevels.KN);

  // Daily seed XOR'd with the per-attempt nonce (MINI-11): a reopened trial draws a fresh
  // sequence instead of an identical, transcribe-able one. (The nonce advances on every
  // Begin, so the day's first attempt is no longer shared across players — an acceptable
  // trade to close the watch-abandon-transcribe exploit.)
  const masterSeq = useMemo(
    () => generateSequence(seededRng(dailySeed(toISODate()) ^ attemptNonce)),
    [attemptNonce],
  );

  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<Phase>('showing');
  const [showIndex, setShowIndex] = useState(0);
  const [playerInput, setPlayerInput] = useState<Glyph[]>([]);
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [retriesLeft, setRetriesLeft] = useState(1);
  const [flashGlyph, setFlashGlyph] = useState<Glyph | null>(null);
  const mounted = useRef(true);

  // Cleanup guard — prevents setState on unmounted component.
  // Must also set true on mount so React 18 StrictMode's remount restores the flag.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const currentLength = LIBRARY_START_LENGTH + round;
  const sequence = masterSeq.slice(0, currentLength);

  // Show schedule may include repeated positions when KN stat level is high enough
  const showSchedule = useMemo(
    () => buildShowSchedule(sequence.length, knLevel, Math.random),
    [round, sequence.length, knLevel],
  );

  const finish = useCallback(
    (completed: number) => {
      setPhase('done');
      onFinish(libraryScore(completed));
    },
    [onFinish],
  );

  // Advance the show phase one glyph at a time
  useEffect(() => {
    if (phase !== 'showing') return;
    if (showIndex >= showSchedule.length) {
      const t = setTimeout(() => { if (mounted.current) setPhase('input'); }, PRE_INPUT_PAUSE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => { if (mounted.current) setShowIndex((i) => i + 1); },
      glyphShowMs(round),
    );
    return () => clearTimeout(t);
  }, [phase, showIndex, showSchedule.length, round]);

  const activeGlyph =
    phase === 'showing' && showIndex < showSchedule.length
      ? sequence[showSchedule[showIndex]]
      : null;

  // Play tone on every showIndex advance, not on activeGlyph change —
  // the latter misses consecutive duplicate glyphs (e.g. KN double-flash).
  useEffect(() => {
    if (activeGlyph) sfx.playNote(GLYPH_TONES[activeGlyph]);
  }, [showIndex, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRound = useCallback((r: number) => {
    setRound(r);
    setShowIndex(0);
    setPlayerInput([]);
    setPhase('showing');
  }, []);

  const handleGlyphTap = (g: Glyph) => {
    if (phase !== 'input') return;

    // Play tone and flash the button on every tap (correct or not)
    sfx.playNote(GLYPH_TONES[g]);
    setFlashGlyph(g);
    setTimeout(() => { if (mounted.current) setFlashGlyph(null); }, TAP_FLASH_MS);

    const next = [...playerInput, g];
    const pos = next.length - 1;

    if (g !== sequence[pos]) {
      sfx.play('libraryWrong');
      if (retriesLeft > 0) {
        // Consume the retry: replay the current round without ending the trial
        setRetriesLeft(0);
        setPhase('wrong');
        setTimeout(() => {
          if (!mounted.current) return;
          setPlayerInput([]);
          setShowIndex(0);
          setPhase('showing');
        }, WRONG_FLASH_MS);
      } else {
        setPhase('wrong');
        setTimeout(() => { if (mounted.current) finish(roundsCompleted); }, WRONG_FLASH_MS);
      }
      return;
    }

    if (next.length === sequence.length) {
      const newCompleted = roundsCompleted + 1;
      setRoundsCompleted(newCompleted);
      sfx.play('libraryCorrect');
      setPhase('correct');
      if (round + 1 >= LIBRARY_MAX_ROUNDS) {
        setTimeout(() => { if (mounted.current) finish(newCompleted); }, CORRECT_FLASH_MS);
      } else {
        setTimeout(() => { if (mounted.current) startRound(round + 1); }, NEXT_ROUND_DELAY_MS);
      }
    } else {
      setPlayerInput(next);
    }
  };

  return (
    <div className="flex flex-col items-center gap-5 px-2">

      {/* Round / length header */}
      <div className="flex items-center justify-between w-full max-w-xs text-xs font-display text-ink-muted">
        <span>Round {round + 1} of {LIBRARY_MAX_ROUNDS}</span>
        <span>Sequence: {currentLength}</span>
      </div>

      {/* Glyph display area */}
      <div className="flex h-20 w-full max-w-xs items-center justify-center rounded-md border border-gold-deep/30 bg-parchment-100/70">
        {phase === 'showing' && activeGlyph ? (
          // key causes React to remount the span on each glyph advance, triggering the CSS animation
          <span key={showIndex} className="text-5xl animate-bounce" style={{ animationDuration: '0.25s', animationIterationCount: 1 }}>
            {activeGlyph}
          </span>
        ) : phase === 'input' ? (
          <div className="text-sm text-ink-muted font-display">Your turn — repeat the sequence</div>
        ) : phase === 'correct' ? (
          // Show the completed sequence for review during the flash window
          <div className="flex gap-1 flex-wrap justify-center px-2">
            {sequence.map((g, i) => (
              <span key={i} className="text-2xl">{g}</span>
            ))}
          </div>
        ) : phase === 'wrong' ? (
          <span className="text-4xl">❌</span>
        ) : phase === 'done' ? (
          <span className="text-4xl">📚</span>
        ) : null}
      </div>

      {/* Player input tracker */}
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

      {/* Retry indicator — shown during input and after a retry is consumed */}
      {(phase === 'input' || phase === 'wrong') && (
        <div className="flex items-center gap-1 text-xs font-display text-ink-muted">
          <span className={retriesLeft > 0 ? 'opacity-100' : 'opacity-25'}>✦</span>
          <span className={retriesLeft > 0 ? 'opacity-100' : 'opacity-25'}>
            {retriesLeft > 0 ? '1 retry remaining' : 'retry used'}
          </span>
        </div>
      )}

      {/* Glyph buttons */}
      {phase === 'input' && (
        <div className="grid grid-cols-3 gap-2 w-full max-w-xs">
          {GLYPHS.map((g) => {
            const isFlashing = flashGlyph === g;
            return (
              <button
                key={g}
                onClick={() => handleGlyphTap(g)}
                style={{
                  backgroundColor: isFlashing
                    ? `${GLYPH_COLORS[g]}55`
                    : `${GLYPH_COLORS[g]}10`,
                  borderColor: isFlashing ? GLYPH_COLORS[g] : `${GLYPH_COLORS[g]}70`,
                }}
                className="rounded-md border py-3 text-2xl active:scale-95 transition-all duration-100"
              >
                {g}
              </button>
            );
          })}
        </div>
      )}

      {/* Status line */}
      <p className="text-xs text-ink-muted text-center">
        {phase === 'showing' && 'Watch the glyphs carefully…'}
        {phase === 'input' && 'Tap the glyphs in order.'}
        {phase === 'correct' && `Round ${round + 1} complete!${round + 1 < LIBRARY_MAX_ROUNDS ? ' Next round…' : ''}`}
        {phase === 'wrong' && (retriesLeft === 0 && roundsCompleted === 0
          ? 'Wrong glyph! Retrying…'
          : retriesLeft === 0
          ? `Wrong glyph! Completed ${roundsCompleted} round${roundsCompleted !== 1 ? 's' : ''}.`
          : 'Wrong glyph! Retrying…'
        )}
        {phase === 'done' && `Completed ${roundsCompleted} of ${LIBRARY_MAX_ROUNDS} rounds.`}
      </p>
    </div>
  );
}
