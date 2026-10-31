import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pwa from '../../lib/pwa';
import { deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';

vi.mock('../../lib/pwa', async importOriginal => ({
  ...(await importOriginal<typeof pwa>()),
  refreshPush: vi.fn(async () => true),
}));

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
  vi.mocked(pwa.refreshPush).mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

type Calls = Record<string, Answer>;
const boot = (more: Calls = {}, profile: Parameters<typeof teamMe>[3] = {}) => {
  const s = open('team', teamMe({}, 'Sales', {}, profile), {
    more: Object.fromEntries(Object.entries(more).map(([p, a]) => [`/api/employee${p}`, a])),
  });
  const sent = (path: string, method: string) =>
    s.calls(`/api/employee${path}`).filter(c => c.init.method === method);
  const body = (path: string, method: string) =>
    JSON.parse(String(sent(path, method).at(-1)?.init.body));
  return { ...s, sent, body };
};
const part = (name: string) => document.querySelector<HTMLElement>(`[data-part=${name}]`);
const menu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Your account' }));
  return screen.getByText('Report an issue').closest('[data-part=profileMenu]') as HTMLElement;
};
const toast = () => document.querySelector('[data-part=toast], [role=status]')?.textContent ?? '';

describe('the account menu', () => {
  it('shows who you are: your initials where you have no picture, your name, your job, and an invitation to set a status', async () => {
    const user = userEvent.setup({ delay: null });
    boot();
    const box = await menu(user);
    expect(part('avatar')!.textContent).toBe('S');
    expect(within(box).getByText('Sam')).toBeTruthy();
    expect(within(box).getByText('Sales')).toBeTruthy();
    expect(part('status')!.textContent).toBe('＋ Set status');
    expect(part('status')!.getAttribute('title')).toBe('Set a status');
    expect(part('changePicture')!.getAttribute('title')).toBe('Change profile picture');
    expect(part('changeUsername')!.getAttribute('title')).toBe('Change username');
  });

  it('shows your picture in the button and the menu where you have one, and your status where you have set one', async () => {
    const user = userEvent.setup({ delay: null });
    boot(
      {},
      { avatarUrl: 'https://cdn.example.test/sam.png', statusEmoji: '📚', statusText: 'Focusing' },
    );
    const box = await menu(user);
    const faces = [
      ...document.querySelectorAll<HTMLImageElement>(
        '[data-part=avatar] img, [data-part=avatarLarge] img',
      ),
    ];
    expect(faces).toHaveLength(2);
    expect(
      faces.every(
        f => f.src === 'https://cdn.example.test/sam.png' && f.getAttribute('alt') === '',
      ),
    ).toBe(true);
    expect(box.textContent).not.toContain('S ');
    expect(part('status')!.textContent).toBe('📚 Focusing');
  });

  it('has the four things the classic menu had, in its order, and the way back to the classic portal', async () => {
    const user = userEvent.setup({ delay: null });
    boot();
    const box = await menu(user);
    const items = [
      ...box.querySelectorAll(
        '[data-part=profileMenu] .profileItem, [data-part=profileMenu] a, [data-part=profileMenu] button',
      ),
    ]
      .map(b => b.textContent?.trim())
      .filter(Boolean);
    expect(
      items.filter(t =>
        ['Report an issue', 'Change password', 'Security', 'Classic portal', 'Sign out'].includes(
          t!,
        ),
      ),
    ).toEqual(['Report an issue', 'Change password', 'Security', 'Classic portal', 'Sign out']);
  });
});

