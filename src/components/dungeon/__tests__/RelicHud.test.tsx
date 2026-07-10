// @vitest-environment jsdom
// HUD restructure (dungeon-delve-plan-2026-07.md item 4.4 / DUN-19): the relic tray
// caps at RELIC_TRAY_MAX icons + "+N", the run readout is one aggregated line, and a
// triggered relic renders its trigger text instead of an empty token. Full detail
// (per-relic rows, ×N stacks, trigger descriptions) lives in the modal only.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { RELICS } from '@/content/relics';
import { RelicTray, RELIC_TRAY_MAX } from '../RelicTray';
import { RunBuffs } from '../RunBuffs';

afterEach(cleanup);

describe('RelicTray cap (plan 4.4)', () => {
  const tenRelics = [
    'ember_sigil', 'keen_lens', 'swift_anklet', 'oak_token', 'sage_bead',
    'silver_tongue', 'owl_charm', 'vital_charm', 'stone_heart', 'stone_heart',
  ];

  it('shows at most RELIC_TRAY_MAX icons plus an overflow chip', () => {
    const { container, getByText } = render(<RelicTray relics={tenRelics} />);
    const icons = container.querySelectorAll('button');
    // 8 sprite buttons + the "+2" chip
    expect(icons.length).toBe(RELIC_TRAY_MAX + 1);
    expect(getByText(`+${tenRelics.length - RELIC_TRAY_MAX}`)).toBeTruthy();
  });

  it('the overflow chip opens the modal, where duplicates stack as ×N', () => {
    const { getByText } = render(<RelicTray relics={tenRelics} />);
    fireEvent.click(getByText('+2'));
    expect(getByText(`Relics (${tenRelics.length})`)).toBeTruthy();
    expect(getByText('×2')).toBeTruthy(); // the duplicated stone_heart collapses to one row
  });

  it('renders no chip when everything fits', () => {
    const { container } = render(<RelicTray relics={['ember_sigil']} />);
    expect(container.textContent).not.toContain('+1');
  });
});

describe('RunBuffs aggregate line (plan 4.4)', () => {
  it('nets stat totals across relics, curses included', () => {
    // +3 ST, +3 ST, and the −3 ST curse → net +3 ST on one line.
    const { container, getByText } = render(
      <RunBuffs relics={['ember_sigil', 'ember_sigil', 'dull_blade']} />,
    );
    expect(getByText('Run total')).toBeTruthy();
    expect(getByText('+3 STR')).toBeTruthy();
    expect(container.textContent).toContain('incl. 1 curse');
    // No per-relic rows in the HUD anymore — names live in the modal.
    expect(container.textContent).not.toContain('Ember Sigil');
  });

  it('renders trigger text for an empty-effect triggered relic, never an empty token', () => {
    const heal = Math.round((RELICS.bloodied_fang.trigger as { healPct: number }).healPct * 100);
    const { container, getByText } = render(<RunBuffs relics={['bloodied_fang']} />);
    expect(getByText(`+${heal}% HP after wins`)).toBeTruthy();
    expect(container.textContent).not.toContain('Bloodied Fang');
  });

  it('describes the low-HP and shrine triggers compactly', () => {
    const { container } = render(<RunBuffs relics={['desperate_ward', 'shrine_stone']} />);
    expect(container.textContent).toContain('+6 DEF below 35% HP');
    expect(container.textContent).toContain('+1 WIS +1 CHA per shrine');
  });
});
