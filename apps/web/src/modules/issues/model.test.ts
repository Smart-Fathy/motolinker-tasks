import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import {
  countsOf,
  fileHint,
  fileHref,
  initialsOf,
  isIssue,
  isIssueComment,
  isIssueCommentList,
  isIssueList,
  isOpen,
  MAX_FILE_BYTES,
  problemWith,
  shows,
  subtitleOf,
  whenOf,
  type Issue,
} from './model';

const issue = (over: Record<string, unknown> = {}) => ({
  id: 4,
  title: 'Cannot log hours',
  description: 'The button does nothing.',
  file_url: 'https://cdn.example.com/shot.png',
  reporter_id: 9,
  reporter_name: 'Sara Ali',
  status: 'open',
  created_at: '2026-10-01T09:30:00.000Z',
  resolved_at: null,
  resolved_by: '',
  ...over,
});
const comment = (over: Record<string, unknown> = {}) => ({
  id: 1,
  issue_id: 4,
  author_key: 'employee_9',
  author_name: 'Sara Ali',
  body: 'Hello',
  file_url: '',
  file_name: '',
  file_size: null,
  file_type: '',
  created_at: '2026-10-01T10:00:00.000Z',
  ...over,
});

describe('what a ticket is', () => {
  // The browser does not carry zod for this: these guards are held to the contract's schema, on what is right and on every
  // way of being wrong that the page could be handed.
  const tickets: unknown[] = [
    issue(),
    issue({ reporter_id: null, reporter_name: '', file_url: '' }),
    issue({ status: 'resolved', resolved_at: '2026-10-02T08:00:00.000Z', resolved_by: 'Admin' }),
    issue({ title: '', description: '' }),
    issue({ id: 1.5 }),
    issue({ id: '4' }),
    issue({ id: null }),
    issue({ id: 2 ** 60 }),
    issue({ title: null }),
    issue({ description: 5 }),
    issue({ file_url: null }),
    issue({ file_url: undefined }),
    issue({ reporter_id: '9' }),
    issue({ reporter_id: 9.5 }),
    issue({ reporter_id: undefined }),
    issue({ reporter_name: undefined }),
    issue({ status: 'closed' }),
    issue({ status: 'OPEN' }),
    issue({ status: undefined }),
    issue({ created_at: 5 }),
    issue({ resolved_at: undefined }),
    issue({ resolved_at: 5 }),
    issue({ resolved_by: null }),
    null,
    undefined,
    'text',
    7,
    [],
    {},
  ];
  it.each(tickets.map((v, i) => [i, v] as const))(
    '%i: the guard agrees with the contract',
    (_i, v) => {
      expect(isIssue(v)).toBe(schemas.Issue.safeParse(v).success);
    },
  );

  const replies: unknown[] = [
    comment(),
    comment({
      file_url: '/files/a.png',
      file_name: 'a.png',
      file_size: 2048,
      file_type: 'image/png',
    }),
    comment({ file_size: 0 }),
    comment({ file_size: -1 }),
    comment({ file_size: 1.5 }),
    comment({ file_size: '2' }),
    comment({ file_size: undefined }),
    comment({ id: '1' }),
    comment({ issue_id: '4' }),
    comment({ issue_id: null }),
    comment({ author_key: 5 }),
    comment({ author_name: null }),
    comment({ body: [] }),
    comment({ file_url: null }),
    comment({ file_name: 3 }),
    comment({ file_type: undefined }),
    comment({ created_at: undefined }),
    null,
    'x',
    [],
    {},
  ];
  it.each(replies.map((v, i) => [i, v] as const))(
    'reply %i: the guard agrees with the contract',
    (_i, v) => {
      expect(isIssueComment(v)).toBe(schemas.IssueComment.safeParse(v).success);
    },
  );

  it('knows a list from what is not one, for tickets and for replies', () => {
    const lists: unknown[] = [
      { items: [] },
      { items: [issue(), issue({ id: 5 })] },
      { items: [issue(), issue({ id: 'x' })] },
      { items: [comment()] },
      { items: 'nope' },
      { items: null },
      { rows: [] },
      [],
      [issue()],
      null,
      'x',
    ];
    for (const v of lists) {
      expect(isIssueList(v)).toBe(schemas.IssueList.safeParse(v).success);
      expect(isIssueCommentList(v)).toBe(schemas.IssueCommentList.safeParse(v).success);
    }
    expect(isIssueList({ items: [issue()] })).toBe(true);
    expect(isIssueList([issue()])).toBe(false);
    expect(isIssueCommentList({ items: [comment()] })).toBe(true);
  });
});

