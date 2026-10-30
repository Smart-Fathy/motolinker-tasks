import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { To } from 'react-router';
import type { Api, Me } from '../lib/api';
import type { MlEnv, Portal } from '../lib/env';
import type { Stream, StreamMessage } from '../lib/sse';
import type { Theme, ThemeState } from '../lib/theme';
import type { Access } from './access';

/** Everything a screen can ask of the signed-in session. */
export interface SessionValue {
  portal: Portal;
  env: MlEnv;
  me: Me;
  access: Access;
  /** opened with ?safe=1: the original look, and the address keeps saying so */
  safe: boolean;
  api: Api;
  theme: Theme;
  stream: Stream;
  signOut: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession: this is only available inside a signed-in session');
  return value;
}

export const useApi = (): Api => useSession().api;
export const useAccess = (): Access => useSession().access;

/** The workspace's name, picture, wording and the colour mode, as they are now. */
export function useTheme(): ThemeState & { theme: Theme } {
  const { theme } = useSession();
  const state = useSyncExternalStore(theme.subscribe, theme.getSnapshot);
  return { ...state, theme };
}

/** Hear a named event of the live stream while the screen is open. */
export function useStreamEvent(
  event: string,
  handler: (data: string, message: StreamMessage) => void,
): void {
  const { stream } = useSession();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(
    () => stream.on(event, (data, message) => latest.current(data, message)),
    [stream, event],
  );
}

/**
 * A path inside the app as a link target. Safe mode lives in the address (?safe=1) and has to survive moving about, or a
 * reload would put the broken look back; nothing else is carried.
 */
export function useAppTo(): (path: string) => To {
  const { safe } = useSession();
  return path => (safe ? { pathname: path, search: '?safe=1' } : path);
}
