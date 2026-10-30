import type { ReactNode } from 'react';
import styles from './Alert.module.css';

interface AlertProps {
  tone?: 'error' | 'success';
  children: ReactNode;
}

/** Said aloud by a screen reader as it appears: an error is an alert, a confirmation is a status. */
export function Alert({ tone = 'error', children }: AlertProps) {
  const ok = tone === 'success';
  return (
    <p
      role={ok ? 'status' : 'alert'}
      className={[styles['alert'], ok ? styles['success'] : ''].filter(Boolean).join(' ')}
      data-part="error"
    >
      {children}
    </p>
  );
}
