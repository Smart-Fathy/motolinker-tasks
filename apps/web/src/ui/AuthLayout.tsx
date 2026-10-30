import { ShieldCheck } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { Portal } from '../lib/env';
import styles from './AuthLayout.module.css';

interface AuthLayoutProps {
  portal: Portal;
  title: string;
  subtitle: string;
  /** a line under the card (the way back to the classic portal while this app is a preview) */
  footer?: ReactNode;
  children: ReactNode;
}

/** The page every sign-in step sits in. */
export function AuthLayout({ portal, title, subtitle, footer, children }: AuthLayoutProps) {
  const heading = useId();
  if (portal === 'team') {
    return (
      <main className={styles['wrap']} data-part="screen">
        <section className={styles['teamCard']} aria-labelledby={heading} data-part="card">
          <div className={styles['logo']}>
            <div className={styles['logoIcon']} aria-hidden="true" data-part="icon" />
            <h1 id={heading} className={styles['teamTitle']} data-part="title">
              {title}
            </h1>
            <p className={styles['teamSub']} data-part="sub">
              {subtitle}
            </p>
          </div>
          {children}
        </section>
        {footer ? <p className={styles['preview']}>{footer}</p> : null}
      </main>
    );
  }
  return (
    <main className={styles['screen']} data-part="screen">
      <section className={styles['card']} aria-labelledby={heading} data-part="card">
        <div className={styles['icon']} aria-hidden="true" data-part="icon">
          <ShieldCheck size={28} />
        </div>
        <h1 id={heading} className={styles['title']} data-part="title">
          {title}
        </h1>
        <p className={styles['sub']} data-part="sub">
          {subtitle}
        </p>
        {children}
      </section>
      {footer ? <p className={styles['preview']}>{footer}</p> : null}
    </main>
  );
}
