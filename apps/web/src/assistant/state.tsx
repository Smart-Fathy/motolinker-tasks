// The assistant, as the frame holds it: whether the panel is open and how wide, the conversations (one for each section, kept for as long as
// the app is open), what the person is looking at, and the keys (Ctrl/⌘+K opens and closes it; Escape closes it when it has the keyboard).
// The classic panel is built by public/assets/assistant.js on every page and keeps all of this in globals; here it is one provider,
// mounted by the Shell, so that the panel and the conversation stay where they are as the person goes from screen to screen.
import { can } from '@motolinker/contracts/access';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from '../app/context';
import { ask, runAction, useSections } from './data';
import { reduce } from './histories';
import {
  historyOf,
  KEYS,
  labelOf,
  recordKey,
  recordSent,
  SAID,
  sectionFor,
  WIDTH,
  type AiSection,
  type Known,
  type Lang,
  type ProposalState,
  type ScreenRecord,
  type ScreenSnapshot,
  type Turn,
} from './model';
import { readScreen } from './screen';

const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
};

const NO_TURNS: readonly Turn[] = [];

/** Does the window match this query? (False where a window cannot say.) */
const matches = (query: string): boolean => !!window.matchMedia?.(query).matches;
const isDesktop = () => matches('(min-width: 1024px)');
const isPhone = () => matches('(max-width: 768px)');

/** Whether a query matches now, and as the window changes. */
function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matches(query));
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const change = () => setOn(list.matches);
    change();
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, [query]);
  return on;
}

/** The width the panel was last dragged to, if it is one it may be. */
function storedWidth(): number {
  const w = parseInt(store.get(KEYS.width) ?? '', 10);
  return w >= WIDTH.min && w <= WIDTH.max ? w : WIDTH.start;
}

/** What a framed classic page can say of what is open on it (see legacy/LegacyFrame): asked for as a question goes out. */
export type FrameReader = () => Promise<Partial<ScreenSnapshot> | null>;

export interface AssistantValue {
  /** may this person open the drawer and see the cards (assistant.chat) */
  available: boolean;
  /** the sections they may ask about, and whether they may have actions proposed */
  known: Known;
  act: boolean;
  /** the page the person is on (the classic portal's name for it), and the section the assistant reads for it */
  page: string;
  section: AiSection;
  label: string;
  open: boolean;
  /** the page gives the panel its room (a desktop) instead of the panel covering it */
  docked: boolean;
  width: number;
  setWidth: (w: number) => void;
  /** a bump each time the box should take the keyboard (the panel opened on purpose) */
  focusTick: number;
  openPanel: () => void;
  closePanel: () => void;
  toggle: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  /** the conversation in the section the assistant is reading */
  turns: readonly Turn[];
  /** the welcome stays above the first question until the panel is opened again (the chips go; the classic panel does the same) */
  welcomeKept: boolean;
  /** the section a question is being answered in, if one is */
  answering: string | null;
  send: (text: string) => Promise<void>;
  newChat: () => void;
  /** the proposals being confirmed just now, as "section:turn:proposal" */
  confirming: ReadonlySet<string>;
  confirm: (turn: number, proposal: number) => Promise<void>;
  dismiss: (turn: number, proposal: number) => void;
  /** the record that is open in front of the person, unless they said to ignore it */
  record: ScreenRecord | null;
  ignoreRecord: () => void;
  /** a screen says what is open on it (or, with null, that nothing is) */
  setRecord: (record: ScreenRecord | null) => void;
  /** a framed classic page can say what is open on it, and read its data again */
  setFrame: (frame: { read: FrameReader; refresh: () => void } | null) => void;
}

const AssistantContext = createContext<AssistantValue | null>(null);

/** The assistant, where there is one (inside the frame of the app); null elsewhere, so a screen drawn on its own does not need it. */
export function useAssistant(): AssistantValue | null {
  return useContext(AssistantContext);
}

