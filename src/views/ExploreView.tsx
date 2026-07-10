import { Component, Suspense, lazy, useState, type ReactNode } from 'react';
import { DoorOpen, Pickaxe, Trees, Home, Zap, Hammer } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { DUNGEON_ENERGY_COST } from '@/engine/dungeon';
import { MINE_ENERGY_COST } from '@/engine/mining';
import { FOREST_ENERGY_COST } from '@/engine/forest';
import { cn } from '@/lib/cn';
import { HubGrid, type HubCard } from '@/components/layout/HubGrid';
import { SubModeFrame } from '@/components/layout/SubModeFrame';
import { DungeonView } from '@/views/DungeonView';
import { MiningView } from '@/views/MiningView';
import { ForestView } from '@/views/ForestView';

// The Homestead pulls in the isometric SVG art kit — code-split it so the town's
// renderer stays out of the main Explore chunk until the card is opened.
const TownView = lazy(() =>
  import('@/views/TownView').then((m) => ({ default: m.TownView })),
);

class DungeonErrorBoundary extends Component<
  { onReset: () => void; children: ReactNode },
  { crashed: boolean }
> {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err: Error) { console.error('[DungeonView] render error:', err); }
  render() {
    if (this.state.crashed) {
      return (
        <div className="flex flex-col items-center gap-4 p-8 text-center">
          <p className="text-sm text-ink-muted">Something went wrong in the dungeon.</p>
          <button
            className="rounded bg-ember px-4 py-2 text-sm font-bold text-parchment-100"
            onClick={() => { this.setState({ crashed: false }); this.props.onReset(); }}
          >
            Back to Explore
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type ExploreMode = 'delve' | 'mine' | 'forest' | 'town';

/** Entry cost per mode — null for the Homestead, which is labor-funded (not a run). */
const ENERGY_COSTS: Record<ExploreMode, number | null> = {
  delve: DUNGEON_ENERGY_COST,
  mine: MINE_ENERGY_COST,
  forest: FOREST_ENERGY_COST,
  town: null,
};

/** Small cost chip on a hub card; ember-toned when the player can't afford entry. */
function costBadge(id: ExploreMode, energy: number): ReactNode {
  const cost = ENERGY_COSTS[id];
  if (cost === null) {
    return (
      <span className="flex items-center gap-1 font-display text-xs text-ink-muted">
        <Hammer className="h-3.5 w-3.5" /> No energy — powered by labor
      </span>
    );
  }
  const short = energy < cost;
  return (
    <span
      className={cn(
        'flex items-center gap-1 font-display text-xs',
        short ? 'text-ember' : 'text-ink-muted',
      )}
    >
      <Zap className={cn('h-3.5 w-3.5', short ? 'text-ember' : 'text-stat-AG')} /> {cost} energy
    </span>
  );
}

const CARDS: HubCard<ExploreMode>[] = [
  {
    id: 'delve',
    label: 'Dungeon Delve',
    icon: DoorOpen,
    blurb:
      'Descend through monster-filled floors, branching paths, and hidden treasure. Bank your spoils or press on for richer rewards.',
  },
  {
    id: 'mine',
    label: 'Deep Mine',
    icon: Pickaxe,
    blurb:
      'Dig through stone and crystal veins for ore, gems, and rare materials. Multi-floor descent with shared resources.',
  },
  {
    id: 'forest',
    label: 'Wild Forest',
    icon: Trees,
    blurb:
      'Forage the wildwood for herbs, encounter beasts, and uncover ancient secrets hidden beneath the canopy.',
  },
  {
    id: 'town',
    label: 'The Homestead',
    icon: Home,
    blurb:
      'Build a persistent home base on an isometric plot. Logging habits raises the town, tier by tier.',
    guide: {
      sections: [
        {
          heading: 'How it grows',
          items: [
            'Placing or upgrading a building charges gold + materials up front — the sink.',
            'Construction then completes with labor earned from your live habit completions (harder habits give more, capped at 24 🔨 a day).',
            'Completed buildings raise your prestige and, in a later update, grant light perks.',
          ],
        },
        {
          heading: 'Building & land',
          items: [
            'Tap Build & Decorate → pick an entry → nudge the ghost with taps → Confirm (rotate where allowed). Nothing commits until you Confirm.',
            'Tap a finished building to upgrade, move, or demolish it.',
            'Land deeds unlock new districts — a pure-gold sink gated on prestige.',
          ],
        },
        {
          heading: 'Refunds',
          items: [
            'Demolish: 50% of materials back, no gold (Keep excepted — it stays).',
            'Cancel a project: 100% of materials back, no gold, applied labor forfeited.',
            'Relocation is free.',
          ],
        },
      ],
    },
  },
];

export function ExploreView({ onGoToHabits }: { onGoToHabits?: () => void } = {}) {
  const [mode, setMode] = useState<ExploreMode | null>(null);
  const energy = useGameStore((s) => s.character.energy);

  if (!mode) {
    return (
      <HubGrid
        title="Explore"
        description="Venture into the world — dungeons, mines, and the wild forest await."
        cards={CARDS.map((card) => ({ ...card, badge: costBadge(card.id, energy) }))}
        onPick={setMode}
      />
    );
  }

  return (
    <SubModeFrame backLabel="Back to Explore" onBack={() => setMode(null)}>
      {mode === 'delve'  && (
        <DungeonErrorBoundary onReset={() => setMode(null)}>
          <DungeonView onGoToHabits={onGoToHabits} />
        </DungeonErrorBoundary>
      )}
      {mode === 'mine'   && <MiningView />}
      {mode === 'forest' && <ForestView />}
      {mode === 'town'   && (
        <Suspense fallback={<div className="p-8 text-center text-sm text-on-wood-dim">Loading the Homestead…</div>}>
          <TownView />
        </Suspense>
      )}
    </SubModeFrame>
  );
}
