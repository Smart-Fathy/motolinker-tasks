import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import { oneAtATime } from '../../test/wrongly';
import {
  addressOf,
  detailDateOf,
  isGmailStatus,
  isMailList,
  isMailMessage,
  isMailSent,
  isMailSummary,
  listDateOf,
  mailLinkOf,
  replySubjectOf,
  routesOf,
  sendBodyOf,
  senderOf,
  SAID,
  type GmailStatus,
} from './model';

const LINKED = {
  configured: true,
  connected: true,
  email: 'a@b.test',
  name: 'Ana',
  canSend: true,
};
const SUMMARY = {
  id: 'm1',
  subject: 'Quote for the Hilux',
  from: 'Ben Buyer <ben@buyer.test>',
  date: 'Wed, 28 Oct 2026 10:15:00 +0000',
  snippet: 'Could you send the final price?',
  unread: true,
};
const MESSAGE = {
  id: 'm1',
  threadId: 't1',
  labelIds: ['INBOX', 'UNREAD'],
  subject: 'Quote for the Hilux',
  from: 'Ben Buyer <ben@buyer.test>',
  to: 'ana@motolinker.test',
  date: 'Wed, 28 Oct 2026 10:15:00 +0000',
  messageId: '<m1@buyer.test>',
  body: 'Hello',
  isHtml: false,
};
// Gmail not finding a message is not an error to the route: it answers a message with nothing in it
const NOTHING = {
  labelIds: [],
  subject: '',
  from: '',
  to: '',
  date: '',
  messageId: '',
  body: '',
  isHtml: false,
};
const NOT_THINGS = [null, undefined, 7, 'x', true, [], [{}]];

describe('how the link is recognised', () => {
  // The browser does not carry zod for this: the guards are held to the contract's schemas, on what is right and on every
  // way each field can be wrong.
  it('has the status recognised as the schema recognises it', () => {
    const shapes: Record<string, unknown>[] = [
      { configured: false },
      { configured: true, connected: false },
      LINKED,
      { configured: true, connected: true, canSend: false },
      { configured: false, connected: true },
      { configured: true, connected: false, email: 'a@b.test' },
      { ...LINKED, extra: 1 },
      {},
    ];
    for (const good of shapes) {
      for (const s of [good, ...oneAtATime(good)]) {
        expect([isGmailStatus(s), s]).toEqual([schemas.GmailStatus.safeParse(s).success, s]);
      }
    }
    for (const s of NOT_THINGS) {
      expect([isGmailStatus(s), s]).toEqual([schemas.GmailStatus.safeParse(s).success, s]);
    }
  });

  it('wants a link to say whether it can send, and not to be taken for one that can', () => {
    expect(isGmailStatus({ configured: true, connected: true, email: 'a@b.test' })).toBe(false);
    expect(isGmailStatus({ ...LINKED, canSend: 'yes' })).toBe(false);
    expect(isGmailStatus({ ...LINKED, canSend: false })).toBe(true);
  });

  it('says there is no Google project, no link, or whose link it is and what it reaches', () => {
    expect(mailLinkOf({ configured: false })).toEqual({ state: 'unconfigured' });
    expect(mailLinkOf({ configured: true, connected: false })).toEqual({ state: 'unlinked' });
    expect(mailLinkOf(LINKED as GmailStatus)).toEqual({
      state: 'linked',
      email: 'a@b.test',
      name: 'Ana',
      canSend: true,
    });
  });

  it('keeps what a link made before sending was asked for says of itself', () => {
    expect(mailLinkOf({ ...LINKED, canSend: false } as GmailStatus)).toMatchObject({
      state: 'linked',
      canSend: false,
    });
  });

  it('has a link with no name or email as one with blanks (Google did not say)', () => {
    expect(mailLinkOf({ configured: true, connected: true, canSend: true })).toEqual({
      state: 'linked',
      email: '',
      name: '',
      canSend: true,
    });
  });
});

