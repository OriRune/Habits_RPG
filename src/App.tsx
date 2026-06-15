import { useState, useEffect } from 'react';
import { Header } from '@/components/layout/Header';
import { TabBar, type Tab } from '@/components/layout/TabBar';
import { BattleOverlay } from '@/components/combat/BattleOverlay';
import { BoonChoice } from '@/components/dungeon/BoonChoice';
import { ClassChoiceModal } from '@/components/class/ClassChoiceModal';
import { WeeklyReportModal } from '@/components/weekly/WeeklyReportModal';
import { CreationView } from '@/views/CreationView';
import { DashboardView } from '@/views/DashboardView';
import { CharacterView } from '@/views/CharacterView';
import { ChallengesView } from '@/views/ChallengesView';
import { DungeonView } from '@/views/DungeonView';
import { InventoryView } from '@/views/InventoryView';
import { HistoryView } from '@/views/HistoryView';
import { SettingsView } from '@/views/SettingsView';
import { useGameStore } from '@/store/useGameStore';

export default function App() {
  const [tab, setTab] = useState<Tab>('habits');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const created = useGameStore((s) => s.created);
  const battle = useGameStore((s) => s.battle);
  const classChoice = useGameStore((s) => s.pendingClassChoice);
  const normalizeHabits = useGameStore((s) => s.normalizeHabits);
  const checkWeeklyRollover = useGameStore((s) => s.checkWeeklyRollover);

  // Resume elapsed suspensions and surface the weekly report if a new week has begun.
  // Only for an established save — a brand-new hero hasn't finished creation yet.
  useEffect(() => {
    if (!created) return;
    normalizeHabits();
    checkWeeklyRollover();
  }, [created, normalizeHabits, checkWeeklyRollover]);

  if (!created) return <CreationView />;

  return (
    <div className="flex min-h-full flex-col">
      <Header onOpenSettings={() => setSettingsOpen(true)} />
      <main className="flex-1">
        {tab === 'habits' && <DashboardView onOpenHistory={() => setHistoryOpen(true)} />}
        {tab === 'character' && <CharacterView />}
        {tab === 'challenges' && <ChallengesView />}
        {tab === 'dungeon' && <DungeonView />}
        {tab === 'inventory' && <InventoryView />}
      </main>
      <TabBar active={tab} onChange={setTab} />

      {historyOpen && <HistoryView onClose={() => setHistoryOpen(false)} />}
      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}
      {battle && <BattleOverlay />}
      <BoonChoice />
      {classChoice && <ClassChoiceModal />}
      <WeeklyReportModal />
    </div>
  );
}
