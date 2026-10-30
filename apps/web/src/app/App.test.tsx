import { adminActor, describeActor, employeeActor } from '@motolinker/contracts/access';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MlEnv } from '../lib/env';
import { App } from './App';

afterEach(cleanup);

const admin: MlEnv = { portal: 'admin', workspaceName: 'Acme Motors', ui: 'next' };
const team: MlEnv = { portal: 'team', workspaceName: 'Acme Motors', ui: 'next' };
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

const storageWith = (token: string | null, key: string) => {
  const data = new Map<string, string>(token ? [[key, token]] : []);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: vi.fn((k: string) => void data.delete(k)),
    data,
  };
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('the app, signed out', () => {
  it('asks nothing of the server and sends you to the classic portal to sign in', async () => {
    const fetchImpl = vi.fn();
    render(
      <App
        env={admin}
        deps={{
          storage: storageWith(null, 'ml_admin_token'),
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }}
      />,
    );
    expect(screen.getByText('You are not signed in here yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the classic portal' }).getAttribute('href')).toBe(
      '/legacy/dashboard',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('knows the team portal’s own addresses', () => {
    render(
      <App
        env={team}
        deps={{
          storage: storageWith(null, 'ml_emp_token'),
          fetchImpl: vi.fn() as unknown as typeof fetch,
        }}
      />,
    );
    expect(screen.getByText('Team portal · new app, preview')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the classic portal' }).getAttribute('href')).toBe(
      '/legacy/employee',
    );
    expect(
      screen.getByRole('link', { name: 'Go back to the classic portal' }).getAttribute('href'),
    ).toBe('/employee?ui=legacy');
  });
});

describe('the app, signed in', () => {
  it('says who the admin is: everything, every section', async () => {
    const fetchImpl = vi.fn(async () => json(200, adminMe));
    render(
      <App
        env={admin}
        deps={{
          storage: storageWith('tok', 'ml_admin_token'),
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }}
      />,
    );
    expect(await screen.findByText('Signed in as Admin')).toBeTruthy();
    expect(screen.getByText('Administrator')).toBeTruthy();
    expect(screen.getByText('do everything')).toBeTruthy();
    expect(screen.getByText('all of them')).toBeTruthy();
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('says who an employee is: their job, how many actions, which sections', async () => {
    const fetchImpl = vi.fn(async () => json(200, saraMe));
    render(
      <App
        env={team}
        deps={{
          storage: storageWith('tok', 'ml_emp_token'),
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }}
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
    const { container } = render(
      <App
        env={{ ...admin, workspaceName: odd.workspace.name }}
        deps={{
          storage: storageWith('tok', 'ml_admin_token'),
          fetchImpl: (async () => json(200, odd)) as unknown as typeof fetch,
        }}
      />,
    );
    await screen.findByText('Signed in as Admin');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('the app, when the session is not good', () => {
  it('forgets a token the server no longer knows, and says you are signed out', async () => {
    const storage = storageWith('stale', 'ml_admin_token');
    render(
      <App
        env={admin}
        deps={{
          storage,
          fetchImpl: (async () => json(401, { error: 'Unauthorized' })) as unknown as typeof fetch,
        }}
      />,
    );
    expect(await screen.findByText('You are not signed in here yet')).toBeTruthy();
    expect(storage.removeItem).toHaveBeenCalledWith('ml_admin_token');
  });

  it('does not sign anyone out because the database is down: it says so, and tries again on request', async () => {
    const storage = storageWith('tok', 'ml_admin_token');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: 'x' }))
      .mockResolvedValueOnce(json(200, adminMe));
    render(<App env={admin} deps={{ storage, fetchImpl: fetchImpl as unknown as typeof fetch }} />);
    expect(await screen.findByText('The server cannot answer just now')).toBeTruthy();
    expect(screen.getByText(/cannot reach its database/)).toBeTruthy();
    expect(storage.removeItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Signed in as Admin')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('says it cannot reach the server when it cannot, and keeps the token', async () => {
    const storage = storageWith('tok', 'ml_admin_token');
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    render(<App env={admin} deps={{ storage, fetchImpl: fetchImpl as unknown as typeof fetch }} />);
    expect(await screen.findByText('Cannot reach the server')).toBeTruthy();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe('the way back', () => {
  it('is on every screen: the classic portal, with the switch set, so the server remembers', async () => {
    const states: Array<() => Promise<Response>> = [
      async () => json(200, adminMe),
      async () => json(401, {}),
      async () => json(503, {}),
    ];
    for (const respond of states) {
      cleanup();
      render(
        <App
          env={admin}
          deps={{
            storage: storageWith('tok', 'ml_admin_token'),
            fetchImpl: respond as unknown as typeof fetch,
          }}
        />,
      );
      await waitFor(() => expect(screen.queryByText('Checking your session…')).toBeNull());
      expect(
        screen.getByRole('link', { name: 'Go back to the classic portal' }).getAttribute('href'),
      ).toBe('/dashboard?ui=legacy');
    }
  });
});

describe('the count of what you may do', () => {
  it('is singular for one', async () => {
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
    render(
      <App
        env={team}
        deps={{
          storage: storageWith('tok', 'ml_emp_token'),
          fetchImpl: (async () => json(200, one)) as unknown as typeof fetch,
        }}
      />,
    );
    expect(await screen.findByText('1 action')).toBeTruthy();
    expect(screen.getByText('Team member')).toBeTruthy();
  });
});
