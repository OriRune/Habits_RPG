// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { guardianArt, StoneGolemArt, MagmaColossusArt } from '../GuardianArt';

describe('GuardianArt (4.1)', () => {
  it('guardianArt resolves art for both band-gate guardian keys', () => {
    expect(guardianArt('stone_golem')).toBeTruthy();
    expect(guardianArt('magma_colossus')).toBeTruthy();
  });

  it('guardianArt returns undefined for a non-guardian key (caller keeps its glyph)', () => {
    expect(guardianArt('cave_slug')).toBeUndefined();
  });

  it('renders both guardian SVGs without throwing', () => {
    const golem = render(<StoneGolemArt />);
    expect(golem.container.querySelector('svg')).toBeTruthy();
    const colossus = render(<MagmaColossusArt />);
    expect(colossus.container.querySelector('svg')).toBeTruthy();
  });
});