describe('how the messages are recognised', () => {
  it('has a line of the inbox recognised as the schema recognises it', () => {
    const asList = (s: unknown) => schemas.GmailMessageList.safeParse([s]).success;
    for (const s of [SUMMARY, ...oneAtATime(SUMMARY), { ...SUMMARY, extra: 1 }]) {
      expect([isMailSummary(s), s]).toEqual([asList(s), s]);
    }
    for (const s of NOT_THINGS) expect([isMailSummary(s), s]).toEqual([asList(s), s]);
  });

  it('has a list recognised as the schema recognises it: of lines and of nothing else', () => {
    const lists: unknown[] = [
      [],
      [SUMMARY],
      [SUMMARY, { ...SUMMARY, id: 'm2' }],
      [SUMMARY, { ...SUMMARY, id: 3 }],
      [SUMMARY, null],
      { error: 'Gmail not connected' },
      'x',
      null,
      undefined,
    ];
    for (const l of lists) {
      expect([isMailList(l), l]).toEqual([schemas.GmailMessageList.safeParse(l).success, l]);
    }
  });

  it('has a message recognised as the schema recognises it', () => {
    const shapes: Record<string, unknown>[] = [
      MESSAGE,
      NOTHING,
      { ...MESSAGE, extra: 1 },
      { ...MESSAGE, labelIds: [1] },
      { ...MESSAGE, labelIds: ['INBOX', null] },
    ];
    for (const good of shapes) {
      for (const m of [good, ...oneAtATime(good)]) {
        expect([isMailMessage(m), m]).toEqual([schemas.GmailMessage.safeParse(m).success, m]);
      }
    }
    for (const m of NOT_THINGS) {
      expect([isMailMessage(m), m]).toEqual([schemas.GmailMessage.safeParse(m).success, m]);
    }
  });

  it('takes the message Gmail did not find (no id, no thread) for a message, as the server answers it', () => {
    expect(isMailMessage(NOTHING)).toBe(true);
    expect(isMailMessage({ ...NOTHING, id: undefined })).toBe(true);
  });

  it('has what the server says of a sent email recognised as the schema recognises it', () => {
    const answers: unknown[] = [
      { ok: true },
      { ok: true, id: 'g1' },
      { ok: true, id: 7 },
      { ok: false },
      { ok: 'yes' },
      { error: 'Nope' },
      {},
      [],
      'ok',
      null,
      undefined,
    ];
    for (const a of answers) {
      expect([isMailSent(a), a]).toEqual([schemas.GmailSent.safeParse(a).success, a]);
    }
  });
});

describe('how a message is written', () => {
  it('writes the sender as the list does: the name before the address, or all of it where there is none', () => {
    expect(senderOf('Ben Buyer <ben@buyer.test>')).toBe('Ben Buyer');
    expect(senderOf('ana@motolinker.test')).toBe('ana@motolinker.test');
    expect(senderOf('<ana@motolinker.test>')).toBe('<ana@motolinker.test>');
    expect(senderOf('  Dee   <dee@dealer.test>')).toBe('Dee');
    expect(senderOf('"Fay, Fleet" <fay@fleet.test>')).toBe('"Fay, Fleet"');
    expect(senderOf('')).toBe('');
    // (from the first bracket to the last: a name with a bracket of its own in it is cut where the classic page cut it)
    expect(senderOf('Ben <ben@buyer.test> <b2@buyer.test>')).toBe('Ben');
  });

  it('finds the address in a sender: between the brackets, or all of it', () => {
    expect(addressOf('Ben Buyer <ben@buyer.test>')).toBe('ben@buyer.test');
    expect(addressOf('ana@motolinker.test')).toBe('ana@motolinker.test');
    expect(addressOf('"Fay, Fleet" <fay@fleet.test>')).toBe('fay@fleet.test');
    expect(addressOf('')).toBe('');
    // (brackets with nothing in them are not an address)
    expect(addressOf('Ben <>')).toBe('Ben <>');
  });

  it('puts Re: in front of the subject of a reply, once', () => {
    expect(replySubjectOf('Quote for the Hilux')).toBe('Re: Quote for the Hilux');
    expect(replySubjectOf('Re: Quote for the Hilux')).toBe('Re: Quote for the Hilux');
    expect(replySubjectOf('')).toBe('Re: ');
    // (the classic administrator's page knew only this spelling of it, and so does this)
    expect(replySubjectOf('RE: Quote')).toBe('Re: RE: Quote');
  });

  it('writes the date of a line as the reader writes dates: the whole day for the administrator, the month and day for the team', () => {
    const d = new Date(SUMMARY.date);
    expect(listDateOf(SUMMARY.date, 'admin')).toBe(d.toLocaleDateString());
    expect(listDateOf(SUMMARY.date, 'team')).toBe(
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    );
  });

  it('writes the date in the head of a message: day and time for the administrator, the header as it came for the team', () => {
    expect(detailDateOf(SUMMARY.date, 'admin')).toBe(new Date(SUMMARY.date).toLocaleString());
    expect(detailDateOf(SUMMARY.date, 'team')).toBe(SUMMARY.date);
    expect(detailDateOf('', 'team')).toBe('');
  });

  it('writes nothing for a date that cannot be read (the classic pages wrote “Invalid Date”)', () => {
    for (const bad of ['', 'garbage', 'Wed, 99 Oct 2026']) {
      expect(listDateOf(bad, 'admin')).toBe('');
      expect(listDateOf(bad, 'team')).toBe('');
      expect(detailDateOf(bad, 'admin')).toBe('');
    }
  });
});

