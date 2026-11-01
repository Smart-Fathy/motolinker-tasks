import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Icon } from '../../app/shell/icons';
import type { Me } from '../../lib/api';
import { clearChatReturn, takeChatReturn } from '../../lib/chat-return';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open, type Answer } from '../../test/session';
import { POLL_MS } from './data';

const A = { name: 'spaces/AAA1', title: 'Sales team', type: 'SPACE' };
const B = { name: 'spaces/BBB2', title: 'Direct message', type: 'DIRECT_MESSAGE' };
const C = { name: 'spaces/CCC3', title: 'Ops crew', type: 'GROUP_CHAT' };
const M1 = {
  id: 'spaces/AAA1/messages/m1',
  text: 'Quote sent',
  senderName: 'Ana A.',
  senderId: 'users/11',
  createTime: new Date(2026, 9, 20, 9, 5).toISOString(),
};
const M2 = {
  id: 'spaces/AAA1/messages/m2',
  text: 'Thanks, Ana',
  senderName: 'Bo B.',
  senderId: 'users/22',
  createTime: new Date(2026, 9, 20, 13, 30).toISOString(),
};
const M3 = {
  id: 'spaces/AAA1/messages/m3',
  text: 'A card',
  senderName: '',
  senderId: '',
  createTime: 'not a time',
};
const ALL_CAPS = { spaces: true, read: true, send: true };
const LINKED = {
  configured: true,
  connected: true,
  email: 'ana@motolinker.test',
  name: 'Ana A.',
  caps: ALL_CAPS,
};
const UNLINKED = { configured: true, connected: false };
const ALL = { gchat: true, gchatActions: { view: true, send: true } };

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
  clearChatReturn();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