describe('the picture', () => {
  const pick = (file: File) => {
    const input = part('avatarFile') as HTMLInputElement;
    // (the browser's picker offers images only, but a file can still arrive another way — dragged, or a wrong extension)
    const user = userEvent.setup({ delay: null, applyAccept: false });
    return user.upload(input, file);
  };

  it('is chosen from the device, sent, and shown at once', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot({
      '/avatar': () => json(200, { avatar_url: 'https://cdn.example.test/new.png' }),
    });
    await menu(user);
    await user.click(part('changePicture')!);
    await pick(new File(['x'], 'face.png', { type: 'image/png' }));
    await waitFor(() => expect(s.sent('/avatar', 'POST')).toHaveLength(1));
    const form = s.sent('/avatar', 'POST')[0]!.init.body as FormData;
    expect((form.get('file') as File).name).toBe('face.png');
    await waitFor(() =>
      expect(document.querySelector<HTMLImageElement>('[data-part=avatar] img')?.src).toBe(
        'https://cdn.example.test/new.png',
      ),
    );
    expect(await screen.findByText('Profile picture updated')).toBeTruthy();
  });

  it('is refused before it is sent when it is not an image, or over 5 MB', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot({ '/avatar': () => json(200, { avatar_url: 'x' }) });
    await menu(user);
    await pick(new File(['hello'], 'a.txt', { type: 'text/plain' }));
    expect(await screen.findByText('Please choose an image')).toBeTruthy();
    await pick(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
    expect(await screen.findByText('Image must be under 5 MB')).toBeTruthy();
    expect(s.sent('/avatar', 'POST')).toHaveLength(0);
  });

  it('says what the server said when it would not take it, and keeps the old picture', async () => {
    const user = userEvent.setup({ delay: null });
    boot(
      { '/avatar': () => json(500, { error: 'storage is down' }) },
      { avatarUrl: 'https://cdn.example.test/old.png' },
    );
    await menu(user);
    await pick(new File(['x'], 'face.png', { type: 'image/png' }));
    expect(await screen.findByText('Upload failed: storage is down')).toBeTruthy();
    expect(document.querySelector<HTMLImageElement>('[data-part=avatar] img')?.src).toBe(
      'https://cdn.example.test/old.png',
    );
  });
});

