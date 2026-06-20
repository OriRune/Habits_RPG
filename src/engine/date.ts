// Local-date helpers. We key habit completion by calendar day (YYYY-MM-DD)
// in the player's local timezone, so "today" matches what the user sees.

// ---------------------------------------------------------------------------
// Injectable clock seam
//
// All "what is today/now" reads go through now() so tests can override the
// clock without patching the global Date. Always call _resetNow() in afterEach.
// ---------------------------------------------------------------------------

let _now: () => Date = () => new Date();

/** Offset in ms added to the device clock when a server-time sync has run. */
let _offsetMs = 0;

/** The current local datetime. All "what is now" reads should route through this. */
export function now(): Date {
  const base = _now();
  return _offsetMs === 0 ? base : new Date(base.getTime() + _offsetMs);
}

/**
 * Set a persistent clock offset so all `now()` calls reflect server time.
 * Called once per session after `supabase.rpc('server_now')` succeeds.
 * A no-op when the backend is unconfigured (offset stays 0).
 */
export function setClockOffset(ms: number): void {
  _offsetMs = ms;
}

/** Override the clock for tests. Pair with _resetNow() in afterEach. */
export function _setNow(fn: () => Date): void {
  _now = fn;
}

/** Restore the real wall clock and reset the server offset after a test override. */
export function _resetNow(): void {
  _now = () => new Date();
  _offsetMs = 0;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function toISODate(d: Date = now()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Whole-day difference a - b (positive when a is later). */
export function daysBetween(aIso: string, bIso: string): number {
  const a = parseISODate(aIso).getTime();
  const b = parseISODate(bIso).getTime();
  return Math.round((a - b) / 86_400_000);
}

export function addDays(iso: string, n: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

/** 0 = Sunday .. 6 = Saturday for an ISO date. */
export function weekdayOf(iso: string): number {
  return parseISODate(iso).getDay();
}

/** ISO date of the Sunday that starts the week containing `iso`. */
export function startOfWeek(iso: string): string {
  return addDays(iso, -weekdayOf(iso));
}

/** Stable key for the week containing `iso` (its starting Sunday). */
export function weekKey(iso: string): string {
  return startOfWeek(iso);
}

/**
 * Maximum days a player can back-date a habit completion via the normal DatePicker (§4.1).
 * Older corrections can be made through the "Log older entry" escape hatch in the habit's kebab menu.
 */
export const BACKDATE_WINDOW_DAYS = 7;
