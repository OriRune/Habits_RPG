import { getScene, resolveSceneImage } from '@/lib/scenes';
import { cn } from '@/lib/cn';

interface SceneArtProps {
  sceneKey: string;
  /** Override the default caption (or pass '' to hide it). */
  caption?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const HEIGHTS = { sm: 'h-20', md: 'h-28', lg: 'h-40' };
const GLYPH = { sm: 'text-4xl', md: 'text-5xl', lg: 'text-6xl' };

/**
 * Illustrates a dungeon event. Renders a real image once registered for the key,
 * otherwise a themed placeholder banner (big glyph + tint + caption).
 */
export function SceneArt({ sceneKey, caption, size = 'md', className }: SceneArtProps) {
  const img = resolveSceneImage(sceneKey);
  const look = getScene(sceneKey);
  const cap = caption ?? look.caption;

  if (img) {
    return (
      <img
        src={img}
        alt={cap}
        className={cn('w-full rounded-md border-2 border-gold-deep/60 object-cover', HEIGHTS[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'relative flex w-full items-center justify-center overflow-hidden rounded-md border-2 border-gold-deep/60 shadow-gold-sm',
        HEIGHTS[size],
        className,
      )}
      style={{ background: `radial-gradient(ellipse at center, ${look.color}55 0%, #160c06 110%)` }}
      aria-label={cap}
    >
      <span className={cn('drop-shadow-[0_2px_3px_rgba(0,0,0,0.6)]', GLYPH[size])}>{look.glyph}</span>
      {cap && (
        <span className="absolute bottom-1 right-2 font-display text-[11px] uppercase tracking-wider text-parchment-200/80">
          {cap}
        </span>
      )}
    </div>
  );
}
