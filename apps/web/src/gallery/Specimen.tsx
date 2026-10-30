import { adminActor, describeActor, employeeActor } from '@motolinker/contracts/access';
import { normalisePermissions, PERM_ACTIONS } from '@motolinker/contracts/permissions';
import { useMemo } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { accessOf } from '../app/access';
import { SessionContext, type SessionValue } from '../app/context';
import { Shell } from '../app/shell/Shell';
import { makeApi, type Me } from '../lib/api';
import type { Portal } from '../lib/env';
import { createStream } from '../lib/sse';
import type { Theme } from '../lib/theme';
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

const nowhere = (async () => {
  throw new TypeError('the gallery asks nothing of the server');
}) as typeof fetch;

/**
 * The real frame — the rail, the top bar, the phone's bottom bar — on a person who may open everything, with nothing behind
 * it: what the contrast audit measures and a designer looks at. A transform makes the box the containing block of the
 * frame's fixed parts, so the rail stays inside it instead of taking over the page.
 */
export function Specimen({ portal, theme }: { portal: Portal; theme: Theme }) {
  const value = useMemo<SessionValue>(() => {
    const me = specimenMe(portal);
    return {
      portal,
      env: { portal, workspaceName: 'Acme Motors', texts: {}, ui: 'dev' },
      me,
      access: accessOf(me),
      safe: false,
      api: makeApi({ portal, token: 'gallery', fetchImpl: nowhere }),
      theme,
      stream: createStream({ url: '', token: '', fetchImpl: nowhere }),
      signOut: () => undefined,
    };
  }, [portal, theme]);
  return (
    <div className={styles['specimen']} data-part="specimen">
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
    </div>
  );
}
