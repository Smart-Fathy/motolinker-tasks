import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Sheet.module.css';
import { useDialog } from './useDialog';

interface SheetProps {
  title: string;
  /** asked to close (the × button, Escape); the sheet itself does not decide to go */
  onClose: () => void;
  children: ReactNode;
  /** the row of buttons along the foot */
  footer: ReactNode;
}

/**
 * The classic portals' shared dialog (`.modal`, which their operations modules open their forms in): a card with a title and a
 * ×, a body of forms, and a row of buttons. It behaves as the app's other dialog does — it is not closed by a click on the
 * curtain around it (what was typed is not lost to a stray click), Escape and the × close it, and focus moves in, stays in, and
 * goes back — and differs from it in the look: this one is each portal's own.
 */
export function Sheet({ title, onClose, children, footer }: SheetProps) {
  const id = useId();
  const box = useDialog(onClose);
  return createPortal(
    <div className={styles['overlay']} data-part="curtain">
      <div
        ref={box}
        className={styles['modal']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        data-part="dialog"
      >
        <div className={styles['header']} data-part="head">
          <span className={styles['title']} id={id} data-part="title">
            {title}
          </span>
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
        <div className={styles['body']} data-part="body">
          {children}
        </div>
        <div className={styles['footer']} data-part="foot">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}
