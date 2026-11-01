import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import { oneAtATime } from '../../test/wrongly';
import {
  chatLinkOf,
  initialsOf,
  isGchatStatus,
  isGroup,
  isMessageList,
  isMine,
  isSent,
  isSpaceList,
  kindOf,
  lastIdOf,
  messagesOf,
  placeholderOf,
  reasonWords,
  routesOf,
  SAID,
  spacesOf,
  timeOf,
  type GchatStatus,
} from './model';

const CAPS = { spaces: true, read: true, send: true };
const LINKED = { configured: true, connected: true, email: 'a@b.test', name: 'Ana', caps: CAPS };
const SPACE = { name: 'spaces/AAA1', title: 'Sales team', type: 'SPACE' };
const MESSAGE = {
  id: 'spaces/AAA1/messages/m1',
  text: 'Hello',
  senderName: 'Ben B.',
  senderId: 'users/22',
  createTime: '2026-10-20T10:03:00Z',
};
const NOT_THINGS = [null, undefined, 7, 'x', true, [], [{}]];

describe('how the link is recognised', () => {
  // The browser does not carry zod for this: the guards are held to the contract's schemas, on what is right and on every
  // way each field can be wrong.
  it('has the status recognised as the schema recognises it', () => {
    const shapes: Record<string, unknown>[] = [
      { configured: false },
      { configured: true, connected: false },
      { configured: true, connected: false, reconnect: true },
      { configured: true, connected: false, reconnect: true, email: 'a@b.test' },
      { configured: true, connected: false, reconnect: false },
      LINKED,
      { configured: true, connected: true, caps: CAPS },
      { configured: false, connected: true },
      { ...LINKED, extra: 1 },
      {},
    ];
    for (const good of shapes) {
      for (const s of [good, ...oneAtATime(good)]) {
        expect([isGchatStatus(s), s]).toEqual([schemas.GchatStatus.safeParse(s).success, s]);
      }
    }
    for (const s of NOT_THINGS) {
      expect([isGchatStatus(s), s]).toEqual([schemas.GchatStatus.safeParse(s).success, s]);
    }
  });

  it('has what a link reaches recognised field by field', () => {
    for (const caps of [CAPS, ...oneAtATime(CAPS)]) {
      const s = { ...LINKED, caps };
      expect([isGchatStatus(s), s]).toEqual([schemas.GchatStatus.safeParse(s).success, s]);
    }
  });

  it('wants a link to say what it reaches, and not to be taken for one that does', () => {
    expect(isGchatStatus({ configured: true, connected: true, email: 'a@b.test' })).toBe(false);
    expect(isGchatStatus({ ...LINKED, caps: { spaces: true, read: true } })).toBe(false);
    expect(isGchatStatus({ ...LINKED, caps: { spaces: false, read: false, send: false } })).toBe(
      true,
    );
  });

  it('says Chat is not set up, there is no link, the link was lost, or whose link it is and what it reaches', () => {
    expect(chatLinkOf({ configured: false })).toEqual({ state: 'unconfigured' });
    expect(chatLinkOf({ configured: true, connected: false })).toEqual({ state: 'unlinked' });
    expect(chatLinkOf({ configured: true, connected: false, reconnect: true })).toEqual({
      state: 'lost',
      email: '',
    });
    expect(
      chatLinkOf({ configured: true, connected: false, reconnect: true, email: 'a@b.test' }),
    ).toEqual({ state: 'lost', email: 'a@b.test' });
    expect(chatLinkOf(LINKED as GchatStatus)).toEqual({
      state: 'linked',
      email: 'a@b.test',
      name: 'Ana',
      caps: CAPS,
    });
  });

  it('has a link with no name or email as one with blanks (Google did not say)', () => {
    expect(chatLinkOf({ configured: true, connected: true, caps: CAPS })).toEqual({
      state: 'linked',
      email: '',
      name: '',
      caps: CAPS,
    });
  });
});

