import { useEffect, useState, useSyncExternalStore } from 'react';
import { TOAST_FADE_MS, TOAST_MS, type Toast, type Toasts } from '../lib/toasts';
import { cx } from './cx';
import styles from './ToastHost.module.css';

function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Comes up on the next frame (so it can fade in), goes after its time, and is gone once it has faded.
    const frame = requestAnimationFrame(() => setShown(true));
    const hide = setTimeout(() => setShown(false), TOAST_MS);
    const gone = setTimeout(() => onDone(toast.id), TOAST_MS + TOAST_FADE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hide);
      clearTimeout(gone);
    };
  }, [toast.id, onDone]);
  return (
    <div className={cx(styles['toast'], shown && styles['shown'])} role="status" data-part="toast">
      {toast.text}
    </div>
  );
}

/** Draws the session's toasts, one over another where they meet (as the classic portals do). */
export function ToastHost({ toasts }: { toasts: Toasts }) {
  const list = useSyncExternalStore(toasts.subscribe, toasts.getSnapshot);
  return (
    <>
      {list.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDone={toasts.dismiss} />
      ))}
    </>
  );
}
