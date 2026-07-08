import { useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { parseISODate, addDays, weekdayOf } from '@/engine/date';
import { cn } from '@/lib/cn';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface DatePickerProps {
  /** Currently selected ISO date. */
  value: string;
  onChange: (iso: string) => void;
  /** Earliest selectable day (inclusive). */
  minISO: string;
  /** Latest selectable day (inclusive). */
  maxISO: string;
  /** Optional predicate to mark a day as having activity (renders a dot). */
  hasActivity?: (iso: string) => boolean;
}

/** First day (ISO) of the calendar month containing `iso`. */
function startOfMonth(iso: string): string {
  return iso.slice(0, 7) + '-01';
}

/** Calendar-grid popover for picking a past day. Days outside [min, max] are disabled. */
export function DatePicker({ value, onChange, minISO, maxISO, hasActivity }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(value)); // ISO of the 1st shown

  const monthDate = parseISODate(month);
  const firstWeekday = weekdayOf(month); // 0=Sun
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();

  // Build a 6×7 grid of ISO dates (null for leading/trailing blanks).
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(addDays(month, d - 1));
  while (cells.length % 7 !== 0) cells.push(null);

  const canPrev = startOfMonth(minISO) < month;
  const canNext = month < startOfMonth(maxISO);

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => {
          setMonth(startOfMonth(value));
          setOpen((o) => !o);
        }}
        className="flex h-9 items-center justify-center rounded-md border border-gold-deep/70 px-2.5 text-on-wood texture-wood transition-colors hover:border-gold"
        aria-label="Pick a day"
        title="Pick a day"
      >
        <CalendarDays className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-20 w-72 rounded-md border border-gold-deep/40 bg-parchment-100 p-3 shadow-gold-sm">
            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() => canPrev && setMonth(addDays(month, -1).slice(0, 7) + '-01')}
                disabled={!canPrev}
                className="rounded p-1 text-ink-light hover:text-ink disabled:opacity-30"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-display text-sm font-semibold text-ink">
                {MONTHS[monthDate.getMonth()]} {monthDate.getFullYear()}
              </span>
              <button
                onClick={() => canNext && setMonth(addDays(month, 31).slice(0, 7) + '-01')}
                disabled={!canNext}
                className="rounded p-1 text-ink-light hover:text-ink disabled:opacity-30"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-light">
              {WEEKDAYS.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((iso, i) => {
                if (!iso) return <div key={i} />;
                const disabled = iso < minISO || iso > maxISO;
                const selected = iso === value;
                const day = parseISODate(iso).getDate();
                return (
                  <button
                    key={i}
                    disabled={disabled}
                    onClick={() => {
                      onChange(iso);
                      setOpen(false);
                    }}
                    className={cn(
                      'relative flex h-8 items-center justify-center rounded text-sm transition-colors',
                      disabled
                        ? 'text-ink-light/30'
                        : selected
                          ? 'bg-gradient-to-b from-gold-bright to-gold-deep font-semibold text-wood-900'
                          : 'text-ink hover:bg-gold/15',
                    )}
                  >
                    {day}
                    {!selected && !disabled && hasActivity?.(iso) && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-ember" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
