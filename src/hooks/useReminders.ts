import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { selectDailySummary } from '@/store/selectors';
import { useToastStore } from '@/store/useToastStore';
import { now, toISODate } from '@/engine/date';

const CHECK_INTERVAL_MS = 60_000; // poll once per minute

/**
 * Foreground daily reminder hook — mounted once in App.tsx.
 *
 * When `settings.dailyReminderEnabled` is true and the browser has notification
 * permission, fires a native Notification once per calendar day at the configured
 * time (`settings.dailyReminderTime`, "HH:MM" 24-hour). Falls back to an in-app
 * toast (reusing the Stage-6.1 Toaster) if permission is denied or the API is
 * unavailable. No service worker is required — this is foreground-only.
 *
 * Design constraints:
 *  - One notification per day max (tracked in a ref, not persisted — resets on reload).
 *  - Uses `now()` from engine/date for server-clock-aware time checks.
 *  - Guards all `Notification` accesses with an availability check.
 */
export function useReminders() {
  const enabled = useGameStore((s) => s.settings.dailyReminderEnabled);
  const reminderTime = useGameStore((s) => s.settings.dailyReminderTime);
  const pushToast = useToastStore((s) => s.pushToast);

  // Tracks the last calendar date on which we already fired the reminder this session.
  const lastFiredISO = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const [hStr, mStr] = reminderTime.split(':');
    const targetHour = parseInt(hStr ?? '20', 10);
    const targetMin = parseInt(mStr ?? '0', 10);

    function check() {
      const currentDate = now();
      const todayISO = toISODate(currentDate);

      // Only fire once per calendar day.
      if (lastFiredISO.current === todayISO) return;

      const currentHour = currentDate.getHours();
      const currentMin = currentDate.getMinutes();

      // Fire once the clock has reached or passed the configured time.
      if (currentHour < targetHour || (currentHour === targetHour && currentMin < targetMin)) return;

      // Determine how many habits still need to be logged today.
      const summary = selectDailySummary(useGameStore.getState());
      const pending = summary.pendingToday;
      const body =
        pending > 0
          ? `You have ${pending} habit${pending !== 1 ? 's' : ''} left to complete today.`
          : "All habits done — great work today!";

      // Mark fired before attempting notification so a permission error doesn't loop.
      lastFiredISO.current = todayISO;

      const notifAvailable =
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted';

      if (notifAvailable) {
        try {
          new Notification('HabitsRPG', { body, icon: '/favicon.png' });
        } catch {
          // Fallback: show an in-app toast if the notification API throws.
          pushToast({ text: body });
        }
      } else {
        // Notification unavailable or denied — show in-app toast instead.
        pushToast({ text: body });
      }
    }

    // Run an immediate check on mount (in case the user enabled reminders after the time).
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, reminderTime, pushToast]);
}
