// What the assistant is made of, apart from how it is drawn: how the server's answers are recognised, which section a page belongs to,
// what a conversation holds, what is on the screen, and the words. The classic portals carry this once, in public/assets/assistant.js
// (shared by both); the routes behind it are the server's own, one set mounted for each portal (tests/assistroutes.js).

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(x => typeof x === 'string');
const optionalText = (v: unknown) => v === undefined || typeof v === 'string';
const optionalNumber = (v: unknown) => v === undefined || typeof v === 'number';

// ── What the server answers ─────────────────────────────────────────────────────────────────────────────────────────

export interface AiSection {
  key: string;
  label: string;
  chips: { en: string[]; ar: string[] };
  actions: string[];
}

/** What GET …/ai/sections says (packages/contracts: schemas.AiSections): what this person may ask about, and whether they may act. */
export interface AiSections {
  ai: boolean;
  act: boolean;
  sections: AiSection[];
  pages: Record<string, string>;
}

const isSection = (v: unknown): v is AiSection =>
  isObject(v) &&
  typeof v['key'] === 'string' &&
  typeof v['label'] === 'string' &&
  isObject(v['chips']) &&
  isStringList(v['chips']['en']) &&
  isStringList(v['chips']['ar']) &&
  isStringList(v['actions']);

export function isAiSections(v: unknown): v is AiSections {
  return (
    isObject(v) &&
    typeof v['ai'] === 'boolean' &&
    typeof v['act'] === 'boolean' &&
    Array.isArray(v['sections']) &&
    v['sections'].every(isSection) &&
    isObject(v['pages']) &&
    Object.values(v['pages']).every(x => typeof x === 'string')
  );
}

/** What GET …/ai/status says (schemas.AiStatus): no model configured, or the state the last real call left it in (no call is spent to say it). */
export type AiStatus =
  | { ai: false; ok: false }
  | {
      ai: true;
      ok: boolean | null;
      provider: string | null;
      model: string | null;
      error: string | null;
      status: number | null;
      at: number;
    };

const nullableText = (v: unknown) => v === null || typeof v === 'string';

export function isAiStatus(v: unknown): v is AiStatus {
  if (!isObject(v)) return false;
  if (v['ai'] === false) return v['ok'] === false;
  return (
    v['ai'] === true &&
    (v['ok'] === null || typeof v['ok'] === 'boolean') &&
    nullableText(v['provider']) &&
    nullableText(v['model']) &&
    nullableText(v['error']) &&
    (v['status'] === null || typeof v['status'] === 'number') &&
    typeof v['at'] === 'number'
  );
}

export interface AiCallListEntry {
  customer_id: number | null;
  name: string;
  why: string;
}

/** What POST …/ai/insights says (schemas.AiInsights): not configured, the Accounting page's own, the model unable to answer, or the card. */
export type AiInsights =
  | { ai: false; section: string }
  | { ai: true; ok: false; section: string; note: string }
  | { ai: true; ok: false; error: string; status?: number; busy?: string; model?: string }
  | {
      ai: true;
      ok: true;
      model: string;
      provider: string;
      generated_at: string;
      section: string;
      label: string;
      lang: string;
      insights: { highlights: string[]; risks: string[]; suggestions: string[] };
      extra: { call_list?: AiCallListEntry[] };
      cached: boolean;
    };

const isCallListEntry = (v: unknown): v is AiCallListEntry =>
  isObject(v) &&
  (v['customer_id'] === null || typeof v['customer_id'] === 'number') &&
  typeof v['name'] === 'string' &&
  typeof v['why'] === 'string';

export function isAiInsights(v: unknown): v is AiInsights {
  if (!isObject(v)) return false;
  if (v['ai'] === false) return typeof v['section'] === 'string';
  if (v['ai'] !== true) return false;
  if (v['ok'] === false) {
    const own = typeof v['section'] === 'string' && typeof v['note'] === 'string';
    const failed =
      typeof v['error'] === 'string' &&
      optionalNumber(v['status']) &&
      optionalText(v['busy']) &&
      optionalText(v['model']);
    return own || failed;
  }
  if (v['ok'] !== true) return false;
  const ins = v['insights'];
  const extra = v['extra'];
  return (
    typeof v['model'] === 'string' &&
    typeof v['provider'] === 'string' &&
    typeof v['generated_at'] === 'string' &&
    typeof v['section'] === 'string' &&
    typeof v['label'] === 'string' &&
    typeof v['lang'] === 'string' &&
    typeof v['cached'] === 'boolean' &&
    isObject(ins) &&
    isStringList(ins['highlights']) &&
    isStringList(ins['risks']) &&
    isStringList(ins['suggestions']) &&
    isObject(extra) &&
    (extra['call_list'] === undefined ||
      (Array.isArray(extra['call_list']) && extra['call_list'].every(isCallListEntry)))
  );
}

