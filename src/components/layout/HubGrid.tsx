import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface HubCard<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  blurb: string;
}

interface HubGridProps<T extends string> {
  title: string;
  description?: string;
  cards: HubCard<T>[];
  onPick: (id: T) => void;
}

/** A card-grid hub for navigating to sub-modes (Explore, Battle, etc.). */
export function HubGrid<T extends string>({
  title,
  description,
  cards,
  onPick,
}: HubGridProps<T>) {
  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-wide text-gold-bright">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-on-wood-mid">{description}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ id, label, icon: Icon, blurb }) => (
          <button
            key={id}
            onClick={() => onPick(id)}
            className={cn(
              'group relative rounded-lg p-5 text-left',
              'texture-parchment shadow-gold',
              'transition-transform hover:-translate-y-0.5 hover:shadow-glow',
              'motion-reduce:hover:translate-y-0',
            )}
          >
            {/* Icon badge */}
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-md border border-gold-deep/30 bg-wood/20 text-ember">
              <Icon className="h-6 w-6" />
            </div>

            <div className="font-display text-base font-bold text-ink">{label}</div>
            <p className="mt-1 text-sm leading-snug text-ink-muted">{blurb}</p>

            {/* Subtle chevron */}
            <span className="absolute bottom-3 right-4 text-gold-deep/40 font-display text-sm">
              ❯
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
