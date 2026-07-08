import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface PanelProps {
  children: ReactNode;
  /** parchment = light surface (ink text); wood = dark surface (parchment text). */
  tone?: 'parchment' | 'wood';
  /**
   * gold = double gold ring + halo, for the ONE hero element of a screen
   * (hero banner, minigame landing card, level-up challenge). plain = crisp
   * single border, for everything else — when every card glows, nothing does.
   */
  frame?: 'gold' | 'plain';
  className?: string;
  /** Show gold corner ornaments. Defaults to true only on gold-framed panels. */
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

/** The workhorse container: a textured surface, plain-bordered by default with a gold hero frame on request. */
export function Panel({
  children,
  tone = 'parchment',
  frame = 'plain',
  className,
  ornate,
  interactive = false,
}: PanelProps) {
  const showCorners = ornate ?? frame === 'gold';
  return (
    <div
      className={cn(
        'relative rounded-md',
        frame === 'gold'
          ? 'shadow-gold'
          : 'border border-gold-deep/50 shadow-[0_3px_10px_rgba(0,0,0,0.35)]',
        tone === 'parchment' ? 'texture-parchment' : 'texture-wood',
        interactive && 'transition-transform hover:-translate-y-0.5 hover:shadow-glow motion-reduce:hover:translate-y-0',
      )}
    >
      {showCorners && <Corners />}
      <div className={cn('relative', className ?? 'p-4')}>{children}</div>
    </div>
  );
}