interface World {
  status: unknown;
  spaces: unknown;
  /** what each space says to GET …/messages, by its address */
  messages: Record<string, unknown>;
  /** a call that is answered with an error: path suffix → [status, words] */
  no?: Record<string, [number, string]>;
  /** a call that waits until the test lets it go */
  wait?: Record<string, Promise<unknown>>;
  /** what a send answers */
  sent?: unknown;
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
    spaces: { spaces: [A, B, C] },
    messages: {
      [A.name]: { messages: [M1, M2] },
      [B.name]: { messages: [] },
      [C.name]: { messages: [M2] },
    },
    posted: [],
    ...over,
  };
  const base = portal === 'admin' ? '/api/dashboard/gchat' : '/api/employee/gchat';
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
    [base + '/spaces']: gate('spaces', () => w.spaces),
    [base + '/messages']: async init => {
      w.posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return gate('send', () => w.sent ?? { ok: true, id: 'spaces/AAA1/messages/new1' })(init);
    },
    '/api/employee/check': () => json(200, { ok: true }),
  };
  for (const space of [A, B, C, { name: 'spaces/ZZZ9' }]) {
    more[`${base}/messages?space=${encodeURIComponent(space.name)}`] = gate(
      'messages:' + space.name,
      () => w.messages[space.name] ?? { messages: [] },
    );
  }
  const me =
    as ??
    (portal === 'admin' ? adminMe({ gchat: true }) : teamMe(permissions, 'Sales', { gchat: true }));
  return { ...open(portal, me, { entries: ['/gchat'], more }), world: w, base };
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part=${name}]`);
const parts = (name: string) => [...document.querySelectorAll<HTMLElement>(`[data-part=${name}]`)];
const text = (name: string) => part(name)?.textContent ?? null;
const rows = () => parts('spaceRow');
const input = () => part('chatInput') as HTMLTextAreaElement;
const pane = () => part('chatLayout')!.getAttribute('data-pane');
const word = (portal: string, a: string, t: string) => (portal === 'admin' ? a : t);

describe.each(['admin', 'team'] as const)('Google Chat, in the %s portal', portal => {
  describe('before there is a conversation', () => {
    it('shows the list with its loader, and the placeholder, until it knows whose Chat it is', async () => {
      const gate = deferred<unknown>();
      boot(portal, { wait: { status: gate.promise } });
      await waitFor(() => expect(part('listLoading')).not.toBeNull());
      expect(part('chatRoomList')!.contains(part('listLoading'))).toBe(true);
      expect(part('listLoading')!.textContent).toBe('');
      expect(part('listLoading')!.querySelector('[data-part=spinner]')).not.toBeNull();
      expect(text('placeholder')).toBe('Select a space');
      expect(part('stateCard')).toBeNull();
      // (a phone shows the list, with its loader, and not the placeholder)
      expect(pane()).toBe('list');
      gate.resolve(null);
      await waitFor(() => expect(part('listLoading')).toBeNull());
    });

    it('always has its head: the name, and a Refresh', async () => {
      boot(portal, { status: { configured: false } });
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('chatRoomsTitle')).toBe('Google Chat');
      expect(part('chatRefresh')!.getAttribute('title')).toBe('Refresh');
      expect(part('chatRefresh')!.querySelector('svg')).not.toBeNull();
    });

    it('says that Chat is not set up here, and names the variable, with no way out of it', async () => {
      boot(portal, { status: { configured: false } });
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateTitle')).toBe('Google Chat is not set up');
      expect(text('stateBody')).toBe(
        'Ask an administrator to enable it (GOOGLE_CHAT_ENABLED=1). Google Chat requires a Google Workspace account.',
      );
      expect(part('stateBody')!.querySelector('code')!.textContent).toBe('GOOGLE_CHAT_ENABLED=1');
      expect(part('stateBtn')).toBeNull();
      // (the list has nothing in it, and a phone shows the card)
      expect(part('chatRoomList')!.childElementCount).toBe(0);
      expect(pane()).toBe('main');
    });

    it('offers to link an account when there is none, and goes to Google when asked', async () => {
      const user = userEvent.setup();
      const view = boot(portal, { status: UNLINKED });
      await waitFor(() => expect(part('stateBtn')).not.toBeNull());
      expect(text('stateTitle')).toBe('Connect Google Chat');
      expect(text('stateBody')).toBe(
        'See your spaces and messages here, and reply without leaving the app.',
      );
      expect(text('stateBtn')).toBe('Connect Google Chat');
      expect(part('chatRoomList')!.childElementCount).toBe(0);
      // (there is no account to ask the spaces of)
      expect(view.calls(`/api/${word(portal, 'dashboard', 'employee')}/gchat/spaces`)).toHaveLength(
        0,
      );
      await user.click(part('stateBtn')!);
      await waitFor(() => expect(assign).toHaveBeenCalled());
      expect(assign).toHaveBeenCalledExactlyOnceWith(
        word(
          portal,
          '/api/dashboard/gchat/connect?_t=adm-tok',
          '/api/employee/gchat/connect?_t=emp-tok',
        ),
      );
      // (the team's page asks whether the session is still good before it leaves; the administrator's does not)
      expect(view.calls('/api/employee/check')).toHaveLength(portal === 'admin' ? 0 : 1);
    });

    it('says a link Google no longer honours needs making again, and goes to Google when asked', async () => {
      const user = userEvent.setup();
      boot(portal, {
        status: {
          configured: true,
          connected: false,
          reconnect: true,
          email: 'ana@motolinker.test',
        },
      });
      await waitFor(() => expect(part('stateBtn')).not.toBeNull());
      expect(text('stateTitle')).toBe('Reconnect Google Chat');
      expect(text('stateBody')).toBe(
        'Your Google session expired. Unverified apps in testing mode lose access every 7 days.',
      );
      expect(text('stateBtn')).toBe('Reconnect');
      await user.click(part('stateBtn')!);
      await waitFor(() => expect(assign).toHaveBeenCalled());
    });

    it('tells a member who has the screen without the right to see it that it is not switched on for them', async () => {
      boot(portal, { no: { status: [403, 'Not permitted'] } });
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateTitle')).toBe('Google Chat');
      expect(text('stateBody')).toBe('Google Chat is not switched on for you. Ask your admin.');
      expect(part('stateBtn')).toBeNull();
    });

    it('says why the status could not be had, in the server’s words, when it could not', async () => {
      boot(portal, { no: { status: [500, 'The database is down'] } });
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateTitle')).toBe('Google Chat unavailable');
      expect(text('stateBody')).toBe('The database is down');
    });

    it('does not take a status it does not know for one', async () => {
      boot(portal, { status: { configured: 'maybe' } });
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateTitle')).toBe('Google Chat unavailable');
      expect(text('stateBody')).toBe('Google Chat came back in a form this app does not know.');
    });
  });

  describe('sent back from Google’s consent screen', () => {
    const returned = (query: string) =>
      takeChatReturn({
        location: { href: `https://app.example.com/dashboard${query}#gchat` },
        history: { state: null, replaceState: () => undefined },
      });

    it('says why the account would not link, in place of everything else, and offers to try again', async () => {
      const user = userEvent.setup();
      returned('?gchat_error=Bad%20Request');
      boot(portal);
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateTitle')).toBe("Couldn't connect Google Chat");
      expect(text('stateBody')).toBe('Bad Request');
      expect(text('stateBtn')).toBe('Try again');
      expect(part('chatRoomList')!.childElementCount).toBe(0);
      await user.click(part('stateBtn')!);
      await waitFor(() => expect(assign).toHaveBeenCalled());
    });

    it('does not ask for the spaces while it says so', async () => {
      returned('?gchat_error=Bad%20Request');
      const view = boot(portal);
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      await new Promise(r => setTimeout(r, 50));
      expect(
        view.calls((portal === 'admin' ? '/api/dashboard' : '/api/employee') + '/gchat/spaces'),
      ).toHaveLength(0);
    });

    it('says it once: the next visit is an ordinary one', async () => {
      returned('?gchat_error=Bad%20Request');
      boot(portal);
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      cleanup();
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(part('stateCard')).toBeNull();
    });

    it('is put away by Refresh, which starts the page over', async () => {
      const user = userEvent.setup();
      returned('?gchat_error=Bad%20Request');
      boot(portal);
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      await user.click(part('chatRefresh')!);
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(part('stateCard')).toBeNull();
    });
  });

  describe('the spaces', () => {
    it('are a row for each: a circle with its initials, its name, and what kind it is', async () => {
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(parts('spaceName').map(e => e.textContent)).toEqual([
        'Sales team',
        'Direct message',
        'Ops crew',
      ]);
      expect(parts('spaceAvatar').map(e => e.textContent)).toEqual(['ST', 'DM', 'OC']);
      // (a row is a button a keyboard can reach)
      expect(rows().map(r => [r.getAttribute('role'), r.getAttribute('tabindex')])).toEqual([
        ['button', '0'],
        ['button', '0'],
        ['button', '0'],
      ]);
      expect(parts('spacePreview').map(e => e.textContent)).toEqual([
        'Space',
        'Direct message',
        'Space',
      ]);
      // (only a space of people has the square-cornered circle)
      expect(parts('spaceAvatar').map(e => e.className.includes('avatarGroup'))).toEqual([
        true,
        false,
        false,
      ]);
      expect(part('listLoading')).toBeNull();
      expect(text('placeholder')).toBe('Select a space');
      expect(pane()).toBe('list');
    });

    it('have their own loader while they are asked for, and the placeholder beside it', async () => {
      const gate = deferred<unknown>();
      const view = boot(portal, { wait: { spaces: gate.promise } });
      // (the status has come, and the spaces are on their way)
      await waitFor(() =>
        expect(
          view.calls(`/api/${word(portal, 'dashboard', 'employee')}/gchat/spaces`),
        ).toHaveLength(1),
      );
      expect(part('listLoading')).not.toBeNull();
      expect(rows()).toHaveLength(0);
      expect(text('placeholder')).toBe('Select a space');
      // (a phone shows the list, with its loader)
      expect(pane()).toBe('list');
      gate.resolve(null);
      await waitFor(() => expect(rows()).toHaveLength(3));
    });

    it('are pressed with Enter or Space from the keyboard, which then does nothing else (the page does not scroll)', async () => {
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      // (fireEvent says false when the event's default was taken)
      expect(fireEvent.keyDown(rows()[0]!, { key: ' ' })).toBe(false);
      await waitFor(() => expect(text('chatName')).toBe('Sales team'));
      expect(fireEvent.keyDown(rows()[1]!, { key: 'Enter' })).toBe(false);
      await waitFor(() => expect(text('chatName')).toBe('Direct message'));
      // (any other key is left alone)
      expect(fireEvent.keyDown(rows()[2]!, { key: 'a' })).toBe(true);
      expect(text('chatName')).toBe('Direct message');
    });

    it('can have two of one name (every conversation of two is called "Direct message"), each its own row', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const one = { name: 'spaces/DM01', title: 'Direct message', type: 'DIRECT_MESSAGE' };
      const two = { name: 'spaces/DM02', title: 'Direct message', type: 'DIRECT_MESSAGE' };
      boot(portal, { spaces: { spaces: [one, two] } });
      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(parts('spaceName').map(e => e.textContent)).toEqual([
        'Direct message',
        'Direct message',
      ]);
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    });

    it('say there are none yet, and why', async () => {
      boot(portal, { spaces: { spaces: [] } });
      await waitFor(() => expect(part('noSpaces')).not.toBeNull());
      expect(part('noSpaces')!.textContent).toBe(
        'No spaces yet.Group chats and DMs only appear here once they have at least one message.',
      );
      expect(part('noSpaces')!.querySelector('br')).not.toBeNull();
      expect(text('placeholder')).toBe('Select a space');
      // (a phone shows the list, which is where it says so)
      expect(pane()).toBe('list');
    });

    it('say Chat is not available for the organization when Google says no', async () => {
      boot(portal, { spaces: { spaces: [], error: 'forbidden', detail: 'API not enabled' } });
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateTitle')).toBe('Google Chat unavailable');
      expect(text('stateBody')).toBe(
        "Google Chat isn't available for your organization. A Workspace admin needs to allow this app.",
      );
      expect(part('stateBtn')).toBeNull();
      expect(part('chatRoomList')!.childElementCount).toBe(0);
    });

    it('say the Google session has expired, and offer to make it again', async () => {
      const user = userEvent.setup();
      boot(portal, { spaces: { spaces: [], error: 'reconnect' } });
      await waitFor(() => expect(part('stateBtn')).not.toBeNull());
      expect(text('stateBody')).toBe('Your Google session expired.');
      expect(text('stateBtn')).toBe('Reconnect');
      await user.click(part('stateBtn')!);
      await waitFor(() => expect(assign).toHaveBeenCalled());
    });

    it('say Chat could not be reached for anything else, and offer nothing', async () => {
      boot(portal, { spaces: { spaces: [], error: 'failed', detail: 'Backend Error' } });
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateBody')).toBe('Could not reach Google Chat.');
      expect(part('stateBtn')).toBeNull();
    });

    it('say so too when the server itself could not be reached', async () => {
      boot(portal, { no: { spaces: [500, 'boom'] } });
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateBody')).toBe('Could not reach Google Chat.');
    });
  });

  describe('a space opened', () => {
    it('shows its name, its messages oldest first, and the box to write in; the row is marked as the open one', async () => {
      const user = userEvent.setup();
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      expect(text('chatName')).toBe('Sales team');
      expect(parts('msgBubble').map(e => e.textContent)).toEqual(['Quote sent', 'Thanks, Ana']);
      expect(rows()[0]!.getAttribute('aria-current')).toBe('true');
      expect(rows()[1]!.getAttribute('aria-current')).toBeNull();
      expect(rows()[0]!.className).toContain('rowActive');
      expect(rows()[1]!.className).not.toContain('rowActive');
      expect(part('placeholder')).toBeNull();
      expect(part('chatComposer')).not.toBeNull();
      expect(pane()).toBe('main');
    });

    it('marks a message the person’s own by the name Google gave their link, and names the others’ writers', async () => {
      const user = userEvent.setup();
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      const [mine, theirs] = parts('msg');
      expect(mine!.className).toContain('mine');
      expect(mine!.querySelector('[data-part=msgSender]')).toBeNull();
      expect(theirs!.className).toContain('theirs');
      expect(theirs!.querySelector('[data-part=msgSender]')!.textContent).toBe('Bo B.');
    });

    it('keeps two messages that were written in the same minute (and the same second) apart, each its own line', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const user = userEvent.setup();
      const twin = { ...M1, id: 'spaces/AAA1/messages/m1b', text: 'Same time' };
      boot(portal, { messages: { [A.name]: { messages: [M1, twin] } } });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      expect(parts('msgBubble').map(e => e.textContent)).toEqual(['Quote sent', 'Same time']);
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key/);
    });

    it('writes the time of a message the 24-hour way, and says Unknown of a writer Chat did not name', async () => {
      const user = userEvent.setup();
      boot(portal, { messages: { [A.name]: { messages: [M1, M2, M3] } } });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(3));
      expect(parts('msgTime').map(e => e.textContent)).toEqual(['09:05', '13:30', '']);
      expect(parts('msg')[2]!.querySelector('[data-part=msgSender]')!.textContent).toBe('Unknown');
    });

    it('shows a message as it was written, with its lines, and not as markup', async () => {
      const user = userEvent.setup();
      const words = 'Line one\nLine two <b>not bold</b>';
      boot(portal, { messages: { [A.name]: { messages: [{ ...M2, text: words }] } } });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(1));
      expect(text('msgBubble')).toBe(words);
      expect(part('msgBubble')!.querySelector('b')).toBeNull();
    });

    it('has the loader in the place of the messages while they are asked for', async () => {
      const user = userEvent.setup();
      const gate = deferred<unknown>();
      boot(portal, { wait: { ['messages:' + A.name]: gate.promise } });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(part('messagesLoading')).not.toBeNull());
      expect(part('chatMessages')!.contains(part('messagesLoading'))).toBe(true);
      expect(text('chatName')).toBe('Sales team');
      expect(part('chatComposer')).not.toBeNull();
      gate.resolve(null);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
    });

    it('says a space has no messages yet', async () => {
      const user = userEvent.setup();
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[1]!);
      await waitFor(() => expect(part('noMessages')).not.toBeNull());
      expect(text('noMessages')).toBe('No messages in this space yet.');
      expect(parts('msg')).toHaveLength(0);
    });

    it('says why the messages could not be had, in Google’s words where it gave some', async () => {
      const user = userEvent.setup();
      boot(portal, {
        messages: {
          [A.name]: {
            messages: [],
            error: 'forbidden',
            detail: 'The caller does not have permission',
          },
        },
      });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateTitle')).toBe('Could not load messages');
      expect(text('stateBody')).toBe('The caller does not have permission');
      expect(part('stateBtn')).toBeNull();
    });

    it('…and in its own where Google gave none (the classic pages showed a bare code)', async () => {
      const user = userEvent.setup();
      boot(portal, { messages: { [A.name]: { messages: [], error: 'failed' } } });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateBody')).toBe('Could not reach Google Chat.');
    });

    it('offers to make the link again where the messages cannot be had because it has gone', async () => {
      const user = userEvent.setup();
      boot(portal, { messages: { [A.name]: { messages: [], error: 'reconnect' } } });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(part('stateBtn')).not.toBeNull());
      expect(text('stateBody')).toBe('Your Google session expired.');
      expect(text('stateBtn')).toBe('Reconnect');
      await user.click(part('stateBtn')!);
      await waitFor(() => expect(assign).toHaveBeenCalled());
    });

    it('does not ask for the messages of a link that may not read them, and says so, and offers to grant it', async () => {
      const user = userEvent.setup();
      const view = boot(portal, {
        status: { ...LINKED, caps: { spaces: true, read: false, send: true } },
      });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(text('stateTitle')).toBe('Message history not shared');
      expect(text('stateBody')).toBe(
        "You didn't grant permission to read messages. You can still send.",
      );
      expect(text('stateBtn')).toBe('Grant read access');
      expect(part('chatComposer')!.querySelector('textarea')).not.toBeNull();
      const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
      expect(view.calls(`${base}/gchat/messages?space=${encodeURIComponent(A.name)}`)).toHaveLength(
        0,
      );
      await user.click(part('stateBtn')!);
      await waitFor(() => expect(assign).toHaveBeenCalled());
    });

    it('opens another space with its own messages, its own name, and an empty box', async () => {
      const user = userEvent.setup();
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      await user.type(input(), 'half a thought');
      await user.click(rows()[2]!);
      await waitFor(() => expect(text('chatName')).toBe('Ops crew'));
      await waitFor(() => expect(parts('msg')).toHaveLength(1));
      expect(input().value).toBe('');
      expect(rows()[2]!.getAttribute('aria-current')).toBe('true');
      expect(rows()[0]!.getAttribute('aria-current')).toBeNull();
    });

    it('opens from the keyboard, with Enter or Space', async () => {
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      fireEvent.keyDown(rows()[1]!, { key: 'Enter' });
      await waitFor(() => expect(text('chatName')).toBe('Direct message'));
      fireEvent.keyDown(rows()[2]!, { key: ' ' });
      await waitFor(() => expect(text('chatName')).toBe('Ops crew'));
      fireEvent.keyDown(rows()[0]!, { key: 'a' });
      expect(text('chatName')).toBe('Ops crew');
    });

    it('goes back to the list on a phone, and shows the placeholder there again', async () => {
      const user = userEvent.setup();
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(pane()).toBe('list');
      await user.click(rows()[0]!);
      await waitFor(() => expect(pane()).toBe('main'));
      await user.click(part('chatBack')!);
      expect(pane()).toBe('list');
      expect(text('placeholder')).toBe('Select a space');
      expect(parts('msg')).toHaveLength(0);
      expect(rows()[0]!.getAttribute('aria-current')).toBeNull();
    });
  });

  describe('writing', () => {
    const opened = async (
      over: Partial<World> = {},
      permissions: Record<string, unknown> = ALL,
    ) => {
      const user = userEvent.setup();
      const view = boot(portal, over, permissions);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      return { user, view };
    };

    it('has a box named for the space, and a button to send with', async () => {
      await opened();
      expect(input().getAttribute('placeholder')).toBe('Message Sales team… (sent as you)');
      expect(input().getAttribute('rows')).toBe('1');
      expect(part('sendBtn')!.getAttribute('title')).toBe('Send');
      expect(part('sendBtn')!.querySelector('svg')).not.toBeNull();
    });

    it('sends what is written when Enter is pressed, to the space that is open, and empties the box once Chat took it', async () => {
      const { user, view } = await opened();
      await user.type(input(), 'On my way');
      await user.keyboard('{Enter}');
      await waitFor(() =>
        expect(view.world.posted).toEqual([{ space: 'spaces/AAA1', text: 'On my way' }]),
      );
      await waitFor(() => expect(input().value).toBe(''));
    });

    it('sends with the button too, with the words trimmed', async () => {
      const { user, view } = await opened();
      await user.type(input(), '  Hello there  ');
      await user.click(part('sendBtn')!);
      await waitFor(() =>
        expect(view.world.posted).toEqual([{ space: 'spaces/AAA1', text: 'Hello there' }]),
      );
    });

    it('asks for the messages again once a message has gone, so that it is among them', async () => {
      const { user, view } = await opened();
      const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
      const path = `${base}/gchat/messages?space=${encodeURIComponent(A.name)}`;
      expect(view.calls(path)).toHaveLength(1);
      await user.type(input(), 'One more');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(view.calls(path)).toHaveLength(2));
    });

    it('breaks the line on Shift+Enter, and sends nothing', async () => {
      const { user, view } = await opened();
      await user.type(input(), 'one');
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      await user.type(input(), 'two');
      expect(input().value).toBe('one\ntwo');
      expect(view.world.posted).toEqual([]);
    });

    it('does not send on an Enter that finishes a word being composed', async () => {
      const { user, view } = await opened();
      await user.type(input(), 'ni');
      fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
      expect(view.world.posted).toEqual([]);
      expect(input().value).toBe('ni');
    });

    it('sends nothing for words that are only blanks', async () => {
      const { user, view } = await opened();
      await user.type(input(), '   ');
      await user.keyboard('{Enter}');
      await user.click(part('sendBtn')!);
      expect(view.world.posted).toEqual([]);
    });

    it('keeps the words when Chat says no, and says why at the foot of the screen', async () => {
      const { user, view } = await opened({
        sent: {
          ok: false,
          error: 'forbidden',
          detail: 'Request had insufficient authentication scopes.',
        },
      });
      await user.type(input(), 'Will this go?');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(view.world.posted).toHaveLength(1));
      await waitFor(() =>
        expect(
          screen.getByText('Could not send: Request had insufficient authentication scopes.'),
        ).toBeTruthy(),
      );
      expect(input().value).toBe('Will this go?');
      expect(part('sendBtn')!.hasAttribute('disabled')).toBe(false);
    });

    it('says in words what the route’s own refusals mean', async () => {
      const { user } = await opened({ no: { send: [400, 'empty'] } });
      await user.type(input(), 'x');
      await user.keyboard('{Enter}');
      await waitFor(() =>
        expect(screen.getByText('Could not send: There is nothing to send.')).toBeTruthy(),
      );
    });

    it('holds the button while the message goes, and sends it once however often Enter is pressed', async () => {
      const gate = deferred<unknown>();
      const { user, view } = await opened({ wait: { send: gate.promise } });
      await user.type(input(), 'Once');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(part('sendBtn')!.hasAttribute('disabled')).toBe(true));
      await user.keyboard('{Enter}{Enter}');
      await user.click(part('sendBtn')!);
      expect(view.world.posted).toHaveLength(1);
      gate.resolve(null);
      await waitFor(() => expect(part('sendBtn')!.hasAttribute('disabled')).toBe(false));
      expect(input().value).toBe('');
    });

    it('says a line, and no box, where the link was not granted the right to send, and offers to make it again', async () => {
      const user = userEvent.setup();
      boot(portal, { status: { ...LINKED, caps: { spaces: true, read: true, send: false } } });
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      expect(part('chatInput')).toBeNull();
      expect(part('sendBtn')).toBeNull();
      expect(text('chatComposer')).toBe(
        "Read-only — you didn't grant permission to send. Reconnect",
      );
      // (a link that acts as a button, which goes to Google and nowhere else: the page does not jump to its own top)
      expect(part('readOnlyLink')!.getAttribute('role')).toBe('button');
      expect(fireEvent.click(part('readOnlyLink')!)).toBe(false);
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    });
  });

  describe('keeping up', () => {
    it('asks the open space for its messages again every twenty seconds, and shows what is new', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const view = boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      view.world.messages[A.name] = {
        messages: [M1, M2, { ...M2, id: 'spaces/AAA1/messages/m9', text: 'Fresh news' }],
      };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS + 200);
      });
      await waitFor(() => expect(parts('msg')).toHaveLength(3));
      expect(parts('msgBubble')[2]!.textContent).toBe('Fresh news');
    });

    it('does not show the conversation’s loader again for a poll', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const gate = deferred<unknown>();
      const view = boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      view.world.wait = { ['messages:' + A.name]: gate.promise };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS + 200);
      });
      expect(part('messagesLoading')).toBeNull();
      expect(parts('msg')).toHaveLength(2);
      gate.resolve(null);
    });

    it('stops asking when the space is closed', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const view = boot(portal);
      const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
      const path = `${base}/gchat/messages?space=${encodeURIComponent(A.name)}`;
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      await user.click(part('chatBack')!);
      const before = view.calls(path).length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS * 3);
      });
      expect(view.calls(path)).toHaveLength(before);
    });
  });

  describe('the foot of the conversation', () => {
    // jsdom lays nothing out: a box that is 500 high of which 200 shows, and a scroll position the test can read
    const positions = new WeakMap<Element, number>();
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(500);
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
      vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return positions.get(this) ?? 0;
      });
      vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (
        this: HTMLElement,
        v: number,
      ) {
        positions.set(this, v);
      });
    });

    it('is in view when the conversation opens', async () => {
      const user = userEvent.setup();
      boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      expect(positions.get(part('chatMessages')!)).toBe(500);
    });

    it('is not taken from a reader who has scrolled up, when something new comes', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const view = boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      positions.set(part('chatMessages')!, 20);
      fireEvent.scroll(part('chatMessages')!);
      view.world.messages[A.name] = {
        messages: [M1, M2, { ...M2, id: 'spaces/AAA1/messages/m9', text: 'New' }],
      };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS + 200);
      });
      await waitFor(() => expect(parts('msg')).toHaveLength(3));
      expect(positions.get(part('chatMessages')!)).toBe(20);
    });

    it('follows a reader who is at it, when something new comes', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const view = boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      // (300 down in a box 500 high of which 200 shows: the foot is in view)
      positions.set(part('chatMessages')!, 300);
      fireEvent.scroll(part('chatMessages')!);
      positions.set(part('chatMessages')!, 280);
      view.world.messages[A.name] = {
        messages: [M1, M2, { ...M2, id: 'spaces/AAA1/messages/m9', text: 'New' }],
      };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS + 200);
      });
      await waitFor(() => expect(parts('msg')).toHaveLength(3));
      expect(positions.get(part('chatMessages')!)).toBe(500);
    });

    it.each([
      [221, 500, 'is followed when the reader is 79 pixels from it'],
      [220, 220, 'is not followed when the reader is 80 pixels from it (they have left it)'],
    ])('the foot %#: %s', async (from, ends) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const view = boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      // (500 high of which 200 shows: the foot is at 300)
      positions.set(part('chatMessages')!, from);
      fireEvent.scroll(part('chatMessages')!);
      view.world.messages[A.name] = {
        messages: [M1, M2, { ...M2, id: 'spaces/AAA1/messages/m9', text: 'New' }],
      };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS + 200);
      });
      await waitFor(() => expect(parts('msg')).toHaveLength(3));
      expect(positions.get(part('chatMessages')!)).toBe(ends);
    });

    it('is taken to after the reader sends, wherever they had scrolled to', async () => {
      const user = userEvent.setup();
      const view = boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      positions.set(part('chatMessages')!, 10);
      fireEvent.scroll(part('chatMessages')!);
      view.world.messages[A.name] = {
        messages: [M1, M2, { ...M1, id: 'spaces/AAA1/messages/m10', text: 'Mine' }],
      };
      await user.type(input(), 'Mine');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(parts('msg')).toHaveLength(3));
      expect(positions.get(part('chatMessages')!)).toBe(500);
    });
  });

  describe('Refresh', () => {
    it('asks the spaces and the open conversation again, with the loaders first', async () => {
      const user = userEvent.setup();
      const view = boot(portal);
      const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      const spaces = deferred<unknown>();
      const messages = deferred<unknown>();
      view.world.wait = { spaces: spaces.promise, ['messages:' + A.name]: messages.promise };
      await user.click(part('chatRefresh')!);
      await waitFor(() => expect(part('listLoading')).not.toBeNull());
      await waitFor(() => expect(part('messagesLoading')).not.toBeNull());
      expect(rows()).toHaveLength(0);
      // (the conversation stays open, with its name and its box)
      expect(text('chatName')).toBe('Sales team');
      // (a phone keeps the conversation on show while the list is asked for again)
      expect(pane()).toBe('main');
      spaces.resolve(null);
      messages.resolve(null);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      expect(rows()[0]!.getAttribute('aria-current')).toBe('true');
      expect(view.calls(`${base}/gchat/spaces`)).toHaveLength(2);
      expect(view.calls(`${base}/gchat/status`)).toHaveLength(1);
    });

    it('shows the list, and not the empty main pane, when the spaces that come back are none (a phone is not left on "Select a space", which has no way back)', async () => {
      const user = userEvent.setup();
      const view = boot(portal);
      await waitFor(() => expect(rows()).toHaveLength(3));
      await user.click(rows()[0]!);
      await waitFor(() => expect(parts('msg')).toHaveLength(2));
      expect(pane()).toBe('main');
      view.world.spaces = { spaces: [] };
      await user.click(part('chatRefresh')!);
      await waitFor(() => expect(part('noSpaces')).not.toBeNull());
      expect(text('placeholder')).toBe('Select a space');
      expect(pane()).toBe('list');
    });

    it('asks whose account it is again when there is none to ask the spaces with', async () => {
      const user = userEvent.setup();
      const view = boot(portal, { status: UNLINKED });
      const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
      await waitFor(() => expect(part('stateBtn')).not.toBeNull());
      view.world.status = LINKED;
      await user.click(part('chatRefresh')!);
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(part('stateCard')).toBeNull();
      expect(view.calls(`${base}/gchat/status`)).toHaveLength(2);
    });
  });
});

