// Shared boon-choice overlay for the crawl minigames (Mine & Forest).
// Pauses the run while the player picks one of the offered boons (ARCH-15).
//
// Divergences preserved as props:
//   - staggerIn: forest deals the cards in with a staggered `boon-deal-in` animation;
//     mine shows them statically (do NOT animate the mine).
//   - onChoose: the mine caller folds its `sfx.play('mineBoonOpen')` into onChoose;
//     forest has no sound.

import { BOONS } from '@/content/boons';

export function BoonChoicePanel({
  status,
  pendingBoonChoice,
  onChoose,
  onSkip,
  staggerIn = false,
}: {
  status: string;
  pendingBoonChoice: string[] | null;
  onChoose: (key: string) => void;
  onSkip: () => void;
  staggerIn?: boolean;
}) {
  if (status !== 'choosing' || !pendingBoonChoice) return null;
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 rounded-md bg-black/85 p-4">
      <p className="font-display text-lg font-bold text-gold-bright">Choose a Boon</p>
      <div className="flex gap-3">
        {pendingBoonChoice.map((key, i) => {
          const boon = BOONS[key];
          if (!boon) return null;
          return (
            <button
              key={key}
              onClick={() => onChoose(key)}
              className="flex flex-col items-center gap-1.5 rounded-md border border-gold-deep/60 bg-parchment-300/20 p-3 text-center hover:bg-parchment-300/40 transition-colors w-28"
              style={staggerIn ? { animation: `boon-deal-in 0.22s ease-out ${i * 75}ms both` } : undefined}
            >
              <span className="text-3xl leading-none">{boon.icon}</span>
              <span className="font-display text-sm font-bold text-gold-bright">{boon.name}</span>
              <span className="text-[11px] text-parchment-300 leading-tight">{boon.desc}</span>
            </button>
          );
        })}
      </div>
      <button
        onClick={() => onSkip()}
        className="rounded-md border border-parchment-300/40 px-4 py-1.5 text-sm text-parchment-300 hover:bg-parchment-300/20 transition-colors"
      >
        Skip
      </button>
    </div>
  );
}
