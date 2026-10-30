import { useCallback, useMemo, useState } from 'react';
import { makeAuthApi, type AuthApi } from '../lib/auth-api';
import type { Arrival } from '../lib/arrival';
import { switchToClassicUrl, wording, type MlEnv } from '../lib/env';
import { AuthLayout } from '../ui';
import { COPY, TEXT } from './copy';
import { CodeStep } from './CodeStep';
import { ForgotStep } from './ForgotStep';
import { failure, type Notice } from './Notice';
import { PasswordStep } from './PasswordStep';
import { ResetStep } from './ResetStep';

type Step =
  | { name: 'password' }
  /** the password was right and the account has a second step */
  | { name: 'code'; mfaToken: string }
  | { name: 'forgot' }
  | { name: 'reset'; resetToken: string };

export interface SignInProps {
  env: MlEnv;
  /** what the page was opened for, if anything (Google's return, the link in a reset email) */
  arrival?: Arrival;
  /** for tests; the portal's own routes otherwise */
  api?: AuthApi;
  /** a session was started: the page keeps it and finds out who it belongs to */
  onSignedIn(token: string): void;
}

function firstStep(arrival: Arrival): Step {
  if (arrival.mfaToken) return { name: 'code', mfaToken: arrival.mfaToken };
  if (arrival.resetToken) return { name: 'reset', resetToken: arrival.resetToken };
  return { name: 'password' };
}

/** Everything between a person and the portal: the password, the second step, and the team's password reset. */
export function SignIn({ env, arrival = {}, api, onSignedIn }: SignInProps) {
  const { portal } = env;
  const calls = useMemo(() => api ?? makeAuthApi(portal), [api, portal]);
  const [step, setStep] = useState<Step>(() => firstStep(arrival));
  const [notice, setNotice] = useState<Notice | null>(() =>
    arrival.error ? failure(arrival.error) : null,
  );
  const [username, setUsername] = useState('');
  const copy = COPY[portal];

  const toPassword = useCallback((carry?: Notice) => {
    setStep({ name: 'password' });
    setNotice(carry ?? null);
  }, []);
  const to = (next: Step) => {
    setStep(next);
    setNotice(null);
  };

  return (
    <AuthLayout
      portal={portal}
      title={wording(env, ...copy.title)}
      subtitle={wording(env, ...copy.subtitle)}
      footer={<a href={switchToClassicUrl(portal)}>{TEXT.classicLink}</a>}
    >
      {step.name === 'password' && (
        <PasswordStep
          portal={portal}
          api={calls}
          username={username}
          onUsername={setUsername}
          notice={notice}
          onNotice={setNotice}
          onSignedIn={onSignedIn}
          onCodeNeeded={mfaToken => to({ name: 'code', mfaToken })}
          {...(portal === 'team' ? { onForgot: () => to({ name: 'forgot' }) } : {})}
        />
      )}
      {step.name === 'code' && (
        <CodeStep
          portal={portal}
          api={calls}
          mfaToken={step.mfaToken}
          notice={notice}
          onNotice={setNotice}
          onSignedIn={onSignedIn}
          onExpired={message => toPassword(failure(message))}
          onBack={() => toPassword()}
        />
      )}
      {step.name === 'forgot' && (
        <ForgotStep api={calls} notice={notice} onNotice={setNotice} onBack={() => toPassword()} />
      )}
      {step.name === 'reset' && (
        <ResetStep
          api={calls}
          resetToken={step.resetToken}
          notice={notice}
          onNotice={setNotice}
          onDone={toPassword}
        />
      )}
    </AuthLayout>
  );
}