/** A lookup the model made on the way to an answer: what it asked, and what it got back. */
export interface AiToolCall {
  name: string;
  args: Record<string, unknown>;
  /** what it got back (JSON leaves out what is undefined, so there may be nothing) */
  result?: unknown;
}

/** An action the model proposes. It is nothing until the person confirms it, and the server checks it again when they do. */
export interface AiProposal {
  action: { type: string } & Record<string, unknown>;
  label: string;
  description: string;
}

/** What POST …/ai/chat says (schemas.AiChat): not configured, the model unable to answer, or the answer. */
export type AiChat =
  | { ai: false; section: string }
  | {
      ai: true;
      ok: false;
      section?: string;
      error: string;
      status?: number;
      busy?: string;
    }
  | {
      ai: true;
      ok: true;
      section: string;
      label: string;
      answer: string;
      model: string;
      provider: string;
      tool_calls: AiToolCall[];
      proposals: AiProposal[];
      lang: string;
    };

const isToolCall = (v: unknown): v is AiToolCall =>
  isObject(v) && typeof v['name'] === 'string' && isObject(v['args']);

const isProposal = (v: unknown): v is AiProposal =>
  isObject(v) &&
  isObject(v['action']) &&
  typeof v['action']['type'] === 'string' &&
  typeof v['label'] === 'string' &&
  typeof v['description'] === 'string';

export function isAiChat(v: unknown): v is AiChat {
  if (!isObject(v)) return false;
  if (v['ai'] === false) return typeof v['section'] === 'string';
  if (v['ai'] !== true) return false;
  if (v['ok'] === false) {
    return (
      optionalText(v['section']) &&
      typeof v['error'] === 'string' &&
      optionalNumber(v['status']) &&
      optionalText(v['busy'])
    );
  }
  return (
    v['ok'] === true &&
    typeof v['section'] === 'string' &&
    typeof v['label'] === 'string' &&
    typeof v['answer'] === 'string' &&
    typeof v['model'] === 'string' &&
    typeof v['provider'] === 'string' &&
    typeof v['lang'] === 'string' &&
    Array.isArray(v['tool_calls']) &&
    v['tool_calls'].every(isToolCall) &&
    Array.isArray(v['proposals']) &&
    v['proposals'].every(isProposal)
  );
}

/** What POST …/ai/actions/run says (schemas.AiActionDone) when it carried the action out. */
export interface AiActionDone {
  ok: true;
  type: string;
  message: string;
  result?: unknown;
}

export const isAiActionDone = (v: unknown): v is AiActionDone =>
  isObject(v) &&
  v['ok'] === true &&
  typeof v['type'] === 'string' &&
  typeof v['message'] === 'string';

// ── Which section a page belongs to ─────────────────────────────────────────────────────────────────────────────────

/** The classic pages that borrow another section's figures (the server's answer wins once it has been read). */
export const PAGES: Readonly<Record<string, string>> = {
  customers: 'leads',
  leads: 'leads',
  rfqs: 'rfq',
  rfq: 'rfq',
  calendar: 'meet',
  deletions: 'home',
  notif: 'home',
  chat: 'home',
  whatsapp: 'home',
  gchat: 'home',
  email: 'home',
  drive: 'home',
  sheets: 'home',
  reports: 'deals',
  availability: 'meet',
};

/** What is known of the sections: the server's answer, or Home alone where it could not be had. */
export interface Known {
  sections: Readonly<Record<string, AiSection>>;
  pages: Readonly<Record<string, string>> | null;
}

/** The Home section as the classic panel makes it when the server could not say what there is (or left Home out). */
export const HOME: AiSection = {
  key: 'home',
  label: 'Home',
  chips: { en: ['What needs my attention today?'], ar: ['ما الذي يحتاج انتباهي اليوم؟'] },
  actions: [],
};

export function knownFrom(answer: AiSections | null): Known {
  const sections: Record<string, AiSection> = {};
  for (const s of answer?.sections ?? []) sections[s.key] = s;
  if (!sections['home']) sections['home'] = HOME;
  return { sections, pages: answer?.pages ?? null };
}

