import { useState } from 'react';
import { ChevronLeft, FlaskConical } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { STATS, type StatId } from '@/engine/stats';
import type { ArenaSpeed } from '@/engine/arena';
import { classFor } from '@/engine/classes';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { SectionTitle } from '@/components/ui/Divider';
import { AppearanceSection } from '@/components/settings/AppearanceSection';

const LEVEL_JUMPS = [3, 5, 10, 20, 50];
const FLOOR_JUMPS = [0, 5, 8, 10];
const TRIALS = [
  { level: 5, label: 'Slime (Lv 5)' },
  { level: 10, label: 'Guardian (Lv 10)' },
  { level: 20, label: 'Golem (Lv 20)' },
];

/** Full-screen Settings overlay: general options + a Developer "creative mode" section. */
export function SettingsView({ onClose }: { onClose: () => void }) {
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const resetGame = useGameStore((s) => s.resetGame);

  const level = useGameStore((s) => s.character.level);
  const classId = useGameStore((s) => s.character.classId);
  const deepestFloor = useGameStore((s) => s.deepestFloor);
  const devSetLevel = useGameStore((s) => s.devSetLevel);
  const devSetDeepestFloor = useGameStore((s) => s.devSetDeepestFloor);
  const devSpawnTrial = useGameStore((s) => s.devSpawnTrial);
  const devClearClass = useGameStore((s) => s.devClearClass);
  const chooseClass = useGameStore((s) => s.chooseClass);

  const [primary, setPrimary] = useState<StatId>('ST');
  const [secondary, setSecondary] = useState<StatId>('DX');
  const previewClass = classFor(primary, secondary);

  const spawn = (lvl: number) => {
    devSpawnTrial(lvl);
    onClose(); // surface the BattleOverlay over the dashboard
  };

  return (
    <div className="texture-wood fixed inset-0 z-50 overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b-2 border-gold-deep bg-wood-800/95 px-4 py-3 backdrop-blur">
        <button onClick={onClose} className="text-parchment-200 hover:text-gold-bright" aria-label="Back">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-lg font-bold text-gold-bright">Settings</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {/* General */}
        <Panel tone="parchment" className="space-y-3 p-4">
          <SectionTitle>General</SectionTitle>

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
              description="Skip the once-per-day gate — trials can be replayed immediately."
              checked={settings.repeatMinigames}
              onChange={(v) => updateSettings({ repeatMinigames: v })}
            />
          </div>

          {/* Testing tools — jump straight to level-locked content. */}
          <div className="space-y-4 border-t border-gold-deep/20 pt-3">
            <p className="text-xs text-ink-muted">
              Testing jumps — set progression directly to reach gated content.
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
                Opens dungeons (3), trials (5), and class assignment (10).
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
              <div className="flex flex-wrap gap-1.5">
                {TRIALS.map((t) => (
                  <Button
                    key={t.level}
                    variant="secondary"
                    onClick={() => spawn(t.level)}
                    className="px-3 py-1 text-xs"
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
          </div>
        </Panel>
      </div>
    </div>
  );
}
