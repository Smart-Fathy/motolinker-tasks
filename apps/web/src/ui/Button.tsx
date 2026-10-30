import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Look = 'primary' | 'outline';

const classes = (look: Look, full: boolean | undefined) =>
  [styles['btn'], styles[look], full ? styles['full'] : ''].filter(Boolean).join(' ');

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  look?: Look;
  /** the full width of its container */
  full?: boolean;
  /** waiting for the server: cannot be pressed again, and says so to a screen reader */
  busy?: boolean;
}

export function Button({
  look = 'primary',
  full,
  busy,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classes(look, full)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-part="button"
    />
  );
}

interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> {
  look?: Look;
  full?: boolean;
  children: ReactNode;
}

/** A link that looks like a button: for going somewhere else (a full page load), not for doing something here. */
export function ButtonLink({ look = 'outline', full, ...rest }: ButtonLinkProps) {
  return <a {...rest} className={classes(look, full)} data-part="button" />;
}

/** A button that reads as a line of muted text: "Forgot password?", "← Back to login". */
export function LinkButton(
  props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'>,
) {
  return <button {...props} type="button" className={styles['link']} data-part="link" />;
}
