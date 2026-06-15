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
import { MiningView } from '@/views/MiningView';
import { MineRunOverlay } from '@/components/mining/MineRunOverlay';
import { ForestView } from '@/views/ForestView';
import { ForestRunOverlay } from '@/components/forest/ForestRunOverlay';
import { InventoryView } from '@/views/InventoryView';
import { HistoryView } from '@/views/HistoryView';
import { SettingsView } from '@/views/SettingsView';
import { useGameStore } from '@/store/useGameStore';
import { applyPalette, resolvePalette } from '@/engine/palettes';

export default function App() {
  const [tab, setTab] = useState<Tab>('habits');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const created = useGameStore((s) => s.created);
  const battle = useGameStore((s) => s.battle);
  const mining = useGameStore((s) => s.mining);
  const forest = useGameStore((s) => s.forest);
  const classChoice = useGameStore((s) => s.pendingClassChoice);
  const normalizeHabits = useGameStore((s) => s.normalizeHabits);
  const checkWeeklyRollover = useGameStore((s) => s.checkWeeklyRollover);
  const paletteId = useGameStore((s) => s.settings.paletteId);
  const customPalette = useGameStore((s) => s.settings.customPalette);

  // Single apply path: re-skin the app whenever the selected palette changes
  // (and once on mount, after the store has hydrated from localStorage).
  useEffect(() => {
    applyPalette(resolvePalette({ paletteId, customPalette }));
  }, [paletteId, customPalette]);

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
        {tab === 'mine' && <MiningView />}
        {tab === 'forest' && <ForestView />}
        {tab === 'inventory' && <InventoryView />}
      </main>
      <TabBar active={tab} onChange={setTab} />

      {historyOpen && <HistoryView onClose={() => setHistoryOpen(false)} />}
      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}
      {mining && <MineRunOverlay />}
      {forest && <ForestRunOverlay />}
      {battle && <BattleOverlay />}
      <BoonChoice />
      {classChoice && <ClassChoiceModal />}
      <WeeklyReportModal />
    </div>
  );
}
