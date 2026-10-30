import { useRef, useState, type FormEvent } from 'react';
import type { AuthApi } from '../lib/auth-api';
import { Button, Field, LinkButton } from '../ui';
import { TEXT } from './copy';
import { failure, NoticeLine, success, type Notice } from './Notice';
import styles from './Steps.module.css';

interface Props {
  api: Pick<AuthApi, 'forgotPassword'>;
  notice: Notice | null;
  onNotice(notice: Notice | null): void;
  onBack(): void;
}

/** The team portal's "Forgot password?": an email address, and a link sent to it if it is a team member's. */
export function ForgotStep({ api, notice, onNotice, onBack }: Props) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const typed = email.trim();
    if (!typed) return onNotice(failure(TEXT.enterEmail));
    sending.current = true;
    setBusy(true);
    onNotice(null);
    const result = await api.forgotPassword(typed);
    sending.current = false;
    setBusy(false);
    switch (result.kind) {
      // the same words whether or not the address belongs to anyone: the server does not say, and neither do we
      case 'done':
        return onNotice(success(TEXT.linkSent));
      case 'failed':
        return onNotice(failure(result.message));
      case 'network':
        return onNotice(failure(TEXT.network));
    }
  }

  return (
    <form onSubmit={submit} noValidate data-step="forgot" aria-label={TEXT.forgotHeading}>
      <NoticeLine notice={notice} />
      <h2 className={styles['stepTitle']}>{TEXT.forgotHeading}</h2>
      <p className={styles['lead']} data-part="lead">
        {TEXT.forgotLead}
      </p>
      <Field
        label={TEXT.email}
        name="email"
        type="email"
        autoComplete="email"
        placeholder={TEXT.emailPlaceholder}
        value={email}
        onChange={e => setEmail(e.target.value)}
      />
      <Button type="submit" full busy={busy}>
        {busy ? TEXT.sending : TEXT.sendLink}
      </Button>
      <p className={styles['aside']}>
        <LinkButton onClick={onBack}>{TEXT.backToLogin}</LinkButton>
      </p>
    </form>
  );
}
