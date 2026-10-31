import {
  legacyIdOf,
  presentation,
  screenIdFromLegacy,
  type Screen,
} from '@motolinker/contracts/modules';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, type To } from 'react-router';
import { useAppTo, useSession, useStreamEvent } from '../app/context';
import { Unported } from '../app/Unported';
import { fromStream } from '../modules/notifications';
import { frameUrl, parseFromFrame, toFrame, type ToFrame } from './bridge';
import styles from './legacy.module.css';

/** A page that has not said it is up by now is not going to: say so, and offer the classic portal. */
const GIVE_UP_MS = 20_000;

type State = 'loading' | 'ready' | 'failed';

/** An address with a lead named in it (whatever else it asks for — the original look — stays). */
function withLead(target: To, lead: number): To {
  const path = typeof target === 'string' ? { pathname: target } : target;
  const search = new URLSearchParams(path.search ?? '');
  search.set('lead', String(lead));
  return { ...path, search: `?${search.toString()}` };
}

/**
 * A screen the app has not rebuilt yet, shown as the classic page itself: the same page, in a frame, without its own chrome
 * (the app draws the rail and the bars around it) and without what the app now does for every screen (public/assets/embed.js
 * and apps/web/README.md say what). One frame serves the screens that come after it — a new screen is asked of the page by
 * message, which is a click and not a reload — and what the person does inside it is followed: a page it moves to is the
 * screen the address names, a dead session is told to the app, a look the admin saves reaches it.
 */
export function LegacyFrame({ screen }: { screen: Screen }) {
  const { portal, safe, recheck } = useSession();
  const navigate = useNavigate();
  const to = useAppTo();
  const page = legacyIdOf(screen, portal);
  const title = presentation(screen, portal).title;

  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<State>('loading');
  // The page the frame opens on is where it was first asked; later screens are asked of it, not loaded.
  const [src, setSrc] = useState(() => frameUrl(portal, page, safe));
  const wanted = useRef(page); // the page the address names
  const at = useRef(page); // the page the frame is on — or has been asked to go to, which it will be as soon as it answers

  const say = useCallback(
    (message: ToFrame) =>
      frame.current?.contentWindow?.postMessage(toFrame(message), window.location.origin),
    [],
  );
  const ask = useCallback(
    (next: string) => {
      at.current = next;
      say({ type: 'navigate', page: next });
    },
    [say],
  );

  // What the frame tells the app. Only this frame, from this origin; anything else is not heard.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.origin !== window.location.origin) return;
      const m = parseFromFrame(e.data);
      if (!m) return;
      if (m.type === 'unauthorized') return recheck();
      at.current = m.page;
      if (m.type === 'ready') setState('ready');
      if (m.page === wanted.current) return;
      // opened on a page the person has left while it loaded: take it where they are now
      if (m.type === 'ready') return ask(wanted.current);
      // …otherwise the person moved about inside the frame: the address follows
      // (a lead's page that sent them to make a document for that lead says whose: the screen that makes it is asked for them)
      const next = screenIdFromLegacy(m.page, portal);
      const lead = m.type === 'navigated' ? m.lead : undefined;
      if (next) void navigate(lead ? withLead(to('/' + next), lead) : to('/' + next));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [portal, navigate, to, recheck, ask]);

  // The address names another screen of the same frame: ask for it, unless the frame is on it already (it went there itself).
  // (A layout effect, so that nothing the frame says between this render and the next one is weighed against the old address.)
  useLayoutEffect(() => {
    wanted.current = page;
    if (state === 'ready' && at.current !== page) ask(page);
  }, [page, state, ask]);

  // Never a page that stays blank: if it does not come up, say so.
  useEffect(() => {
    if (state !== 'loading') return;
    const timer = window.setTimeout(() => setState('failed'), GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  // The workspace's look changed (the admin saved it): the frame's page wears it too, as the app does.
  useStreamEvent('workspace', data => {
    if (state !== 'ready') return;
    // (a line that is not JSON throws, and the stream keeps one listener's trouble from the others)
    const profile: unknown = JSON.parse(data);
    if (profile && typeof profile === 'object') say({ type: 'look', profile });
  });

  // A task was assigned to the team member, or one is due: the page that lists their tasks reads them again, as it did when it
  // held the notification stream itself.
  useStreamEvent('notification', data => {
    if (state !== 'ready' || portal !== 'team') return;
    const n = fromStream(JSON.parse(data));
    if (n && (n.type === 'task' || n.type === 'reminder')) say({ type: 'refresh', what: 'tasks' });
  });

  // The frame fills what the window has left below the top bar (and above a phone's bottom bar): the classic page scrolls
  // inside it, and its pop-ups and drawers sit in the part of the page that is on show.
  useLayoutEffect(() => {
    const fit = () => {
      const el = box.current;
      if (!el) return;
      const top = Math.max(0, el.getBoundingClientRect().top);
      const bar = document.querySelector<HTMLElement>('[data-part=bottomNav]');
      const below = bar && getComputedStyle(bar).display !== 'none' ? bar.offsetHeight : 0;
      el.style.height = `${Math.max(240, window.innerHeight - top - below)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [state]);

  if (state === 'failed') {
    return (
      <Unported
        screen={screen}
        onRetry={() => {
          setSrc(frameUrl(portal, page, safe));
          setState('loading');
        }}
      >
        <span role="alert">
          The classic page for {title} did not open here. It is still there in the classic portal,
          and works as it always has.
        </span>
      </Unported>
    );
  }
  return (
    <div className={styles['box']} ref={box} data-part="legacyFrame">
      <iframe
        ref={frame}
        className={styles['frame']}
        src={src}
        title={`${title} (classic page)`}
        data-state={state}
      />
      {state === 'loading' && (
        <div className={styles['loading']} role="status">
          <span className={styles['spinner']} aria-hidden="true" />
          Opening {title}…
        </div>
      )}
    </div>
  );
}
