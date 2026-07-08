// @vitest-environment jsdom
// Component smoke (plan3 10.4 / M4) — the Homestead's interactive shell. The build/
// placement logic is engine- and slice-tested; this exercises the reachable UI wiring:
// entering placement from the panel and confirming a valid placement queues a build,
// the Deeds tab surfaces the 500g gate with a disabled Buy, and the building card
// renders an upgrade cost. Canvas cell/building taps are coordinate hit-tests over live
// SVG layout (no jsdom geometry), so the card is exercised directly by buildingId.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { TownView } from '@/views/TownView';
import { TownBuildingCard } from '@/components/town/TownBuildingCard';
import { useGameStore } from '@/store/useGameStore';
import { useToastStore } from '@/store/useToastStore';
import { freshTown } from '@/engine/town';

const get = () => useGameStore.getState();

beforeEach(() => {
  get().resetGame();
  useGameStore.setState({
    town: freshTown(),
    materials: { stone: 99, wood: 99, iron_bar: 99, gemstone: 99 },
    character: { ...get().character, gold: 9999 },
  });
  useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

describe('TownView placement flow (M4)', () => {
  it('picking a building then confirming a valid centred placement queues a build', () => {
    render(<TownView />);
    fireEvent.click(screen.getByRole('button', { name: /Build & Decorate/ }));

    // The Keep is the first (buildable, affordable) row — enter placement.
    const keepRow = screen.getByText('The Keep').closest('.rounded-md') as HTMLElement;
    fireEvent.click(within(keepRow).getByRole('button', { name: 'Place' }));

    // The centred ghost on a fresh town is valid → Confirm is enabled and queues the build.
    const confirm = screen.getByLabelText('Confirm placement') as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    expect(get().town.queue).toHaveLength(1);
    expect(get().town.queue[0].key).toBe('keep');
  });

  it('the Deeds tab shows the 500g first-deed cost with a prestige-gated, disabled Buy', () => {
    render(<TownView />);
    fireEvent.click(screen.getByRole('button', { name: /Build & Decorate/ }));
    fireEvent.click(screen.getByRole('button', { name: 'deeds' }));

    // Fresh town: prestige 0 < 40 gate → Buy disabled; the 500g cost is shown.
    const buy = screen.getByRole('button', { name: 'Buy district 1' }) as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
    expect(document.body.textContent).toContain('500');
  });
});

describe('TownBuildingCard (M4)', () => {
  it('opens for a completed building and shows the next-tier upgrade cost', () => {
    useGameStore.setState({
      town: { ...freshTown(), buildings: [{ id: 'k1', key: 'keep', r: 0, c: 0, tier: 1 }] },
    });
    render(<TownBuildingCard buildingId="k1" onMove={() => {}} onClose={() => {}} />);

    expect(screen.getByText('The Keep')).toBeTruthy();
    expect(screen.getByText(/Upgrade to tier 2/)).toBeTruthy();
    // Keep tier-2 upgrade costs 600g.
    expect(document.body.textContent).toContain('600');
  });
});
