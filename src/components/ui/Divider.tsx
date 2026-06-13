import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Filigree divider: a thin gold rule with a central ornament. */
export function Divider({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-gold-deep/70', className)} aria-hidden>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-deep/60" />
      <span className="text-xs">❖</span>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-deep/60" />
    </div>
  );
}

/** A Cinzel section heading flanked by filigree rules. */
export function SectionTitle({
  children,
  className,
  tone = 'parchment',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'parchment' | 'wood';
}) {
  const text = tone === 'parchment' ? 'text-ink' : 'text-gold-bright';
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-deep/50" />
      <h2 className={cn('font-display text-sm font-semibold uppercase tracking-[0.18em]', text)}>{children}</h2>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-deep/50" />
    </div>
  );
}
