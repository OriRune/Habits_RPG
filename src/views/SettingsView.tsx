import { useRef, useState } from 'react';
import { Bell, ChevronLeft, Download, FlaskConical, BarChart3, Upload } from 'lucide-react';
import { BalanceReportModal } from '@/components/balance/BalanceReportModal';
import { DevStateInspector } from '@/components/dev/DevStateInspector';
import { useGameStore } from '@/store/useGameStore';
import { STATS, type StatId } from '@/engine/stats';
import type { ArenaSpeed } from '@/engine/arena';
import { classFor } from '@/engine/classes';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { SectionTitle } from '@/components/ui/Divider';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { isBackendConfigured } from '@/net/env';
import { signOut, useAuthStore } from '@/net/auth';
import { pushCloudSave } from '@/net/cloudSave';

const LEVEL_JUMPS = [3, 5, 10, 20, 50];
const FLOOR_JUMPS = [0, 5, 8, 10];
const TRIALS = [
  { level: 5,  label: 'Procrastination Slime (Lv 5)'  },
  { level: 8,  label: 'Drill Sergeant Rex (Lv 8)'      },
  { level: 12, label: 'Comfort Blob (Lv 12)'           },
  { level: 15, label: 'Anxiety Wraith (Lv 15)'         },
  { level: 20, label: 'Burnout Golem (Lv 20)'          },
  { level: 25, label: 'Mirror Demon (Lv 25)'           },
  { level: 30, label: 'Clockwork Tyrant (Lv 30)'       },
  { level: 40, label: 'Trial Guardian (Lv 40)'         },
  { level: 50, label: 'Trial Guardian (Lv 50)'         },
];