describe('the status', () => {
  const dialog = () => screen.queryByRole('dialog', { name: 'Set status' });

  it('opens from the line under your name (the menu puts itself away), with what you have now', async () => {
    const user = userEvent.setup({ delay: null });
    boot({}, { statusEmoji: '📚', statusText: 'Focusing' });
    await menu(user);
    await user.click(part('status')!);
    expect(dialog()).toBeTruthy();
    expect(screen.queryByText('Report an issue')).toBeNull();
    expect((part('emoji') as HTMLInputElement).value).toBe('📚');
    expect((part('text') as HTMLInputElement).value).toBe('Focusing');
    expect(part('emoji')!.getAttribute('maxlength')).toBe('4');
    expect(part('text')!.getAttribute('maxlength')).toBe('100');
  });

  it('offers four ways to say it, which fill the two fields', async () => {
    const user = userEvent.setup({ delay: null });
    boot();
    await menu(user);
    await user.click(part('status')!);
    expect(screen.getByText('For MotoLinkers')).toBeTruthy();
    const presets = [...document.querySelectorAll('[data-part=preset]')].map(p => p.textContent);
    expect(presets).toEqual([
      '📅 In a meeting',
      '📚 Focusing',
      '🤒 Sick— OOO for Today',
      '🏝️ Vacation— OOO',
    ]);
    await user.click(screen.getByRole('button', { name: /Sick/ }));
    expect((part('emoji') as HTMLInputElement).value).toBe('🤒');
    expect((part('text') as HTMLInputElement).value).toBe('Sick');
  });

  it('saves what you typed (trimmed), shows it in the menu, closes, and says so', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot({
      '/status': () => json(200, { status_text: 'In a meeting', status_emoji: '📅' }),
    });
    await menu(user);
    await user.click(part('status')!);
    await user.type(part('emoji')!, ' 📅 ');
    await user.type(part('text')!, '  In a meeting  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(s.body('/status', 'PUT')).toEqual({ emoji: '📅', text: 'In a meeting' });
    expect(await screen.findByText('Status updated')).toBeTruthy();
    await menu(user);
    expect(part('status')!.textContent).toBe('📅 In a meeting');
  });

  it('clears it: nothing is sent but nothing, and the invitation is back', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot(
      { '/status': () => json(200, { status_text: '', status_emoji: '' }) },
      { statusEmoji: '📚', statusText: 'Focusing' },
    );
    await menu(user);
    await user.click(part('status')!);
    await user.click(screen.getByRole('button', { name: 'Clear status' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(s.body('/status', 'PUT')).toEqual({ emoji: '', text: '' });
    expect(await screen.findByText('Status cleared')).toBeTruthy();
    await menu(user);
    expect(part('status')!.textContent).toBe('＋ Set status');
  });

  it('says what the server said when it would not keep it, and stays open', async () => {
    const user = userEvent.setup({ delay: null });
    boot({ '/status': () => json(500, { error: 'database is down' }) });
    await menu(user);
    await user.click(part('status')!);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('database is down')).toBeTruthy();
    expect(dialog()).toBeTruthy();
  });
});

describe('one dialog at a time', () => {
  it('is not undone by a dialog that was still waiting for the server when the next one was opened', async () => {
    const user = userEvent.setup({ delay: null });
    const wait = deferred<Response>();
    boot({ '/status': () => wait.promise });
    await menu(user);
    await user.click(part('status')!);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    // (the status is on its way; she opens the username dialog in the meantime)
    await menu(user);
    await user.click(part('changeUsername')!);
    expect(screen.getByRole('dialog', { name: 'Change Username' })).toBeTruthy();
    wait.resolve(json(200, { status_text: 'x', status_emoji: '' }));
    await screen.findByText('Status updated');
    expect(screen.getByRole('dialog', { name: 'Change Username' })).toBeTruthy();
  });
});

describe('the username', () => {
  const dialog = () => screen.queryByRole('dialog', { name: 'Change Username' });

  it('opens from the pencil by your name, with the name you have, and says what a name may be', async () => {
    const user = userEvent.setup({ delay: null });
    boot({}, { username: 'sam.s' });
    await menu(user);
    await user.click(part('changeUsername')!);
    expect(dialog()).toBeTruthy();
    expect(
      screen.getByText('3–32 characters: letters, numbers, dots, dashes, underscores.'),
    ).toBeTruthy();
    expect((part('username') as HTMLInputElement).value).toBe('sam.s');
    expect(part('username')!.getAttribute('placeholder')).toBe('new.username');
    expect(document.querySelector('[data-part=dialog] [data-part=close]')).toBeNull();
  });

  it('saves it (trimmed), closes, and says the new name', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot({ '/username': () => json(200, { ok: true, username: 'sam.new' }) });
    await menu(user);
    await user.click(part('changeUsername')!);
    await user.clear(part('username')!);
    await user.type(part('username')!, '  sam.new  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(s.body('/username', 'PUT')).toEqual({ username: 'sam.new' });
    expect(await screen.findByText('Username changed to sam.new')).toBeTruthy();
    await menu(user);
    await user.click(part('changeUsername')!);
    expect((part('username') as HTMLInputElement).value).toBe('sam.new');
  });

  it("shows the server's refusal in the dialog and stays open — and the next try starts from a clean slate", async () => {
    const user = userEvent.setup({ delay: null });
    let n = 0;
    const s = boot({
      '/username': () =>
        ++n === 1
          ? json(409, { error: 'Username already taken' })
          : json(200, { ok: true, username: 'free.name' }),
    });
    await menu(user);
    await user.click(part('changeUsername')!);
    await user.clear(part('username')!);
    await user.type(part('username')!, 'omar');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Username already taken')).toBeTruthy();
    expect(dialog()).toBeTruthy();
    await user.clear(part('username')!);
    await user.type(part('username')!, 'free.name{Enter}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(s.sent('/username', 'PUT')).toHaveLength(2);
  });
});

describe('the password', () => {
  const dialog = () => screen.queryByRole('dialog', { name: 'Change Password' });
  const fields = () => ({
    current: part('current') as HTMLInputElement,
    next: part('new') as HTMLInputElement,
    again: part('confirm') as HTMLInputElement,
  });
  async function toDialog(user: ReturnType<typeof userEvent.setup>, more: Calls = {}) {
    const s = boot(more);
    await menu(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByRole('dialog', { name: 'Change Password' });
    return s;
  }
  const fill = async (
    user: ReturnType<typeof userEvent.setup>,
    c: string,
    n: string,
    a: string,
  ) => {
    const f = fields();
    if (c) await user.type(f.current, c);
    if (n) await user.type(f.next, n);
    if (a) await user.type(f.again, a);
  };

  it('opens from the menu, says what it will do, and asks for three passwords', async () => {
    const user = userEvent.setup({ delay: null });
    await toDialog(user);
    expect(
      screen.getByText(
        'Update your portal password. Every other device you are signed in on will be signed out.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Report an issue')).toBeNull();
    const f = fields();
    expect(f.current.getAttribute('placeholder')).toBe('Your current password');
    expect(f.next.getAttribute('placeholder')).toBe('At least 8 characters');
    expect(f.again.getAttribute('placeholder')).toBe('Repeat new password');
    expect([f.current, f.next, f.again].every(i => i.type === 'password')).toBe(true);
    expect(screen.getByLabelText('Current Password')).toBe(f.current);
  });

  it('says what is wrong before it asks the server, in the order the classic dialog checked', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await toDialog(user, {
      '/change-password': () => json(200, { ok: true, sessionsRevoked: 0 }),
    });
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('Enter your current password.')).toBeTruthy();
    await fill(user, 'old-password', '1234567', '1234567');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('New password must be at least 8 characters.')).toBeTruthy();
    await user.clear(fields().next);
    await user.clear(fields().again);
    await fill(user, '', 'new-password-1', 'new-password-2');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('New passwords do not match.')).toBeTruthy();
    expect(s.sent('/change-password', 'POST')).toHaveLength(0);
  });

  it("changes it, says how many other devices were signed out, clears the fields, and tells the server about this device's push subscription again", async () => {
    const user = userEvent.setup({ delay: null });
    const s = await toDialog(user, {
      '/change-password': () => json(200, { ok: true, sessionsRevoked: 2 }),
    });
    const before = vi.mocked(pwa.refreshPush).mock.calls.length;
    await fill(user, 'old-password', 'new-password-1', 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(
      await screen.findByText('Password updated. 2 other devices were signed out.'),
    ).toBeTruthy();
    expect(s.body('/change-password', 'POST')).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password-1',
    });
    expect([fields().current.value, fields().next.value, fields().again.value]).toEqual([
      '',
      '',
      '',
    ]);
    expect(vi.mocked(pwa.refreshPush).mock.calls.length).toBe(before + 1);
    expect(dialog()).toBeTruthy();
  });

  it('says it plainly when there were no other devices', async () => {
    const user = userEvent.setup({ delay: null });
    await toDialog(user, { '/change-password': () => json(200, { ok: true, sessionsRevoked: 0 }) });
    await fill(user, 'old-password', 'new-password-1', 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('Password updated successfully!')).toBeTruthy();
  });

  it('does not call it a success when the other devices could not be signed out: the warning is shown beside it', async () => {
    const user = userEvent.setup({ delay: null });
    await toDialog(user, {
      '/change-password': () =>
        json(200, {
          ok: true,
          sessionsRevoked: 0,
          warning: 'Your password was changed, but we could not sign your other devices out.',
        }),
    });
    await fill(user, 'old-password', 'new-password-1', 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText(/we could not sign your other devices out/)).toBeTruthy();
    expect(screen.getByText('Password updated successfully!')).toBeTruthy();
  });

  it("shows a wrong current password in the server's words and keeps what was typed", async () => {
    const user = userEvent.setup({ delay: null });
    await toDialog(user, {
      '/change-password': () => json(403, { error: 'Current password is incorrect' }),
    });
    await fill(user, 'wrong', 'new-password-1', 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    expect(await screen.findByText('Current password is incorrect')).toBeTruthy();
    expect(fields().next.value).toBe('new-password-1');
    expect(screen.queryByText(/Password updated/)).toBeNull();
  });

  it('holds the button while it works, and says so on it', async () => {
    const user = userEvent.setup({ delay: null });
    const wait = deferred<Response>();
    await toDialog(user, { '/change-password': () => wait.promise });
    await fill(user, 'old-password', 'new-password-1', 'new-password-1');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));
    const busy = await screen.findByRole('button', { name: 'Updating…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    wait.resolve(json(200, { ok: true, sessionsRevoked: 0 }));
    expect(await screen.findByText('Password updated successfully!')).toBeTruthy();
    expect(toast()).toBeDefined();
  });

  it('closes on Cancel and on Escape', async () => {
    const user = userEvent.setup({ delay: null });
    await toDialog(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(dialog()).toBeNull();
    await menu(user);
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
  });
});
