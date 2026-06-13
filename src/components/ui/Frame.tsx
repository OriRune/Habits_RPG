import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface FrameProps {
  children: ReactNode;
  tone?: 'parchment' | 'wood';
  className?: string;
}

/** Ornate square frame for sprites/avatars — gold double-border around a textured inset. */
export function Frame({ children, tone = 'wood', className }: FrameProps) {
  return (
    <div
      className={cn(
        'relative grid place-items-center rounded-md p-2 shadow-gold',
        tone === 'parchment' ? 'texture-parchment' : 'texture-wood',
        className,
      )}
    >
      {children}
    </div>
  );
}
