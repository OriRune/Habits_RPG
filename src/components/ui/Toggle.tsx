import { cn } from '@/lib/cn';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}

/** A labeled on/off switch styled in the gold/wood palette (settings rows). */
export function Toggle({ checked, onChange, label, description }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-gold-deep/30 bg-parchment-100/70 p-3 text-left transition-colors hover:border-gold-deep/60"
    >
      <span className="min-w-0">
        <span className="block font-display text-sm font-semibold text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>}
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-gold-deep bg-gradient-to-b from-gold-bright to-gold-deep' : 'border-ink-light/50 bg-wood-900/40',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-parchment-100 shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}
