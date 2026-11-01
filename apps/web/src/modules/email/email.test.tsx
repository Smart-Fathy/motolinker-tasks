import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../../lib/api';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';
import type { MailMessage, MailSummary } from './model';

const M1: MailSummary = {
  id: 'm1',
  subject: 'Quote for the Hilux',
  from: 'Ben Buyer <ben@buyer.test>',
  date: 'Wed, 28 Oct 2026 10:15:00 +0000',
  snippet: 'Could you send the final price?',
  unread: true,
};
const M2: MailSummary = {
  id: 'm2',
  subject: 'Re: Service slot',
  from: 'ana@motolinker.test',
  date: 'Tue, 27 Oct 2026 08:00:00 +0000',
  snippet: 'Friday at ten works.',
  unread: false,
};
const M3: MailSummary = {
  id: 'm3',
  subject: '',
  from: 'Dee <dee@dealer.test>',
  date: 'Mon, 26 Oct 2026 17:45:00 +0000',
  snippet: '',
  unread: false,
};
const BODY1: MailMessage = {
  id: 'm1',
  threadId: 't1',
  labelIds: ['INBOX', 'UNREAD'],
  subject: 'Quote for the Hilux',
  from: 'Ben Buyer <ben@buyer.test>',
  to: 'ana@motolinker.test',
  date: 'Wed, 28 Oct 2026 10:15:00 +0000',
  messageId: '<m1@buyer.test>',
  body: 'Hello,\n\nCould you send the final price?\n\nBen',
  isHtml: false,
};
const BODY2: MailMessage = {
  ...BODY1,
  id: 'm2',
  threadId: 't2',
  subject: 'Re: Service slot',
  from: 'ana@motolinker.test',
  messageId: '<m2@motolinker.test>',
  body: 'Friday at ten works.',
};
const HTML_BODY = '<p class="x">Tom &amp; Jerry say &quot;hi&quot; &lt;script&gt;</p>';
const BODY3: MailMessage = {
  ...BODY1,
  id: 'm3',
  threadId: 't3',
  subject: '',
  from: 'Dee <dee@dealer.test>',
  messageId: '',
  body: HTML_BODY,
  isHtml: true,
};
const LINKED = {
  configured: true,
  connected: true,
  email: 'ana@motolinker.test',
  name: 'Ana A.',
  canSend: true,
};
const UNLINKED = { configured: true, connected: false };
const ALL = { email: true, emailActions: { view: true, send: true, connect: true } };

let assign: ReturnType<typeof vi.fn>;
beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  localStorage.clear();
  localStorage.setItem('ml_admin_token', 'adm-tok');
  localStorage.setItem('ml_emp_token', 'emp-tok');
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

interface World {
  status: unknown;
  messages: unknown;
  bodies: Record<string, MailMessage>;
  /** a call that is answered with an error: path suffix → [status, words] */
  no?: Record<string, [number, string]>;
  /** a call that waits until the test lets it go */
  wait?: Record<string, Promise<unknown>>;
  /** what was posted to send, in order */
  posted: Record<string, unknown>[];
}

