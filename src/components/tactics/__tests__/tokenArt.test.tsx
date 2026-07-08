// @vitest-environment jsdom
// Token art contract: every enemy in the bestiary has a full-color token, tokens render
// deterministically, and unknown ids fall back (UnitSprite keeps the emoji glyph for those).
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { TOKEN_ART, PALETTES, CreatureToken, HeroToken, hasToken } from '@/components/tactics/tokenArt';
import { ENEMIES } from '@/engine/enemies';

afterEach(cleanup);

describe('tokenArt', () => {
  it('covers the entire enemy roster — every templateId has art and a palette', () => {
    for (const id of Object.keys(ENEMIES)) {
      expect(TOKEN_ART[id], `missing TOKEN_ART for ${id}`).toBeTypeOf('function');
      expect(PALETTES[id], `missing palette for ${id}`).toBeTruthy();
      expect(hasToken(id)).toBe(true);
    }
  });

  it('renders an svg[data-token] for each roster creature', () => {
    for (const id of Object.keys(ENEMIES)) {
      const { container, unmount } = render(<CreatureToken templateId={id} sizePx={30} />);
      expect(container.querySelector(`svg[data-token="${id}"]`), `no svg for ${id}`).toBeTruthy();
      unmount();
    }
  });

  it('renders deterministically — same props, identical markup', () => {
    const a = render(<CreatureToken templateId="dire_wolf" sizePx={30} />);
    const html = a.container.innerHTML;
    a.unmount();
    const b = render(<CreatureToken templateId="dire_wolf" sizePx={30} />);
    expect(b.container.innerHTML).toBe(html);
  });

  it('returns null for unknown template ids (emoji fallback contract)', () => {
    const { container } = render(<CreatureToken templateId="not_a_monster" sizePx={30} />);
    expect(container.firstChild).toBeNull();
    expect(hasToken('not_a_monster')).toBe(false);
  });

  it('mirrors the art when facing left', () => {
    const { container } = render(<CreatureToken templateId="skeleton" sizePx={30} facing="left" />);
    const svg = container.querySelector('svg[data-token="skeleton"]') as SVGElement;
    expect(svg.style.transform).toBe('scaleX(-1)');
  });

  it('hero token renders for a classless adventurer and for a real class', () => {
    const a = render(<HeroToken variant="player" classId={null} sizePx={30} />);
    expect(a.container.querySelector('svg[data-token="hero-player"]')).toBeTruthy();
    a.unmount();
    const b = render(<HeroToken variant="ally" classId="Warden" cloakColor="#22c55e" sizePx={30} />);
    expect(b.container.querySelector('svg[data-token="hero-ally"]')).toBeTruthy();
  });
});
