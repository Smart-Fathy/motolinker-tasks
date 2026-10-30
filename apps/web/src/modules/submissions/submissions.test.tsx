import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../../test/helpers';
import { open } from '../../test/session';
import { whenOf, type Submission } from './model';

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

const sub = (id: number, over: Partial<Submission> = {}): Submission => ({
  id,
  name: `Visitor ${id}`,
  email: `v${id}@example.com`,
  phone: `+20 100 555 ${String(id).padStart(4, '0')}`,
  message: `Hello ${id}`,
  car_interest: 'Tiguan',
  source: 'website',
  customer_id: null,
  lead_name: '',
  created_at: '2026-09-21T10:30:00.000Z',
  ...over,
});
const LAYLA = sub(3, { name: 'Layla', customer_id: 41, lead_name: 'Layla Hassan' });
const OMAR = sub(2, { name: 'Omar', phone: '', message: '', car_interest: '' });

/** The team member who may read what the website sent, and may or may not clear it. */
const READER = { submissions: true, submissionsActions: { view: true } };
const CLEARER = { submissions: true, submissionsActions: { view: true, delete: true } };

type Answer = Submission[] | { status: number; error?: string } | Promise<Submission[]>;

/** A signed-in session whose server lists these submissions (each time it is asked: the last answer stands), and a record of what it was asked. */
async function boot(
  portal: 'admin' | 'team',
  first: Answer,
  {
    lists = [] as Answer[],
    deleted = 200,
    perms = CLEARER,
  }: { lists?: Answer[]; deleted?: number; perms?: Record<string, unknown> } = {},
) {
  const answers = [first, ...lists];
  let asked = 0;
  const s = open(portal, portal === 'admin' ? adminMe() : teamMe(perms), {
    entries: ['/submissions'],
    more: {
      '/api/v1/submissions': async () => {
        const answer = await answers[Math.min(asked++, answers.length - 1)]!;
        if (!Array.isArray(answer)) {
          return json(answer.status, { error: answer.error ?? 'no', code: 'unavailable' });
        }
        return json(200, { items: answer });
      },
      ...Object.fromEntries(
        [LAYLA.id, OMAR.id, 5].map(id => [
          `/api/v1/submissions/${id}`,
          () =>
            deleted === 200
              ? json(200, { ok: true })
              : json(deleted, { error: 'no', code: 'unavailable' }),
        ]),
      ),
    },
  });
  return { ...s, listed: () => s.calls('/api/v1/submissions').length };
}