describe('how the spaces are recognised', () => {
  it('has a list recognised as the schema recognises it, and each space field by field', () => {
    const lists: Record<string, unknown>[] = [
      { spaces: [] },
      { spaces: [SPACE] },
      { spaces: [], error: 'forbidden' },
      { spaces: [], error: 'failed', detail: 'Backend Error' },
      { spaces: [SPACE], error: 'failed' },
      { spaces: [SPACE, { ...SPACE, name: 'spaces/BBB2' }] },
      { spaces: [SPACE, null] },
      { spaces: [{ ...SPACE, type: 3 }] },
      { spaces: [{ name: 'spaces/AAA1' }] },
      { error: 'forbidden' },
      { spaces: {} },
    ];
    for (const good of lists) {
      for (const s of [good, ...oneAtATime(good)]) {
        expect([isSpaceList(s), s]).toEqual([schemas.GchatSpaceList.safeParse(s).success, s]);
      }
    }
    for (const field of oneAtATime(SPACE)) {
      const s = { spaces: [field] };
      expect([isSpaceList(s), s]).toEqual([schemas.GchatSpaceList.safeParse(s).success, s]);
    }
    for (const s of NOT_THINGS) {
      expect([isSpaceList(s), s]).toEqual([schemas.GchatSpaceList.safeParse(s).success, s]);
    }
  });

  it('has the spaces, or why there are none: forbidden, a link to make again, or anything else', () => {
    expect(spacesOf({ spaces: [SPACE] })).toEqual({ ok: true, spaces: [SPACE] });
    expect(spacesOf({ spaces: [] })).toEqual({ ok: true, spaces: [] });
    expect(spacesOf({ spaces: [], error: 'forbidden', detail: 'No' })).toEqual({
      ok: false,
      reason: 'forbidden',
    });
    expect(spacesOf({ spaces: [], error: 'reconnect' })).toEqual({
      ok: false,
      reason: 'reconnect',
    });
    for (const error of ['failed', 'not_connected', 'not_configured', 'surprise']) {
      expect(spacesOf({ spaces: [], error })).toEqual({ ok: false, reason: 'failed' });
    }
  });

  it('takes an empty reason for no reason (the classic page did)', () => {
    expect(spacesOf({ spaces: [SPACE], error: '' })).toEqual({ ok: true, spaces: [SPACE] });
  });

  it('draws a space as the first letter of each of its first two words', () => {
    expect(initialsOf('Sales team')).toBe('ST');
    expect(initialsOf('Direct message')).toBe('DM');
    expect(initialsOf('Ops')).toBe('O');
    expect(initialsOf('one two three')).toBe('OT');
    expect(initialsOf('lower case')).toBe('LC');
    expect(initialsOf('')).toBe('?');
  });

  it('draws a first letter that is more than one code unit whole, and never half of one', () => {
    const drawn = initialsOf('😀 Team');
    expect(drawn).toBe('😀');
    // (no lone surrogate: the text survives being encoded)
    expect(new TextDecoder().decode(new TextEncoder().encode(drawn))).toBe(drawn);
  });

  it('skips the gaps between words as the classic pages did (a blank is nothing, not a letter)', () => {
    expect(initialsOf('a  b')).toBe('AB');
    expect(initialsOf(' ab')).toBe('A');
  });

  it('tells a space of people from a conversation of two', () => {
    expect(isGroup(SPACE)).toBe(true);
    expect(isGroup({ ...SPACE, type: 'DIRECT_MESSAGE' })).toBe(false);
    expect(isGroup({ ...SPACE, type: 'GROUP_CHAT' })).toBe(false);
    expect(kindOf(SPACE)).toBe('Space');
    expect(kindOf({ ...SPACE, type: 'DIRECT_MESSAGE' })).toBe('Direct message');
    expect(kindOf({ ...SPACE, type: 'GROUP_CHAT' })).toBe('Space');
    expect(kindOf({ ...SPACE, type: '' })).toBe('Space');
  });
});

