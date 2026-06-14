import { getScene, resolveSceneImage, scenePlaceholderImage } from '@/lib/scenes';
import { cn } from '@/lib/cn';

interface SceneArtProps {
  sceneKey: string;
  /** Override the default caption (or pass '' to hide it). */
  caption?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const HEIGHTS = { sm: 'h-20', md: 'h-28', lg: 'h-40' };

/**
 * Illustrates a dungeon event. Renders a real image once registered for the key,
 * otherwise a themed placeholder banner (big glyph + tint + caption).
 */
export function SceneArt({ sceneKey, caption, size = 'md', className }: SceneArtProps) {
  const look = getScene(sceneKey);
  const cap = caption ?? look.caption;
  // Real art when registered, otherwise a generated wide "framed image box" — always an <img>.
  const src = resolveSceneImage(sceneKey) ?? scenePlaceholderImage(look, cap);

  return (
    <img
      src={src}
      alt={cap}
      className={cn('w-full rounded-md border-2 border-gold-deep/60 object-cover', HEIGHTS[size], className)}
    />
  );
}
