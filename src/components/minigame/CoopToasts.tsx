import { useCoopStore } from '@/net/coop/session';

/**
 * Transient co-op join/leave notices, stacked at the top of a run overlay. Driven by
 * the live remote-player roster (see useCoopSession), so they fire reliably during a
 * raid — including on disconnect — independent of the party chat.
 */
export function CoopToasts() {
  const notices = useCoopStore((s) => s.notices);
  if (notices.length === 0) return null;
  return (
    <div className="pointer-events-none absolute left-1/2 top-2 z-[60] flex -translate-x-1/2 flex-col items-center gap-1">
      {notices.map((n) => (
        <div
          key={n.id}
          className="rounded-full border border-gold-deep/50 bg-black/80 px-3 py-1 font-display text-xs text-gold-bright shadow-lg"
        >
          {n.text}
        </div>
      ))}
    </div>
  );
}
