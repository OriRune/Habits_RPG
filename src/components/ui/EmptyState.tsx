import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  /** Optional icon rendered above the message. */
  icon?: LucideIcon;
  /** Optional bolded heading line. */
  title?: string;
  /** Primary descriptive text — explains what this section is and how to populate it. */
  message: ReactNode;
  /** If provided, a Button CTA is rendered below the message. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * Shared dashed-border empty-state card used wherever a list or panel would otherwise
 * render nothing. Replaces the ad-hoc pattern in DashboardView / HistoryView.
 */
export function EmptyState({ icon: Icon, title, message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-dashed border-gold-deep/40 p-6 text-center',
        className,
      )}
    >
      {Icon && <Icon className="mx-auto mb-2 h-5 w-5 text-gold-deep/60" />}
      {title && (
        <p className="mb-1 font-display text-sm font-semibold text-ink-muted">{title}</p>
      )}
      <p className="text-sm text-ink-muted">{message}</p>
      {action && (
        <Button onClick={action.onClick} className="mt-3">
          {action.label}
        </Button>
      )}
    </div>
  );
}
