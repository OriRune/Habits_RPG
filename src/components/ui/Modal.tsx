import { type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  /** Hide the close button for forced choices (e.g. tie-break class pick). */
  dismissable?: boolean;
}

export function Modal({ title, onClose, children, dismissable = true }: ModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4">
      <div className="texture-parchment relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md p-5 shadow-gold sm:rounded-md">
        {/* Corner ornaments */}
        <span className="pointer-events-none absolute left-1.5 top-1 text-gold-deep/70">❖</span>
        <span className="pointer-events-none absolute right-1.5 top-1 text-gold-deep/70">❖</span>
        <span className="pointer-events-none absolute bottom-1 left-1.5 text-gold-deep/70">❖</span>
        <span className="pointer-events-none absolute bottom-1 right-1.5 text-gold-deep/70">❖</span>

        <div className="mb-4 flex items-center justify-between border-b border-gold-deep/40 pb-2">
          <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
          {dismissable && onClose && (
            <button onClick={onClose} className="text-ink-light hover:text-ember">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
