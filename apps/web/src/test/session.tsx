import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { Session } from '../app/Session';
import type { Me } from '../lib/api';
import { admin, json, team } from './helpers';

// A signed-in session against a fake server, for the tests that want the whole app around what they test: the answers
// it gives to the frame's own questions, a live stream the test can write to, and a record of what was asked.

export const PROFILE = {
  name: 'Acme Motors',
  logo_url: '',
  updated_at: '2026-10-01T00:00:00.000Z',
  theme: { preset: 'moto', default_mode: 'dark' },
  typography: {},
  shape: {},
  texts: {},
};

/** The frame's own questions, and a live stream the test can write to. */
export function frame(portal: 'admin' | 'team', more: Record<string, () => Response> = {}) {
  const base = portal === 'admin' ? '/api/dashboard' : '/api/employee';
  let push: (text: string) => void = () => undefined;
  const asked: { path: string; init: RequestInit }[] = [];
  const routes: Record<string, () => Response> = {
    '/api/workspace': () => json(200, PROFILE),
    [`${base}/ui-prefs`]: () => json(200, {}),
    [`${base}/nav-config`]: () => json(200, { groups: [] }),
    [`${base}/notifications/stream?hd=2`]: () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(ctl) {
            const enc = new TextEncoder();
            push = text => ctl.enqueue(enc.encode(text));
          },
        }),
      ),
    ...more,
  };
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    asked.push({ path, init });
    const answer = routes[path];
    if (!answer) throw new TypeError('no answer for ' + path);
    return answer();
  }) as typeof fetch;
  return {
    fetchImpl,
    asked,
    push: (t: string) => push(t),
    calls: (p: string) => asked.filter(a => a.path === p),
  };
}

export function open(
  portal: 'admin' | 'team',
  me: Me,
  {
    entries = ['/'],
    safe = false,
    browser = false,
    more = {} as Record<string, () => Response>,
  } = {},
) {
  const f = frame(portal, more);
  const signOut = vi.fn();
  const onUnauthorized = vi.fn();
  const view = render(
    <Session
      env={portal === 'admin' ? admin : team}
      me={me}
      token="tok"
      signOut={signOut}
      onUnauthorized={onUnauthorized}
      fetchImpl={f.fetchImpl}
      {...(browser ? {} : { entries })}
      safe={safe}
    />,
  );
  return { ...f, ...view, signOut, onUnauthorized };
}
