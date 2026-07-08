// @vitest-environment jsdom
// Component smoke (plan 7.5, sub-task 5B) — LastStand is store-free, so this just
// confirms it mounts and renders its initial (countdown) screen without throwing.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LastStand } from '@/components/trials/games/LastStand';

afterEach(cleanup);

describe('LastStand (smoke)', () => {
  it('mounts and renders its countdown screen without throwing', () => {
    const onFinish = vi.fn();
    const { container, getByText } = render(<LastStand onFinish={onFinish} hpLevel={5} />);
    // Root renders and the countdown intro copy is present.
    expect(container.firstChild).toBeTruthy();
    expect(getByText(/get ready/i)).toBeTruthy();
    // A smoke mount fires no completion callback.
    expect(onFinish).not.toHaveBeenCalled();
  });
});
