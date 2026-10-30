import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Arrival } from '../lib/arrival';
import type { MlEnv } from '../lib/env';
import { admin, deferred, fakeApi, team } from '../test/helpers';
import { BACK_TO_SIGN_IN_MS } from './ResetStep';
import { SignIn } from './SignIn';

afterEach(cleanup);

function setup(env: MlEnv, arrival?: Arrival) {
  const api = fakeApi();
  const onSignedIn = vi.fn();
  const user = userEvent.setup({ delay: null });
  render(<SignIn env={env} {...(arrival ? { arrival } : {})} api={api} onSignedIn={onSignedIn} />);
  return { api, onSignedIn, user };
}

const submitButton = () => screen.getByRole('button', { name: /^(Sign In|Signing in…)$/ });

async function enterCredentials(
  user: ReturnType<typeof userEvent.setup>,
  name = 'sara',
  pass = 'pw-1',
) {
  await user.type(screen.getByLabelText('Username'), name);
  await user.type(screen.getByLabelText('Password'), pass);
}

describe.each([
  ['admin', admin],
  ['team', team],
] as const)('signing in with a password — the %s portal', (_portal, env) => {
  it('signs in with the username (trimmed) and the password (exactly as typed)', async () => {
    const { api, onSignedIn, user } = setup(env);
    api.signIn.mockResolvedValue({ kind: 'signed-in', token: 'tok-1' });
    await user.type(screen.getByLabelText('Username'), '  sara  ');
    await user.type(screen.getByLabelText('Password'), ' p a s s ');
    await user.click(submitButton());
    expect(api.signIn).toHaveBeenCalledExactlyOnceWith('sara', ' p a s s ');
    expect(onSignedIn).toHaveBeenCalledExactlyOnceWith('tok-1');
  });

  it('can be sent with Enter from either field, as a form is', async () => {
    const { api, onSignedIn, user } = setup(env);
    api.signIn.mockResolvedValue({ kind: 'signed-in', token: 'tok-1' });
    await user.type(screen.getByLabelText('Username'), 'sara{Enter}');
    expect(api.signIn).toHaveBeenCalledTimes(1);
    expect(onSignedIn).toHaveBeenCalledWith('tok-1');
  });

  it('says why, in the server’s words, when it is refused — and keeps what was typed', async () => {
    const { api, onSignedIn, user } = setup(env);
    api.signIn.mockResolvedValue({
      kind: 'failed',
      status: 401,
      message: 'Invalid username or password',
    });
    await enterCredentials(user);
    await user.click(submitButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Invalid username or password');
    expect(onSignedIn).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('sara');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('pw-1');
  });

  it('clears the message when it tries again', async () => {
    const { api, user } = setup(env);
    api.signIn.mockResolvedValueOnce({
      kind: 'failed',
      status: 401,
      message: 'Invalid username or password',
    });
    const second = deferred<Awaited<ReturnType<typeof api.signIn>>>();
    api.signIn.mockReturnValueOnce(second.promise);
    await enterCredentials(user);
    await user.click(submitButton());
    await screen.findByRole('alert');
    await user.click(submitButton());
    expect(screen.queryByRole('alert')).toBeNull();
    second.resolve({
      kind: 'failed',
      status: 429,
      message: 'Too many attempts. Try again in 30 seconds.',
    });
    expect((await screen.findByRole('alert')).textContent).toContain('30 seconds');
  });

  it('says it cannot reach the server, and does not sign anyone in', async () => {
    const { api, onSignedIn, user } = setup(env);
    api.signIn.mockResolvedValue({ kind: 'network' });
    await enterCredentials(user);
    await user.click(submitButton());
    expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot reach the server/);
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('waits for the answer: the button says so and cannot be pressed again, and the password is sent once', async () => {
    const { api, onSignedIn, user } = setup(env);
    const answer = deferred<Awaited<ReturnType<typeof api.signIn>>>();
    api.signIn.mockReturnValue(answer.promise);
    await enterCredentials(user);
    await user.click(submitButton());
    const button = screen.getByRole('button', { name: 'Signing in…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await user.type(screen.getByLabelText('Password'), '{Enter}');
    await user.click(button);
    expect(api.signIn).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve({ kind: 'signed-in', token: 'tok-1' }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('can be tried again after a refusal (the button comes back)', async () => {
    const { api, user } = setup(env);
    api.signIn.mockResolvedValue({ kind: 'failed', status: 401, message: 'no' });
    await enterCredentials(user);
    await user.click(submitButton());
    await screen.findByRole('alert');
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
    await user.click(submitButton());
    expect(api.signIn).toHaveBeenCalledTimes(2);
  });
});

describe.each([
  ['admin', admin],
  ['team', team],
] as const)('the second step — the %s portal', (_portal, env) => {
  async function toSecondStep() {
    const ctx = setup(env);
    ctx.api.signIn.mockResolvedValue({ kind: 'code-needed', mfaToken: 'challenge-1' });
    await enterCredentials(ctx.user);
    await ctx.user.click(submitButton());
    await screen.findByLabelText('Authentication code');
    return ctx;
  }
  const verifyButton = () => screen.getByRole('button', { name: /^(Verify|Verifying…)$/ });

  it('asks for the code instead of signing in, and the password is gone from the page', async () => {
    const { onSignedIn } = await toSecondStep();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByText(/6-digit code/)).toBeTruthy();
    const code = screen.getByLabelText('Authentication code') as HTMLInputElement;
    expect(code.getAttribute('inputmode')).toBe('numeric');
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code.placeholder).toBe('123456');
    expect(document.activeElement).toBe(code);
  });

  it('signs in with the code, against the challenge the password step was answered with', async () => {
    const { api, onSignedIn, user } = await toSecondStep();
    api.verifyCode.mockResolvedValue({ kind: 'signed-in', token: 'tok-2' });
    await user.type(screen.getByLabelText('Authentication code'), ' 123456 ');
    await user.click(verifyButton());
    expect(api.verifyCode).toHaveBeenCalledExactlyOnceWith('challenge-1', '123456');
    expect(onSignedIn).toHaveBeenCalledExactlyOnceWith('tok-2');
  });

  it('does not ask the server for an empty code: it says to enter one', async () => {
    const { api, user } = await toSecondStep();
    await user.click(verifyButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the code.');
    expect(api.verifyCode).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText('Authentication code'));
  });

  it('stays on the step for a wrong code, with the same challenge, and selects the code so it can be typed over', async () => {
    const { api, onSignedIn, user } = await toSecondStep();
    api.verifyCode.mockResolvedValueOnce({
      kind: 'failed',
      status: 401,
      message: 'That code is not right.',
    });
    api.verifyCode.mockResolvedValueOnce({ kind: 'signed-in', token: 'tok-2' });
    await user.type(screen.getByLabelText('Authentication code'), '000000');
    await user.click(verifyButton());
    expect((await screen.findByRole('alert')).textContent).toBe('That code is not right.');
    const code = screen.getByLabelText('Authentication code') as HTMLInputElement;
    expect(code.selectionStart).toBe(0);
    expect(code.selectionEnd).toBe(6);
    await user.keyboard('654321');
    await user.click(verifyButton());
    expect(api.verifyCode.mock.calls).toEqual([
      ['challenge-1', '000000'],
      ['challenge-1', '654321'],
    ]);
    expect(onSignedIn).toHaveBeenCalledWith('tok-2');
  });

  it('shows a rate limit or an outage without leaving the step', async () => {
    const { api, user } = await toSecondStep();
    api.verifyCode.mockResolvedValue({
      kind: 'failed',
      status: 503,
      message: 'Could not check the code right now.',
    });
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(verifyButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not check the code right now.',
    );
    expect(screen.getByLabelText('Authentication code')).toBeTruthy();
  });

  it('says it cannot reach the server, and stays', async () => {
    const { api, user } = await toSecondStep();
    api.verifyCode.mockResolvedValue({ kind: 'network' });
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(verifyButton());
    expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot reach the server/);
  });

  it('waits for the answer without sending the code twice', async () => {
    const { api, user } = await toSecondStep();
    const answer = deferred<Awaited<ReturnType<typeof api.verifyCode>>>();
    api.verifyCode.mockReturnValue(answer.promise);
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(verifyButton());
    const button = screen.getByRole('button', { name: 'Verifying…' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await user.type(screen.getByLabelText('Authentication code'), '{Enter}');
    expect(api.verifyCode).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve({ kind: 'failed', status: 401, message: 'no' }));
  });

  it('can use a recovery code instead, and back to the app: the words, the keyboard and the field follow', async () => {
    const { api, user } = await toSecondStep();
    await user.type(screen.getByLabelText('Authentication code'), '12');
    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }));
    const recovery = screen.getByLabelText('Recovery code') as HTMLInputElement;
    expect(recovery.value).toBe('');
    expect(recovery.getAttribute('inputmode')).toBe('text');
    expect(recovery.placeholder).toBe('xxxxx-xxxxx');
    expect(screen.getByText(/recovery codes? .*works once|each works once/i)).toBeTruthy();
    expect(document.activeElement).toBe(recovery);
    api.verifyCode.mockResolvedValue({ kind: 'signed-in', token: 'tok-3' });
    await user.type(recovery, 'abcde-fghij');
    await user.click(verifyButton());
    expect(api.verifyCode).toHaveBeenCalledWith('challenge-1', 'abcde-fghij');

    await user.click(screen.getByRole('button', { name: 'Use my authenticator app instead' }));
    const app = screen.getByLabelText('Authentication code') as HTMLInputElement;
    expect(app.getAttribute('inputmode')).toBe('numeric');
    expect(app.value).toBe('');
  });

  it('goes back to the password, with the username still typed and the challenge dropped', async () => {
    const { api, user } = await toSecondStep();
    await user.click(screen.getByRole('button', { name: /^← Back/ }));
    expect(screen.queryByLabelText('Authentication code')).toBeNull();
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('sara');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    api.signIn.mockResolvedValue({ kind: 'code-needed', mfaToken: 'challenge-2' });
    await user.type(screen.getByLabelText('Password'), 'pw-2');
    await user.click(submitButton());
    await screen.findByLabelText('Authentication code');
    api.verifyCode.mockResolvedValue({ kind: 'signed-in', token: 'tok-9' });
    await user.type(screen.getByLabelText('Authentication code'), '111111');
    await user.click(verifyButton());
    expect(api.verifyCode).toHaveBeenCalledWith('challenge-2', '111111');
  });

  it('goes back to the password, with the server’s words, when the challenge has run out', async () => {
    const { api, onSignedIn, user } = await toSecondStep();
    api.verifyCode.mockResolvedValue({
      kind: 'expired',
      message: 'Your sign-in expired. Enter your password again.',
    });
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(verifyButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your sign-in expired. Enter your password again.',
    );
    expect(screen.queryByLabelText('Authentication code')).toBeNull();
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('sara');
    expect(onSignedIn).not.toHaveBeenCalled();
    // and the old challenge is not kept: a new password is a new challenge
    api.signIn.mockResolvedValue({ kind: 'code-needed', mfaToken: 'challenge-3' });
    await user.type(screen.getByLabelText('Password'), 'pw-3');
    await user.click(submitButton());
    await screen.findByLabelText('Authentication code');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the words on the page', () => {
  it('are the classic portals’, for the admin portal', () => {
    setup(admin);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Admin Access');
    expect(screen.getByText('Sign in with your admin credentials')).toBeTruthy();
    expect((screen.getByLabelText('Username') as HTMLInputElement).placeholder).toBe('Username');
    expect((screen.getByLabelText('Password') as HTMLInputElement).placeholder).toBe('Password');
  });

  it('are the classic portals’, for the team portal, with the workspace’s name in the subtitle', () => {
    setup(team);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Team Portal');
    expect(screen.getByText('Acme Motors · Log hours & track tasks')).toBeTruthy();
    expect((screen.getByLabelText('Username') as HTMLInputElement).placeholder).toBe(
      'Your username',
    );
  });

  it('are the admin’s own, wherever they replaced them in the workspace editor ({ws} is the name)', () => {
    setup({
      ...team,
      texts: { team_title: 'Crew Room', team_sub: '{ws} — clock in' },
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Crew Room');
    expect(screen.getByText('Acme Motors — clock in')).toBeTruthy();
    cleanup();
    setup({ ...admin, texts: { admin_title: 'Owners only', admin_sub: 'Welcome back' } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Owners only');
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });

  it('are text: a title with markup in it is shown, not run', () => {
    const { container } = render(
      <SignIn
        env={{ ...admin, texts: { admin_title: '<img src=x onerror=alert(1)>' } }}
        api={fakeApi()}
        onSignedIn={() => undefined}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('name the way back to the classic portal, with the switch set so the server remembers', () => {
    setup(admin);
    expect(
      screen.getByRole('link', { name: 'Back to the classic portal' }).getAttribute('href'),
    ).toBe('/dashboard?ui=legacy');
    cleanup();
    setup(team);
    expect(
      screen.getByRole('link', { name: 'Back to the classic portal' }).getAttribute('href'),
    ).toBe('/employee?ui=legacy');
  });
});

describe('what only the team portal has', () => {
  it('offers Google, as a link to the server’s own route (a full page load, not a call)', () => {
    setup(team);
    const google = screen.getByRole('link', { name: /Sign in with Google/ });
    expect(google.getAttribute('href')).toBe('/api/employee/auth/google');
  });

  it('is not offered to the admin portal, which has neither Google nor a reset email', () => {
    setup(admin);
    expect(screen.queryByRole('link', { name: /Google/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).toBeNull();
  });

  describe('"Forgot password?"', () => {
    async function open() {
      const ctx = setup(team);
      await ctx.user.click(screen.getByRole('button', { name: 'Forgot password?' }));
      return ctx;
    }

    it('asks for an email address and sends it, and says the same thing whoever the address belongs to', async () => {
      const { api, user } = await open();
      expect(screen.getByRole('heading', { level: 2, name: 'Reset Password' })).toBeTruthy();
      api.forgotPassword.mockResolvedValue({ kind: 'done' });
      await user.type(screen.getByLabelText('Email Address'), '  sara@example.com ');
      await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));
      expect(api.forgotPassword).toHaveBeenCalledExactlyOnceWith('sara@example.com');
      const note = await screen.findByRole('status');
      expect(note.textContent).toBe(
        'If an account with that email exists, a reset link has been sent.',
      );
    });

    it('does not ask the server for an empty address', async () => {
      const { api, user } = await open();
      await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));
      expect((await screen.findByRole('alert')).textContent).toBe('Please enter your email.');
      expect(api.forgotPassword).not.toHaveBeenCalled();
    });

    it('says what the server refuses with, and when it cannot be reached', async () => {
      const { api, user } = await open();
      api.forgotPassword.mockResolvedValueOnce({
        kind: 'failed',
        status: 503,
        message: 'Email service not configured. Contact your admin.',
      });
      await user.type(screen.getByLabelText('Email Address'), 'sara@example.com');
      await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Email service not configured. Contact your admin.',
      );
      api.forgotPassword.mockResolvedValueOnce({ kind: 'network' });
      await user.click(screen.getByRole('button', { name: 'Send Reset Link' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/Cannot reach the server/);
    });

    it('waits for the answer without sending twice', async () => {
      const { api, user } = await open();
      const answer = deferred<Awaited<ReturnType<typeof api.forgotPassword>>>();
      api.forgotPassword.mockReturnValue(answer.promise);
      await user.type(screen.getByLabelText('Email Address'), 'sara@example.com{Enter}');
      expect(screen.getByRole('button', { name: 'Sending…' })).toBeTruthy();
      await user.type(screen.getByLabelText('Email Address'), '{Enter}');
      expect(api.forgotPassword).toHaveBeenCalledTimes(1);
      await act(async () => answer.resolve({ kind: 'done' }));
    });

    it('goes back to the sign-in form', async () => {
      const { user } = await open();
      await user.click(screen.getByRole('button', { name: '← Back to login' }));
      expect(screen.getByLabelText('Password')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('the link in the reset email', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    const fields = () => ({
      password: screen.getByLabelText('New Password') as HTMLInputElement,
      again: screen.getByLabelText('Confirm New Password') as HTMLInputElement,
      button: screen.getByRole('button', {
        name: /^(Set Password|Updating…)$/,
      }) as HTMLButtonElement,
    });
    function arrive() {
      const ctx = {
        ...setup(team, { resetToken: 'reset-tok' }),
      };
      return ctx;
    }
    const typeBoth = async (
      user: ReturnType<typeof userEvent.setup>,
      first: string,
      second: string,
    ) => {
      await user.type(fields().password, first);
      await user.type(fields().again, second);
    };

    it('opens on the new-password form, not the sign-in', () => {
      arrive();
      expect(screen.getByRole('heading', { level: 2, name: 'Set New Password' })).toBeTruthy();
      expect(screen.queryByLabelText('Username')).toBeNull();
      expect(fields().password.getAttribute('autocomplete')).toBe('new-password');
    });

    it('wants at least 8 characters, and the same twice, before it asks the server', async () => {
      const { api, user } = arrive();
      await typeBoth(user, 'short', 'short');
      await user.click(fields().button);
      expect((await screen.findByRole('alert')).textContent).toBe(
        'Password must be at least 8 characters.',
      );
      await user.clear(fields().password);
      await user.clear(fields().again);
      await typeBoth(user, 'long-enough-1', 'long-enough-2');
      await user.click(fields().button);
      expect((await screen.findByRole('alert')).textContent).toBe('Passwords do not match.');
      expect(api.resetPassword).not.toHaveBeenCalled();
    });

    it('sets the password with the token from the email, says so, and after a moment goes back to sign in', async () => {
      const { api, user } = arrive();
      api.resetPassword.mockResolvedValue({ kind: 'done' });
      await typeBoth(user, 'a-new-password', 'a-new-password');
      await user.click(fields().button);
      expect(api.resetPassword).toHaveBeenCalledExactlyOnceWith('reset-tok', 'a-new-password');
      expect((await screen.findByRole('status')).textContent).toBe(
        'Password updated! You can now sign in.',
      );
      expect(fields().button.disabled).toBe(true);
      expect(screen.queryByLabelText('Username')).toBeNull();
      // The clock also runs in real time here (the async queries need it to), so these are margins, not instants:
      // half the wait has passed and the confirmation is still being read; the rest has passed and it is not.
      act(() => void vi.advanceTimersByTime(BACK_TO_SIGN_IN_MS / 2));
      expect(screen.queryByLabelText('Username')).toBeNull();
      expect(screen.getByRole('status')).toBeTruthy();
      act(() => void vi.advanceTimersByTime(BACK_TO_SIGN_IN_MS / 2 + 100));
      expect(screen.getByLabelText('Username')).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('stays, with the server’s words, when the link is used up or has expired', async () => {
      const { api, user } = arrive();
      api.resetPassword.mockResolvedValue({
        kind: 'failed',
        status: 400,
        message: 'Invalid or expired reset link',
      });
      await typeBoth(user, 'a-new-password', 'a-new-password');
      await user.click(fields().button);
      expect((await screen.findByRole('alert')).textContent).toBe('Invalid or expired reset link');
      act(() => void vi.advanceTimersByTime(BACK_TO_SIGN_IN_MS * 3));
      expect(screen.getByLabelText('New Password')).toBeTruthy();
      expect(fields().button.disabled).toBe(false);
    });

    it('does not go back to sign in on its own if the person has already gone', async () => {
      const { api, user } = arrive();
      api.resetPassword.mockResolvedValue({ kind: 'done' });
      await typeBoth(user, 'a-new-password', 'a-new-password');
      await user.click(fields().button);
      await screen.findByRole('status');
      await user.click(screen.getByRole('button', { name: '← Back to login' }));
      expect(screen.getByLabelText('Username')).toBeTruthy();
      await user.type(screen.getByLabelText('Username'), 'sara');
      act(() => void vi.advanceTimersByTime(BACK_TO_SIGN_IN_MS * 2));
      expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('sara');
    });

    it('waits for the answer without sending twice', async () => {
      const { api, user } = arrive();
      const answer = deferred<Awaited<ReturnType<typeof api.resetPassword>>>();
      api.resetPassword.mockReturnValue(answer.promise);
      await typeBoth(user, 'a-new-password', 'a-new-password{Enter}');
      expect(fields().button.textContent).toBe('Updating…');
      await user.type(fields().again, '{Enter}');
      expect(api.resetPassword).toHaveBeenCalledTimes(1);
      await act(async () => answer.resolve({ kind: 'failed', status: 500, message: 'x' }));
    });
  });
});

describe('arriving from Google', () => {
  it('goes straight to the second step when the account has one', () => {
    const { api } = setup(team, { mfaToken: 'google-challenge' });
    expect(screen.getByLabelText('Authentication code')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(api.verifyCode).not.toHaveBeenCalled();
  });

  it('answers that challenge with the code', async () => {
    const { api, onSignedIn, user } = setup(team, { mfaToken: 'google-challenge' });
    api.verifyCode.mockResolvedValue({ kind: 'signed-in', token: 'tok-g' });
    await user.type(screen.getByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(api.verifyCode).toHaveBeenCalledWith('google-challenge', '123456');
    expect(onSignedIn).toHaveBeenCalledWith('tok-g');
  });

  it('shows why Google could not sign the person in, on the sign-in form', () => {
    setup(team, { error: 'No account linked to this Google address. Contact your admin.' });
    expect(screen.getByRole('alert').textContent).toBe(
      'No account linked to this Google address. Contact your admin.',
    );
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('shows that message as text, not markup', () => {
    const { container } = render(
      <SignIn
        env={team}
        arrival={{ error: '<img src=x onerror=alert(1)>' }}
        api={fakeApi()}
        onSignedIn={() => undefined}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(
      within(screen.getByRole('alert')).getByText('<img src=x onerror=alert(1)>'),
    ).toBeTruthy();
  });

  it('takes the second step before the reset form if it was somehow told both', () => {
    setup(team, { mfaToken: 'c', resetToken: 'r' });
    expect(screen.getByLabelText('Authentication code')).toBeTruthy();
  });
});
