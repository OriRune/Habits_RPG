// @vitest-environment jsdom
// Modal dialog semantics (dungeon-delve-plan-2026-07.md item 4.5): proper role and
// labelling, focus moves in on open and back to the opener on close, Escape
// dismisses, and Tab wraps inside the dialog.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Modal } from '../Modal';

afterEach(cleanup);

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal title="A Choice" onClose={() => setOpen(false)}>
          <button>First</button>
          <button>Last</button>
        </Modal>
      )}
    </div>
  );
}

describe('Modal accessibility (plan 4.5)', () => {
  it('exposes dialog semantics labelled by its title', () => {
    const { getByRole } = render(<Modal title="A Choice">x</Modal>);
    const dialog = getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe('A Choice');
  });

  it('moves focus into the dialog on open and restores it to the opener on close', () => {
    const { getByText, getByRole } = render(<Host />);
    const opener = getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(getByRole('dialog'));
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
  });

  it('Escape does not close a non-dismissable modal', () => {
    const onClose = vi.fn();
    const { getByRole } = render(
      <Modal title="Forced" onClose={onClose} dismissable={false}>x</Modal>,
    );
    fireEvent.keyDown(getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('wraps Tab focus at both ends of the dialog', () => {
    const { getByText, getByLabelText } = render(
      <Modal title="A Choice" onClose={() => {}}>
        <button>First</button>
        <button>Last</button>
      </Modal>,
    );
    const close = getByLabelText('Close'); // first focusable in DOM order
    const last = getByText('Last');
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
