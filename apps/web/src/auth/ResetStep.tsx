import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthApi } from '../lib/auth-api';
import { Button, Field, LinkButton } from '../ui';
import { TEXT } from './copy';
import { failure, NoticeLine, success, type Notice } from './Notice';
import styles from './Steps.module.css';

/** How long "Password updated!" stays up before the page goes back to the sign-in form, as the classic page does. */
export const BACK_TO_SIGN_IN_MS = 2000;
export const MIN_PASSWORD = 8;

interface Props {
  api: Pick<AuthApi, 'resetPassword'>;
  /** the token from the link in the email */
  resetToken: string;
  notice: Notice | null;
  onNotice(notice: Notice | null): void;
  /** the password is changed (or the person went back): the sign-in form, with a notice if there is one to carry */
  onDone(notice?: Notice): void;
}

/** The team portal's "Set New Password", reached from the link in the reset email. */
export function ResetStep({ api, resetToken, notice, onNotice, onDone }: Props) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const sending = useRef(false);

  // After the confirmation has been read, back to the sign-in form (and not if the person has already left).
  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => onDone(), BACK_TO_SIGN_IN_MS);
    return () => clearTimeout(timer);
  }, [changed, onDone]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current || changed) return;
    if (password.length < MIN_PASSWORD) return onNotice(failure(TEXT.tooShort));
    if (password !== again) return onNotice(failure(TEXT.mismatch));
    sending.current = true;
    setBusy(true);
    onNotice(null);
    const result = await api.resetPassword(resetToken, password);
    sending.current = false;
    setBusy(false);
    switch (result.kind) {
      case 'done':
        onNotice(success(TEXT.passwordUpdated));
        return setChanged(true);
      case 'failed':
        return onNotice(failure(result.message));
      case 'network':
        return onNotice(failure(TEXT.network));
    }
  }

  return (
    <form onSubmit={submit} noValidate data-step="reset" aria-label={TEXT.resetHeading}>
      <NoticeLine notice={notice} />
      <h2 className={styles['stepTitle']}>{TEXT.resetHeading}</h2>
      <p className={styles['lead']} data-part="lead">
        {TEXT.resetLead}
      </p>
      <Field
        label={TEXT.newPassword}
        name="new-password"
        type="password"
        autoComplete="new-password"
        placeholder={TEXT.newPasswordPlaceholder}
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      <Field
        label={TEXT.confirmPassword}
        name="confirm-password"
        type="password"
        autoComplete="new-password"
        placeholder={TEXT.confirmPlaceholder}
        value={again}
        onChange={e => setAgain(e.target.value)}
      />
      <Button type="submit" full busy={busy} disabled={changed}>
        {busy ? TEXT.updating : TEXT.setPassword}
      </Button>
      <p className={styles['aside']}>
        <LinkButton onClick={() => onDone()}>{TEXT.backToLogin}</LinkButton>
      </p>
    </form>
  );
}