describe('how the messages are recognised', () => {
  it('has a list recognised as the schema recognises it, and each message field by field', () => {
    const lists: Record<string, unknown>[] = [
      { messages: [] },
      { messages: [MESSAGE] },
      { messages: [], error: 'reconnect' },
      { messages: [], error: 'failed', detail: 'Backend Error' },
      { messages: [MESSAGE, null] },
      { messages: [{ ...MESSAGE, text: '' }] },
      { messages: [{ id: 'x' }] },
      { spaces: [] },
      { messages: {} },
    ];
    for (const good of lists) {
      for (const s of [good, ...oneAtATime(good)]) {
        expect([isMessageList(s), s]).toEqual([schemas.GchatMessageList.safeParse(s).success, s]);
      }
    }
    for (const field of oneAtATime(MESSAGE)) {
      const s = { messages: [field] };
      expect([isMessageList(s), s]).toEqual([schemas.GchatMessageList.safeParse(s).success, s]);
    }
    for (const s of NOT_THINGS) {
      expect([isMessageList(s), s]).toEqual([schemas.GchatMessageList.safeParse(s).success, s]);
    }
  });

  it('has the messages, or the reason there are none with Google’s words beside it', () => {
    expect(messagesOf({ messages: [MESSAGE] })).toEqual({ ok: true, messages: [MESSAGE] });
    expect(messagesOf({ messages: [], error: 'forbidden', detail: 'No way' })).toEqual({
      ok: false,
      reason: 'forbidden',
      detail: 'No way',
    });
    expect(messagesOf({ messages: [], error: 'reconnect' })).toEqual({
      ok: false,
      reason: 'reconnect',
      detail: '',
    });
    expect(messagesOf({ messages: [], error: '' })).toEqual({ ok: true, messages: [] });
  });

  it('knows a message is the person’s own by the name Google gave the link and the name Chat gave the message', () => {
    const me = { email: 'a@b.test', name: 'Ana A.' };
    expect(isMine({ ...MESSAGE, senderName: 'Ana A.' }, me)).toBe(true);
    expect(isMine({ ...MESSAGE, senderName: 'Ben B.' }, me)).toBe(false);
    // (a link that does not say who it is, or a message with nobody named, is nobody's own)
    expect(isMine({ ...MESSAGE, senderName: 'Ana A.' }, { email: '', name: 'Ana A.' })).toBe(false);
    expect(isMine({ ...MESSAGE, senderName: '' }, { email: 'a@b.test', name: '' })).toBe(false);
    expect(isMine({ ...MESSAGE, senderName: 'ana a.' }, me)).toBe(false);
  });

  it('writes the time of a message as hours and minutes, the 24-hour way', () => {
    const at = new Date(2026, 9, 20, 13, 5, 30);
    expect(timeOf(at.toISOString())).toBe('13:05');
    expect(timeOf(new Date(2026, 9, 20, 0, 7).toISOString())).toBe('00:07');
    expect(timeOf(new Date(2026, 9, 20, 9, 30).toISOString())).toBe('09:30');
  });

  it('writes no time for a message that has none that can be read (the classic pages wrote “Invalid Date”)', () => {
    expect(timeOf('')).toBe('');
    expect(timeOf('yesterday-ish')).toBe('');
  });

  it('knows the last message of a list by its address, and that an empty list has none', () => {
    expect(lastIdOf([])).toBe('');
    expect(lastIdOf([MESSAGE, { ...MESSAGE, id: 'spaces/AAA1/messages/m2' }])).toBe(
      'spaces/AAA1/messages/m2',
    );
  });
});

describe('how what was sent is recognised', () => {
  it('has the answer recognised as the schema recognises it', () => {
    const answers: Record<string, unknown>[] = [
      { ok: true },
      { ok: true, id: 'spaces/AAA1/messages/new1' },
      { ok: false, error: 'forbidden' },
      { ok: false, error: 'forbidden', detail: 'No way' },
      { ok: false },
      { ok: 'yes' },
      { error: 'empty' },
      {},
    ];
    for (const good of answers) {
      for (const s of [good, ...oneAtATime(good)]) {
        expect([isSent(s), s]).toEqual([schemas.GchatSent.safeParse(s).success, s]);
      }
    }
    for (const s of NOT_THINGS) {
      expect([isSent(s), s]).toEqual([schemas.GchatSent.safeParse(s).success, s]);
    }
  });
});