/** The section the assistant reads when a person is on this page: the page's own if it has one, what it borrows otherwise, Home at last. */
export function sectionFor(known: Known, page: string): string {
  const p = page || 'home';
  if (p === 'accounting') return known.sections['accounting'] ? 'accounting' : 'home';
  if (known.sections[p]) return p;
  const mapped = known.pages?.[p] ?? PAGES[p] ?? 'home';
  return known.sections[mapped] ? mapped : 'home';
}

export const labelOf = (known: Known, section: string): string =>
  known.sections[section]?.label || (section === 'home' ? 'Home' : section);

/**
 * The insight card belongs on a section's own page. Chat, mail, Drive, Sheets, the calendar, notifications and the rest borrow Home's
 * figures for the panel but are full-height layouts of their own — a card there sits on top of the conversation list and breaks the page.
 */
const CARD_ALIASES: Readonly<Record<string, string>> = {
  customers: 'leads',
  leads: 'leads',
  rfqs: 'rfq',
  rfq: 'rfq',
};

export function cardAllowed(known: Known, page: string): boolean {
  if (page === 'home' || known.sections[page]) return true;
  const alias = CARD_ALIASES[page];
  return !!alias && !!known.sections[alias];
}

// ── The conversation ────────────────────────────────────────────────────────────────────────────────────────────────

export type Lang = 'auto' | 'en' | 'ar';

/** An action proposed in an answer, and what became of it. */
export interface ProposalState extends AiProposal {
  /** done (the server carried it out), dismissed (the person put it away), failed (the server said no) — none yet while it waits to be confirmed */
  state?: 'done' | 'dismissed' | 'failed';
  /** what was done, in words, once it has been */
  message?: string;
  /** why it was not, once it was not */
  error?: string;
}

export interface Turn {
  role: 'user' | 'bot';
  content: string;
  /** an answer's working: the model, the lookups, and the proposals to confirm */
  meta?: { model?: string; tool_calls: AiToolCall[]; proposals: ProposalState[] };
  /** the call did not go: shown to the person, and not part of the conversation the model is shown */
  unsent?: true;
}

/** The turns that go with a question: the last eight, as the server reads them (a call that did not go was never said to the model). */
export const HISTORY_SENT = 8;
export const historyOf = (turns: readonly Turn[]): { role: 'user' | 'bot'; content: string }[] =>
  turns
    .filter(t => !t.unsent)
    .slice(-HISTORY_SENT)
    .map(t => ({ role: t.role, content: t.content }));

/** The pictures the panel draws (the app's set has them; src/app/shell/icons.test.ts checks that each one is drawn by something). */
export const AI_ICONS = { newChat: 'message-square-plus', send: 'send' } as const;

export const isAr = (s: unknown): boolean => /[؀-ۿ]/.test(String(s ?? ''));

