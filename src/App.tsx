import { useState, useEffect, lazy, Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { TabBar, type Tab } from '@/components/layout/TabBar';
import { BoonChoice } from '@/components/dungeon/BoonChoice';
import { ClassChoiceModal } from '@/components/class/ClassChoiceModal';
import { WeeklyReportModal } from '@/components/weekly/WeeklyReportModal';
import { CreationView } from '@/views/CreationView';
import { LoginView } from '@/views/LoginView';
import { DashboardView } from '@/views/DashboardView';
import { CharacterView } from '@/views/CharacterView';
import { ChallengesView } from '@/views/ChallengesView';
import { DungeonView } from '@/views/DungeonView';
import { MiningView } from '@/views/MiningView';
import { ForestView } from '@/views/ForestView';
import { ArenaView } from '@/views/ArenaView';
import { TrialsView } from '@/views/TrialsView';
import { InventoryView } from '@/views/InventoryView';
import { HistoryView } from '@/views/HistoryView';
import { SettingsView } from '@/views/SettingsView';
import { useGameStore } from '@/store/useGameStore';
import { applyPalette, resolvePalette } from '@/engine/palettes';
import { isBackendConfigured } from '@/net/env';
import { useAuthStore } from '@/net/auth';
import { useCloudSync } from '@/hooks/useCloudSync';

// Minigame/combat overlays are heavy (each pulls in its engine: mining/forest/
// arena/combat). Code-split them so the initial bundle stays lean — each chunk
// loads only when its overlay first opens. Named exports → map to default.
const MineRunOverlay = lazy(() =>
  import('@/components/mining/MineRunOverlay').then((m) => ({ default: m.MineRunOverlay })),
);
const ForestRunOverlay = lazy(() =>
  import('@/components/forest/ForestRunOverlay').then((m) => ({ default: m.ForestRunOverlay })),
);
const ArenaOverlay = lazy(() =>
  import('@/components/arena/ArenaOverlay').then((m) => ({ default: m.ArenaOverlay })),
);
const BattleOverlay = lazy(() =>
  import('@/components/combat/BattleOverlay').then((m) => ({ default: m.BattleOverlay })),
);

export default function App() {
  const [tab, setTab] = useState<Tab>('habits');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const created = useGameStore((s) => s.created);
  const battle = useGameStore((s) => s.battle);
  const mining = useGameStore((s) => s.mining);
  const forest = useGameStore((s) => s.forest);
  const arena = useGameStore((s) => s.arena);
  const classChoice = useGameStore((s) => s.pendingClassChoice);
  const normalizeHabits = useGameStore((s) => s.normalizeHabits);
  const checkWeeklyRollover = useGameStore((s) => s.checkWeeklyRollover);
  const paletteId = useGameStore((s) => s.settings.paletteId);
  const customPalette = useGameStore((s) => s.settings.customPalette);
  const authStatus = useAuthStore((s) => s.status);

  // Wire the Supabase session ↔ cloud-save lifecycle (no-op without a backend).
  const { cloudReady } = useCloudSync();

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

  // Auth gate (only when a backend is configured; otherwise pure single-player).
  // Order: wait for the session check → sign in → create character → main app.
  if (isBackendConfigured()) {
    if (authStatus === 'loading' || (authStatus === 'signedIn' && !cloudReady)) {
      return (
        <div className="texture-wood flex min-h-full items-center justify-center">
          <p className="font-display text-sm text-parchment-300">Loading…</p>
        </div>
      );
    }
    if (authStatus === 'signedOut') return <LoginView />;
  }

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
        {tab === 'arena' && <ArenaView />}
        {tab === 'skills' && <TrialsView />}
        {tab === 'inventory' && <InventoryView />}
      </main>
      <TabBar active={tab} onChange={setTab} />

      {historyOpen && <HistoryView onClose={() => setHistoryOpen(false)} />}
      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}
      <Suspense fallback={null}>
        {mining && <MineRunOverlay />}
        {forest && <ForestRunOverlay />}
        {arena && <ArenaOverlay />}
        {battle && <BattleOverlay />}
      </Suspense>
      <BoonChoice />
      {classChoice && <ClassChoiceModal />}
      <WeeklyReportModal />
    </div>
  );
}