describe('where the routes are, and the words', () => {
  it('has the administrator’s routes under /api/dashboard and the team’s under /api/employee, the same six', () => {
    const a = routesOf('admin');
    const t = routesOf('team');
    expect(a).toMatchObject({
      status: '/api/dashboard/gchat/status',
      connect: '/api/dashboard/gchat/connect',
      disconnect: '/api/dashboard/gchat/disconnect',
      spaces: '/api/dashboard/gchat/spaces',
      send: '/api/dashboard/gchat/messages',
      check: null,
    });
    expect(t).toMatchObject({
      status: '/api/employee/gchat/status',
      connect: '/api/employee/gchat/connect',
      disconnect: '/api/employee/gchat/disconnect',
      spaces: '/api/employee/gchat/spaces',
      send: '/api/employee/gchat/messages',
      // (the team's page asks whether the session is still good before it leaves for Google)
      check: '/api/employee/check',
    });
  });

  it('asks for a space’s messages by its address, written so that nothing in it can be taken for more', () => {
    expect(routesOf('admin').messages('spaces/AAA1')).toBe(
      '/api/dashboard/gchat/messages?space=spaces%2FAAA1',
    );
    expect(routesOf('team').messages('spaces/a&b=c')).toBe(
      '/api/employee/gchat/messages?space=spaces%2Fa%26b%3Dc',
    );
  });

  it('writes the box a message is written in after the space it is for', () => {
    expect(placeholderOf('Sales team')).toBe('Message Sales team… (sent as you)');
    expect(placeholderOf('')).toBe('Message … (sent as you)');
  });

  it('has words for every reason the server gives, and a sentence for one it does not know', () => {
    expect(reasonWords('reconnect')).toBe('Your Google session expired.');
    expect(reasonWords('forbidden')).toBe(SAID.forbidden);
    expect(reasonWords('not_connected')).toBe('Google Chat is not connected.');
    expect(reasonWords('not_configured')).toBe('Google Chat is not set up.');
    expect(reasonWords('bad_space')).toBe('That space could not be found.');
    expect(reasonWords('empty')).toBe('There is nothing to send.');
    expect(reasonWords('failed')).toBe(SAID.unreachable);
    expect(reasonWords('something-new')).toBe(SAID.unreachable);
  });

  it('says every word as the classic page does where they were its own (and in the same breath where they are new)', () => {
    expect({ ...SAID }).toEqual({
      title: 'Google Chat',
      refresh: 'Refresh',
      select: 'Select a space',
      back: 'Back',
      unconfiguredTitle: 'Google Chat is not set up',
      unconfiguredBefore: 'Ask an administrator to enable it (',
      unconfiguredEnv: 'GOOGLE_CHAT_ENABLED=1',
      unconfiguredAfter: '). Google Chat requires a Google\u00a0Workspace account.',
      noAccess: 'Google Chat is not switched on for you. Ask your admin.',
      unavailableTitle: 'Google Chat unavailable',
      unreadable: 'Google Chat could not be read.',
      strange: 'Google Chat came back in a form this app does not know.',
      unlinkedTitle: 'Connect Google Chat',
      unlinkedBody: 'See your spaces and messages here, and reply without leaving the app.',
      connect: 'Connect Google Chat',
      lostTitle: 'Reconnect Google Chat',
      lostBody:
        'Your Google session expired. Unverified apps in testing mode lose access every 7 days.',
      reconnect: 'Reconnect',
      returnTitle: "Couldn't connect Google Chat",
      tryAgain: 'Try again',
      noSpacesLead: 'No spaces yet.',
      noSpacesRest: 'Group chats and DMs only appear here once they have at least one message.',
      forbidden:
        "Google Chat isn't available for your organization. A Workspace admin needs to allow this app.",
      expired: 'Your Google session expired.',
      unreachable: 'Could not reach Google Chat.',
      noMessages: 'No messages in this space yet.',
      historyTitle: 'Message history not shared',
      historyBody: "You didn't grant permission to read messages. You can still send.",
      grantRead: 'Grant read access',
      messagesFailed: 'Could not load messages',
      unknown: 'Unknown',
      readOnly: "Read-only — you didn't grant permission to send.",
      readOnlyAdmin: 'Read-only — your admin has not granted sending.',
      send: 'Send',
      sendFailed: 'Could not send: ',
      strangeSend:
        'Google Chat answered in a form this app does not know, so it is not known whether the message went.',
    });
  });
});
