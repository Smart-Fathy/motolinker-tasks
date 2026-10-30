import { adminActor, describeActor, employeeActor } from '@motolinker/contracts/access';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { admin, json, storageWith, team } from '../test/helpers';
import { App } from './App';

// (the app moves the real address and keeps the real storage; each test starts from neither)
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  localStorage.clear();
});

const workspace = { name: 'Acme Motors', logo_url: '', updated_at: null };

const adminMe = { ...describeActor(adminActor()), workspace, flags: {} };
const saraMe = {
  ...describeActor(
    employeeActor({
      id: 7,
      name: 'Sara',
      job_title: 'Sales',
      permissions: {
        leads: true,
        tasks: true,
        leadsActions: { view: true },
        tasksActions: { view: true, create: true },
      },
    }),
  ),
  workspace,
  flags: {},
};

type Answer = Response | Error | (() => Response | Promise<Response>);

/** What the signed-in frame asks for on its own — the workspace, the person's colour choice, the sidebar's arrangement, the
 *  live stream — answered quietly, so a test can say only what it is about. */
const FRAME: Record<string, Answer> = {
  '/api/workspace': () =>
    json(200, { ...workspace, theme: {}, typography: {}, shape: {}, texts: {} }),
  '/api/dashboard/ui-prefs': () => json(200, {}),
  '/api/employee/ui-prefs': () => json(200, {}),
  '/api/dashboard/nav-config': () => json(200, { groups: [] }),
  '/api/employee/nav-config': () => json(200, { groups: [] }),
  '/api/dashboard/notifications/stream?hd=2': () =>
    new Response(new ReadableStream({ start() {} })),
  '/api/employee/notifications/stream?hd=2': () => new Response(new ReadableStream({ start() {} })),
};

/** A server that answers by address: what each path says, and what it was asked, in order. */
function server(routes: Record<string, Answer | Answer[]>) {
  const asked: Array<{ path: string; init: RequestInit; body: unknown }> = [];
  const queues = new Map(
    Object.entries({ ...FRAME, ...routes }).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]),
  );
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    asked.push({
      path,
      init,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const queue = queues.get(path);
    if (!queue) throw new Error(`no answer for ${path}`);
    const answer = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer() : answer.clone();
  }) as typeof fetch;
  const paths = () => asked.map(a => a.path);
  /** …without the frame's own questions: what was asked about signing in, and who is signed in */
  const identity = () => paths().filter(p => !(p in FRAME));
  return { fetchImpl, asked, paths, identity };
}
const bearer = (init: RequestInit) => (init.headers as Record<string, string>)['Authorization'];

