import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { TabBar, type Tab } from '@/components/layout/TabBar';
import { BattleOverlay } from '@/components/combat/BattleOverlay';
import { ClassChoiceModal } from '@/components/class/ClassChoiceModal';
import { DashboardView } from '@/views/DashboardView';
import { CharacterView } from '@/views/CharacterView';
import { ChallengesView } from '@/views/ChallengesView';
import { DungeonView } from '@/views/DungeonView';
import { InventoryView } from '@/views/InventoryView';
import { useGameStore } from '@/store/useGameStore';

export default function App() {
  const [tab, setTab] = useState<Tab>('habits');
  const battle = useGameStore((s) => s.battle);
  const classChoice = useGameStore((s) => s.pendingClassChoice);

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1">
        {tab === 'habits' && <DashboardView />}
        {tab === 'character' && <CharacterView />}
        {tab === 'challenges' && <ChallengesView />}
        {tab === 'dungeon' && <DungeonView />}
        {tab === 'inventory' && <InventoryView />}
      </main>
      <TabBar active={tab} onChange={setTab} />

      {battle && <BattleOverlay />}
      {classChoice && <ClassChoiceModal />}
    </div>
  );
}
