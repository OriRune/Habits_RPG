// @vitest-environment jsdom
// Component smoke (plan 7.5, sub-task 5B) — LongMarch is store-free, so this just
// confirms it mounts and shows its initial HUD (stamina + progress) without throwing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LongMarch } from '@/components/trials/games/LongMarch';

afterEach(cleanup);

describe('LongMarch (smoke)', () => {
  it('mounts and renders its initial stamina/progress UI without throwing', () => {
    const onFinish = vi.fn();
    const { container, getByText } = render(<LongMarch enLevel={5} onFinish={onFinish} />);
    expect(container.firstChild).toBeTruthy();
    // Initial HUD: the stamina gauge label and the progress readout are present.
    expect(getByText('Stamina')).toBeTruthy();
    expect(getByText(/Progress:/)).toBeTruthy();
    expect(onFinish).not.toHaveBeenCalled();
  });
});