export function AssistantProvider({ page, children }: { page: string; children: ReactNode }) {
  const { api, access, toasts } = useSession();
  const qc = useQueryClient();
  const available = can(access.actor, 'assistant.chat');
  const { known, act } = useSections(available);
  const sectionKey = sectionFor(known, page);
  const section = known.sections[sectionKey] ?? known.sections['home'];
  if (!section) throw new Error('the assistant has no Home section');
  const label = labelOf(known, sectionKey);
  const desktop = useMedia('(min-width: 1024px)');

  // Back where it was: the panel stays docked across a reload on a desktop (and does not take the keyboard when it comes back).
  const [open, setOpen] = useState(() => store.get(KEYS.open) === '1' && isDesktop());
  const [width, setWidthState] = useState(storedWidth);
  const [focusTick, setFocusTick] = useState(0);
  const [lang, setLang] = useState<Lang>('auto');
  const [talk, dispatch] = useReducer(reduce, {});
  const [answering, setAnswering] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ReadonlySet<string>>(new Set());
  const [kept, setKept] = useState<string | null>(null);
  const [shown, setShown] = useState<ScreenRecord | null>(null);
  const [ignored, setIgnored] = useState<string | null>(null);
  const frame = useRef<{ read: FrameReader; refresh: () => void } | null>(null);

  // The width is a variable of the page, as the classic panel keeps it: the page gives that much room when the panel is docked.
  useEffect(() => {
    document.documentElement.style.setProperty('--ai-w', `${width}px`);
  }, [width]);
  const setWidth = useCallback((w: number) => {
    const clamped = Math.max(WIDTH.min, Math.min(WIDTH.max, Math.round(w)));
    setWidthState(clamped);
    store.set(KEYS.width, String(clamped));
  }, []);

  const openPanel = useCallback(() => {
    setOpen(true);
    setKept(null);
    store.set(KEYS.open, '1');
    setFocusTick(t => t + 1);
  }, []);
  const closePanel = useCallback(() => {
    setOpen(false);
    store.set(KEYS.open, '0');
  }, []);
  const toggle = useCallback(
    () => (open ? closePanel() : openPanel()),
    [open, openPanel, closePanel],
  );

  // Ctrl/⌘+K opens and closes the panel from anywhere; Escape closes it when it has the keyboard, or when nothing else is open over the
  // page (a dialog keeps its own Escape).
  useEffect(() => {
    if (!available) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
        return;
      }
      if (e.key === 'Escape' && open) {
        const panel = document.querySelector('[data-part="aiPanel"]');
        const inside = !!panel && panel.contains(document.activeElement);
        const dialog = !!document.querySelector('[aria-modal="true"]');
        if (inside || (isDesktop() && !dialog)) {
          e.preventDefault();
          closePanel();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [available, open, toggle, closePanel]);

  // What is open in front of the person: a record that a screen has said is open, until they say to ignore it. A different record is
  // a new thing to ignore or not.
  const record = shown && recordKey(shown) !== ignored ? shown : null;
  const setRecord = useCallback((r: ScreenRecord | null) => {
    setShown(r);
    setIgnored(prev => (r && prev !== recordKey(r) ? null : prev));
  }, []);
  const ignoreRecord = useCallback(() => {
    if (shown) setIgnored(recordKey(shown));
  }, [shown]);
  const setFrame = useCallback((f: { read: FrameReader; refresh: () => void } | null) => {
    frame.current = f;
  }, []);

  const turns = talk[sectionKey] ?? NO_TURNS;

  /** After a proposal was carried out the page should show it: whatever a screen has read is read again (the cards are left as they are). */
  const refreshPage = useCallback(() => {
    void qc.invalidateQueries({ predicate: q => q.queryKey[0] !== 'assistant' });
    frame.current?.refresh();
  }, [qc]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || answering) return;
      const asked = sectionKey;
      const before = talk[asked] ?? [];
      if (before.length === 0) setKept(asked);
      dispatch({ type: 'asked', section: asked, content: message });
      setAnswering(asked);
      try {
        const screen: ScreenSnapshot = { page, section: asked };
        if (record) screen.record = recordSent(record);
        Object.assign(
          screen,
          readScreen(document.querySelector('[data-part="page"]'), asked),
          (await frame.current?.read().catch(() => null)) ?? {},
        );
        const d = await ask(api, {
          section: asked,
          page,
          message,
          history: historyOf(before),
          ...(lang !== 'auto' ? { lang } : {}),
          screen,
        });
        let reply: Turn;
        if (!d.ai) reply = { role: 'bot', content: SAID.chatNotConfigured };
        else if (!d.ok)
          reply = { role: 'bot', content: d.busy || SAID.chatFailed(d.error || SAID.unknownError) };
        else
          reply = {
            role: 'bot',
            content: d.answer || SAID.nothingToAdd,
            meta: {
              model: d.model,
              tool_calls: d.tool_calls,
              proposals: d.proposals.map((p): ProposalState => ({ ...p })),
            },
          };
        dispatch({ type: 'answered', section: asked, turn: reply });
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        dispatch({
          type: 'answered',
          section: asked,
          turn: { role: 'bot', content: SAID.network(why), unsent: true },
        });
      } finally {
        setAnswering(null);
      }
    },
    [answering, sectionKey, talk, page, record, api, lang],
  );

  const newChat = useCallback(() => {
    setKept(null);
    dispatch({ type: 'new', section: sectionKey });
  }, [sectionKey]);

  const confirm = useCallback(
    async (turn: number, proposal: number) => {
      const p = turns[turn]?.meta?.proposals[proposal];
      const key = `${sectionKey}:${turn}:${proposal}`;
      if (!p || p.state || confirming.has(key)) return;
      setConfirming(prev => new Set(prev).add(key));
      try {
        const done = await runAction(api, p.action);
        dispatch({
          type: 'proposal',
          section: sectionKey,
          turn,
          proposal,
          patch: { state: 'done', message: done.message || SAID.doneDefault },
        });
        toasts.show(done.message || SAID.done);
        refreshPage();
      } catch (e) {
        dispatch({
          type: 'proposal',
          section: sectionKey,
          turn,
          proposal,
          patch: { state: 'failed', error: e instanceof Error ? e.message : String(e) },
        });
      } finally {
        setConfirming(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [turns, sectionKey, confirming, api, toasts, refreshPage],
  );

  const dismiss = useCallback(
    (turn: number, proposal: number) =>
      dispatch({
        type: 'proposal',
        section: sectionKey,
        turn,
        proposal,
        patch: { state: 'dismissed' },
      }),
    [sectionKey],
  );

  const value = useMemo<AssistantValue>(
    () => ({
      available,
      known,
      act,
      page,
      section,
      label,
      open: available && open,
      docked: available && open && desktop,
      width,
      setWidth,
      focusTick,
      openPanel,
      closePanel,
      toggle,
      lang,
      setLang,
      turns,
      welcomeKept: kept === sectionKey && turns.length > 0,
      answering,
      send,
      newChat,
      confirming,
      confirm,
      dismiss,
      record,
      ignoreRecord,
      setRecord,
      setFrame,
    }),
    [
      available,
      known,
      act,
      page,
      section,
      label,
      open,
      desktop,
      width,
      setWidth,
      focusTick,
      openPanel,
      closePanel,
      toggle,
      lang,
      turns,
      kept,
      sectionKey,
      answering,
      send,
      newChat,
      confirming,
      confirm,
      dismiss,
      record,
      ignoreRecord,
      setRecord,
      setFrame,
    ],
  );
  return <AssistantContext value={value}>{children}</AssistantContext>;
}

/** Say what is open in front of the person (a supplier's page, a ticket) for as long as it is, so that "this one" means it. */
export function useAssistantRecord(record: ScreenRecord | null): void {
  const assistant = useAssistant();
  const set = assistant?.setRecord;
  const kind = record?.kind;
  const id = record?.id;
  const title = record?.title;
  const sub = record?.sub;
  useEffect(() => {
    if (!set) return;
    set(kind && id ? { kind, id, title: title ?? '', sub: sub ?? '' } : null);
    return () => set(null);
  }, [set, kind, id, title, sub]);
}

export { isPhone };
