import { useEffect, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { selectDailySummary } from '@/store/selectors';
import { useToastStore } from '@/store/useToastStore';
import { now, toISODate } from '@/engine/date';

const CHECK_INTERVAL_MS = 60_000; // poll once per minute

/**
 * Fire the daily reminder through the best available channel. Prefers the service
 * worker's `showNotification` (required on Chrome-for-Android), then a page-context
 * Notification, then an in-app toast. `getRegistration()` resolves quickly (unlike
 * `serviceWorker.ready`, which hangs forever when no SW is registered — e.g. in dev).
 */
function fireReminder(body: string, pushToast: (t: { text: string }) => void) {
  const canNotify =
    typeof Notification !== 'undefined' && Notification.permission === 'granted';
  if (!canNotify) {
    pushToast({ text: body });
    return;
  }

  const opts: NotificationOptions = { body, icon: '/favicon.png' };
  const toast = () => pushToast({ text: body });
  const nativeThenToast = () => {
    try {
      new Notification('HabitsRPG', opts);
    } catch {
      toast();
    }
  };

  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => (reg ? reg.showNotification('HabitsRPG', opts) : nativeThenToast()))
      .catch(nativeThenToast);
  } else {
    nativeThenToast();
  }
}

/**
 * Foreground daily reminder hook — mounted once in App.tsx.
 *
 * When `settings.dailyReminderEnabled` is true and the browser has notification
 * permission, fires a notification once per calendar day at the configured time
 * (`settings.dailyReminderTime`, "HH:MM" 24-hour). Prefers the service worker's
 * `registration.showNotification` — the only path that works on Chrome-for-Android,
 * where page-context `new Notification(...)` throws — and falls back to a native
 * Notification, then to an in-app toast, if the SW or API is unavailable.
 *
 * Still foreground-only: the once-a-minute poll only runs while a tab is open, so
 * this is a "you left the tab open past your reminder time" cue, not a true
 * background push (which would need Periodic Background Sync or a push endpoint).
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
      fireReminder(body, pushToast);
    }

    // Run an immediate check on mount (in case the user enabled reminders after the time).
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, reminderTime, pushToast]);
}
