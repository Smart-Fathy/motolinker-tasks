import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';
import { MAX_FILE_BYTES, SAID } from './model';

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

/** A signed-in team member (who need not be allowed the Issues centre: anybody may report) on the Home screen. */
function boot(
  answer: Answer = () => json(201, { ok: true, file: '' }),
  portal: 'admin' | 'team' = 'team',
) {
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe({}, 'Sales'), {
    more: { '/api/v1/issues': answer },
  });
  const sent = () => s.calls('/api/v1/issues').filter(c => c.init.method === 'POST');
  const form = () => sent()[0]!.init.body as FormData;
  return { ...s, sent, form };
}

const summary = () => screen.getByPlaceholderText("e.g. Can't log hours");
const details = () => screen.getByPlaceholderText('What happened? What did you expect?');
const submit = () => screen.getByRole('button', { name: /Submit Ticket|Sending…/ });
const dialog = () => screen.queryByRole('dialog', { name: 'Report an Issue' });
/** The report's own file input (the account menu has one too, for the picture). */
const fileInput = () => dialog()!.querySelector<HTMLInputElement>('input[type=file]')!;

describe('the ways in', () => {
  it("is a button at the foot of the team's rail, and a line in the account menu", async () => {
    const user = userEvent.setup({ delay: null });
    boot();
    await screen.findByText(/Signed in as Sam/);
    expect(dialog()).toBeNull();

    await user.click(document.querySelector('[data-part=reportIssue]')!);
    expect(dialog()).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(dialog()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Your account' }));
    await user.click(screen.getByRole('button', { name: 'Report an issue' }));
    expect(dialog()).toBeTruthy();
    // the menu closed behind it
    expect(screen.queryByText('Sign out')).toBeNull();
  });

  it('is offered to the team and not to the admin, whose classic portal never had it', async () => {
    boot(undefined, 'admin');
    await screen.findByText(/Signed in as Admin/);
    expect(document.querySelector('[data-part=reportIssue]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Report an Issue/i })).toBeNull();
  });
});

describe('the form', () => {
  it('says who it goes to, and asks for a summary, details and an attachment — the last two optional in the sense that one of the first two will do', async () => {
    const user = userEvent.setup({ delay: null });
    boot();
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    const box = within(screen.getByRole('dialog'));
    expect(
      box.getByText(
        'Describe the problem — your ticket goes straight to the Chief Technical Officer.',
      ),
    ).toBeTruthy();
    expect(box.getByLabelText('Summary')).toBe(summary());
    expect(box.getByLabelText('Details')).toBe(details());
    expect(box.getByText('(optional, up to 10 MB)')).toBeTruthy();
    expect(summary().getAttribute('maxlength')).toBe('150');
    expect(details().getAttribute('maxlength')).toBe('2000');
    expect(box.getByText('Click to attach a screenshot or file')).toBeTruthy();
    expect(fileInput().accept).toBe('image/*,.pdf,.log,.txt,.zip,.mp4');
  });

  it('says what has been chosen under the paperclip', async () => {
    const user = userEvent.setup({ delay: null });
    boot();
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    const file = new File([new Uint8Array(1.5 * 1024 * 1024)], 'shot.png', { type: 'image/png' });
    await user.upload(fileInput(), file);
    expect(screen.getByText('shot.png · 1.5 MB')).toBeTruthy();
  });

  it('starts empty each time it is opened', async () => {
    const user = userEvent.setup({ delay: null });
    boot();
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    await user.type(summary(), 'something');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: /Report an Issue/ }));
    expect((summary() as HTMLInputElement).value).toBe('');
  });
});

describe('sending it', () => {
  it('posts a form with the words (trimmed) and the file, says the ticket is on its way, and closes', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot();
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    await user.type(summary(), '  Cannot log hours  ');
    await user.type(details(), 'The button does nothing.\n');
    await user.upload(fileInput(), new File(['x'], 'shot.png', { type: 'image/png' }));
    await user.click(submit());
    expect(await screen.findByText(SAID.sent)).toBeTruthy();
    expect(dialog()).toBeNull();
    expect(s.sent()).toHaveLength(1);
    expect(s.form().get('title')).toBe('Cannot log hours');
    expect(s.form().get('description')).toBe('The button does nothing.');
    expect((s.form().get('file') as File).name).toBe('shot.png');
    // the browser writes the multipart content type, with its boundary; a JSON one would break it
    expect((s.sent()[0]!.init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('takes details alone, or a summary alone, with no file', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot();
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    await user.type(details(), 'It broke');
    await user.click(submit());
    await screen.findByText(SAID.sent);
    expect(s.form().get('title')).toBe('');
    expect(s.form().has('file')).toBe(false);
  });

  it('asks for words before it sends anything, and keeps the dialog open', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot();
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    await user.type(summary(), '   ');
    await user.click(submit());
    expect(await screen.findByText('Please describe the issue')).toBeTruthy();
    expect(s.sent()).toHaveLength(0);
    expect(dialog()).toBeTruthy();
  });

  it('refuses a file over 10 MB before it sends anything', async () => {
    const user = userEvent.setup({ delay: null });
    const s = boot();
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    await user.type(summary(), 'Big one');
    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
    await user.upload(fileInput(), big);
    await user.click(submit());
    expect(await screen.findByText('File must be under 10 MB')).toBeTruthy();
    expect(s.sent()).toHaveLength(0);
  });

  it('cannot be sent twice at once: the button says it is sending, and waits', async () => {
    const user = userEvent.setup({ delay: null });
    const answer = deferred<Response>();
    const s = boot(() => answer.promise);
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    await user.type(summary(), 'Slow one');
    await user.click(submit());
    const button = await screen.findByRole('button', { name: 'Sending…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await user.click(button);
    expect(s.sent()).toHaveLength(1);
    answer.resolve(json(201, { ok: true, file: '' }));
    await screen.findByText(SAID.sent);
  });

  it('tells the person "Error: " and the server\'s words when it would not take it, and keeps what they wrote', async () => {
    const user = userEvent.setup({ delay: null });
    boot(() =>
      json(502, {
        error: 'The attachment could not be stored. Try again in a moment.',
        code: 'upload_failed',
      }),
    );
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    await user.type(summary(), 'Cannot log hours');
    await user.click(submit());
    expect(
      await screen.findByText('Error: The attachment could not be stored. Try again in a moment.'),
    ).toBeTruthy();
    expect(dialog()).toBeTruthy();
    expect((summary() as HTMLInputElement).value).toBe('Cannot log hours');
    await waitFor(() => expect((submit() as HTMLButtonElement).disabled).toBe(false));
    expect(submit().textContent).toBe('Submit Ticket');
  });

  it('says so when the server cannot be reached at all', async () => {
    const user = userEvent.setup({ delay: null });
    boot(() => {
      throw new TypeError('Failed to fetch');
    });
    await user.click(await screen.findByRole('button', { name: /Report an Issue/ }));
    await user.type(summary(), 'x');
    await user.click(submit());
    expect(await screen.findByText(/^Error: Cannot reach the server/)).toBeTruthy();
  });
});
