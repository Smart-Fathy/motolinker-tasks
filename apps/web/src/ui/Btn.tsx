import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import styles from './Btn.module.css';
import { cx } from './cx';

interface Look {
  /** the main thing to do on the page, or one of the others */
  kind?: 'primary' | 'outline';
  small?: boolean;
  /** an action that cannot be taken back (Cancel a meeting): in the team's sheet it is red, in the admin's it never was */
  danger?: boolean;
}

const classes = ({ kind = 'outline', small, danger }: Look, extra: string | undefined) =>
  cx(
    styles['btn'],
    kind === 'primary' ? styles['primary'] : styles['outline'],
    small && styles['sm'],
    danger && styles['danger'],
    extra,
  );

/** The classic portals' in-page button (`.btn.btn-primary`, `.btn.btn-outline`, `.btn-sm`), each portal's own. */
export function Btn({
  kind,
  small,
  danger,
  className,
  type = 'button',
  ...rest
}: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...rest} type={type} className={classes({ kind, small, danger }, className)} />;
}

/** …and the same as a link (it opens a page of its own). */
export function BtnLink({
  kind,
  small,
  danger,
  className,
  ...rest
}: Look & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...rest} className={classes({ kind, small, danger }, className)} />;
}
