import { Crest } from './Crest';
import { resolveSpriteImage, type CrestLook } from '@/lib/sprites';
import { cn } from '@/lib/cn';

type SpriteSize = 'sm' | 'md' | 'lg' | 'xl';

const BOX: Record<SpriteSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-14 w-14',
  lg: 'h-20 w-20',
  xl: 'h-28 w-28',
};

interface SpriteProps {
  /** Stable key (e.g. "boss:procrastination_slime") checked against the sprite registry. */
  spriteKey?: string;
  /** Crest fallback shown until a real sprite image is registered for this key. */
  look: CrestLook;
  size?: SpriteSize;
  shrouded?: boolean;
  alt?: string;
  className?: string;
}

/**
 * Renders a real sprite image when one is registered for `spriteKey`, otherwise the
 * heraldic Crest stand-in. This is the single swap point for future art.
 */
export function Sprite({ spriteKey, look, size = 'md', shrouded, alt, className }: SpriteProps) {
  const img = spriteKey ? resolveSpriteImage(spriteKey) : undefined;
  if (img && !shrouded) {
    return (
      <img
        src={img}
        alt={alt ?? ''}
        className={cn('clip-shield object-cover', BOX[size], className)}
      />
    );
  }
  return <Crest look={look} size={size} shrouded={shrouded} className={className} />;
}
