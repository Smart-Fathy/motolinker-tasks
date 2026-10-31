import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import styles from './Modal.module.css';
import { useDialog } from './useDialog';

interface ModalProps {
  title: string;
  /** the line under the title that says what the dialog is for */
  hint?: string;
  /** asked to close (the × button, Escape); the dialog itself does not decide to go */
  onClose: () => void;
  children: ReactNode;
  /** the row of buttons along the foot (a `loose` dialog draws its own among its parts) */
  footer?: ReactNode;
  /** how wide the card gets, where it is not the usual 440px */
  width?: number;
  /** `plain`: a smaller title with no × beside it (Escape still closes it); `heavy`, the usual: the title and a × */
  head?: 'heavy' | 'plain';
  /** the space under the hint, where it is not the usual 20px */
  hintGap?: number;
  /** what is inside keeps its own spacing: there is no gap between its parts and no foot of the dialog's own */
  loose?: boolean;
}

/**
 * A dialog over the whole page, as the classic portals draw theirs: a dim curtain, a card with a title and a ×, a body, and
 * a row of buttons. It does not close when the curtain is clicked (what was typed is not lost to a stray click); Escape and
 * the × close it. Focus moves into it when it opens, stays in it while Tab is pressed, and goes back to where it was when it
 * closes.
 */
export function Modal({
  title,
  hint,
  onClose,
  children,
  footer,
  width,
  head = 'heavy',
  hintGap,
  loose,
}: ModalProps) {
  const id = useId();
  const box = useDialog(onClose);
  const plain = head === 'plain';
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
        {...(width ? { style: { maxWidth: width } } : {})}
      >
        <div
          className={cx(styles['head'], plain ? styles['headPlain'] : !hint && styles['headBare'])}
          data-part="head"
        >
          <div
            className={cx(styles['title'], plain && styles['titlePlain'])}
            id={id}
            data-part="title"
          >
            {title}
          </div>
          {!plain && (
            <button
              type="button"
              className={styles['close']}
              data-part="close"
              aria-label="Close"
              onClick={onClose}
            >
              ×
            </button>
          )}
        </div>
        {hint ? (
          <div
            className={styles['hint']}
            data-part="hint"
            {...(hintGap ? { style: { marginBottom: hintGap } } : {})}
          >
            {hint}
          </div>
        ) : null}
        <div className={cx(styles['body'], loose && styles['loose'])} data-part="body">
          {children}
        </div>
        {footer ? (
          <div className={styles['foot']} data-part="foot">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