/** The language the panel speaks when it is left on Auto: the browser's, Arabic or English. */
export function uiLang(lang: Lang, browser: string | undefined): 'en' | 'ar' {
  if (lang === 'en' || lang === 'ar') return lang;
  return (browser ?? '').toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

/** A model's name as the panel shows it: Cloudflare's "@cf/meta/" prefix is not part of the name. */
export const modelName = (m: unknown): string => String(m || 'AI').replace(/^@cf\/[^/]+\//, '');

// ── What is on the screen ───────────────────────────────────────────────────────────────────────────────────────────

/** The kinds of record the server reads from the screen (and the words the panel calls them by). */
export const KIND_LABEL: Readonly<Record<string, string>> = {
  lead: 'Lead',
  deal: 'Deal',
  task: 'Task',
  supplier: 'Supplier',
  purchase_order: 'PO',
  rfq: 'RFQ',
  contract: 'Contract',
  quotation: 'Quotation',
  container: 'Container',
  vehicle: 'VIN',
  stock_model: 'Stock',
  request: 'Request',
  issue: 'Issue',
  meeting: 'Meeting',
  submission: 'Submission',
  expense: 'Expense',
  employee: 'Employee',
  sale: 'Sale',
  automation: 'Rule',
  report: 'Report',
};

/** A record that is open in front of the person (a supplier's detail, a ticket): what kind, which, and how to say it. */
export interface ScreenRecord {
  kind: string;
  id: string;
  title: string;
  sub: string;
}

/** What the panel tells the server about the screen with every question (the server reads these and no others). */
export interface ScreenSnapshot {
  page: string;
  section: string;
  record?: ScreenRecord;
  tab?: string;
  search?: string;
  filters?: Record<string, string>;
  selected?: { kind: string; id: string; title: string }[];
}

const squash = (s: string | null | undefined, max: number): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const recordKey = (r: Pick<ScreenRecord, 'kind' | 'id'>): string => `${r.kind}:${r.id}`;

/** The record as it is sent: its words cut to the length the server keeps. */
export function recordSent(r: ScreenRecord): ScreenRecord {
  return {
    kind: r.kind,
    id: r.id,
    title: squash(r.title, 120),
    sub: squash(r.sub, 120),
  };
}

/** "Looking at Lead #7 · Ahmed" — the line under the panel's head that says what a question about "this" will mean. */
export function lookingAt(r: ScreenRecord): string {
  return (
    (KIND_LABEL[r.kind] ?? r.kind) + (r.id ? ' #' + r.id : '') + (r.title ? ' · ' + r.title : '')
  );
}

/** The placeholder of the box: about the record that is open, or about the section. */
export const placeholderFor = (r: ScreenRecord | null): string =>
  r
    ? 'Ask about this ' + (KIND_LABEL[r.kind] ?? r.kind).toLowerCase() + ', or anything else…'
    : 'Ask about this section… · اسأل عن هذا القسم…';

// ── The words ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SET_UP = 'set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server';

export const SAID = {
  title: 'Assistant',
  ask: 'Ask AI',
  askLabel: 'Ask AI',
  newChat: 'New conversation',
  close: 'Close (Esc)',
  language: 'Language',
  grip: 'Drag to resize',
  send: 'Send',
  lookingAt: 'Looking at',
  panelFailed:
    'The assistant could not be opened. Check your connection and try again (or reload the page).',
  ignore: 'Ignore this record',
  typing: '…',
  statusPending: '…',
  notConfigured: `● AI not configured — ${SET_UP}`,
  busy: '● Busy — out of capacity, retry shortly',
  ready: (label: string) => `● Ready · reading ${label}`,
  connected: (model: string, label: string) => `● Connected (${model}) · reading ${label}`,
  failing: (why: string) => `● Key set but failing: ${why}`,
  unknownError: 'unknown error',
  welcome: (label: string, act: boolean) => ({
    before: 'I read the ',
    label,
    after:
      ' section — only what you are allowed to see — and I can follow any lead, deal, supplier or VIN across the whole system, or search everything. Ask me to explain a figure, find something, work something out or draft a message, in English or العربية.',
    act: act
      ? ' I can also propose things to do here — a follow-up, a task, a status change, a payment — and you confirm each one with a button.'
      : '',
  }),
  chatNotConfigured: `The assistant is not configured. Set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server and I will read this section for you.`,
  chatFailed: (why: string) => `I could not answer just now: ${why}`,
  nothingToAdd: 'I have nothing to add.',
  network: (why: string) => `Network error: ${why}`,
  lookups: (n: number) => `Worked out with ${n} lookup${n === 1 ? '' : 's'}`,
  tag: (model: string | undefined) => (model ? 'AI · ' + modelName(model) : 'AI'),
  proposed: (label: string) => `Proposed · ${label}`,
  done: 'Done',
  doneDefault: 'Done.',
  confirm: 'Confirm',
  dismiss: 'Dismiss',
  cardTitle: (label: string) => `AI insights · ${label}`,
  cardOff: `AI not configured — ${SET_UP} to turn on insights and the assistant.`,
  cardReading: 'Reading this section…',
  cardBusy: 'The AI could not answer just now.',
  cardOffStatus: 'AI off',
  cardBusyStatus: 'busy',
  refresh: 'Refresh',
  cardAsk: 'Ask',
  hide: 'Hide',
  show: 'Show',
  highlights: 'Highlights',
  risks: 'Risks',
  suggestions: 'Suggestions',
  nothing: 'Nothing to flag.',
  callFirst: 'Call first',
} as const;

/** The keys the panel remembers in the browser, which are the classic portals' own (a width or a closed card carries over). */
export const KEYS = {
  open: 'ml_ai_open',
  width: 'ml_ai_w',
  card: (page: string) => `ml_ai_card_${page}`,
} as const;

/** How wide the panel may be dragged (the classic panel's own limits). */
export const WIDTH = { min: 340, max: 760, start: 420 } as const;
