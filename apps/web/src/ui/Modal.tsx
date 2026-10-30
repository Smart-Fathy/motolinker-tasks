import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

/** What a keyboard can land on inside the dialog (the file input of a form is visually hidden but is one of them). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  title: string;
  /** the line under the title that says what the dialog is for */
  hint?: string;
  /** asked to close (the × button, Escape); the dialog itself does not decide to go */
  onClose: () => void;
  children: ReactNode;
  /** the row of buttons along the foot */
  footer: ReactNode;
}

/**
 * A dialog over the whole page, as the classic portals draw theirs: a dim curtain, a card with a title and a ×, a body, and
 * a row of buttons. It does not close when the curtain is clicked (what was typed is not lost to a stray click); Escape and
 * the × close it. Focus moves into it when it opens, stays in it while Tab is pressed, and goes back to where it was when it
 * closes.
 */
export function Modal({ title, hint, onClose, children, footer }: ModalProps) {
  const id = useId();
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
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, []);
  return createPortal(
    <div className={styles['curtain']} data-part="curtain">
      <div
        ref={box}
        className={styles['card']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        data-part="dialog"
      >
        <div className={styles['head']} data-part="head">
          <div className={styles['title']} id={id} data-part="title">
            {title}
          </div>
          <button
            type="button"
            className={styles['close']}
            data-part="close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {hint ? (
          <div className={styles['hint']} data-part="hint">
            {hint}
          </div>
        ) : null}
        <div className={styles['body']} data-part="body">
          {children}
        </div>
        <div className={styles['foot']} data-part="foot">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}
