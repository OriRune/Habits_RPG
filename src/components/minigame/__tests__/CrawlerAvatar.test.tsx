// @vitest-environment jsdom
// 4.2: gear-reflecting avatar (toolTier recolor) + a swing-trigger ref the overlay's
// rAF loop toggles imperatively (see MineRunOverlay's crawler-swing-anim wiring).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createRef } from 'react';
import { CrawlerAvatar } from '../CrawlerAvatar';

describe('CrawlerAvatar (4.2)', () => {
  it('renders for each tool tier without throwing', () => {
    for (const toolTier of ['stone', 'iron', 'mithril'] as const) {
      const { container } = render(
        <CrawlerAvatar variant="miner" facing="down" moving={false} cell={32} toolTier={toolTier} />,
      );
      expect(container.querySelector('.crawler-avatar')).toBeTruthy();
    }
  });

  it('renders with no toolTier (default look) without throwing', () => {
    const { container } = render(<CrawlerAvatar variant="miner" facing="down" moving={false} cell={32} />);
    expect(container.querySelector('.crawler-avatar')).toBeTruthy();
  });

  it('attaches toolRef to the tool group so a caller can trigger the swing class', () => {
    const toolRef = createRef<HTMLDivElement>();
    render(<CrawlerAvatar variant="miner" facing="down" moving={false} cell={32} toolRef={toolRef} />);
    expect(toolRef.current).toBeTruthy();
    toolRef.current!.classList.add('crawler-swing-anim');
    expect(toolRef.current!.classList.contains('crawler-swing-anim')).toBe(true);
  });

  it('a dead avatar renders the skull glyph instead of the sprite', () => {
    const { container } = render(<CrawlerAvatar variant="miner" facing="down" moving={false} dead cell={32} />);
    expect(container.textContent).toContain('💀');
    expect(container.querySelector('.crawler-avatar')).toBeNull();
  });
});
