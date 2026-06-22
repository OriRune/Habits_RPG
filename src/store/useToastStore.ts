import { create } from 'zustand';

export interface Toast {
  id: string;
  /** Display text — e.g. "+20 XP". */
  text: string;
  /** Optional hex color for the text (typically the habit's stat color). */
  color?: string;
}

interface ToastStore {
  toasts: Toast[];
  pushToast: (opts: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

let _seq = 0;
const TTL_MS = 2200;

/**
 * Transient toast store — lives outside Zustand persist so toasts don't survive
 * a page refresh. Modelled on the CoopToasts pattern (useCoopStore / CoopToasts.tsx).
 * Only one tiny concern per toast: text + optional color. Auto-expires after TTL_MS.
 */
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  pushToast({ text, color }) {
    const id = String(++_seq);
    set((s) => ({ toasts: [...s.toasts, { id, text, color }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TTL_MS);
  },

  removeToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