describe('Google Chat, and who may write in it', () => {
  it('lets the administrator write wherever the link reaches as far as sending', async () => {
    const user = userEvent.setup();
    boot('admin');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(parts('msg')).toHaveLength(2));
    expect(part('chatInput')).not.toBeNull();
  });

  it('lets a member write where they hold the right and the link reaches as far as sending', async () => {
    const user = userEvent.setup();
    boot('team');
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(parts('msg')).toHaveLength(2));
    expect(part('chatInput')).not.toBeNull();
  });

  it('says the admin has not granted sending, to a member who may read and may not send, whatever the link reaches', async () => {
    const user = userEvent.setup();
    boot('team', {}, { gchat: true, gchatActions: { view: true, send: false } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(parts('msg')).toHaveLength(2));
    expect(part('chatInput')).toBeNull();
    expect(text('chatComposer')).toBe('Read-only — your admin has not granted sending.');
    expect(part('readOnlyLink')).toBeNull();
  });
});

describe.each(['admin', 'team'] as const)('Google Chat, in the %s portal: its pictures', portal => {
  /** what the app draws for a picture of this name (the strokes: their size and colour are the screen's own) */
  const drawing = (name: string) => {
    const { container, unmount } = render(<Icon name={name} />);
    const strokes = container.querySelector('svg')?.innerHTML ?? '';
    unmount();
    return strokes;
  };
  const drawn = (root: Element | null) => root?.querySelector('svg')?.innerHTML ?? '';

  it.each([
    ['Chat is not set up', { status: { configured: false } }, undefined, 'plug'],
    ['there is no account', { status: UNLINKED }, undefined, 'message-square'],
    [
      'the link was lost',
      { status: { configured: true, connected: false, reconnect: true } },
      undefined,
      'rotate-ccw',
    ],
    ['a member may not see Chat', { no: { status: [403, 'Not permitted'] } }, undefined, 'plug'],
    [
      'the status cannot be had',
      { no: { status: [500, 'The database is down'] } },
      undefined,
      'alert-circle',
    ],
    [
      'Chat will not list the spaces',
      { spaces: { spaces: [], error: 'failed' } },
      undefined,
      'alert-circle',
    ],
    ['Google sent the person back with a reason', {}, '?gchat_error=Nope', 'alert-triangle'],
  ] as [string, Partial<Parameters<typeof boot>[1]>, string | undefined, string][])(
    'draws its own picture when %s',
    async (_when, over, back, picture) => {
      if (back)
        takeChatReturn({
          location: { href: `https://app.example.com/dashboard${back}#gchat` },
          history: { state: null, replaceState: () => undefined },
        });
      boot(portal, over);
      await waitFor(() => expect(part('stateCard')).not.toBeNull());
      expect(drawing(picture)).not.toBe('');
      expect(drawn(part('stateCard'))).toBe(drawing(picture));
    },
  );

  it('draws the placeholder, the refresh button, the send button and the way back with their own pictures', async () => {
    const user = userEvent.setup();
    boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(drawn(part('placeholder'))).toBe(drawing('message-square'));
    expect(drawn(part('chatRefresh'))).toBe(drawing('refresh-cw'));
    await user.click(rows()[0]!);
    await waitFor(() => expect(parts('msg')).toHaveLength(2));
    expect(drawn(part('sendBtn'))).toBe(drawing('send'));
    expect(drawn(part('chatBack'))).toBe(drawing('arrow-left'));
  });

  it('names its way back, as it names its send button, for those who cannot see the picture', async () => {
    const user = userEvent.setup();
    boot(portal);
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(parts('msg')).toHaveLength(2));
    expect(part('chatBack')!.getAttribute('aria-label')).toBe('Back');
    expect(part('sendBtn')!.getAttribute('aria-label')).toBe('Send');
    expect(part('sendBtn')!.getAttribute('title')).toBe('Send');
  });

  it('draws its own picture when the messages could not be had, and when the link may not read them', async () => {
    const user = userEvent.setup();
    boot(portal, { messages: { [A.name]: { messages: [], error: 'failed' } } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('stateCard')).not.toBeNull());
    expect(drawn(part('stateCard'))).toBe(drawing('alert-circle'));
    cleanup();
    boot(portal, { status: { ...LINKED, caps: { spaces: true, read: false, send: true } } });
    await waitFor(() => expect(rows()).toHaveLength(3));
    await user.click(rows()[0]!);
    await waitFor(() => expect(part('stateCard')).not.toBeNull());
    expect(drawn(part('stateCard'))).toBe(drawing('eye-off'));
  });
});
