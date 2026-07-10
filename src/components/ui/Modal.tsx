import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  /** Hide the close button for forced choices (e.g. tie-break class pick). */
  dismissable?: boolean;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, dismissable = true }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Move focus into the dialog on open; hand it back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Escape closes (when dismissable); Tab wraps within the dialog.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && dismissable && onClose) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4"
      onKeyDown={onKeyDown}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="texture-parchment relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md p-5 shadow-gold outline-none sm:rounded-md"
      >
        {/* Corner ornaments */}
        <span className="pointer-events-none absolute left-1.5 top-1 text-gold-deep/70">❖</span>
        <span className="pointer-events-none absolute right-1.5 top-1 text-gold-deep/70">❖</span>
        <span className="pointer-events-none absolute bottom-1 left-1.5 text-gold-deep/70">❖</span>
        <span className="pointer-events-none absolute bottom-1 right-1.5 text-gold-deep/70">❖</span>

        <div className="mb-4 flex items-center justify-between border-b border-gold-deep/40 pb-2">
          <h2 id={titleId} className="font-display text-lg font-bold text-ink">{title}</h2>
          {dismissable && onClose && (
            <button onClick={onClose} aria-label="Close" className="text-ink-light hover:text-ember">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
