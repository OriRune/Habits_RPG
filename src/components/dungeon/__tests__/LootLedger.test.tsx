// @vitest-environment jsdom
// Banked-vs-exposed loot (dungeon-delve-plan-2026-07.md item 4.3 / DUN-09): the safe and
// at-risk containers are visually distinct, and the retention preview renders from the
// same engine helper the run-end path uses — never from hard-coded percentages.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { previewRetainedReward } from '@/engine/dungeonRun';
import { LootLedger } from '../LootLedger';

afterEach(cleanup);

describe('LootLedger (plan 4.3)', () => {
  it('labels the two containers and shows the engine-exact keep amounts', () => {
    const run = {
      bankedReward: { gold: 84, materials: { herbs: 2 } },
      floorReward: { gold: 35, materials: { stone: 1 }, items: ['healing_potion'] },
    };
    const { container, getByText } = render(<LootLedger run={run} />);
    expect(getByText(/Banked · safe/i)).toBeTruthy();
    expect(getByText(/This floor · exposed/i)).toBeTruthy();
    expect(container.textContent).toContain('84g · 2 mat');
    expect(container.textContent).toContain('35g · 1 mat · 1 drop');

    const fled = previewRetainedReward(run, 'fled').kept.gold ?? 0;
    const fell = previewRetainedReward(run, 'defeated').kept.gold ?? 0;
    expect(container.textContent).toContain(`Flee keeps ${fled}g`);
    expect(container.textContent).toContain(`a fall keeps ${fell}g`);
    expect(container.textContent).toContain('drops are lost either way');
  });

  it('shows quiet placeholders when nothing is banked or at risk', () => {
    const { container } = render(<LootLedger run={{ bankedReward: {}, floorReward: {} }} />);
    expect(container.textContent).toContain('Nothing banked yet');
    expect(container.textContent).toContain('Nothing at risk yet');
    expect(container.textContent).not.toContain('Flee keeps');
  });

  it('omits the drops warning when the floor has only gold and materials', () => {
    const { container } = render(
      <LootLedger run={{ bankedReward: {}, floorReward: { gold: 10 } }} />,
    );
    expect(container.textContent).toContain('Flee keeps');
    expect(container.textContent).not.toContain('drops are lost');
  });
});
