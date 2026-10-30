import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';
import { useDialog } from './useDialog';

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
  const box = useDialog(onClose);
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
