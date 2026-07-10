import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DungeonSceneArt, hasDungeonSceneArt } from '../DungeonSceneArt';

describe('DungeonSceneArt', () => {
  it('covers every scene used by Dungeon Delve', () => {
    for (const key of [
      'dungeon:entrance', 'dungeon:checkpoint', 'dungeon:cleared', 'dungeon:retreat',
      'room:combat', 'room:treasure', 'room:rest', 'room:boss', 'room:encounter',
      'room:shrine', 'room:merchant', 'room:elite',
      'outcome:success', 'outcome:partial', 'outcome:fail', 'combat:victory', 'combat:defeat',
    ]) expect(hasDungeonSceneArt(key), key).toBe(true);
  });

  it('renders accessible vector art without emoji placeholders', () => {
    const html = renderToStaticMarkup(<DungeonSceneArt sceneKey="room:treasure" label="A glittering hoard" />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-label="A glittering hoard"');
    expect(html).toContain('data-dungeon-scene="room:treasure"');
    expect(html).not.toContain('ðŸ');
  });
});
