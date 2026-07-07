import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { BottomBar, Sidebar, type Tab } from '@/components/layout/TabBar';
import { BoonChoice } from '@/components/dungeon/BoonChoice';
import { Toaster } from '@/components/ui/Toaster';
import { ClassChoiceModal } from '@/components/class/ClassChoiceModal';
import { WeeklyReportModal } from '@/components/weekly/WeeklyReportModal';
import { PlanWeekModal } from '@/components/weekly/PlanWeekModal';
import type { WeeklyReport } from '@/engine/weekly';
import { CreationView } from '@/views/CreationView';
import { LoginView } from '@/views/LoginView';
import { DashboardView } from '@/views/DashboardView';
import { CharacterView } from '@/views/CharacterView';
import { ChallengesView } from '@/views/ChallengesView';
import { TrialsView } from '@/views/TrialsView';
import { ExploreView } from '@/views/ExploreView';
import { BattleView } from '@/views/BattleView';
import { PartyView } from '@/views/PartyView';
import { InventoryView } from '@/views/InventoryView';
import { HistoryView } from '@/views/HistoryView';
import { SettingsView } from '@/views/SettingsView';
import { useGameStore } from '@/store/useGameStore';
import { applyPalette, resolvePalette } from '@/engine/palettes';
import { isBackendConfigured } from '@/net/env';
import { useAuthStore } from '@/net/auth';
import { useSaveConflictStore } from '@/net/cloudSave';
import { SaveConflictModal } from '@/components/settings/SaveConflictModal';
import { useCloudSync } from '@/hooks/useCloudSync';
import { useParty, usePartyQuestReporter } from '@/hooks/useParty';
import { useCoopSession } from '@/hooks/useCoopSession';
import { useTacticsCoopSession } from '@/hooks/useTacticsCoopSession';
import { useReminders } from '@/hooks/useReminders';
import { isExpired } from '@/engine/challenges';
import { toISODate, daysBetween } from '@/engine/date';

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
const TacticsOverlay = lazy(() =>
  import('@/components/tactics/TacticsOverlay').then((m) => ({ default: m.TacticsOverlay })),
);
const BattleOverlay = lazy(() =>
  import('@/components/combat/BattleOverlay').then((m) => ({ default: m.BattleOverlay })),
);

