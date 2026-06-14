import { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { TabBar, type Tab } from '@/components/layout/TabBar';
import { BattleOverlay } from '@/components/combat/BattleOverlay';
import { ClassChoiceModal } from '@/components/class/ClassChoiceModal';
import { WeeklyReportModal } from '@/components/weekly/WeeklyReportModal';
import { DashboardView } from '@/views/DashboardView';
import { CharacterView } from '@/views/CharacterView';
import { ChallengesView } from '@/views/ChallengesView';
import { DungeonView } from '@/views/DungeonView';
import { InventoryView } from '@/views/InventoryView';
import { HistoryView } from '@/views/HistoryView';
import { useGameStore } from '@/store/useGameStore';

export default function App() {
  const [tab, setTab] = useState<Tab>('habits');
  const [historyOpen, setHistoryOpen] = useState(false);
  const battle = useGameStore((s) => s.battle);
  const classChoice = useGameStore((s) => s.pendingClassChoice);
  const normalizeHabits = useGameStore((s) => s.normalizeHabits);
  const checkWeeklyRollover = useGameStore((s) => s.checkWeeklyRollover);

  // Resume elapsed suspensions and surface the weekly report if a new week has begun.
  useEffect(() => {
    normalizeHabits();
    checkWeeklyRollover();
  }, [normalizeHabits, checkWeeklyRollover]);

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1">
        {tab === 'habits' && <DashboardView onOpenHistory={() => setHistoryOpen(true)} />}
        {tab === 'character' && <CharacterView />}
        {tab === 'challenges' && <ChallengesView />}
        {tab === 'dungeon' && <DungeonView />}
        {tab === 'inventory' && <InventoryView />}
      </main>
      <TabBar active={tab} onChange={setTab} />

      {historyOpen && <HistoryView onClose={() => setHistoryOpen(false)} />}
      {battle && <BattleOverlay />}
      {classChoice && <ClassChoiceModal />}
      <WeeklyReportModal />
    </div>
  );
}
