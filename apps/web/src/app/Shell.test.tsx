import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminMe, json, teamMe } from '../test/helpers';
import { open, PROFILE } from '../test/session';

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

const rail = () => screen.getByRole('navigation', { name: 'Sections' });
const names = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-part=item],[data-part=itemActive]')].map(a =>
    a.textContent?.trim(),
  );

describe("the admin's frame", () => {
  it('draws every section of the admin portal, with how many screens each holds, and the screen it opens on', async () => {
    open('admin', adminMe());
    expect(await screen.findByText(/Signed in as Admin/)).toBeTruthy();
    const groups = within(rail())
      .getAllByRole('button', { expanded: true })
      .concat(within(rail()).getAllByRole('button', { expanded: false }));
    expect(groups.map(g => g.textContent)).toEqual([
      'Management6',
      'CRM5',
      'Finance1',
      'Logistics & Shipping2',
      'Tools4',
      'Chat2',
      'Google5',
      'System2',
    ]);
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('aria-current')).toBeNull();
  });

  it('opens only the section the person is in, and closes and opens the others when asked', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    const head = (label: RegExp) => within(rail()).getByRole('button', { name: label });
    expect(head(/^Management/).getAttribute('aria-expanded')).toBe('true');
    expect(head(/^CRM/).getAttribute('aria-expanded')).toBe('false');
    await user.click(head(/^CRM/));
    expect(head(/^CRM/).getAttribute('aria-expanded')).toBe('true');
    expect(JSON.parse(localStorage.getItem('ml_admin_navgroups') ?? 'null')).toEqual([
      'management',
      'crm',
    ]);
    await user.click(head(/^Management/));
    expect(JSON.parse(localStorage.getItem('ml_admin_navgroups') ?? 'null')).toEqual(['crm']);
  });

  it("goes to a screen when its name is pressed, keeps the person's place for next time, and opens that screen's section", async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    await user.click(within(rail()).getByRole('button', { name: /^CRM/ }));
    await user.click(screen.getByRole('link', { name: 'Leads' }));
    expect(await screen.findByTitle('Leads (classic page)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Leads' }).getAttribute('aria-current')).toBe('page');
    expect(localStorage.getItem('ml_page')).toBe('customers');
  });

  it('shows a screen that has not moved as its classic page, in a frame, and Home is one click away', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), { entries: ['/leads'] });
    const frame = await screen.findByTitle('Leads (classic page)');
    expect(frame.getAttribute('src')).toBe('/legacy/dashboard?embed=1#customers');
    expect(screen.getByRole('link', { name: 'Leads' }).getAttribute('aria-current')).toBe('page');
    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByText(/Signed in as Admin/)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('says why a screen cannot be shown in a frame and sends the person to the classic portal for it, not a dead end', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), { entries: ['/chat'] });
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeTruthy();
    expect(screen.getByText(/live connection to the server/)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    const classic = screen.getByRole('link', { name: /Open Chat in the classic portal/ });
    expect(classic.getAttribute('href')).toBe('/legacy/dashboard#chat');
    await user.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByText(/Signed in as Admin/)).toBeTruthy();
  });

  it('opens a drawer on a phone, and closes it when a screen is chosen', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    const burger = screen.getByRole('button', { name: 'Toggle menu' });
    const sidebar = rail().closest('aside') as HTMLElement;
    expect(burger.getAttribute('aria-expanded')).toBe('false');
    await user.click(burger);
    expect(burger.getAttribute('aria-expanded')).toBe('true');
    expect(sidebar.className).toMatch(/drawerOpen/);
    expect(document.body.style.overflow).toBe('hidden');
    await user.click(screen.getByRole('link', { name: 'Tasks' }));
    expect(burger.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.style.overflow).toBe('');
    await user.click(burger);
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(sidebar.className).not.toMatch(/drawerOpen/);
  });

  it('narrows the rail to its icons, and remembers it where the classic portal does', async () => {
    const user = userEvent.setup({ delay: null });
    localStorage.setItem('ml_admin_sidebar', 'expanded');
    open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse.getAttribute('aria-pressed')).toBe('false');
    await user.click(collapse);
    expect(collapse.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('ml_admin_sidebar')).toBe('collapsed');
  });

  it('starts narrow when it was left narrow', async () => {
    localStorage.setItem('ml_admin_sidebar', 'collapsed');
    open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    expect(
      screen.getByRole('button', { name: 'Collapse sidebar' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('has the quick tabs a phone shows, and More for the rest', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    const bar = screen.getByRole('navigation', { name: 'Quick links' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map(b => b.textContent),
    ).toEqual(['Home', 'Tasks', 'Leads', 'Chat', 'More']);
    await user.click(within(bar).getByRole('button', { name: 'Chat' }));
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeTruthy();
    await user.click(within(bar).getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Toggle menu' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('signs out from the foot of the rail, and offers the way back to the classic portal', async () => {
    const user = userEvent.setup({ delay: null });
    const { signOut } = open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    expect(screen.getByRole('link', { name: 'Classic portal' }).getAttribute('href')).toBe(
      '/dashboard?ui=legacy',
    );
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe('what a team member is given', () => {
  it('draws the screens they were granted and the sections that hold them, named as the team portal names them', async () => {
    open(
      'team',
      teamMe({
        tasks: true,
        requests: true,
        hours: true,
        hoursActions: { log: true },
        leads: true,
      }),
    );
    expect(await screen.findByText(/Signed in as Sam/)).toBeTruthy();
    expect(names(rail())).toEqual([
      'Home',
      'My Tasks',
      'Hours Log',
      'Requests',
      'Leads',
      'Chat',
      'Calendar',
      'Meet',
      'My Drive',
      'My Sheets',
      'Notifications',
    ]);
    expect(within(rail()).queryByRole('button', { name: /Finance/ })).toBeNull();
  });

  it("sends them home from a screen they were not granted, and from one that is the admin's", async () => {
    for (const entry of ['/deals', '/employees', '/approvals', '/workspace', '/nonsense']) {
      cleanup();
      open('team', teamMe({}), { entries: [entry] });
      expect(await screen.findByText(/Signed in as Sam/), entry).toBeTruthy();
    }
  });

  it('does not open a screen that belongs to the other portal, even for somebody who may open everything', async () => {
    open('admin', adminMe({ gchat: true }), { entries: ['/issues'] });
    expect(await screen.findByText(/Signed in as Admin/)).toBeTruthy();
  });

  it('opens a screen they were granted', async () => {
    open('team', teamMe({ deals: true }), { entries: ['/deals'] });
    const frame = await screen.findByTitle('Deals (classic page)');
    expect(frame.getAttribute('src')).toBe('/legacy/employee?embed=1#deals');
  });

  it('names the page in the top bar as the classic team portal does', async () => {
    // Submissions is the one screen whose title in the team's top bar is not its name in the rail
    open('team', teamMe({ submissions: true }), {
      entries: ['/submissions'],
      more: { '/api/v1/submissions': () => json(200, { items: [] }) },
    });
    await screen.findByText('No submissions yet');
    expect(document.querySelector('[data-part=title]')?.textContent).toBe('Website Submissions');
    expect(
      within(rail()).getByRole('button', { name: 'Submissions' }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('keeps their account behind their initials: who they are, the way back to the classic portal, and Sign out', async () => {
    const user = userEvent.setup({ delay: null });
    const { signOut } = open('team', teamMe({}));
    await screen.findByText(/Signed in as Sam/);
    expect(screen.queryByText('Sales')).toBeNull();
    const button = screen.getByRole('button', { name: 'Your account' });
    expect(button.textContent).toBe('S');
    await user.click(button);
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Classic portal' }).getAttribute('href')).toBe(
      '/employee?ui=legacy',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Sales')).toBeNull();
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByText('Sales')).toBeNull();
    await user.click(button);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });
});

describe('links that already exist', () => {
  it("opens the screen a hash names, in either portal's words, and lets go of the hash", async () => {
    open('admin', adminMe(), { entries: ['/#customers'] });
    expect(await screen.findByTitle('Leads (classic page)')).toBeTruthy();
  });

  it('opens a chat room from a notification click', async () => {
    open('admin', adminMe(), { entries: ['/?chat=room-7'] });
    expect(await screen.findByRole('heading', { name: 'Chat' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /Open Chat in the classic portal/ }).getAttribute('href'),
    ).toBe('/legacy/dashboard?chat=room-7');
  });

  it('opens the hours page for the team\'s old "log" hash', async () => {
    open('team', teamMe({ hours: true, hoursActions: { log: true } }), { entries: ['/#log'] });
    expect(await screen.findByTitle('Hours Log (classic page)')).toBeTruthy();
  });

  it('opens Home for a hash that is nothing', async () => {
    open('admin', adminMe(), { entries: ['/#nope'] });
    expect(await screen.findByText(/Signed in as Admin/)).toBeTruthy();
  });

  it('opens where the person was last, if they still may, and Home if not', async () => {
    localStorage.setItem('ml_emp_page', 'requests');
    open('team', teamMe({ requests: true }));
    expect(await screen.findByTitle('Requests (classic page)')).toBeTruthy();
    cleanup();
    localStorage.setItem('ml_emp_page', 'leads');
    open('team', teamMe({}));
    expect(await screen.findByText(/Signed in as Sam/)).toBeTruthy();
  });

  it('keeps safe mode in every address it goes to', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), { safe: true, entries: ['/home?safe=1'] });
    await screen.findByText(/Signed in as Admin/);
    expect(screen.getByRole('link', { name: 'Tasks' }).getAttribute('href')).toBe('/tasks?safe=1');
    await user.click(screen.getByRole('link', { name: 'Tasks' }));
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/home?safe=1');
  });
});

describe('the arrangement the admin saved', () => {
  it('is how the rail reads, in either portal', async () => {
    const config = {
      groups: [
        { key: 'crm', label: 'Sales', items: [{ id: 'nav-customers', label: 'Prospects' }] },
        { key: 'management', items: [{ id: 'nav-tasks', hidden: true }] },
      ],
    };
    open('admin', adminMe(), { more: { '/api/dashboard/nav-config': () => json(200, config) } });
    await screen.findByText(/Signed in as Admin/);
    expect(await within(rail()).findByRole('button', { name: /^Sales/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Prospects' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Tasks' })).toBeNull();
  });

  it('is the shipped rail when the server cannot say, or says nonsense', async () => {
    for (const answer of [
      () => json(500, { error: 'x' }),
      () => json(200, 'nonsense'),
      () => json(200, { groups: 7 }),
    ]) {
      cleanup();
      open('admin', adminMe(), { more: { '/api/dashboard/nav-config': answer } });
      await screen.findByText(/Signed in as Admin/);
      expect(await within(rail()).findByRole('button', { name: /^CRM/ })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Tasks' })).toBeTruthy();
    }
  });
});

describe('the colours', () => {
  it('goes round dark, light, automatic, says which it is, and remembers the choice here and at the server', async () => {
    const user = userEvent.setup({ delay: null });
    const f = open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    const toggle = await screen.findByRole('button', { name: /^Colour mode: Dark/ });
    await waitFor(() => expect(f.calls('/api/workspace')).toHaveLength(1));
    await user.click(toggle);
    expect(toggle.getAttribute('aria-label')).toBe('Colour mode: Light (click for Automatic)');
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
    expect(localStorage.getItem('ml_mode')).toBe('light');
    await waitFor(() =>
      expect(f.calls('/api/dashboard/ui-prefs').some(c => c.init.method === 'PUT')).toBe(true),
    );
    const put = f.calls('/api/dashboard/ui-prefs').find(c => c.init.method === 'PUT');
    expect(JSON.parse(String(put?.init.body))).toEqual({ mode: 'light' });
    await user.click(toggle);
    expect(toggle.getAttribute('aria-label')).toBe('Colour mode: Automatic (click for Dark)');
  });

  it('is not offered where the workspace has fixed the mode, and not in safe mode', async () => {
    open('admin', adminMe(), {
      more: {
        '/api/workspace': () =>
          json(200, { ...PROFILE, theme: { preset: 'moto', allow_user_mode: false } }),
      },
    });
    await screen.findByText(/Signed in as Admin/);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Colour mode/ })).toBeNull());
    cleanup();
    open('admin', adminMe(), { safe: true });
    await screen.findByText(/Signed in as Admin/);
    expect(screen.queryByRole('button', { name: /^Colour mode/ })).toBeNull();
  });

  it("is on the team's top bar too", async () => {
    open('team', teamMe({}));
    expect(await screen.findByRole('button', { name: /^Colour mode/ })).toBeTruthy();
  });
});

describe('the live stream', () => {
  it("opens as the person, on their portal's own stream", async () => {
    const f = open('team', teamMe({}));
    await screen.findByText(/Signed in as Sam/);
    await waitFor(() => expect(f.calls('/api/employee/notifications/stream?hd=2')).toHaveLength(1));
    expect(
      (
        f.calls('/api/employee/notifications/stream?hd=2')[0]!.init.headers as Record<
          string,
          string
        >
      )['Authorization'],
    ).toBe('Bearer tok');
  });

  it('wears a look the admin has just saved, in every open page, without a reload', async () => {
    const f = open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    await waitFor(() =>
      expect(f.calls('/api/dashboard/notifications/stream?hd=2')).toHaveLength(1),
    );
    await waitFor(() =>
      expect(document.querySelector('[data-part=brandName]')?.textContent).toBe('Acme Motors'),
    );
    f.push(
      `event: workspace\ndata: ${JSON.stringify({ ...PROFILE, name: 'Renamed Ltd', updated_at: '2026-10-02T00:00:00.000Z', theme: { preset: 'cyberpunk' }, texts: { admin_badge: 'Control room' } })}\n\n`,
    );
    await waitFor(() =>
      expect(document.querySelector('[data-part=brandName]')?.textContent).toBe('Renamed Ltd'),
    );
    expect(document.querySelector('[data-part=badge]')?.textContent).toBe('Control room');
    expect(document.getElementById('ws-theme')?.textContent).not.toBe('/* server */');
    expect(document.title).toBe('Renamed Ltd · Admin');
  });

  it('asks whether the session is over when the stream is refused, and does not call a server that is down a refusal', async () => {
    const down = open('admin', adminMe(), {
      more: {
        '/api/dashboard/notifications/stream?hd=2': () => new Response(null, { status: 503 }),
      },
    });
    await screen.findByText(/Signed in as Admin/);
    await waitFor(() =>
      expect(down.calls('/api/dashboard/notifications/stream?hd=2').length).toBeGreaterThan(0),
    );
    expect(down.onUnauthorized).not.toHaveBeenCalled();
    cleanup();
    const refused = open('admin', adminMe(), {
      more: {
        '/api/dashboard/notifications/stream?hd=2': () => new Response(null, { status: 401 }),
      },
    });
    await waitFor(() => expect(refused.onUnauthorized).toHaveBeenCalledTimes(1));
  });
});