function boot(
  portal: 'admin' | 'team',
  over: Partial<World> = {},
  permissions: Record<string, unknown> = ALL,
  as?: Me,
) {
  const w: World = {
    status: LINKED,
    messages: [M1, M2, M3],
    bodies: { m1: BODY1, m2: BODY2, m3: BODY3 },
    posted: [],
    ...over,
  };
  const base = portal === 'admin' ? '/api/email' : '/api/employee/email';
  const gate = (suffix: string, body: () => unknown): Answer => {
    return async () => {
      const wait = w.wait?.[suffix];
      if (wait) await wait;
      const no = w.no?.[suffix];
      return no ? json(no[0], { error: no[1] }) : json(200, body());
    };
  };
  const more: Record<string, Answer> = {
    [base + '/status']: gate('status', () => w.status),
    [base + '/messages']: gate('messages', () => w.messages),
    [base + '/disconnect']: gate('disconnect', () => {
      w.status = UNLINKED;
      return { ok: true };
    }),
    [base + '/send']: async init => {
      w.posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return gate('send', () => ({ ok: true, id: 'g1' }))(init);
    },
    '/api/employee/check': () => json(200, { ok: true }),
  };
  for (const id of ['m1', 'm2', 'm3', 'm9']) {
    more[`${base}/messages/${id}`] = gate('message:' + id, () => w.bodies[id] ?? {});
  }
  const me = as ?? (portal === 'admin' ? adminMe() : teamMe(permissions));
  return { ...open(portal, me, { entries: ['/email'], more }), world: w, base };
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part=${name}]`);
const parts = (name: string) => [...document.querySelectorAll<HTMLElement>(`[data-part=${name}]`)];
const text = (name: string) => part(name)?.textContent ?? null;
const rows = () => parts('inboxRow');
const dialog = () => document.querySelector<HTMLElement>('[data-part=dialog]');
const sheetTitle = () => dialog()?.querySelector('[data-part=title]')?.textContent ?? null;
const field = (name: string) => document.querySelector<HTMLInputElement>(`[data-part=${name}]`)!;

describe.each(['admin', 'team'] as const)('My Email, in the %s portal', portal => {
  it('shows the loader until it knows whose Gmail it is', async () => {
    const gate = deferred<unknown>();
    boot(portal, { wait: { status: gate.promise } });
    await waitFor(() => expect(part('loading')).not.toBeNull());
    expect(text('loading')!.trim()).toBe(portal === 'admin' ? 'Checking Gmail…' : 'Loading email…');
    // (a space between the spinner and the words, as the classic pages have)
    expect(text('loading')).toBe(' ' + (portal === 'admin' ? 'Checking Gmail…' : 'Loading email…'));
    expect(part('connectCard')).toBeNull();
    expect(part('inboxCard')).toBeNull();
    gate.resolve(null);
    await waitFor(() => expect(part('loading')).toBeNull());
  });

  it('says that there is no Google project here, and offers no way out of it', async () => {
    boot(portal, { status: { configured: false } });
    await waitFor(() => expect(part('connectCard')).not.toBeNull());
    if (portal === 'admin') {
      expect(text('connectTitle')).toBe('Connect Gmail');
      expect(text('connectSub')).toBe('Add these env vars in Railway then redeploy:');
      expect(text('env')).toBe(
        'GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=...\nAPP_URL=https://your-app.railway.app',
      );
    } else {
      expect(text('connectTitle')).toBe('Email not configured');
      expect(text('connectSub')).toBe('Google OAuth is not set up. Contact your admin.');
      expect(part('env')).toBeNull();
      expect(part('connectCard')!.querySelector('svg')).not.toBeNull();
    }
    expect(part('connectBtn')).toBeNull();
    expect(part('account')).toBeNull();
  });

  it('offers to link an account when there is none, and goes to Google when asked', async () => {
    const user = userEvent.setup();
    const view = boot(portal, { status: UNLINKED });
    await waitFor(() => expect(part('connectBtn')).not.toBeNull());
    expect(text('connectTitle')).toBe('Connect Your Gmail');
    expect(text('connectSub')).toBe(
      portal === 'admin'
        ? 'Sign in with Google to view your inbox in this dashboard.'
        : 'Connect your Google account to access your personal inbox.',
    );
    expect(text('connectBtn')!.trim()).toBe('Connect Gmail');
    // (the team's button has the mail icon in it; the administrator's is the words alone)
    expect(part('connectBtn')!.querySelector('svg') !== null).toBe(portal === 'team');
    await user.click(part('connectBtn')!);
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledExactlyOnceWith(
      portal === 'admin'
        ? '/api/email/connect?_t=adm-tok'
        : '/api/employee/email/connect?_t=emp-tok',
    );
    // (the team's page asks whether the session is still good before it leaves; the administrator's does not)
    expect(view.calls('/api/employee/check')).toHaveLength(portal === 'admin' ? 0 : 1);
  });

  it('shows the account and its inbox: sender, subject and snippet of each message, unread ones marked', async () => {
    boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(text('accountName')).toBe('Ana A.');
    expect(text('accountEmail')).toBe('ana@motolinker.test');
    expect(text('accountAvatar')).toBe('A');
    expect(parts('rowFrom').map(e => e.textContent)).toEqual([
      'Ben Buyer',
      'ana@motolinker.test',
      'Dee',
    ]);
    expect(parts('rowSubject').map(e => e.textContent)).toEqual([
      'Quote for the Hilux',
      'Re: Service slot',
      '(no subject)',
    ]);
    expect(parts('rowSnippet').map(e => e.textContent)).toEqual([
      'Could you send the final price?',
      'Friday at ten works.',
      '',
    ]);
    // (only the first is unread)
    expect(rows().map(r => r.querySelector('[data-part=unreadDot]') !== null)).toEqual([
      true,
      false,
      false,
    ]);
    // …and it is the one set in bold
    expect(rows().map(r => /unread/i.test(r.className))).toEqual([true, false, false]);
    expect(text('inboxHeader')).toContain('Inbox');
    expect(part('loading')).toBeNull();
  });

  it('writes each date in the portal’s own way', async () => {
    boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    const d = new Date(M1.date);
    expect(parts('rowDate')[0]!.textContent).toBe(
      portal === 'admin'
        ? d.toLocaleDateString()
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
  });

  it('shows the loader while the inbox is on its way, and not an account with nothing in it', async () => {
    const gate = deferred<unknown>();
    boot(portal, { wait: { messages: gate.promise } });
    await waitFor(() => expect(part('inboxLoading')).not.toBeNull());
    await new Promise(r => setTimeout(r, 30));
    expect(part('inboxLoading')).not.toBeNull();
    expect(part('inboxNone')).toBeNull();
    expect(text('accountName')).toBe('Ana A.');
    if (portal === 'team') expect(text('inboxLoading')!.trim()).toBe('Loading messages…');
    // (the room it takes is the classic page's own: the team's line is padded 28px, the administrator's spinner has the usual)
    expect(part('inboxLoading')!.style.padding).toBe(portal === 'team' ? '28px' : '');
    gate.resolve(null);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(part('inboxLoading')).toBeNull();
  });

  it('says so when there is nothing in the inbox', async () => {
    boot(portal, { messages: [] });
    await waitFor(() => expect(part('inboxNone')).not.toBeNull());
    expect(text('inboxNone')).toBe(portal === 'admin' ? 'No messages' : 'No messages in inbox');
    expect(rows()).toHaveLength(0);
  });

  it('says why the inbox could not be had, in the words the server gave, and not that it is empty', async () => {
    boot(portal, { no: { messages: [500, 'Request had insufficient authentication scopes.'] } });
    await waitFor(() => expect(part('error')).not.toBeNull());
    expect(text('error')).toBe('Request had insufficient authentication scopes.');
    expect(part('error')!.getAttribute('role')).toBe('alert');
    expect(part('inboxNone')).toBeNull();
    // (the account, and the way to let go of it, are still there)
    expect(text('accountName')).toBe('Ana A.');
    expect(part('disconnect')).not.toBeNull();
  });

  it('does not take an inbox it does not know for an empty one', async () => {
    boot(portal, { messages: { error: 'Gmail not connected' } });
    await waitFor(() => expect(part('error')).not.toBeNull());
    expect(text('error')).toBe('Gmail came back in a form this app does not know.');
    expect(part('inboxNone')).toBeNull();
  });

  it('says why when the link itself could not be read, and offers nothing', async () => {
    boot(portal, { no: { status: [500, 'Down for now'] } });
    await waitFor(() => expect(part('error')).not.toBeNull());
    expect(text('error')).toBe('Down for now');
    expect(part('connectBtn')).toBeNull();
    expect(part('account')).toBeNull();
  });

  it('opens a message when its line is chosen: who wrote it, to whom, and what it says', async () => {
    const user = userEvent.setup();
    const view = boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('bodyText')).not.toBeNull());
    expect(view.calls(view.base + '/messages/m1')).toHaveLength(1);
    expect(text('messageSubject')).toBe('Quote for the Hilux');
    expect(text('messageFrom')).toContain('Ben Buyer <ben@buyer.test>');
    expect(text('messageTo')).toContain('ana@motolinker.test');
    expect(text('bodyText')).toBe('Hello,\n\nCould you send the final price?\n\nBen');
    expect(part('bodyFrame')).toBeNull();
  });

  it('opens a line from the keyboard, too', async () => {
    const user = userEvent.setup();
    boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    rows()[1]!.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(text('bodyText')).toBe('Friday at ten works.'));
    rows()[0]!.focus();
    await user.keyboard(' ');
    await waitFor(() => expect(text('bodyText')).toContain('Could you send'));
  });

  it('keeps Space from scrolling the page, and Enter from doing anything else, when they open a line', async () => {
    boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    // (fireEvent says whether the key was left to do what it does: false is “someone took it”)
    expect(fireEvent.keyDown(rows()[0]!, { key: ' ' })).toBe(false);
    expect(fireEvent.keyDown(rows()[1]!, { key: 'Enter' })).toBe(false);
    expect(fireEvent.keyDown(rows()[2]!, { key: 'a' })).toBe(true);
  });

  it('opens nothing for a key that is not Enter or Space', async () => {
    const view = boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.keyDown(rows()[0]!, { key: 'a' });
    fireEvent.keyDown(rows()[0]!, { key: 'Tab' });
    await new Promise(r => setTimeout(r, 30));
    expect(view.calls(view.base + '/messages/m1')).toHaveLength(0);
    expect(part('message')).toBeNull();
  });

  it('shows the loader in place of a message that has not come, and then the message', async () => {
    const user = userEvent.setup();
    const gate = deferred<unknown>();
    boot(portal, { wait: { 'message:m1': gate.promise } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('detailLoading')).not.toBeNull());
    expect(part('bodyText')).toBeNull();
    // (there is nothing yet to answer: the team's box for it is not drawn before the message is)
    expect(part('reply')).toBeNull();
    expect(part('detailLoading')!.style.padding).toBe(portal === 'admin' ? '40px' : '');
    gate.resolve(null);
    await waitFor(() => expect(part('bodyText')).not.toBeNull());
    expect(part('detailLoading')).toBeNull();
  });

  it('says why a message could not be had, in the words the server gave', async () => {
    const user = userEvent.setup();
    boot(portal, { no: { 'message:m1': [500, 'Gmail said no'] } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('detailError')).not.toBeNull());
    expect(text('detailError')).toBe('Gmail said no');
    expect(part('detailError')!.getAttribute('role')).toBe('alert');
    expect(part('bodyText')).toBeNull();
    // (the list is still there to choose another from)
    expect(rows()).toHaveLength(3);
  });

  it('says so, in place of a blank card, when Gmail did not give the message', async () => {
    const user = userEvent.setup();
    boot(portal, {
      bodies: {
        m1: {
          labelIds: [],
          subject: '',
          from: '',
          to: '',
          date: '',
          messageId: '',
          body: '',
          isHtml: false,
        },
        m2: BODY2,
        m3: BODY3,
      },
    });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('detailError')).not.toBeNull());
    expect(text('detailError')).toBe(
      'Gmail did not give this message. It may have been moved or deleted.',
    );
    expect(part('reply')).toBeNull();
    expect(part('forward')).toBeNull();
    // (nothing is written of a message there is none of)
    expect(text('messageSubject') ?? '').toBe('');
  });

  it('draws a page of HTML in a frame that runs nothing, handing over exactly what the sender wrote', async () => {
    const user = userEvent.setup();
    boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[2]!);
    await waitFor(() => expect(part('bodyFrame')).not.toBeNull());
    const frame = part('bodyFrame') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    // (the entities and quotes are the sender's own, not turned into anything by the page that holds them)
    expect(frame.getAttribute('srcdoc')).toBe(HTML_BODY);
    expect(part('bodyText')).toBeNull();
    // (the administrator's page sets a page of HTML edge to edge, and text in a padded block)
    expect(/messageBodyHtml/.test(part('messageBody')!.className)).toBe(portal === 'admin');
  });

  it('makes the administrator’s frame as tall as what is in it once it has loaded, and leaves the team’s as it is', async () => {
    const user = userEvent.setup();
    boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[2]!);
    await waitFor(() => expect(part('bodyFrame')).not.toBeNull());
    const frame = part('bodyFrame') as HTMLIFrameElement;
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      value: { body: { scrollHeight: 120 } },
    });
    fireEvent.load(frame);
    expect(frame.style.height).toBe(portal === 'admin' ? '160px' : '');
    // (a frame whose page has no document, or no body yet, is not measured, and does not stop the page)
    for (const empty of [null, { body: null }]) {
      Object.defineProperty(frame, 'contentDocument', { configurable: true, value: empty });
      frame.style.height = '';
      fireEvent.load(frame);
      expect(frame.style.height).toBe('');
    }
  });

  it('draws text as text: markup in it is words, not markup', async () => {
    const user = userEvent.setup();
    boot(portal, {
      bodies: {
        m1: { ...BODY1, body: '<img src=x onerror=alert(1)><b>bold</b>', isHtml: false },
        m2: BODY2,
        m3: BODY3,
      },
    });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('bodyText')).not.toBeNull());
    expect(text('bodyText')).toBe('<img src=x onerror=alert(1)><b>bold</b>');
    expect(part('bodyText')!.querySelector('img, b')).toBeNull();
  });

  it('lets go of the account when asked, holds the button while it asks, and asks again whose account it is', async () => {
    const user = userEvent.setup();
    const gate = deferred<unknown>();
    const view = boot(portal, { wait: { disconnect: gate.promise } });
    await waitFor(() => expect(part('disconnect')).not.toBeNull());
    const button = part('disconnect') as HTMLButtonElement;
    await user.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    await user.click(button);
    gate.resolve(null);
    await waitFor(() => expect(part('connectBtn')).not.toBeNull());
    expect(view.calls(view.base + '/disconnect')).toHaveLength(1);
    expect(part('inboxCard')).toBeNull();
    // (the inbox is not read again with no account to read it with)
    expect(view.calls(view.base + '/messages')).toHaveLength(1);
  });

  it('says in a message at the foot when the link could not be let go, and stays as it was', async () => {
    const user = userEvent.setup();
    boot(portal, { no: { disconnect: [500, 'Down for now'] } });
    await waitFor(() => expect(part('disconnect')).not.toBeNull());
    await user.click(part('disconnect')!);
    expect(await screen.findByText('Down for now')).toBeTruthy();
    expect(part('account')).not.toBeNull();
    expect((part('disconnect') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reads it all again each time it is opened', async () => {
    const view = boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(view.calls(view.base + '/status')).toHaveLength(1);
    expect(view.calls(view.base + '/messages')).toHaveLength(1);
  });
});

describe('My Email, in the admin’s portal', () => {
  it('sets the account and the inbox in a page that is the height of the screen and scrolls inside it', async () => {
    boot('admin');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(part('emailPage')!.contains(part('emailContent')!)).toBe(true);
    expect(part('emailContent')!.contains(part('account')!)).toBe(true);
    expect(part('emailContent')!.contains(part('split')!)).toBe(true);
  });

  it('puts Compose and Disconnect together beside the account', async () => {
    boot('admin');
    await waitFor(() => expect(part('accountActions')).not.toBeNull());
    expect([...part('accountActions')!.children].map(c => c.textContent)).toEqual([
      'Compose',
      'Disconnect',
    ]);
  });

  it('shows the placeholder beside the inbox until a message is chosen', async () => {
    const user = userEvent.setup();
    boot('admin');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(text('placeholderText')).toBe('Select an email to read it');
    expect(part('message')).toBeNull();
    expect(part('split')!.className).not.toMatch(/showDetail/);
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('message')).not.toBeNull());
    expect(part('placeholder')).toBeNull();
    // (on a phone the message takes the place of the inbox)
    expect(part('split')!.className).toMatch(/showDetail/);
  });

  it('writes the message’s head: subject, sender, recipient, the day and time', async () => {
    const user = userEvent.setup();
    boot('admin');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('message')).not.toBeNull());
    expect(text('messageSubject')).toBe('Quote for the Hilux');
    expect(text('messageFrom')).toBe('From: Ben Buyer <ben@buyer.test>');
    expect(text('messageTo')).toBe('To: ana@motolinker.test');
    expect(text('messageDate')).toBe(new Date(BODY1.date).toLocaleString());
  });

  it('writes “(no subject)” over a message that has none, and leaves out a recipient that is missing', async () => {
    const user = userEvent.setup();
    boot('admin', { bodies: { m1: BODY1, m2: BODY2, m3: { ...BODY3, to: '' } } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[2]!);
    await waitFor(() => expect(part('message')).not.toBeNull());
    expect(text('messageSubject')).toBe('(no subject)');
    expect(part('messageTo')).toBeNull();
  });

  it('writes “(empty)” for a text message with nothing in it', async () => {
    const user = userEvent.setup();
    boot('admin', { bodies: { m1: { ...BODY1, body: '' }, m2: BODY2, m3: BODY3 } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('bodyText')).not.toBeNull());
    expect(text('bodyText')).toBe('(empty)');
  });

  it('takes a message from view with Back, which a phone needs, and shows the placeholder again', async () => {
    const user = userEvent.setup();
    boot('admin');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('back')).not.toBeNull());
    await user.click(part('back')!);
    expect(part('message')).toBeNull();
    expect(part('placeholder')).not.toBeNull();
    expect(part('split')!.className).not.toMatch(/showDetail/);
  });

  it('starts the whole page over when Refresh is pressed: the loader, the account again, the inbox again, no message open', async () => {
    const user = userEvent.setup();
    const view = boot('admin');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('message')).not.toBeNull());
    // (the account is asked about again, and the answer is held back so that the page can be seen waiting for it)
    const gate = deferred<unknown>();
    view.world.wait = { status: gate.promise };
    await user.click(part('refresh')!);
    await waitFor(() => expect(part('loading')).not.toBeNull());
    expect(text('loading')!.trim()).toBe('Checking Gmail…');
    expect(part('split')).toBeNull();
    expect(part('message')).toBeNull();
    gate.resolve(null);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(part('message')).toBeNull();
    expect(part('placeholder')).not.toBeNull();
    expect(view.calls('/api/email/status')).toHaveLength(2);
    expect(view.calls('/api/email/messages')).toHaveLength(2);
  });

  it('offers no way to write to an administrator’s session that has not got the grant, should the administrator’s rights ever be narrowed', async () => {
    const me = { ...adminMe(), caps: ['email.view', 'email.connect'] } as Me;
    const w = boot('admin', {}, ALL, me);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(part('compose')).toBeNull();
    expect(part('disconnect')).not.toBeNull();
    await userEvent.setup().click(rows()[0]!);
    await waitFor(() => expect(part('message')).not.toBeNull());
    expect(part('reply')).toBeNull();
    expect(part('forward')).toBeNull();
    expect(w.calls('/api/email/send')).toHaveLength(0);
  });

  describe('Compose', () => {
    it('opens a sheet for a new email, with nothing filled in', async () => {
      const user = userEvent.setup();
      boot('admin');
      await waitFor(() => expect(part('compose')).not.toBeNull());
      await user.click(part('compose')!);
      expect(dialog()).not.toBeNull();
      expect(sheetTitle()).toBe('New Email');
      expect(field('to').value).toBe('');
      expect(field('subject').value).toBe('');
      expect(field('composeBody').value).toBe('');
      expect(field('to').placeholder).toBe('recipient@example.com');
      expect(field('subject').placeholder).toBe('Subject…');
      expect(field('composeBody').placeholder).toBe('Write your message…');
      expect(within(dialog()!).getByText('To *')).toBeTruthy();
      expect(within(dialog()!).getByText('Subject *')).toBeTruthy();
      expect(within(dialog()!).getByText('Message *')).toBeTruthy();
    });

    it('wants all three and says so, without sending anything', async () => {
      const user = userEvent.setup();
      const view = boot('admin');
      await waitFor(() => expect(part('compose')).not.toBeNull());
      await user.click(part('compose')!);
      await user.click(part('send')!);
      expect(await screen.findByText('To, subject and message are required')).toBeTruthy();
      await user.type(field('to'), 'a@b.test');
      await user.type(field('subject'), 'Hi');
      await user.click(part('send')!);
      expect(view.calls('/api/email/send')).toHaveLength(0);
      // (words made of spaces are no words)
      await user.type(field('composeBody'), '   ');
      await user.click(part('send')!);
      expect(view.calls('/api/email/send')).toHaveLength(0);
      expect(dialog()).not.toBeNull();
    });

    it('wants each of the three: with any one missing nothing is sent', async () => {
      const user = userEvent.setup();
      const view = boot('admin');
      await waitFor(() => expect(part('compose')).not.toBeNull());
      await user.click(part('compose')!);
      const fields: [string, string][] = [
        ['to', 'a@b.test'],
        ['subject', 'Hi'],
        ['composeBody', 'Hello'],
      ];
      for (const missing of fields) {
        for (const [name, value] of fields) {
          const input = field(name);
          await user.clear(input);
          if (name !== missing[0]) await user.type(input, value);
        }
        await user.click(part('send')!);
        expect(view.calls('/api/email/send')).toHaveLength(0);
        expect(dialog()).not.toBeNull();
      }
    });

    it('sends what was written, trimmed, with no conversation, and puts the sheet away with a message that it went', async () => {
      const user = userEvent.setup();
      const view = boot('admin');
      await waitFor(() => expect(part('compose')).not.toBeNull());
      await user.click(part('compose')!);
      await user.type(field('to'), '  ben@buyer.test ');
      await user.type(field('subject'), ' Price ');
      await user.type(field('composeBody'), ' Here it is. ');
      await user.click(part('send')!);
      await waitFor(() => expect(dialog()).toBeNull());
      expect(view.world.posted).toEqual([
        { to: 'ben@buyer.test', subject: 'Price', body: 'Here it is.' },
      ]);
      expect(await screen.findByText('Email sent successfully!')).toBeTruthy();
    });

    it('holds the button while it sends, and says so', async () => {
      const user = userEvent.setup();
      const gate = deferred<unknown>();
      const view = boot('admin', { wait: { send: gate.promise } });
      await waitFor(() => expect(part('compose')).not.toBeNull());
      await user.click(part('compose')!);
      await user.type(field('to'), 'a@b.test');
      await user.type(field('subject'), 'Hi');
      await user.type(field('composeBody'), 'Hello');
      const send = part('send') as HTMLButtonElement;
      await user.click(send);
      await waitFor(() => expect(send.disabled).toBe(true));
      expect(send.textContent).toBe('Sending…');
      await user.click(send);
      gate.resolve(null);
      await waitFor(() => expect(dialog()).toBeNull());
      expect(view.world.posted).toHaveLength(1);
    });

    it('keeps the sheet, and what was written in it, when the email could not be sent, and says why', async () => {
      const user = userEvent.setup();
      boot('admin', { no: { send: [500, 'Insufficient Permission'] } });
      await waitFor(() => expect(part('compose')).not.toBeNull());
      await user.click(part('compose')!);
      await user.type(field('to'), 'a@b.test');
      await user.type(field('subject'), 'Hi');
      await user.type(field('composeBody'), 'Hello');
      await user.click(part('send')!);
      expect(await screen.findByText('Failed to send: Insufficient Permission')).toBeTruthy();
      expect(dialog()).not.toBeNull();
      expect(field('composeBody').value).toBe('Hello');
      const send = part('send') as HTMLButtonElement;
      expect(send.disabled).toBe(false);
      expect(send.textContent).toBe('Send');
    });

    it('is put away by Cancel and by Escape, without sending anything', async () => {
      const user = userEvent.setup();
      const view = boot('admin');
      await waitFor(() => expect(part('compose')).not.toBeNull());
      await user.click(part('compose')!);
      await user.click(part('cancel')!);
      expect(dialog()).toBeNull();
      await user.click(part('compose')!);
      await user.keyboard('{Escape}');
      expect(dialog()).toBeNull();
      expect(view.calls('/api/email/send')).toHaveLength(0);
    });
  });

  describe('Reply and Forward', () => {
    async function opened(over: Partial<World> = {}, row = 0) {
      const user = userEvent.setup();
      const view = boot('admin', over);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[row]!);
      await waitFor(() => expect(part('message')).not.toBeNull());
      return { user, view };
    }

    it('opens a Reply to the sender’s address, under the subject with Re: in front of it', async () => {
      const { user } = await opened();
      await user.click(part('reply')!);
      expect(sheetTitle()).toBe('Reply');
      expect(field('to').value).toBe('ben@buyer.test');
      expect(field('subject').value).toBe('Re: Quote for the Hilux');
      expect(field('composeBody').value).toBe('');
    });

    it('does not put a second Re: in front of a subject that has one', async () => {
      const { user } = await opened({}, 1);
      await user.click(part('reply')!);
      expect(field('subject').value).toBe('Re: Service slot');
      expect(field('to').value).toBe('ana@motolinker.test');
    });

    it('sends the reply in the message’s conversation, naming the message it answers', async () => {
      const { user, view } = await opened();
      await user.click(part('reply')!);
      await user.type(field('composeBody'), 'It is 41,000.');
      await user.click(part('send')!);
      await waitFor(() => expect(dialog()).toBeNull());
      expect(view.world.posted).toEqual([
        {
          to: 'ben@buyer.test',
          subject: 'Re: Quote for the Hilux',
          body: 'It is 41,000.',
          threadId: 't1',
          inReplyTo: '<m1@buyer.test>',
        },
      ]);
    });

    it('sends a reply to a message that has no Message-ID without naming one', async () => {
      const { user, view } = await opened({}, 2);
      await user.click(part('reply')!);
      await user.type(field('composeBody'), 'Noted');
      await user.click(part('send')!);
      await waitFor(() => expect(dialog()).toBeNull());
      expect(view.world.posted[0]).toEqual({
        to: 'dee@dealer.test',
        subject: 'Re:',
        body: 'Noted',
        threadId: 't3',
      });
    });

    it('opens Forward as a new email to the sender, as the classic page does: no subject, nothing quoted, no conversation', async () => {
      const { user, view } = await opened();
      await user.click(part('forward')!);
      expect(sheetTitle()).toBe('New Email');
      expect(field('to').value).toBe('ben@buyer.test');
      expect(field('subject').value).toBe('');
      expect(field('composeBody').value).toBe('');
      await user.type(field('subject'), 'Fwd');
      await user.type(field('composeBody'), 'See below');
      await user.click(part('send')!);
      await waitFor(() => expect(dialog()).toBeNull());
      expect(view.world.posted).toEqual([
        { to: 'ben@buyer.test', subject: 'Fwd', body: 'See below' },
      ]);
    });
  });
});

describe('My Email, in the team’s portal', () => {
  it('shows no message under the inbox until a line is chosen, and tints the line that is open', async () => {
    const user = userEvent.setup();
    boot('team');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(part('message')).toBeNull();
    expect(rows().some(r => r.getAttribute('aria-current') === 'true')).toBe(false);
    await user.click(rows()[1]!);
    await waitFor(() => expect(part('message')).not.toBeNull());
    expect(rows().map(r => r.getAttribute('aria-current'))).toEqual([null, 'true', null]);
  });

  it('writes the message’s head: the subject over From, To and Date as the header came', async () => {
    const user = userEvent.setup();
    boot('team');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('bodyText')).not.toBeNull());
    expect(text('messageSubject')).toBe('Quote for the Hilux');
    expect(text('messageFrom')).toBe('From: Ben Buyer <ben@buyer.test>');
    expect(text('messageTo')).toBe('To: ana@motolinker.test');
    expect(text('messageDate')).toBe('Date: Wed, 28 Oct 2026 10:15:00 +0000');
  });

  it('shows the loader and an empty head while the message is on its way', async () => {
    const user = userEvent.setup();
    const gate = deferred<unknown>();
    boot('team', { wait: { 'message:m1': gate.promise } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('detailLoading')).not.toBeNull());
    expect(text('detailLoading')!.trim()).toBe('Loading…');
    expect(text('messageSubject')).toBe('');
    expect(part('messageFrom')).toBeNull();
    gate.resolve(null);
    await waitFor(() => expect(text('messageSubject')).toBe('Quote for the Hilux'));
  });

  it('takes the message away with Back, and the tint with it', async () => {
    const user = userEvent.setup();
    boot('team');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('back')).not.toBeNull());
    expect(text('back')!.trim()).toBe('Back');
    await user.click(part('back')!);
    expect(part('message')).toBeNull();
    expect(rows().some(r => r.getAttribute('aria-current') === 'true')).toBe(false);
  });

  it('moves from one message to the next without carrying what was typed under the first to the second’s sender', async () => {
    const user = userEvent.setup();
    boot('team');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('replyBox')).not.toBeNull());
    await user.type(part('replyBox')!, 'A private word for Ben');
    await user.click(rows()[1]!);
    await waitFor(() => expect(text('bodyText')).toBe('Friday at ten works.'));
    expect((part('replyBox') as HTMLTextAreaElement).value).toBe('');
  });

  describe('Reply', () => {
    async function opened(over: Partial<World> = {}, row = 0, permissions = ALL) {
      const user = userEvent.setup();
      const view = boot('team', over, permissions);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[row]!);
      await waitFor(() => expect(part('message')).not.toBeNull());
      return { user, view };
    }

    it('has a box under the message to answer it in', async () => {
      await opened();
      await waitFor(() => expect(part('replyBox')).not.toBeNull());
      expect(text('replyLabel')).toBe('Reply');
      expect((part('replyBox') as HTMLTextAreaElement).placeholder).toBe('Write your reply…');
      expect((part('replyBox') as HTMLTextAreaElement).rows).toBe(4);
      expect(text('send')!.trim()).toBe('Send Reply');
    });

    it('sends nothing, and says nothing, for a box with no words in it', async () => {
      const { user, view } = await opened();
      await waitFor(() => expect(part('send')).not.toBeNull());
      await user.click(part('send')!);
      await user.type(part('replyBox')!, '   ');
      await user.click(part('send')!);
      expect(view.calls(view.base + '/send')).toHaveLength(0);
    });

    it('sends a reply to whoever wrote the message, in its conversation, under its subject', async () => {
      const { user, view } = await opened();
      await waitFor(() => expect(part('replyBox')).not.toBeNull());
      await user.type(part('replyBox')!, '  It is 41,000.  ');
      await user.click(part('send')!);
      await waitFor(() => expect(view.world.posted).toHaveLength(1));
      expect(view.world.posted[0]).toEqual({
        to: 'Ben Buyer <ben@buyer.test>',
        subject: 'Re: Quote for the Hilux',
        body: 'It is 41,000.',
        threadId: 't1',
        inReplyTo: '<m1@buyer.test>',
      });
    });

    it('does not put a second Re: in front of a subject that has one (the classic page did)', async () => {
      const { user, view } = await opened({}, 1);
      await waitFor(() => expect(part('replyBox')).not.toBeNull());
      await user.type(part('replyBox')!, 'Thanks');
      await user.click(part('send')!);
      await waitFor(() => expect(view.world.posted).toHaveLength(1));
      expect(view.world.posted[0]!['subject']).toBe('Re: Service slot');
    });

    it('holds the button while it sends, then clears the box and says it went, for a moment', async () => {
      const user = userEvent.setup();
      const gate = deferred<unknown>();
      boot('team', { wait: { send: gate.promise } });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(part('replyBox')).not.toBeNull());
      await user.type(part('replyBox')!, 'Thanks');
      const send = part('send') as HTMLButtonElement;
      await user.click(send);
      await waitFor(() => expect(send.disabled).toBe(true));
      expect(send.textContent!.trim()).toBe('Sending…');
      gate.resolve(null);
      await waitFor(() => expect(send.textContent!.trim()).toBe('Sent!'));
      expect(send.disabled).toBe(false);
      expect((part('replyBox') as HTMLTextAreaElement).value).toBe('');
    });

    it('goes back to being “Send Reply” three seconds after it went', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      boot('team');
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(part('replyBox')).not.toBeNull());
      await user.type(part('replyBox')!, 'Thanks');
      await user.click(part('send')!);
      await waitFor(() => expect(text('send')!.trim()).toBe('Sent!'));
      act(() => {
        vi.advanceTimersByTime(2900);
      });
      expect(text('send')!.trim()).toBe('Sent!');
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(text('send')!.trim()).toBe('Send Reply');
    });

    it('counts the three seconds from the last send, not the first', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      boot('team');
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(part('replyBox')).not.toBeNull());
      await user.type(part('replyBox')!, 'One');
      await user.click(part('send')!);
      await waitFor(() => expect(text('send')!.trim()).toBe('Sent!'));
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      await user.type(part('replyBox')!, 'Two');
      await user.click(part('send')!);
      await waitFor(() => expect((part('replyBox') as HTMLTextAreaElement).value).toBe(''));
      // (3.5 seconds after the first, 1.5 after the second)
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(text('send')!.trim()).toBe('Sent!');
      act(() => {
        vi.advanceTimersByTime(1700);
      });
      expect(text('send')!.trim()).toBe('Send Reply');
    });

    it('keeps the words, and says why, when the reply could not be sent', async () => {
      const { user } = await opened({ no: { send: [500, 'Insufficient Permission'] } });
      await waitFor(() => expect(part('replyBox')).not.toBeNull());
      await user.type(part('replyBox')!, 'Thanks');
      await user.click(part('send')!);
      expect(await screen.findByText('Error: Insufficient Permission')).toBeTruthy();
      expect((part('replyBox') as HTMLTextAreaElement).value).toBe('Thanks');
      expect((part('send') as HTMLButtonElement).disabled).toBe(false);
      expect(text('send')!.trim()).toBe('Send Reply');
    });

    it('is not drawn for a message that could not be had: there is nothing to answer', async () => {
      await opened({ no: { 'message:m1': [500, 'Gmail said no'] } });
      await waitFor(() => expect(part('detailError')).not.toBeNull());
      expect(part('reply')).toBeNull();
      expect(part('replyBox')).toBeNull();
    });

    it('is not offered to a member who may read the mail and not send any', async () => {
      await opened({}, 0, {
        email: true,
        emailActions: { view: true, send: false, connect: true },
      });
      await waitFor(() => expect(part('bodyText')).not.toBeNull());
      expect(part('reply')).toBeNull();
      expect(part('replyBox')).toBeNull();
    });
  });
});

describe('what a member of the team may do with the account', () => {
  it('offers a member who may read the mail and may not link an account no way to link one', async () => {
    boot(
      'team',
      { status: UNLINKED },
      { email: true, emailActions: { view: true, send: true, connect: false } },
    );
    await waitFor(() => expect(part('connectCard')).not.toBeNull());
    expect(text('connectSub')).toBe(
      'No Google account is linked. Ask your admin to link one for you.',
    );
    expect(part('connectBtn')).toBeNull();
  });

  it('shows such a member the account that was linked, and no way to let go of it', async () => {
    boot('team', {}, { email: true, emailActions: { view: true, send: true, connect: false } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(text('accountName')).toBe('Ana A.');
    expect(part('disconnect')).toBeNull();
  });

  it('shows a member who may link an account both', async () => {
    boot('team', {}, ALL);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(part('disconnect')).not.toBeNull();
  });

  it('says that the mail is not switched on for a member whose status the server refused', async () => {
    boot('team', { no: { status: [403, 'Not permitted'] } });
    await waitFor(() => expect(part('connectCard')).not.toBeNull());
    expect(text('connectTitle')).toBe('My Email');
    expect(text('connectSub')).toBe('Gmail is not switched on for you. Ask your admin.');
    expect(part('connectBtn')).toBeNull();
  });
});

describe('a link made before sending was asked for', () => {
  const OLD = { ...LINKED, canSend: false };

  it('tells the administrator so, round the word that makes it again, which goes to Google', async () => {
    const user = userEvent.setup();
    boot('admin', { status: OLD });
    await waitFor(() => expect(part('reconnectNotice')).not.toBeNull());
    expect(text('reconnectNotice')).toBe(
      'This connection was authorised before sending was supported, so Compose and Reply will fail. Reconnect to fix it.',
    );
    expect(text('reconnect')).toBe('Reconnect');
    await user.click(part('reconnect')!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/email/connect?_t=adm-tok'));
  });

  it('tells a member of the team who may link an account, and goes to Google when asked', async () => {
    const user = userEvent.setup();
    boot('team', { status: OLD });
    await waitFor(() => expect(part('reconnectNotice')).not.toBeNull());
    expect(text('reconnectNotice')).toBe(
      'This connection was authorised before sending was supported, so replies will fail. Reconnect to fix it.',
    );
    await user.click(part('reconnect')!);
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('/api/employee/email/connect?_t=emp-tok'),
    );
  });

  it('tells a member who may not link an account to ask the admin, with no word to press', async () => {
    boot(
      'team',
      { status: OLD },
      { email: true, emailActions: { view: true, send: true, connect: false } },
    );
    await waitFor(() => expect(part('reconnectNotice')).not.toBeNull());
    expect(text('reconnectNotice')).toBe(
      'This connection was authorised before sending was supported, so replies will fail. Ask your admin to reconnect it.',
    );
    expect(part('reconnect')).toBeNull();
  });

  it('does not trouble a member who could not send anyway', async () => {
    boot(
      'team',
      { status: OLD },
      { email: true, emailActions: { view: true, send: false, connect: true } },
    );
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(part('reconnectNotice')).toBeNull();
  });

  it('says nothing of it when the link can send', async () => {
    boot('admin');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(part('reconnectNotice')).toBeNull();
  });

  it('leaves Compose and Reply where they were: they are told to fail, not taken away', async () => {
    boot('admin', { status: OLD });
    await waitFor(() => expect(part('compose')).not.toBeNull());
  });
});
