import { Bell, X } from 'lucide-react';
import { useGameStore } from '@/store/useGameStore';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';

/**
 * One-time dashboard card shown after a recently missed scheduled day when the
 * daily reminder is still off. Offers to enable the existing reminder (requesting
 * notification permission first), or dismiss it for good. Both paths call
 * `dismissReminderCard()`, whose flag is persisted so the card never reappears.
 * See HABIT-03.
 */
export function ReminderCard() {
  const updateSettings = useGameStore((s) => s.updateSettings);
  const dismiss = useGameStore((s) => s.dismissReminderCard);

  async function enable() {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // Prompt failed or was blocked — enable anyway; the in-app toast fallback fires.
      }
    }
    updateSettings({ dailyReminderEnabled: true });
    dismiss();
  }

  return (
    <Panel tone="parchment" className="relative flex items-start gap-3 p-4">
      <button
        onClick={dismiss}
        aria-label="Dismiss reminder offer"
        className="absolute right-3 top-3 rounded text-ink-light/50 transition-colors hover:text-ink-muted"
      >
        <X className="h-4 w-4" />
      </button>
      <Bell className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1 pr-5">
        <div className="font-display text-sm font-bold text-ink">Missed a day?</div>
        <p className="mt-0.5 text-sm leading-snug text-ink-muted">
          Turn on a daily reminder so you never forget to log your habits. Pick the time
          anytime in Settings.
        </p>
        <Button onClick={enable} variant="secondary" className="mt-3">
          Enable daily reminder
        </Button>
      </div>
    </Panel>
  );
}
