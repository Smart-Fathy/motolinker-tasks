import { useRef, useState, type FormEvent } from 'react';
import type { AuthApi } from '../lib/auth-api';
import type { Portal } from '../lib/env';
import { Button, ButtonLink, Field, GoogleMark, LinkButton } from '../ui';
import { COPY, TEXT } from './copy';
import { failure, NoticeLine, type Notice } from './Notice';
import styles from './Steps.module.css';

interface Props {
  portal: Portal;
  api: Pick<AuthApi, 'signIn'>;
  /** kept by the page, so a person sent back here from the second step finds their username still typed */
  username: string;
  onUsername(username: string): void;
  notice: Notice | null;
  onNotice(notice: Notice | null): void;
  onSignedIn(token: string): void;
  onCodeNeeded(mfaToken: string): void;
  /** team only */
  onForgot?: () => void;
}

export function PasswordStep({
  portal,
  api,
  username,
  onUsername,
  notice,
  onNotice,
  onSignedIn,
  onCodeNeeded,
  onForgot,
}: Props) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // A second press (or Enter) before the first answer is back must not send the password twice: state would only
  // say so after the next render.
  const sending = useRef(false);
  const copy = COPY[portal];
  const team = portal === 'team';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    onNotice(null);
    const result = await api.signIn(username.trim(), password);
    sending.current = false;
    setBusy(false);
    switch (result.kind) {
      case 'signed-in':
        return onSignedIn(result.token);
      case 'code-needed':
        return onCodeNeeded(result.mfaToken);
      case 'failed':
        return onNotice(failure(result.message));
      case 'network':
        return onNotice(failure(TEXT.network));
    }
  }

  return (
    <form onSubmit={submit} noValidate data-step="password" aria-label={TEXT.signIn}>
      {team && <NoticeLine notice={notice} />}
      <Field
        label="Username"
        name="username"
        autoComplete="username"
        placeholder={copy.usernamePlaceholder}
        value={username}
        onChange={e => onUsername(e.target.value)}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder={copy.passwordPlaceholder}
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      {!team && <NoticeLine notice={notice} />}
      <Button type="submit" full busy={busy}>
        {busy ? TEXT.signingIn : TEXT.signIn}
      </Button>
      {team && (
        <>
          {onForgot && (
            <p className={styles['aside']}>
              <LinkButton onClick={onForgot}>{TEXT.forgot}</LinkButton>
            </p>
          )}
          <div className={styles['divider']} role="separator">
            <span>{TEXT.or}</span>
          </div>
          <ButtonLink look="outline" full href="/api/employee/auth/google">
            <GoogleMark />
            {TEXT.google}
          </ButtonLink>
        </>
      )}
    </form>
  );
}