/** Full-screen Settings overlay: general options + a Developer "creative mode" section. */
export function SettingsView({ onClose }: { onClose: () => void }) {
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const resetGame = useGameStore((s) => s.resetGame);
  const habits = useGameStore((s) => s.habits);
  const completionLog = useGameStore((s) => s.completionLog);
  const importHabits = useGameStore((s) => s.importHabits);
  const importFileRef = useRef<HTMLInputElement>(null);

  const level = useGameStore((s) => s.character.level);
  const classId = useGameStore((s) => s.character.classId);
  const deepestFloor = useGameStore((s) => s.deepestFloor);
  const devSetLevel = useGameStore((s) => s.devSetLevel);
  const devSetDeepestFloor = useGameStore((s) => s.devSetDeepestFloor);
  const devSpawnTrial = useGameStore((s) => s.devSpawnTrial);
  const devClearClass = useGameStore((s) => s.devClearClass);
  const devFillEnergy = useGameStore((s) => s.devFillEnergy);
  const devAddGold = useGameStore((s) => s.devAddGold);
  const devForceWeeklyRollover = useGameStore((s) => s.devForceWeeklyRollover);
  const battle = useGameStore((s) => s.battle);
  const checkWeeklyRollover = useGameStore((s) => s.checkWeeklyRollover);
  const chooseClass = useGameStore((s) => s.chooseClass);

  const [primary, setPrimary] = useState<StatId>('ST');
  const [secondary, setSecondary] = useState<StatId>('DX');
  const previewClass = classFor(primary, secondary);
  const [showBalanceReport, setShowBalanceReport] = useState(false);

  const username = useAuthStore((s) => s.username);
  const handleSignOut = async () => {
    // Flush a final save so nothing since the last debounce is lost, then sign out.
    await pushCloudSave();
    await signOut();
  };

  const spawn = (lvl: number) => {
    devSpawnTrial(lvl);
    onClose(); // surface the BattleOverlay over the dashboard
  };

  // -------------------------------------------------------------------------
  // Habit export / import
  // -------------------------------------------------------------------------

  function handleExport() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), habits, completionLog };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `habits-rpg-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be selected again after dismissal.
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result as string) as { habits?: unknown; completionLog?: unknown };
        if (!Array.isArray(raw.habits)) {
          alert('Invalid export file — no "habits" array found.');
          return;
        }
        // Basic shape coercion: ensure required fields are present.
        const incoming = (raw.habits as unknown[])
          .filter((h): h is import('@/engine/habits').Habit =>
            typeof (h as Record<string, unknown>).id === 'string' &&
            typeof (h as Record<string, unknown>).name === 'string',
          );

        if (incoming.length === 0) {
          alert('No valid habits found in the file.');
          return;
        }

        if (!confirm(`Merge ${incoming.length} habit${incoming.length !== 1 ? 's' : ''} from the file? Existing habits with the same ID will be replaced.`)) return;
        importHabits(incoming);
      } catch {
        alert('Could not read the file — make sure it is a valid HabitsRPG export.');
      }
    };
    reader.readAsText(file);
  }

  // -------------------------------------------------------------------------
  // Daily reminders
  // -------------------------------------------------------------------------

  async function handleReminderToggle(enabled: boolean) {
    if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        // Permission denied — enable anyway so the in-app toast fallback fires.
      }
    }
    updateSettings({ dailyReminderEnabled: enabled });
  }

  return (
    <div className="texture-wood fixed inset-0 z-50 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-gold-deep bg-wood-800/95 px-4 py-3 backdrop-blur">
        <button onClick={onClose} className="text-parchment-200 hover:text-gold-bright" aria-label="Back">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-lg font-bold text-gold-bright">Settings</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {/* Account (only when signed in to a backend) */}
        {isBackendConfigured() && username && (
          <Panel tone="parchment" className="space-y-3 p-4">
            <SectionTitle>Account</SectionTitle>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink">
                Signed in as <span className="font-bold text-gold-deep">{username}</span>
              </span>
              <Button variant="secondary" onClick={handleSignOut}>
                Sign out
              </Button>
            </div>
            <p className="text-[11px] text-ink-muted">
              Your progress syncs to this account across devices.
            </p>
          </Panel>
        )}

        {/* General */}
        <Panel tone="parchment" className="space-y-3 p-4">
          <SectionTitle>General</SectionTitle>

          {/* Sound */}
          <Toggle
            label="Sound"
            description="Sound effects and tension drone during minigames."
            checked={settings.soundEnabled}
            onChange={(v) => updateSettings({ soundEnabled: v })}
          />

          {/* Daily reminder */}
          <div className="space-y-2">
            <Toggle
              label="Daily reminder"
              description="Show a notification (or in-app alert) at your chosen time to log today's habits. Requires browser notification permission."
              checked={settings.dailyReminderEnabled}
              onChange={handleReminderToggle}
            />
            {settings.dailyReminderEnabled && (
              <div className="flex items-center gap-3 pl-1">
                <Bell className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                <input
                  type="time"
                  value={settings.dailyReminderTime}
                  onChange={(e) => updateSettings({ dailyReminderTime: e.target.value })}
                  className="rounded-md border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-xs text-ink focus:border-gold-deep focus:outline-none"
                  aria-label="Reminder time"
                />
              </div>
            )}
          </div>

          {/* Party habit visibility (only meaningful when signed in) */}
          {isBackendConfigured() && (
            <Toggle
              label="Share habits with party"
              description="Your active habit names, current streaks, and today's completion status will be visible to your party members."
              checked={settings.shareHabitNames}
              onChange={(v) => updateSettings({ shareHabitNames: v })}
            />
          )}

          {/* Arena pace */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
                Arena speed
              </span>
              <select
                value={settings.arenaSpeed}
                onChange={(e) => updateSettings({ arenaSpeed: e.target.value as ArenaSpeed })}
                aria-label="Arena speed"
                className="rounded-md border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-xs text-ink focus:border-gold-deep focus:outline-none"
              >
                <option value="auto">Auto (by level)</option>
                <option value="slow">Slow (easier)</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast (harder)</option>
              </select>
            </div>
            <p className="text-[10px] text-ink-light">
              How fast the boss attacks and moves in the Arena. Auto eases lower levels and quickens
              higher ones.
            </p>
          </div>

          {/* Adventure Ritual — pre-entry checklist before each minigame. */}
          <Toggle
            label="Adventure Ritual"
            description="Show a pre-entry checklist before each minigame that lists today's habits and the energy cost."
            checked={settings.showAdventureRitual}
            onChange={(v) => updateSettings({ showAdventureRitual: v })}
          />

          {/* Habit data export / import */}
          <div className="space-y-1.5">
            <div className="font-display text-xs font-bold uppercase tracking-wider text-ink">
              Habit data
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
              <Button
                variant="secondary"
                onClick={() => importFileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs"
              >
                <Upload className="h-3.5 w-3.5" /> Import
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleImportFile}
              />
            </div>
            <p className="text-[10px] text-ink-light">
              Export saves your habits + history as a JSON file. Import merges habits by ID
              (existing habits with the same ID are replaced).
            </p>
          </div>

          <button
            onClick={() => {
              if (confirm('Reset all progress? This cannot be undone.')) {
                resetGame();
                onClose();
              }
            }}
            className="font-display text-xs uppercase tracking-wider text-ink-light/80 hover:text-ember"
          >
            Reset game
          </button>
        </Panel>

        {/* Appearance */}
        <AppearanceSection />

        {/* Developer */}
        <Panel tone="parchment" className="space-y-3 p-4">
          <SectionTitle>
            <span className="inline-flex items-center gap-1.5">
              <FlaskConical className="h-4 w-4" /> Developer
            </span>
          </SectionTitle>
          <p className="rounded-md border border-gold-deep/30 bg-gold/10 px-3 py-2 text-xs text-ink-muted">
            Creative mode — for exploring features freely. Not meant for normal play; toggles persist
            across reloads.
          </p>
          <div className="space-y-2">
            <Toggle
              label="Unlimited Gold"
              description="Purchases and crafting ignore their gold cost."
              checked={settings.unlimitedGold}
              onChange={(v) => updateSettings({ unlimitedGold: v })}
            />
            <Toggle
              label="Unlimited Energy"
              description="Enter dungeons without spending energy."
              checked={settings.unlimitedEnergy}
              onChange={(v) => updateSettings({ unlimitedEnergy: v })}
            />
            <Toggle
              label="Invincibility"
              description="HP, mana, and stamina stay full in combat — you can't fall."
              checked={settings.invincible}
              onChange={(v) => updateSettings({ invincible: v })}
            />
            <Toggle
              label="Repeat Skill Trials"
              description="Skip the once-per-day gate and the stat-activity requirement — trials can be replayed immediately without matching habits."
              checked={settings.repeatMinigames}
              onChange={(v) => updateSettings({ repeatMinigames: v })}
            />
          </div>

          {/* Balance report — cumulative per-source XP/gold ledger (v25+). */}
          <div className="border-t border-gold-deep/20 pt-3">
            <Button
              variant="secondary"
              onClick={() => setShowBalanceReport(true)}
              className="flex w-full items-center justify-center gap-2 text-sm"
            >
              <BarChart3 className="h-4 w-4" />
              Balance Report
            </Button>
          </div>

          {/* Testing tools — jump straight to level-locked content. */}
          <div className="space-y-4 border-t border-gold-deep/20 pt-3">
            <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">
              Progression
            </p>

            {/* Level jump */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
                  Set level
                </span>
                <span className="text-[11px] text-ink-muted">
                  current <span className="font-bold tabular-nums text-gold-deep">Lv {level}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {LEVEL_JUMPS.map((lvl) => (
                  <Button
                    key={lvl}
                    variant="secondary"
                    onClick={() => devSetLevel(lvl)}
                    className="px-3 py-1 text-xs"
                  >
                    Lv {lvl}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-ink-light">
                Opens dungeons (3), trials (5), and class assignment (10). Also updates combat stat levels.
              </p>
            </div>

            {/* Deepest floor */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
                  Deepest floor
                </span>
                <span className="text-[11px] text-ink-muted">
                  reached{' '}
                  <span className="font-bold tabular-nums text-gold-deep">{deepestFloor}</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FLOOR_JUMPS.map((n) => (
                  <Button
                    key={n}
                    variant="secondary"
                    onClick={() => devSetDeepestFloor(n)}
                    className="px-3 py-1 text-xs"
                  >
                    {n === 0 ? 'Reset' : `Floor ${n}`}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-ink-light">
                Unlocks Merchant (5), Elite (8), and Tier-3 relic (10) rooms on the next run.
              </p>
            </div>

            {/* Spawn trial */}
            <div className="space-y-1.5">
              <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
                Spawn boss trial
              </span>
              {battle && (
                <p className="text-[10px] text-ember">
                  A battle is already active — dismiss it first.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {TRIALS.map((t) => (
                  <Button
                    key={t.level}
                    variant="secondary"
                    onClick={() => spawn(t.level)}
                    className="px-3 py-1 text-xs"
                    disabled={!!battle}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
              <p className="text-[10px] text-ink-light">
                Starts the fight at once; winning advances you to that level.
              </p>
            </div>

            {/* Class */}
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
                  Class
                </span>
                <span className="text-[11px] text-ink-muted">
                  current{' '}
                  <span className="font-bold text-gold-deep">{classId ?? 'none'}</span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value as StatId)}
                  aria-label="Primary stat"
                  className="rounded-md border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-xs text-ink focus:border-gold-deep focus:outline-none"
                >
                  {STATS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-ink-light">+</span>
                <select
                  value={secondary}
                  onChange={(e) => setSecondary(e.target.value as StatId)}
                  aria-label="Secondary stat"
                  className="rounded-md border border-gold-deep/50 bg-parchment-100/80 px-2 py-1 text-xs text-ink focus:border-gold-deep focus:outline-none"
                >
                  {STATS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs italic text-gold-deep">→ {previewClass}</span>
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant="secondary"
                  onClick={() => chooseClass(primary, secondary)}
                  className="px-3 py-1 text-xs"
                >
                  Assign
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => devClearClass()}
                  className="px-3 py-1 text-xs"
                  disabled={!classId}
                >
                  Clear
                </Button>
              </div>
            </div>

            {/* Resources */}
            <div className="space-y-4 border-t border-gold-deep/20 pt-3">
              <p className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                Resources
              </p>

              {/* Energy */}
              <div className="space-y-1.5">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
                  Energy
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="secondary"
                    onClick={() => devFillEnergy()}
                    className="px-3 py-1 text-xs"
                  >
                    Fill to max
                  </Button>
                </div>
              </div>

              {/* Gold */}
              <div className="space-y-1.5">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
                  Gold
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[100, 500, 2000].map((amt) => (
                    <Button
                      key={amt}
                      variant="secondary"
                      onClick={() => devAddGold(amt)}
                      className="px-3 py-1 text-xs"
                    >
                      +{amt}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Weekly rollover */}
              <div className="space-y-1.5">
                <span className="font-display text-xs font-bold uppercase tracking-wider text-ink">
                  Weekly rollover
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant="secondary"
                    onClick={() => { devForceWeeklyRollover(); checkWeeklyRollover(); onClose(); }}
                    className="px-3 py-1 text-xs"
                  >
                    Force rollover
                  </Button>
                </div>
                <p className="text-[10px] text-ink-light">
                  Rewinds the week sentinel so the weekly report fires immediately.
                </p>
              </div>
            </div>
          </div>

          <DevStateInspector />
        </Panel>
      </div>

      {showBalanceReport && <BalanceReportModal onClose={() => setShowBalanceReport(false)} />}
    </div>
  );
}
