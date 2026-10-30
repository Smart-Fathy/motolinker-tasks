import { useRef, useState, type FormEvent } from 'react';
import type { AuthApi } from '../lib/auth-api';
import type { Portal } from '../lib/env';
import { Button, Field, LinkButton } from '../ui';
import { COPY, TEXT } from './copy';
import { failure, NoticeLine, type Notice } from './Notice';
import styles from './Steps.module.css';

interface Props {
  portal: Portal;
  api: Pick<AuthApi, 'verifyCode'>;
  /** the challenge the password step was answered with; it lives here and nowhere else (not storage, not the address) */
  mfaToken: string;
  notice: Notice | null;
  onNotice(notice: Notice | null): void;
  onSignedIn(token: string): void;
  /** the challenge is gone: the page goes back to the password, with the server's words */
  onExpired(message: string): void;
  onBack(): void;
}

type Mode = 'totp' | 'recovery';

/** The second step: the six digits from the authenticator app, or one of the recovery codes. */
export function CodeStep({
  portal,
  api,
  mfaToken,
  notice,
  onNotice,
  onSignedIn,
  onExpired,
  onBack,
}: Props) {
  const [mode, setMode] = useState<Mode>('totp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const copy = COPY[portal].code;
  const team = portal === 'team';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) return;
    const typed = code.trim();
    if (!typed) {
      onNotice(failure(TEXT.enterCode));
      input.current?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    onNotice(null);
    const result = await api.verifyCode(mfaToken, typed);
    sending.current = false;
    setBusy(false);
    switch (result.kind) {
      case 'signed-in':
        return onSignedIn(result.token);
      case 'expired':
        return onExpired(result.message);
      case 'failed':
        onNotice(failure(result.message));
        // back in the field with the wrong code selected, so the right one can be typed straight over it (the
        // button that was pressed has the focus until then)
        input.current?.focus();
        input.current?.select();
        return;
      case 'network':
        return onNotice(failure(TEXT.network));
    }
  }

  function switchMode() {
    setMode(mode === 'totp' ? 'recovery' : 'totp');
    setCode('');
    input.current?.focus();
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      data-step="code"
      aria-label={copy.heading ?? 'Two-step verification'}
    >
      {team && <NoticeLine notice={notice} />}
      {copy.heading && <h2 className={styles['stepTitle']}>{copy.heading}</h2>}
      <p className={styles['lead']} data-part="lead">
        {copy.lead[mode]}
      </p>
      <Field
        ref={input}
        label={copy.label[mode]}
        name="code"
        inputMode={mode === 'recovery' ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        placeholder={copy.placeholder[mode]}
        maxLength={14}
        autoFocus
        value={code}
        onChange={e => setCode(e.target.value)}
      />
      {!team && <NoticeLine notice={notice} />}
      <Button type="submit" full busy={busy}>
        {busy ? TEXT.verifying : TEXT.verify}
      </Button>
      <p className={`${styles['aside']} ${styles['small']}`}>
        <LinkButton onClick={switchMode}>
          {mode === 'totp' ? TEXT.useRecovery : TEXT.useApp}
        </LinkButton>
        <span className={styles['sep']}> · </span>
        <LinkButton onClick={onBack}>{copy.back}</LinkButton>
      </p>
    </form>
  );
}