describe('what is sent', () => {
  it('sends the three things every email has', () => {
    expect(sendBodyOf({ to: 'a@b.test', subject: 'Hi', body: 'Hello' })).toEqual({
      to: 'a@b.test',
      subject: 'Hi',
      body: 'Hello',
    });
  });

  it('adds the conversation and the message a reply answers, where there are some', () => {
    expect(
      sendBodyOf(
        { to: 'a@b.test', subject: 'Re: Hi', body: 'Hello' },
        { threadId: 't1', messageId: '<m1@x>' },
      ),
    ).toEqual({
      to: 'a@b.test',
      subject: 'Re: Hi',
      body: 'Hello',
      threadId: 't1',
      inReplyTo: '<m1@x>',
    });
  });

  it('leaves out what is empty or missing, rather than sending a blank (the server reads a blank as no thread)', () => {
    const body = sendBodyOf(
      { to: 'a@b.test', subject: 'Hi', body: 'Hello' },
      { threadId: '', messageId: undefined },
    );
    expect(Object.keys(body).sort()).toEqual(['body', 'subject', 'to']);
    expect(
      Object.keys(sendBodyOf({ to: 'a', subject: 'b', body: 'c' }, { threadId: 't' })).sort(),
    ).toEqual(['body', 'subject', 'threadId', 'to']);
  });
});

describe('where the routes are', () => {
  it('has the administrator’s under /api/email: Gmail’s own, not under /api/dashboard', () => {
    const r = routesOf('admin');
    expect(r).toMatchObject({
      status: '/api/email/status',
      connect: '/api/email/connect',
      disconnect: '/api/email/disconnect',
      messages: '/api/email/messages',
      send: '/api/email/send',
      check: null,
    });
    expect(r.message('m1')).toBe('/api/email/messages/m1');
  });

  it('has the team’s under /api/employee/email, and asks the session before leaving', () => {
    const r = routesOf('team');
    expect(r).toMatchObject({
      status: '/api/employee/email/status',
      connect: '/api/employee/email/connect',
      disconnect: '/api/employee/email/disconnect',
      messages: '/api/employee/email/messages',
      send: '/api/employee/email/send',
      check: '/api/employee/check',
    });
    expect(r.message('m1')).toBe('/api/employee/email/messages/m1');
  });

  it('keeps a message’s id to one part of the address, whatever is in it', () => {
    expect(routesOf('admin').message('a/b?c#d')).toBe('/api/email/messages/a%2Fb%3Fc%23d');
    expect(routesOf('team').message('../x')).toBe('/api/employee/email/messages/..%2Fx');
  });
});

describe('the words', () => {
  it('say what the classic pages say', () => {
    expect(SAID.checking).toBe('Checking Gmail…');
    expect(SAID.loadingTeam).toBe('Loading email…');
    expect(SAID.adminUnlinked).toBe('Sign in with Google to view your inbox in this dashboard.');
    expect(SAID.teamUnlinked).toBe('Connect your Google account to access your personal inbox.');
    expect(SAID.teamUnconfigured).toBe('Google OAuth is not set up. Contact your admin.');
    expect(SAID.adminEnv).toBe(
      'GOOGLE_CLIENT_ID=...\nGOOGLE_CLIENT_SECRET=...\nAPP_URL=https://your-app.railway.app',
    );
    expect(SAID.required).toBe('To, subject and message are required');
    expect(SAID.sentAdmin).toBe('Email sent successfully!');
  });
});