describe('open and closed', () => {
  it('reads anything that is not "resolved" as open, as the classic page does', () => {
    expect(isOpen(issue() as Issue)).toBe(true);
    expect(isOpen(issue({ status: 'resolved' }) as Issue)).toBe(false);
    expect(isOpen(issue({ status: '' }) as unknown as Issue)).toBe(true);
    expect(isOpen(issue({ status: 'whatever' }) as unknown as Issue)).toBe(true);
  });

  it('shows, for each chip, the tickets it names', () => {
    const open = issue() as Issue;
    const done = issue({ status: 'resolved' }) as Issue;
    expect([open, done].filter(i => shows('', i))).toEqual([open, done]);
    expect([open, done].filter(i => shows('open', i))).toEqual([open]);
    expect([open, done].filter(i => shows('resolved', i))).toEqual([done]);
  });

  it('counts them for the chips, and says how many are still open', () => {
    const items = [issue(), issue({ id: 5, status: 'resolved' }), issue({ id: 6 })] as Issue[];
    expect(countsOf(items)).toEqual({ all: 3, open: 2, resolved: 1 });
    expect(countsOf([])).toEqual({ all: 0, open: 0, resolved: 0 });
    expect(subtitleOf(2)).toBe('2 still open');
    expect(subtitleOf(1)).toBe('1 still open');
    expect(subtitleOf(0)).toBe('Nothing open — all clear');
  });
});

describe('how a time and a name are written', () => {
  it('writes a time as day, short month, year and a 24-hour time, in British order', () => {
    const iso = '2026-10-01T12:00:00.000Z';
    expect(whenOf(iso)).toBe(
      new Date(iso).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    );
    expect(whenOf(iso)).toMatch(/^\d{2} (Sep|Oct) 2026,? \d{2}:\d{2}$/);
  });

  it('writes nothing as a dash', () => {
    expect(whenOf(null)).toBe('—');
    expect(whenOf(undefined)).toBe('—');
    expect(whenOf('')).toBe('—');
  });

  it('takes up to two capitals from the first two words of a name', () => {
    expect(initialsOf('Sara Ali')).toBe('SA');
    expect(initialsOf('sara')).toBe('S');
    expect(initialsOf('  mo   salah  extra ')).toBe('MS');
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
    expect(initialsOf('   ')).toBe('?');
  });
});

describe('where a stored file opens from', () => {
  it('keeps an address on this site and a web address, and nothing else', () => {
    expect(fileHref('/files/a.png')).toBe('/files/a.png');
    expect(fileHref('https://cdn.example.com/a b.png')).toBe('https://cdn.example.com/a%20b.png');
    expect(fileHref('  http://localhost:3000  ')).toBe('http://localhost:3000/');
  });

  it('is not fooled into a link by an address that runs a script, is not on the web, or points elsewhere without saying so', () => {
    for (const bad of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'ftp://x/y',
      '//evil.example/x',
      'vbscript:x',
      'file:///etc/passwd',
      'relative/path',
      '',
      null,
      undefined,
      5,
    ])
      expect(fileHref(bad), String(bad)).toBe('');
  });
});

describe('a report, before it is sent', () => {
  it('needs words: a summary or details, either', () => {
    expect(problemWith({ title: '', description: '', file: null })).toBe(
      'Please describe the issue',
    );
    expect(problemWith({ title: '   ', description: ' \n ', file: null })).toBe(
      'Please describe the issue',
    );
    expect(problemWith({ title: 'Cannot log hours', description: '', file: null })).toBeNull();
    expect(problemWith({ title: '', description: 'It does nothing', file: undefined })).toBeNull();
  });

  it('takes a file up to 10 MB, no more', () => {
    const words = { title: 'x', description: '' };
    expect(problemWith({ ...words, file: { size: MAX_FILE_BYTES } })).toBeNull();
    expect(problemWith({ ...words, file: { size: MAX_FILE_BYTES + 1 } })).toBe(
      'File must be under 10 MB',
    );
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('asks for words before it asks about the file', () => {
    expect(problemWith({ title: '', description: '', file: { size: MAX_FILE_BYTES + 1 } })).toBe(
      'Please describe the issue',
    );
  });

  it('says what has been chosen under the paperclip', () => {
    expect(fileHint(null)).toBe('Click to attach a screenshot or file');
    expect(fileHint(undefined)).toBe('Click to attach a screenshot or file');
    expect(fileHint({ name: 'shot.png', size: 1.5 * 1024 * 1024 })).toBe('shot.png · 1.5 MB');
    expect(fileHint({ name: 'log.txt', size: 100 })).toBe('log.txt · 0.0 MB');
  });
});
