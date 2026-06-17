import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PanelProps {
  children: ReactNode;
  /** parchment = light surface (ink text); wood = dark surface (parchment text). */
  tone?: 'parchment' | 'wood';
  className?: string;
  /** Show gold corner ornaments. */
  ornate?: boolean;
  /** Adds hover lift + glow — use for clickable panels. Disabled under reduced-motion. */
  interactive?: boolean;
}

function Corners() {
  return (
    <>
      <span className="pointer-events-none absolute left-1 top-0.5 text-xs leading-none text-gold-deep/70">❖</span>
      <span className="pointer-events-none absolute right-1 top-0.5 text-xs leading-none text-gold-deep/70">❖</span>
      <span className="pointer-events-none absolute bottom-0.5 left-1 text-xs leading-none text-gold-deep/70">❖</span>
      <span className="pointer-events-none absolute bottom-0.5 right-1 text-xs leading-none text-gold-deep/70">❖</span>
    </>
  );
}

/** The workhorse container: a textured surface inside a gold double-frame. */
export function Panel({ children, tone = 'parchment', className, ornate = true, interactive = false }: PanelProps) {
  return (
    <div
      className={cn(
        'relative rounded-md shadow-gold',
        tone === 'parchment' ? 'texture-parchment' : 'texture-wood',
        interactive && 'transition-transform hover:-translate-y-0.5 hover:shadow-glow motion-reduce:hover:translate-y-0',
      )}
    >
      {ornate && <Corners />}
      <div className={cn('relative', className ?? 'p-4')}>{children}</div>
    </div>
  );
}
