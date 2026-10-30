// The small messages that come up at the foot of the screen and go by themselves ("New task assigned · Quote the Hilux").
// One store per signed-in session; ui/ToastHost.tsx draws what it holds.

export interface Toast {
  readonly id: number;
  readonly text: string;
}

export interface Toasts {
  show(text: string): void;
  dismiss(id: number): void;
  subscribe(fn: () => void): () => void;
  /** the toasts on screen now; the same array until something changes */
  getSnapshot(): readonly Toast[];
}

/** How long a message stays, and how long it takes to fade once it goes (the classic portals' own). */
export const TOAST_MS = 4000;
export const TOAST_FADE_MS = 400;

export function createToasts(): Toasts {
  let list: readonly Toast[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const set = (to: readonly Toast[]) => {
    list = to;
    for (const fn of [...listeners]) fn();
  };
  return {
    show(text) {
      set([...list, { id: next++, text }]);
    },
    dismiss(id) {
      if (list.some(t => t.id === id)) set(list.filter(t => t.id !== id));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    getSnapshot: () => list,
  };
}