describe('the Submissions screen', () => {
  it("is headed as each portal's classic page is: the admin's page title, the team's card title with a line under it", async () => {
    // the team's side navigation carries the same words, so the page's own heading is read where it is drawn
    const title = () => document.querySelector('[data-part=pageTitle]')?.textContent;
    const hint = () => document.querySelector('[data-part=pageHint]')?.textContent;
    const a = await boot('admin', [LAYLA]);
    await screen.findByRole('table');
    expect(title()).toBe('Form Submissions');
    expect(hint()).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
    a.unmount();
    cleanup();

    await boot('team', [LAYLA]);
    await screen.findByRole('table');
    expect(title()).toBe('Website Submissions');
    expect(hint()).toBe('Enquiries the public website sent us.');
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('lists what the website sent: who, the lead each became, how to reach them, what they asked about, when', async () => {
    await boot('admin', [LAYLA, OMAR]);
    const table = await screen.findByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map(h => h.textContent),
    ).toEqual(['Name', 'Lead', 'Email', 'Phone', 'Car Interest', 'Message', 'Submitted', '']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const layla = within(rows[0]!);
    expect(layla.getByText('Layla')).toBeTruthy();
    expect(layla.getByTitle('Open lead profile').textContent).toBe('→ Layla Hassan');
    expect(layla.getByRole('link', { name: 'v3@example.com' }).getAttribute('href')).toBe(
      'mailto:v3@example.com',
    );
    expect(layla.getByText('+20 100 555 0003')).toBeTruthy();
    expect(layla.getByText('Tiguan')).toBeTruthy();
    expect(layla.getByText('Hello 3')).toBeTruthy();
    expect(layla.getByText(whenOf(LAYLA.created_at))).toBeTruthy();
    const omar = within(rows[1]!);
    expect(omar.getByText('Omar')).toBeTruthy();
    expect(omar.queryByTitle('Open lead profile')).toBeNull();
    expect(omar.getAllByText('—').length).toBe(4); // no lead, no phone, no car, no message
  });

  it('labels each cell with its heading, which is what a phone shows the table as cards by', async () => {
    await boot('team', [LAYLA]);
    const table = await screen.findByRole('table');
    const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell');
    expect(cells.map(c => c.getAttribute('data-label'))).toEqual([
      'Name',
      'Lead',
      'Email',
      'Phone',
      'Car Interest',
      'Message',
      'Submitted',
      '',
    ]);
  });

  it('says there is nothing yet, and what will appear', async () => {
    await boot('admin', []);
    expect(await screen.findByText('No submissions yet')).toBeTruthy();
    expect(screen.getByText('Submissions from website forms will appear here.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('is a loader until the server answers', async () => {
    const answer = deferred<Submission[]>();
    await boot('admin', answer.promise);
    expect(await screen.findByText('Loading submissions…')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    answer.resolve([LAYLA]);
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByText('Loading submissions…')).toBeNull();
  });

  it("says why it could not be had, in the server's words — and a refresh asks again", async () => {
    // a "no" is not asked again by itself (a 5xx is: that is the query client's policy, held in lib/api-client.test.ts), so
    // this is the screen showing what the server said, and the person asking for the list once more
    const s = await boot(
      'admin',
      { status: 403, error: 'You may not read submissions.' },
      { lists: [[LAYLA]] },
    );
    expect(await screen.findByText('You may not read submissions.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(s.listed()).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('table')).toBeTruthy();
    expect(screen.queryByText('You may not read submissions.')).toBeNull();
    expect(s.listed()).toBe(2);
  });

  it('asks again when Refresh is pressed, and shows the loader while it waits', async () => {
    const second = deferred<Submission[]>();
    const s = await boot('team', [LAYLA], { lists: [second.promise] });
    await screen.findByRole('table');
    expect(s.listed()).toBe(1);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Loading submissions…')).toBeTruthy();
    second.resolve([LAYLA, OMAR]);
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3),
    );
    expect(s.listed()).toBe(2);
  });

  it('has Delete for whoever may clear them: it asks, deletes that one, and lists again', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const s = await boot('admin', [LAYLA, OMAR], { lists: [[OMAR]] });
    await screen.findByRole('table');
    const first = within(within(screen.getByRole('table')).getAllByRole('row')[1]!);
    await userEvent.click(first.getByRole('button', { name: 'Delete' }));
    expect(confirm).toHaveBeenCalledWith('Delete this submission?');
    await waitFor(() => expect(s.calls('/api/v1/submissions/3')).toHaveLength(1));
    expect(s.calls('/api/v1/submissions/3')[0]!.init.method).toBe('DELETE');
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2),
    );
    expect(screen.queryByText('Layla')).toBeNull();
    expect(screen.getByText('Omar')).toBeTruthy();
    expect(s.listed()).toBe(2);
  });

  it('does nothing when the person changes their mind', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const s = await boot('admin', [LAYLA]);
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(s.calls('/api/v1/submissions/3')).toHaveLength(0);
    expect(s.listed()).toBe(1);
    expect(screen.getByText('Layla')).toBeTruthy();
  });

  it('says so when the server would not delete it, and leaves the list as it was', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const s = await boot('team', [LAYLA], { deleted: 503 });
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith('Delete failed'));
    expect(s.listed()).toBe(1);
    expect(screen.getByText('Layla')).toBeTruthy();
  });

  it('is read-only for a team member who may read them but not clear them: no Delete is drawn', async () => {
    await boot('team', [LAYLA, OMAR], { perms: READER });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it("takes a lead's chip to the Leads screen, where the lead's own page opens", async () => {
    await boot('admin', [LAYLA]);
    await userEvent.click(await screen.findByTitle('Open lead profile'));
    await waitFor(() => expect(screen.queryByText('Form Submissions')).toBeNull());
    expect(document.querySelector('[data-part=legacyFrame]')).toBeTruthy();
  });

  it('works from the keyboard: the chip answers Enter and Space', async () => {
    await boot('team', [LAYLA]);
    const chip = await screen.findByTitle('Open lead profile');
    chip.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByText('Website Submissions')).toBeNull());
  });

  it('is asked of the server as /api/v1/submissions, once, when it opens', async () => {
    const s = await boot('admin', [LAYLA]);
    await screen.findByRole('table');
    expect(s.listed()).toBe(1);
    expect(s.calls('/api/v1/submissions')[0]!.init.method ?? 'GET').toBe('GET');
  });
});
