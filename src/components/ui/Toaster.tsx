import { useToastStore } from '@/store/useToastStore';

/**
 * Renders transient XP / notification toasts in the bottom-right corner.
 * Mount once near the root of App.tsx alongside BoonChoice.
 * Toasts are non-interactive (pointer-events-none) and auto-expire after 2.2 s.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-24 right-4 z-50 flex flex-col items-end gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-fade-in rounded-md border border-gold-deep/40 bg-parchment-100 px-3 py-1.5 font-display text-sm font-bold shadow-gold-sm"
          style={t.color ? { color: t.color } : undefined}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
