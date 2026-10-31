import { useEffect, useRef, type RefObject } from 'react';

/** What a keyboard can land on inside the dialog (the file input of a form is visually hidden but is one of them). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What every dialog does besides being drawn: focus moves into it when it opens, stays in it while Tab is pressed, and goes back
 * to where it was when it closes; Escape asks it to close. The dialog itself does not decide to go — it asks `onClose` each time.
 * Give the returned ref to the dialog's card (which must be focusable: tabIndex -1).
 *
 * A dialog that opens over another one (`over`) takes Escape for itself: the keystroke closes it and goes no further, so the
 * dialog beneath stays.
 */
export function useDialog(
  onClose: () => void,
  { over = false }: { over?: boolean } = {},
): RefObject<HTMLDivElement | null> {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (over) e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = box.current;
      if (!card) return;
      const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        card.focus();
      } else if (!card.contains(at)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (at === first || at === card)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // (in the capture phase, a dialog over another is heard before the one beneath)
    document.addEventListener('keydown', onKey, over);
    return () => {
      document.removeEventListener('keydown', onKey, over);
      before?.focus();
    };
  }, [over]);
  return box;
}
