import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './HuddleSheet.module.css';
import { useDialog } from './useDialog';

interface HuddleSheetProps {
  title: string;
  /** asked to close (the ×, Escape, a press on the curtain) */
  onClose: () => void;
  children: ReactNode;
  /** the row of buttons along the foot, if there is one */
  footer?: ReactNode;
}

/**
 * The classic portals' small overlay (`hdSheet`): a card with a title and a ×, a body, and a row of buttons. It opens over
 * whatever is open (a form being filled in), takes Escape for itself, and closes on a press on the curtain around it.
 */
export function HuddleSheet({ title, onClose, children, footer }: HuddleSheetProps) {
  const id = useId();
  const box = useDialog(onClose, { over: true });
  return createPortal(
    <div
      className={styles['overlay']}
      data-part="hdCurtain"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className={styles['box']}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        data-part="hdSheet"
      >
        <div className={styles['head']} data-part="hdHead">
          <div className={styles['title']} id={id} data-part="hdTitle">
            {title}
          </div>
          <button
            type="button"
            className={styles['x']}
            title="Close"
            data-part="hdClose"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className={styles['body']} data-part="hdBody">
          {children}
        </div>
        {footer && (
          <div className={styles['foot']} data-part="hdFoot">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
