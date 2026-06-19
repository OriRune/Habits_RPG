import { Component, useState, type ReactNode } from 'react';
import { DoorOpen, Pickaxe, Trees } from 'lucide-react';
import { HubGrid, type HubCard } from '@/components/layout/HubGrid';
import { SubModeFrame } from '@/components/layout/SubModeFrame';
import { DungeonView } from '@/views/DungeonView';
import { MiningView } from '@/views/MiningView';
import { ForestView } from '@/views/ForestView';

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

type ExploreMode = 'delve' | 'mine' | 'forest';

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
];

export function ExploreView() {
  const [mode, setMode] = useState<ExploreMode | null>(null);

  if (!mode) {
    return (
      <HubGrid
        title="Explore"
        description="Venture into the world — dungeons, mines, and the wild forest await."
        cards={CARDS}
        onPick={setMode}
      />
    );
  }

  return (
    <SubModeFrame backLabel="Back to Explore" onBack={() => setMode(null)}>
      {mode === 'delve'  && (
        <DungeonErrorBoundary onReset={() => setMode(null)}>
          <DungeonView />
        </DungeonErrorBoundary>
      )}
      {mode === 'mine'   && <MiningView />}
      {mode === 'forest' && <ForestView />}
    </SubModeFrame>
  );
}
