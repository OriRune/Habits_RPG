import { Zap, Star, TrendingUp, X } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { SectionTitle } from '@/components/ui/Divider';

/**
 * One-time welcome/coach card shown at the top of the dashboard after character creation.
 * Explains the core loop (habits → XP + Energy → minigames → power) in three short beats.
 * Dismissed by calling `dismissWelcome()` — the flag is persisted so the card never reappears.
 */
export function WelcomeCard() {
  const dismissWelcome = useGameStore((s) => s.dismissWelcome);

  return (
    <Panel tone="parchment" className="relative p-5">
      <button
        onClick={dismissWelcome}
        aria-label="Dismiss welcome"
        className="absolute right-3 top-3 rounded text-ink-light/50 transition-colors hover:text-ink-muted"
      >
        <X className="h-4 w-4" />
      </button>

      <SectionTitle className="mb-4">Welcome, Adventurer</SectionTitle>

      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <Star className="mt-0.5 h-4 w-4 shrink-0 text-gold-deep" />
          <p className="text-sm leading-snug text-ink-muted">
            <span className="font-semibold text-ink">Complete habits</span> to earn Training XP.
            XP grows your eight stats — Strength, Agility, Knowledge, and more — shaping your hero
            over time.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm leading-snug text-ink-muted">
            Each completion also awards{' '}
            <span className="font-semibold text-ink">Energy</span>. Spend it in the Explore tab to
            delve dungeons, mine ore, or hunt in the forest.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <p className="text-sm leading-snug text-ink-muted">
            Enough XP summons a{' '}
            <span className="font-semibold text-ink">Level-Up Trial</span>. Win it to grow stronger
            and unlock new abilities. The quest log is your foundation — start there.
          </p>
        </div>
      </div>

      <Button onClick={dismissWelcome} variant="secondary" className="mt-5 w-full">
        Got it — let's begin
      </Button>
    </Panel>
  );
}
