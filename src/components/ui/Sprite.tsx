import { Crest } from './Crest';
import { resolveSpriteImage, placeholderImage, type CrestLook } from '@/lib/sprites';
import { cn } from '@/lib/cn';

type SpriteSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const BOX: Record<SpriteSize, string> = {
  xs: 'h-6 w-6',
  sm: 'h-8 w-8',
  md: 'h-14 w-14',
  lg: 'h-20 w-20',
  xl: 'h-28 w-28',
};

interface SpriteProps {
  /** Stable key (e.g. "boss:procrastination_slime") checked against the sprite registry. */
  spriteKey?: string;
  /** Crest look — the tint/glyph used to generate the placeholder image (and shroud fallback). */
  look: CrestLook;
  size?: SpriteSize;
  shrouded?: boolean;
  alt?: string;
  /** Small caption baked into the placeholder image. Defaults to the key's suffix. */
  label?: string;
  className?: string;
}

/** A readable label derived from a sprite key, e.g. "item:healing_potion" -> "healing potion". */
function labelFromKey(key?: string): string | undefined {
  if (!key) return undefined;
  const tail = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
  return tail.replace(/_/g, ' ');
}

/**
 * Renders a real sprite image when one is registered for `spriteKey`, otherwise a generated
 * "framed image box" placeholder (still a real <img>). Shrouded entries stay hidden as a Crest.
 * This is the single swap point for future art: register a URL and it takes over automatically.
 */
export function Sprite({ spriteKey, look, size = 'md', shrouded, alt, label, className }: SpriteProps) {
  if (shrouded) {
    return <Crest look={look} size={size} shrouded className={className} />;
  }
  const real = spriteKey ? resolveSpriteImage(spriteKey) : undefined;
  const src = real ?? placeholderImage(look, label ?? labelFromKey(spriteKey));
  return (
    <img
      src={src}
      alt={alt ?? label ?? ''}
      className={cn(real ? 'clip-shield object-cover' : 'rounded-md object-cover', BOX[size], 'shrink-0', className)}
    />
  );
}
