import { ChevronLeft, FlaskConical } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { Panel } from '@/components/ui/Panel';
import { Toggle } from '@/components/ui/Toggle';
import { SectionTitle } from '@/components/ui/Divider';

/** Full-screen Settings overlay: general options + a Developer "creative mode" section. */
export function SettingsView({ onClose }: { onClose: () => void }) {
  const settings = useGameStore((s) => s.settings);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const resetGame = useGameStore((s) => s.resetGame);

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
          <p className="text-xs text-ink-muted">More options will appear here as the game grows.</p>
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
          </div>
        </Panel>
      </div>
    </div>
  );
}
