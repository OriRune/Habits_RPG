import { getScene, resolveSceneImage, scenePlaceholderImage } from '@/lib/scenes';
import { cn } from '@/lib/cn';
import { DungeonSceneArt, hasDungeonSceneArt } from '@/components/dungeon/DungeonSceneArt';

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
 *
 * When a `--biome-tint` CSS variable is set on an ancestor (e.g. the dungeon
 * container), a semi-transparent overlay blends the biome's palette colour into
 * the scene background so each region reads as visually distinct.
 */
export function SceneArt({ sceneKey, caption, size = 'md', className }: SceneArtProps) {
  const look = getScene(sceneKey);
  const cap = caption ?? look.caption;
  // Real art when registered, otherwise a generated wide "framed image box" — always an <img>.
  const registeredImage = resolveSceneImage(sceneKey);
  const useDungeonVector = hasDungeonSceneArt(sceneKey) && !registeredImage;
  const src = registeredImage ?? (useDungeonVector ? null : scenePlaceholderImage(look, cap, sceneKey));

  return (
    <div className={cn('relative overflow-hidden rounded-md border-2 border-gold-deep/60', HEIGHTS[size], className)}>
      {useDungeonVector ? (
        <DungeonSceneArt sceneKey={sceneKey} label={cap} />
      ) : (
        <img src={src!} alt={cap} className="h-full w-full object-cover" />
      )}
      {/* Biome tint overlay — reads --biome-tint from ancestor; transparent when unset */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundColor: 'var(--biome-tint, transparent)', opacity: 0.22 }}
      />
    </div>
  );
}
