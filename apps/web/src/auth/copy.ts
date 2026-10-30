import type { Portal } from '../lib/env';

// Every line the sign-in screens say, in one place: the words the classic portals use (public/dashboard.html,
// employee.html, assets/dashboard.js, employee.js), kept so that switching to the new app changes nothing a person
// reads. `title` and `subtitle` are lines an admin can replace (Workspace → wording): the key, then the default.

export interface Copy {
  title: readonly [key: string, fallback: string];
  subtitle: readonly [key: string, fallback: string];
  usernamePlaceholder: string;
  passwordPlaceholder: string;
  /** under the card's heading on the second step */
  code: {
    heading: string | null;
    lead: { totp: string; recovery: string };
    label: { totp: string; recovery: string };
    placeholder: { totp: string; recovery: string };
    back: string;
  };
}

export const COPY: Record<Portal, Copy> = {
  admin: {
    title: ['admin_title', 'Admin Access'],
    subtitle: ['admin_sub', 'Sign in with your admin credentials'],
    usernamePlaceholder: 'Username',
    passwordPlaceholder: 'Password',
    code: {
      heading: null,
      lead: {
        totp: 'Enter the 6-digit code from your authenticator app',
        recovery: 'Enter one of your recovery codes (each works once)',
      },
      label: { totp: 'Authentication code', recovery: 'Recovery code' },
      placeholder: { totp: '123456', recovery: 'xxxxx-xxxxx' },
      back: '← Back',
    },
  },
  team: {
    title: ['team_title', 'Team Portal'],
    subtitle: ['team_sub', '{ws} · Log hours & track tasks'],
    usernamePlaceholder: 'Your username',
    passwordPlaceholder: 'Your password',
    code: {
      heading: 'Two-step verification',
      lead: {
        totp: 'Open your authenticator app and enter the 6-digit code for MotoLinker.',
        recovery:
          'Enter one of the recovery codes you saved when you turned on two-step verification. Each works once.',
      },
      label: { totp: 'Authentication code', recovery: 'Recovery code' },
      placeholder: { totp: '123456', recovery: 'xxxxx-xxxxx' },
      back: '← Back to login',
    },
  },
};

export const TEXT = {
  signIn: 'Sign In',
  signingIn: 'Signing in…',
  forgot: 'Forgot password?',
  or: 'or',
  google: 'Sign in with Google',
  verify: 'Verify',
  verifying: 'Verifying…',
  useRecovery: 'Use a recovery code instead',
  useApp: 'Use my authenticator app instead',
  enterCode: 'Enter the code.',
  backToLogin: '← Back to login',
  // the second step's default when the server gave no words of its own is in lib/auth-api.ts
  network: 'Cannot reach the server. Check the connection and try again.',
  forgotHeading: 'Reset Password',
  forgotLead: "Enter your email address and we'll send you a reset link.",
  email: 'Email Address',
  emailPlaceholder: 'you@example.com',
  enterEmail: 'Please enter your email.',
  sendLink: 'Send Reset Link',
  sending: 'Sending…',
  linkSent: 'If an account with that email exists, a reset link has been sent.',
  resetHeading: 'Set New Password',
  resetLead: 'Enter your new password below.',
  newPassword: 'New Password',
  newPasswordPlaceholder: 'At least 8 characters',
  confirmPassword: 'Confirm New Password',
  confirmPlaceholder: 'Repeat password',
  tooShort: 'Password must be at least 8 characters.',
  mismatch: 'Passwords do not match.',
  setPassword: 'Set Password',
  updating: 'Updating…',
  passwordUpdated: 'Password updated! You can now sign in.',
  classicLink: 'Back to the classic portal',
} as const;
