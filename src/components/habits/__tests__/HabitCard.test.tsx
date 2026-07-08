// @vitest-environment jsdom
// Touch-fix regression (plan3 9.2) — the logging surface must be finger-friendly:
// a >=44px wax seal, a hover-free Undo affordance on touch, and a bottom-sheet
// options menu on coarse pointers. jsdom has no matchMedia, so we stub a flippable
// MediaQueryList the same way useIsCoarsePointer.test.ts does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { HabitCard } from '@/components/habits/HabitCard';
import { useGameStore } from '@/store/useGameStore';

// Minimal MediaQueryList fake — `matches` is fixed per test; we only need it stable
// across the initial render/effect (no runtime flip exercised here).
function makeFakeMql(matches: boolean) {
  return {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

function setCoarse(matches: boolean) {
  window.matchMedia = vi.fn(() => makeFakeMql(matches)) as unknown as typeof window.matchMedia;
}

const get = useGameStore.getState;

function seedHabit(): string {
  get().addHabit({ name: 'Read', stat: 'KN', type: 'binary', frequency: 'daily', difficulty: 'normal' });
  return get().habits[0].id;
}

beforeEach(() => {
  get().resetGame();
  setCoarse(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HabitCard (touch surface)', () => {
  it('renders the wax-seal button with a >=44px (h-11 w-11) touch target', () => {
    seedHabit();
    const habit = get().habits[0];
    const { getByLabelText } = render(<HabitCard habit={habit} />);
    const seal = getByLabelText('Complete habit');
    expect(seal.className).toContain('h-11');
    expect(seal.className).toContain('w-11');
  });

  it('shows the Undo affordance without hover on a coarse pointer when done', () => {
    setCoarse(true);
    const id = seedHabit();
    get().completeHabit(id, undefined);
    const habit = get().habits[0];
    const { container } = render(<HabitCard habit={habit} />);
    const undo = container.querySelector('.lucide-undo2');
    expect(undo).not.toBeNull();
    // Visible without any mouseenter — the coarse branch drops the `hidden`/hover classes.
    expect(undo!.getAttribute('class')).not.toContain('hidden');
    expect(undo!.getAttribute('class')).toContain('block');
  });

  it('opens the options menu as a bottom-sheet Modal on a coarse pointer', () => {
    setCoarse(true);
    seedHabit();
    const habit = get().habits[0];
    const { getByLabelText, queryByText } = render(<HabitCard habit={habit} />);
    expect(queryByText('Habit options')).toBeNull();
    fireEvent.click(getByLabelText('Habit options'));
    // Modal renders its title; the absolute dropdown does not.
    expect(queryByText('Habit options')).not.toBeNull();
  });

  it('opens the options menu as the absolute dropdown on a fine pointer', () => {
    setCoarse(false);
    seedHabit();
    const habit = get().habits[0];
    const { getByLabelText, queryByText } = render(<HabitCard habit={habit} />);
    fireEvent.click(getByLabelText('Habit options'));
    // No Modal title, but the dropdown MenuItem list is present.
    expect(queryByText('Habit options')).toBeNull();
    expect(queryByText('Edit…')).not.toBeNull();
  });
});
