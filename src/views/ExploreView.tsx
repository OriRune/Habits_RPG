import { useState } from 'react';
import { DoorOpen, Pickaxe, Trees } from 'lucide-react';
import { HubGrid, type HubCard } from '@/components/layout/HubGrid';
import { SubModeFrame } from '@/components/layout/SubModeFrame';
import { DungeonView } from '@/views/DungeonView';
import { MiningView } from '@/views/MiningView';
import { ForestView } from '@/views/ForestView';

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
      {mode === 'delve'  && <DungeonView />}
      {mode === 'mine'   && <MiningView />}
      {mode === 'forest' && <ForestView />}
    </SubModeFrame>
  );
}