export default function App() {
  const [tab, setTab] = useState<Tab>('habits');
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyFocusId = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [planWeekOpen, setPlanWeekOpen] = useState(false);
  const [planWeekReport, setPlanWeekReport] = useState<WeeklyReport | null>(null);
  const created = useGameStore((s) => s.created);
  const battle = useGameStore((s) => s.battle);
  const mining = useGameStore((s) => s.mining);
  const forest = useGameStore((s) => s.forest);
  const arena = useGameStore((s) => s.arena);
  const tactics = useGameStore((s) => s.tactics);
  const classChoice = useGameStore((s) => s.pendingClassChoice);
  const pendingReport = useGameStore((s) => s.pendingReport) as WeeklyReport | null;
  const normalizeHabits = useGameStore((s) => s.normalizeHabits);
  const checkWeeklyRollover = useGameStore((s) => s.checkWeeklyRollover);
  const paletteId = useGameStore((s) => s.settings.paletteId);
  const customPalette = useGameStore((s) => s.settings.customPalette);
  const darkMode = useGameStore((s) => s.settings.darkMode);
  const authStatus = useAuthStore((s) => s.status);
  const saveConflict = useSaveConflictStore((s) => s.conflict);
  const challenges = useGameStore((s) => s.challenges);

  // Expiry badge: highlight the Trials tab when any active challenge expires in ≤ 2 days.
  const today = toISODate();
  const hasExpiringChallenge = challenges.some((c) => {
    if (c.status !== 'active' || isExpired(c, today)) return false;
    const daysLeft = c.def.durationDays - daysBetween(today, c.startISO);
    return daysLeft <= 2;
  });

  // Wire the Supabase session ↔ cloud-save lifecycle (no-op without a backend).
  const { cloudReady, clockReady } = useCloudSync();
  // Party realtime (presence/chat/quests) + quest-progress reporting (no-op when
  // not in a party / no backend).
  useParty();
  usePartyQuestReporter();
  useCoopSession();
  useTacticsCoopSession();
  // Daily foreground reminders (no-op when disabled in settings).
  useReminders();

  // Single apply path: re-skin the app whenever the selected palette or dark
  // mode changes (and once on mount, after the store has hydrated from localStorage).
  useEffect(() => {
    applyPalette(resolvePalette({ paletteId, customPalette }), darkMode ? 'dark' : 'light');
  }, [paletteId, customPalette, darkMode]);

  // Resume elapsed suspensions and surface the weekly report if a new week has begun.
  // Waits for clockReady so the very first evaluation uses server time (not raw device
  // clock). Both checks are idempotent — safe to call once clockReady flips true.
  // Only for an established save — a brand-new hero hasn't finished creation yet.
  useEffect(() => {
    if (!created || !clockReady) return;
    normalizeHabits();
    checkWeeklyRollover();
  }, [created, clockReady, normalizeHabits, checkWeeklyRollover]);

  // Auth gate (only when a backend is configured; otherwise pure single-player).
  // Order: wait for the session check → sign in → create character → main app.
  if (isBackendConfigured()) {
    if (authStatus === 'loading' || (authStatus === 'signedIn' && !cloudReady)) {
      return (
        <div className="texture-wood flex min-h-full items-center justify-center">
          <p className="font-display text-sm text-on-wood-mid">Loading…</p>
        </div>
      );
    }
    if (authStatus === 'signedOut') return <LoginView />;
    // First sign-in found real progress both locally and in the cloud — block the
    // app until the player picks a side (see cloudSave.ts, MP-06).
    if (saveConflict) return <SaveConflictModal conflict={saveConflict} />;
  }

  if (!created) return <CreationView />;

  return (
    <div className="flex min-h-full flex-col">
      <Header onOpenSettings={() => setSettingsOpen(true)} />

      {/* Row: sidebar (desktop) + content (both) */}
      <div className="flex flex-1">
        <Sidebar active={tab} onChange={setTab} badges={{ challenges: hasExpiringChallenge }} />

        <main className="flex-1">
          {tab === 'habits'     && <DashboardView onOpenHistory={(id) => { historyFocusId.current = id ?? null; setHistoryOpen(true); }} onPlanWeek={() => { setPlanWeekReport(null); setPlanWeekOpen(true); }} />}
          {tab === 'challenges' && <ChallengesView />}
          {tab === 'character'  && <CharacterView />}
          {tab === 'skills'     && <TrialsView />}
          {tab === 'explore'    && <ExploreView />}
          {tab === 'battle'     && <BattleView />}
          {tab === 'inventory'  && <InventoryView />}
          {tab === 'party'      && <PartyView />}
        </main>
      </div>

      {/* Bottom bar — mobile/narrow only (hidden on lg+) */}
      <BottomBar active={tab} onChange={setTab} badges={{ challenges: hasExpiringChallenge }} />

      {historyOpen && (
        <HistoryView
          onClose={() => { setHistoryOpen(false); historyFocusId.current = null; }}
          focusHabitId={historyFocusId.current}
        />
      )}
      {settingsOpen && <SettingsView onClose={() => setSettingsOpen(false)} />}
      <Suspense fallback={null}>
        {mining  && <MineRunOverlay />}
        {forest  && <ForestRunOverlay />}
        {arena   && <ArenaOverlay />}
        {tactics && <TacticsOverlay />}
        {battle  && <BattleOverlay />}
      </Suspense>
      <Toaster />
      <BoonChoice />
      {classChoice && <ClassChoiceModal />}
      <WeeklyReportModal
        onPlanWeek={() => {
          setPlanWeekReport(pendingReport);
          setPlanWeekOpen(true);
        }}
      />
      {planWeekOpen && (
        <PlanWeekModal lastReport={planWeekReport} onClose={() => setPlanWeekOpen(false)} />
      )}
    </div>
  );
}
