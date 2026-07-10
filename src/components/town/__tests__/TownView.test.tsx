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
import { TownDecorCard } from '@/components/town/TownDecorCard';
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

  // TOWN-13: a build the pre-banked labor finishes at queue time celebrates as a
  // completion; TOWN-14: the toast reflects what actually happened, not the attempt.
  it('a build instantly finished by banked labor toasts a completion, not a queue', () => {
    useGameStore.setState({ town: { ...freshTown(), laborBank: 200 } }); // Keep needs 20
    render(<TownView />);
    fireEvent.click(screen.getByRole('button', { name: /Build & Decorate/ }));
    const keepRow = screen.getByText('The Keep').closest('.rounded-md') as HTMLElement;
    fireEvent.click(within(keepRow).getByRole('button', { name: 'Place' }));
    fireEvent.click(screen.getByLabelText('Confirm placement'));

    expect(get().town.buildings.some((b) => b.key === 'keep' && b.tier === 1)).toBe(true);
    const texts = useToastStore.getState().toasts.map((t) => t.text);
    expect(texts).toContain('🏗️ The Keep complete!');
    expect(texts).not.toContain('The Keep queued');
  });

  // TOWN-12: laborToday belongs to laborISO's day — a stale save must show 0/24, not
  // yesterday's count.
  it('the "Labor today" chip shows 0 when laborISO is a previous day', () => {
    useGameStore.setState({
      town: { ...freshTown(), laborISO: '2020-01-01', laborToday: 24 },
    });
    render(<TownView />);
    const chip = screen.getByText('Labor today').parentElement as HTMLElement;
    expect(chip.textContent).toContain('0/24');
    expect(chip.textContent).not.toContain('24/24');
  });

  it('the Deeds tab shows the 500g first-deed cost with a prestige-gated, disabled Buy', () => {
    render(<TownView />);
    fireEvent.click(screen.getByRole('button', { name: /Build & Decorate/ }));
    fireEvent.click(screen.getByRole('button', { name: 'deeds' }));

    // Fresh town: prestige 0 < 100 gate (M6 retune) → Buy disabled; the 500g cost is shown.
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

  // TOWN-02: the Demolish button must be blocked while an upgrade targets the building.
  it('disables Demolish while an upgrade project targets the building', () => {
    useGameStore.setState({
      town: {
        ...freshTown(),
        buildings: [{ id: 'w1', key: 'watchtower', r: 0, c: 0, tier: 1 }],
        queue: [{ id: 'u1', kind: 'upgrade', key: 'watchtower', buildingId: 'w1', laborNeed: 30, laborApplied: 5 }],
      },
    });
    render(<TownBuildingCard buildingId="w1" onMove={() => {}} onClose={() => {}} />);
    const demolish = screen.getByRole('button', { name: 'Demolish' }) as HTMLButtonElement;
    expect(demolish.disabled).toBe(true);
  });
});

// TOWN-19: decor is removable — tap → card → confirm → 50% material refund. The card is
// exercised directly by anchor (canvas taps are coordinate hit-tests, no jsdom geometry).
describe('TownDecorCard (TOWN-19)', () => {
  it('removes the tapped prop after confirmation and refunds materials', () => {
    useGameStore.setState({
      town: { ...freshTown(), decor: [{ key: 'well', r: 5, c: 5, v: 1 }] }, // well: 3 stone
    });
    const { unmount } = render(<TownDecorCard r={5} c={5} onClose={() => {}} />);

    expect(screen.getByText('Well')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' })); // opens confirm
    const removes = screen.getAllByRole('button', { name: 'Remove' }); // card + dialog
    fireEvent.click(removes[removes.length - 1]); // confirms
    expect(get().town.decor).toHaveLength(0);
    expect(get().materials.stone).toBe(99 + 1); // floor(3 × 0.5)
    const texts = useToastStore.getState().toasts.map((t) => t.text);
    expect(texts).toContain('Well removed — materials returned');
    unmount();
  });

  it('renders nothing for an empty cell', () => {
    const { container } = render(<TownDecorCard r={2} c={2} onClose={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});
