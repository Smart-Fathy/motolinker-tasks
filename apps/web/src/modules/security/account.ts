// What a team member keeps about themselves, and changes from the account menu: a picture, a status, the name they sign in with,
// and their password. The portal's own routes (`/api/employee/avatar`, `/status`, `/username`, `/change-password`), as the classic
// menu calls them: each answer is checked before it is believed, and what the server refused is said in its own words.
// The administrator has none of this — there is no account to keep it on.
import { useMemo } from 'react';
import { useSession } from '../../app/context';
import type { Api } from '../../lib/api';
import { failed, type Outcome } from '../../lib/outcome';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isStatusResult = (v: unknown): v is { status_text: string; status_emoji: string } =>
  isObject(v) && typeof v['status_text'] === 'string' && typeof v['status_emoji'] === 'string';
export const isAvatarResult = (v: unknown): v is { avatar_url: string } =>
  isObject(v) && typeof v['avatar_url'] === 'string';
export const isUsernameResult = (v: unknown): v is { ok: true; username: string } =>
  isObject(v) && v['ok'] === true && typeof v['username'] === 'string';
export const isPasswordResult = (
  v: unknown,
): v is { ok: true; sessionsRevoked: number; warning?: string } =>
  isObject(v) &&
  v['ok'] === true &&
  typeof v['sessionsRevoked'] === 'number' &&
  (v['warning'] === undefined || typeof v['warning'] === 'string');

/** A picture up to this size is taken (the server's own limit, said before the file is sent). */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
/** The words a status may have, and the emoji: what the server keeps (it cuts longer ones). */
export const STATUS_TEXT_MAX = 100;
export const STATUS_EMOJI_MAX = 4;
/** The ways to say what you are doing that the portal offers, as (emoji, words, what follows the words in grey). */
export const STATUS_PRESETS: ReadonlyArray<readonly [emoji: string, text: string, note?: string]> =
  [
    ['📅', 'In a meeting'],
    ['📚', 'Focusing'],
    ['🤒', 'Sick', '— OOO for Today'],
    ['🏝️', 'Vacation', '— OOO'],
  ];
/** The shortest password the server accepts. */
export const MIN_PASSWORD = 8;

/** What is wrong with the passwords typed, before they are sent (the server checks again). */
export function passwordProblem(current: string, next: string, again: string): string | null {
  if (!current) return 'Enter your current password.';
  if (!next || next.length < MIN_PASSWORD)
    return `New password must be at least ${MIN_PASSWORD} characters.`;
  if (next !== again) return 'New passwords do not match.';
  return null;
}

/** "Password updated. 2 other devices were signed out." — or plainly that it was. */
export const passwordDone = (revoked: number): string =>
  revoked
    ? `Password updated. ${revoked} other device${revoked === 1 ? ' was' : 's were'} signed out.`
    : 'Password updated successfully!';

const NOT_READ = 'The answer came back in a form this app does not know. Try again.';

async function ask<T>(
  call: () => Promise<unknown>,
  read: (body: unknown) => body is T,
): Promise<Outcome<T>> {
  let body: unknown;
  try {
    body = await call();
  } catch (e) {
    return failed(e);
  }
  return read(body) ? { ok: true, value: body } : { ok: false, message: NOT_READ };
}

/** The calls, for the portal `api` belongs to. */
export function accountCalls(api: Api) {
  return {
    avatar: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return ask(() => api.postForm(`${api.base}/avatar`, form), isAvatarResult);
    },
    status: (emoji: string, text: string) =>
      ask(() => api.put(`${api.base}/status`, { emoji, text }), isStatusResult),
    username: (username: string) =>
      ask(() => api.put(`${api.base}/username`, { username }), isUsernameResult),
    password: (currentPassword: string, newPassword: string) =>
      ask(
        () => api.post(`${api.base}/change-password`, { currentPassword, newPassword }),
        isPasswordResult,
      ),
  };
}

/** What the profile menu does, with what it changes shown at once. */
export function useAccount() {
  const { api, toasts, updateProfile, resubscribePush } = useSession();
  const calls = useMemo(() => accountCalls(api), [api]);
  return useMemo(
    () => ({
      /** A picture chosen from the device: checked, sent, and shown. */
      async uploadAvatar(file: File | undefined): Promise<void> {
        if (!file) return;
        if (!file.type.startsWith('image/')) return toasts.show('Please choose an image');
        if (file.size > MAX_AVATAR_BYTES) return toasts.show('Image must be under 5 MB');
        const r = await calls.avatar(file);
        if (!r.ok) return toasts.show('Upload failed: ' + r.message);
        updateProfile({ avatarUrl: r.value.avatar_url });
        toasts.show('Profile picture updated');
      },
      /** A status (or none, to clear it): what the server kept is what is shown. */
      async saveStatus(emoji: string, text: string, cleared: boolean): Promise<boolean> {
        const r = await calls.status(emoji.trim(), text.trim());
        if (!r.ok) {
          toasts.show(r.message);
          return false;
        }
        updateProfile({ statusEmoji: r.value.status_emoji, statusText: r.value.status_text });
        toasts.show(cleared ? 'Status cleared' : 'Status updated');
        return true;
      },
      /** The name to sign in with: `ok` with the name kept, or the words to show in the dialog. */
      async saveUsername(typed: string): Promise<Outcome<string>> {
        const r = await calls.username(typed.trim());
        if (!r.ok) return r;
        updateProfile({ username: r.value.username });
        toasts.show('Username changed to ' + r.value.username);
        return { ok: true, value: r.value.username };
      },
      /** A new password: how many other devices were signed out (and what could not be done about the rest). */
      async changePassword(
        current: string,
        next: string,
      ): Promise<Outcome<{ revoked: number; warning: string | undefined }>> {
        const r = await calls.password(current, next);
        if (!r.ok) return r;
        // The server clears this account's push subscriptions with the sessions; this device's is made again.
        resubscribePush();
        return { ok: true, value: { revoked: r.value.sessionsRevoked, warning: r.value.warning } };
      },
    }),
    [calls, toasts, updateProfile, resubscribePush],
  );
}
