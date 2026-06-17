import { useState } from 'react';
import { Swords, Grid3x3 } from 'lucide-react';
import { HubGrid, type HubCard } from '@/components/layout/HubGrid';
import { SubModeFrame } from '@/components/layout/SubModeFrame';
import { ArenaView } from '@/views/ArenaView';
import { TacticsView } from '@/views/TacticsView';

type BattleMode = 'arena' | 'tactics';

const CARDS: HubCard<BattleMode>[] = [
  {
    id: 'arena',
    label: 'Arena',
    icon: Swords,
    blurb:
      'Face the arena boss in real-time combat. Dodge telegraphed attacks, cast spells, and prove your reflexes.',
  },
  {
    id: 'tactics',
    label: 'Hex Tactics',
    icon: Grid3x3,
    blurb:
      'Command your forces in a turn-based isometric hex skirmish. Position, ability timing, and terrain mastery decide the day.',
  },
];

export function BattleView() {
  const [mode, setMode] = useState<BattleMode | null>(null);

  if (!mode) {
    return (
      <HubGrid
        title="Battle"
        description="Choose your fight — real-time arena combat or turn-based hex tactics."
        cards={CARDS}
        onPick={setMode}
      />
    );
  }

  return (
    <SubModeFrame backLabel="Back to Battle" onBack={() => setMode(null)}>
      {mode === 'arena'   && <ArenaView />}
      {mode === 'tactics' && <TacticsView />}
    </SubModeFrame>
  );
}
