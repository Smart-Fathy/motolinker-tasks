import { adminActor, describeActor, employeeActor } from '@motolinker/contracts/access';
import { normalisePermissions, PERM_ACTIONS } from '@motolinker/contracts/permissions';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { accessOf } from '../app/access';
import { SessionContext, type SessionValue } from '../app/context';
import { Shell } from '../app/shell/Shell';
import { makeApi, type Me } from '../lib/api';
import type { Portal } from '../lib/env';
import { notificationsKey, type Notification } from '../modules/notifications';
import { createStream } from '../lib/sse';
import type { Theme } from '../lib/theme';
import { createToasts } from '../lib/toasts';
import styles from './gallery.module.css';

const WORKSPACE = { name: 'Acme Motors', logo_url: '', updated_at: null };

/** A person who may open everything, so the whole rail is drawn. */
function specimenMe(portal: Portal): Me {
  if (portal === 'admin') {
    return {
      ...describeActor(adminActor()),
      workspace: WORKSPACE,
      flags: { gchat: true },
    } as unknown as Me;
  }
  const everything: Record<string, unknown> = {};
  for (const [section, actions] of Object.entries(PERM_ACTIONS)) {
    everything[section] = true;
    everything[section + 'Actions'] = Object.fromEntries((actions as string[]).map(a => [a, true]));
  }
  const permissions = normalisePermissions(everything, { dealStages: [], normStatus: String });
  const actor = employeeActor({
    id: 1,
    name: 'Sam Gallery',
    job_title: 'Chief Technical Officer',
    permissions,
  });
  return { ...describeActor(actor), workspace: WORKSPACE, flags: { gchat: true } } as unknown as Me;
}

/** A few unread notifications, so the frame is drawn with its badges (the bell's and the rail's). */
const SPECIMEN_NOTIFICATIONS: Notification[] = ['task', 'request', 'lead'].map((type, i) => ({
  id: i + 1,
  type,
  title: 'Something to look at',
  body: '',
  url: '',
  read: false,
  created_at: '2026-10-01T09:00:00.000Z',
}));

const nowhere = (async () => {
  throw new TypeError('the gallery asks nothing of the server');
}) as typeof fetch;

/**
 * The real frame — the rail, the top bar, the phone's bottom bar — on a person who may open everything, with nothing behind
 * it: what the contrast audit measures and a designer looks at. A transform makes the box the containing block of the
 * frame's fixed parts, so the rail stays inside it instead of taking over the page.
 */
export function Specimen({ portal, theme }: { portal: Portal; theme: Theme }) {
  const { value, client } = useMemo(() => {
    const me = specimenMe(portal);
    // Nothing is asked of the server here: what the frame shows is put in place, and never goes stale or is read again.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    client.setQueryData(notificationsKey(me.actor.key), SPECIMEN_NOTIFICATIONS);
    const value: SessionValue = {
      portal,
      env: { portal, workspaceName: 'Acme Motors', texts: {}, ui: 'dev' },
      me,
      access: accessOf(me),
      safe: false,
      api: makeApi({ portal, token: 'gallery', fetchImpl: nowhere }),
      theme,
      stream: createStream({ url: '', token: '', fetchImpl: nowhere }),
      toasts: createToasts(),
      signOut: () => undefined,
      recheck: () => undefined,
    };
    return { value, client };
  }, [portal, theme]);
  return (
    <div className={styles['specimen']} data-part="specimen">
      <QueryClientProvider client={client}>
        <SessionContext value={value}>
          <MemoryRouter initialEntries={['/tasks']}>
            <Routes>
              <Route element={<Shell openAll />}>
                <Route
                  path="*"
                  element={
                    <p className={styles['page']}>
                      The screen goes here: the frame is the same around every one.
                    </p>
                  }
                />
              </Route>
            </Routes>
          </MemoryRouter>
        </SessionContext>
      </QueryClientProvider>
    </div>
  );
}