describe('the app, signed out', () => {
  it('shows the admin sign-in and asks nothing of the server', () => {
    const s = server({});
    render(<App env={admin} deps={{ storage: storageWith(), fetchImpl: s.fetchImpl }} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Admin Access');
    expect(s.asked).toEqual([]);
  });

  it('shows the team sign-in for the team portal', () => {
    const s = server({});
    render(<App env={team} deps={{ storage: storageWith(), fetchImpl: s.fetchImpl }} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Team Portal');
    expect(s.asked).toEqual([]);
  });
});

describe('signing in', () => {
  it('keeps the session where the classic portal keeps it, and finds out who it is', async () => {
    const storage = storageWith();
    const s = server({
      '/api/auth/login': json(200, { token: 'tok-new', username: 'boss' }),
      '/api/v1/me': json(200, adminMe),
    });
    const user = userEvent.setup({ delay: null });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    await user.type(screen.getByLabelText('Username'), 'boss');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Signed in as Admin')).toBeTruthy();
    expect(storage.data.get('ml_admin_token')).toBe('tok-new');
    expect(storage.data.has('ml_emp_token')).toBe(false);
    expect(s.identity()).toEqual(['/api/auth/login', '/api/v1/me']);
    expect(bearer(s.asked.find(a => a.path === '/api/v1/me')!.init)).toBe('Bearer tok-new');
  });

  it('signs a team member in on their own key, through the second step', async () => {
    const storage = storageWith();
    const s = server({
      '/api/employee/login': json(200, { mfa_required: true, mfa_token: 'challenge' }),
      '/api/employee/login/2fa': json(200, { token: 'tok-sara', name: 'Sara' }),
      '/api/v1/me': json(200, saraMe),
    });
    const user = userEvent.setup({ delay: null });
    render(<App env={team} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    await user.type(screen.getByLabelText('Username'), 'sara');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(storage.data.size).toBe(0);
    await user.type(await screen.findByLabelText('Authentication code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Signed in as Sara')).toBeTruthy();
    expect(storage.data.get('ml_emp_token')).toBe('tok-sara');
    expect(s.asked[1]!.body).toEqual({ mfa_token: 'challenge', code: '123456' });
  });

  it('is signed in for this visit even when the browser will not keep the session', async () => {
    const storage = storageWith();
    storage.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const s = server({
      '/api/auth/login': json(200, { token: 'tok-new' }),
      '/api/v1/me': json(200, adminMe),
    });
    const user = userEvent.setup({ delay: null });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    await user.type(screen.getByLabelText('Username'), 'boss');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Signed in as Admin')).toBeTruthy();
  });
});

describe('arriving from Google', () => {
  it('is signed in on the session Google’s return carried, without a sign-in screen, even if storage refuses it', async () => {
    const storage = storageWith();
    const s = server({ '/api/v1/me': json(200, saraMe) });
    render(
      <App
        env={team}
        arrival={{ token: 'tok-google' }}
        deps={{ storage, fetchImpl: s.fetchImpl }}
      />,
    );
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(await screen.findByText('Signed in as Sara')).toBeTruthy();
    expect(bearer(s.asked[0]!.init)).toBe('Bearer tok-google');
  });

  it('takes the second step Google’s return asked for, and signs in on it', async () => {
    const storage = storageWith();
    const s = server({
      '/api/employee/login/2fa': json(200, { token: 'tok-g2' }),
      '/api/v1/me': json(200, saraMe),
    });
    const user = userEvent.setup({ delay: null });
    render(
      <App
        env={team}
        arrival={{ mfaToken: 'google-challenge' }}
        deps={{ storage, fetchImpl: s.fetchImpl }}
      />,
    );
    await user.type(screen.getByLabelText('Authentication code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Signed in as Sara')).toBeTruthy();
    expect(s.asked[0]!.body).toEqual({ mfa_token: 'google-challenge', code: '654321' });
    expect(storage.data.get('ml_emp_token')).toBe('tok-g2');
  });

  it('does not offer a spent challenge again after the person has signed in and out', async () => {
    const storage = storageWith();
    const s = server({
      '/api/employee/login/2fa': json(200, { token: 'tok-g2' }),
      '/api/v1/me': json(200, saraMe),
      '/api/employee/logout': json(200, { ok: true }),
    });
    const user = userEvent.setup({ delay: null });
    render(
      <App
        env={team}
        arrival={{ mfaToken: 'google-challenge' }}
        deps={{ storage, fetchImpl: s.fetchImpl }}
      />,
    );
    await user.type(screen.getByLabelText('Authentication code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await screen.findByText('Signed in as Sara');
    await user.click(screen.getByRole('button', { name: 'Your account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
    expect(screen.queryByLabelText('Authentication code')).toBeNull();
  });

  it('does not offer a spent challenge again when the session later ends of itself', async () => {
    const storage = storageWith();
    const s = server({
      '/api/employee/login/2fa': json(200, { token: 'tok-g2' }),
      '/api/v1/me': [json(503, { error: 'db down' }), json(401, { error: 'Unauthorized' })],
    });
    const user = userEvent.setup({ delay: null });
    render(
      <App
        env={team}
        arrival={{ mfaToken: 'google-challenge' }}
        deps={{ storage, fetchImpl: s.fetchImpl }}
      />,
    );
    await user.type(screen.getByLabelText('Authentication code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Password')).toBeTruthy();
    expect(screen.queryByLabelText('Authentication code')).toBeNull();
  });

  it('shows Google’s refusal on the sign-in form', () => {
    const s = server({});
    render(
      <App
        env={team}
        arrival={{ error: 'No account linked to this Google address. Contact your admin.' }}
        deps={{ storage: storageWith(), fetchImpl: s.fetchImpl }}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('No account linked');
    expect(s.asked).toEqual([]);
  });
});

describe('the app, signed in', () => {
  it('says who the admin is: everything, every section', async () => {
    const s = server({ '/api/v1/me': json(200, adminMe) });
    render(
      <App
        env={admin}
        deps={{ storage: storageWith({ ml_admin_token: 'tok' }), fetchImpl: s.fetchImpl }}
      />,
    );
    expect(await screen.findByText('Signed in as Admin')).toBeTruthy();
    expect(screen.getByText('Administrator')).toBeTruthy();
    expect(screen.getByText('do everything')).toBeTruthy();
    expect(screen.getByText('all of them')).toBeTruthy();
    expect(bearer(s.asked[0]!.init)).toBe('Bearer tok');
  });

  it('says who an employee is: their job, how many actions, which sections', async () => {
    const s = server({ '/api/v1/me': json(200, saraMe) });
    render(
      <App
        env={team}
        deps={{ storage: storageWith({ ml_emp_token: 'tok' }), fetchImpl: s.fetchImpl }}
      />,
    );
    expect(await screen.findByText('Signed in as Sara')).toBeTruthy();
    expect(screen.getByText('Team member · Sales')).toBeTruthy();
    expect(saraMe.caps).toEqual(['leads.view', 'tasks.create', 'tasks.view']);
    expect(screen.getByText('3 actions')).toBeTruthy();
    expect(screen.getByText('leads, tasks')).toBeTruthy();
  });

  it('shows the workspace’s name as text, never as markup', async () => {
    const odd = { ...adminMe, workspace: { ...workspace, name: '<img src=x onerror=alert(1)>' } };
    const s = server({ '/api/v1/me': json(200, odd) });
    const { container } = render(
      <App
        env={{ ...admin, workspaceName: odd.workspace.name }}
        deps={{ storage: storageWith({ ml_admin_token: 'tok' }), fetchImpl: s.fetchImpl }}
      />,
    );
    await screen.findByText('Signed in as Admin');
    expect(container.querySelector('img')).toBeNull();
  });

  it('counts one action in the singular', async () => {
    const one = {
      ...describeActor(
        employeeActor({
          id: 8,
          name: 'Omar',
          job_title: '',
          permissions: { tasks: true, tasksActions: { view: true } },
        }),
      ),
      workspace,
      flags: {},
    };
    const s = server({ '/api/v1/me': json(200, one) });
    render(
      <App
        env={team}
        deps={{ storage: storageWith({ ml_emp_token: 'tok' }), fetchImpl: s.fetchImpl }}
      />,
    );
    expect(await screen.findByText('1 action')).toBeTruthy();
    expect(screen.getByText('Team member')).toBeTruthy();
  });
});

describe('signing out', () => {
  it('ends the session at the server, forgets it here, and shows the sign-in', async () => {
    const storage = storageWith({ ml_admin_token: 'tok' });
    const s = server({
      '/api/v1/me': json(200, adminMe),
      '/api/auth/logout': json(200, { ok: true }),
    });
    const user = userEvent.setup({ delay: null });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    await user.click(await screen.findByRole('button', { name: 'Sign Out' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin Access' })).toBeTruthy();
    expect(storage.removeItem).toHaveBeenCalledWith('ml_admin_token');
    expect(storage.data.size).toBe(0);
    const logout = s.asked.find(a => a.path === '/api/auth/logout')!;
    expect(logout.init.method).toBe('POST');
    expect(bearer(logout.init)).toBe('Bearer tok');
    // and a session once ended is not asked about again
    expect(s.paths().filter(p => p === '/api/v1/me')).toHaveLength(1);
  });

  it('uses the team portal’s own route', async () => {
    const s = server({
      '/api/v1/me': json(200, saraMe),
      '/api/employee/logout': json(200, { ok: true }),
    });
    const user = userEvent.setup({ delay: null });
    render(
      <App
        env={team}
        deps={{ storage: storageWith({ ml_emp_token: 'tok' }), fetchImpl: s.fetchImpl }}
      />,
    );
    await user.click(await screen.findByRole('button', { name: 'Your account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Username');
    expect(s.paths()).toContain('/api/employee/logout');
  });

  it('leaves even when the server will not answer: nobody is kept signed in by an outage', async () => {
    for (const answer of [new TypeError('Failed to fetch'), json(503, { error: 'db down' })]) {
      cleanup();
      const storage = storageWith({ ml_admin_token: 'tok' });
      const s = server({ '/api/v1/me': json(200, adminMe), '/api/auth/logout': answer });
      const user = userEvent.setup({ delay: null });
      render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
      await user.click(await screen.findByRole('button', { name: 'Sign Out' }));
      expect(await screen.findByLabelText('Username')).toBeTruthy();
      expect(storage.data.size).toBe(0);
    }
  });

  it('does not wait for the server: the sign-in is there while the request is still out', async () => {
    const storage = storageWith({ ml_admin_token: 'tok' });
    const s = server({
      '/api/v1/me': json(200, adminMe),
      '/api/auth/logout': () => new Promise<Response>(() => undefined),
    });
    const user = userEvent.setup({ delay: null });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    await user.click(await screen.findByRole('button', { name: 'Sign Out' }));
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(storage.data.size).toBe(0);
  });
});

describe('the app, when the session is not good', () => {
  it('forgets a token the server no longer knows, and shows the sign-in', async () => {
    const storage = storageWith({ ml_admin_token: 'stale' });
    const s = server({ '/api/v1/me': json(401, { error: 'Unauthorized' }) });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Admin Access' })).toBeTruthy();
    expect(storage.removeItem).toHaveBeenCalledWith('ml_admin_token');
  });

  it('does not sign anyone out because the database is down: it says so, and tries again on request', async () => {
    const storage = storageWith({ ml_admin_token: 'tok' });
    const s = server({ '/api/v1/me': [json(503, { error: 'x' }), json(200, adminMe)] });
    const user = userEvent.setup({ delay: null });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    expect(await screen.findByText('The server cannot answer just now')).toBeTruthy();
    expect(screen.getByText(/cannot reach its database/)).toBeTruthy();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Username')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Signed in as Admin')).toBeTruthy();
    expect(s.identity()).toEqual(['/api/v1/me', '/api/v1/me']);
  });

  it('says it cannot reach the server when it cannot, and keeps the token', async () => {
    const storage = storageWith({ ml_admin_token: 'tok' });
    const s = server({ '/api/v1/me': new TypeError('Failed to fetch') });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    expect(await screen.findByText('Cannot reach the server')).toBeTruthy();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Username')).toBeNull();
  });
});

describe('the way back', () => {
  it('is on every screen: the classic portal, with the switch set, so the server remembers', async () => {
    const screens: Array<{ token: string | null; routes: Record<string, Answer | Answer[]> }> = [
      { token: null, routes: {} },
      { token: 'tok', routes: { '/api/v1/me': json(200, adminMe) } },
      { token: 'tok', routes: { '/api/v1/me': json(401, {}) } },
      { token: 'tok', routes: { '/api/v1/me': json(503, {}) } },
    ];
    for (const { token, routes } of screens) {
      cleanup();
      const s = server(routes);
      render(
        <App
          env={admin}
          deps={{
            storage: storageWith(token ? { ml_admin_token: token } : {}),
            fetchImpl: s.fetchImpl,
          }}
        />,
      );
      await waitFor(() => expect(screen.queryByText('Checking your session…')).toBeNull());
      const links = screen
        .getAllByRole('link')
        .filter(a => a.getAttribute('href') === '/dashboard?ui=legacy');
      expect(links.length, JSON.stringify(routes)).toBeGreaterThan(0);
    }
  });
});

describe('the gallery', () => {
  it('is at <portal>/__gallery, needs no session, and asks the server for nothing', async () => {
    window.history.pushState({}, '', '/dashboard/__gallery');
    try {
      const s = server({});
      render(<App env={admin} deps={{ storage: storageWith(), fetchImpl: s.fetchImpl }} />);
      expect(await screen.findByRole('heading', { name: 'Gallery' })).toBeTruthy();
      expect(document.querySelector('[data-step]')).toBeNull();
      expect(s.asked).toEqual([]);
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
});

describe('a call that comes back 401 while the app is open', () => {
  const refusedStream = {
    '/api/dashboard/notifications/stream?hd=2': () => new Response(null, { status: 401 }),
  };

  it('asks the server who the token belongs to, and keeps the person where they are if the server cannot say', async () => {
    const storage = storageWith({ ml_admin_token: 'tok' });
    const s = server({
      ...refusedStream,
      '/api/v1/me': [
        json(200, adminMe),
        json(503, { error: 'db down' }),
        json(503, { error: 'db down' }),
      ],
    });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    expect(await screen.findByText('Signed in as Admin')).toBeTruthy();
    await waitFor(() =>
      expect(s.identity().filter(p => p === '/api/v1/me').length).toBeGreaterThan(1),
    );
    expect(screen.getByText('Signed in as Admin')).toBeTruthy();
    expect(screen.queryByText('The server cannot answer just now')).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('shows the sign-in when the server says the token is not a session', async () => {
    const storage = storageWith({ ml_admin_token: 'tok' });
    const s = server({
      ...refusedStream,
      '/api/v1/me': [json(200, adminMe), json(401, { error: 'Unauthorized' })],
    });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    expect(await screen.findByLabelText('Username')).toBeTruthy();
    expect(storage.removeItem).toHaveBeenCalledWith('ml_admin_token');
  });

  it('takes a fresh look at who the person is when the server says they are still signed in', async () => {
    const storage = storageWith({ ml_admin_token: 'tok' });
    const before = { ...adminMe, actor: { ...adminMe.actor, name: 'Before' } };
    const after = { ...adminMe, actor: { ...adminMe.actor, name: 'After' } };
    const s = server({ ...refusedStream, '/api/v1/me': [json(200, before), json(200, after)] });
    render(<App env={admin} deps={{ storage, fetchImpl: s.fetchImpl }} />);
    expect(await screen.findByText('Signed in as After')).toBeTruthy();
  });
});
