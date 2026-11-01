import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import { oneAtATime } from '../test/wrongly';
import {
  cardAllowed,
  historyOf,
  HOME,
  isAiActionDone,
  isAiChat,
  isAiInsights,
  isAiSections,
  isAiStatus,
  isAr,
  knownFrom,
  labelOf,
  lookingAt,
  modelName,
  placeholderFor,
  recordKey,
  recordSent,
  SAID,
  sectionFor,
  uiLang,
  type AiSections,
  type Known,
  type Turn,
} from './model';

const NOT_THINGS = [null, undefined, 7, 'x', true, [], [{}]];
const CHIPS = { en: ['What needs my attention today?'], ar: ['ما الذي يحتاج انتباهي اليوم؟'] };
const SECTION = (key: string, label = key) => ({ key, label, chips: CHIPS, actions: ['notify'] });
const SECTIONS: AiSections = {
  ai: true,
  act: true,
  sections: [SECTION('home', 'Home'), SECTION('leads', 'Leads'), SECTION('rfq', 'RFQ')],
  pages: { customers: 'leads', rfqs: 'rfq' },
};

/** The guard says what the schema says, of what is right and of every way each field can be wrong (the browser does not carry zod). */
function agrees(
  guard: (v: unknown) => boolean,
  schema: { safeParse: (v: unknown) => { success: boolean } },
  goods: Record<string, unknown>[],
) {
  for (const good of goods) {
    for (const s of [good, ...oneAtATime(good)]) {
      expect([guard(s), s]).toEqual([schema.safeParse(s).success, s]);
    }
  }
  for (const s of NOT_THINGS) expect([guard(s), s]).toEqual([schema.safeParse(s).success, s]);
}

describe("how the server's answers are recognised", () => {
  it('has the sections recognised as the schema recognises them', () => {
    agrees(isAiSections, schemas.AiSections, [
      { ...SECTIONS },
      { ai: false, act: false, sections: [], pages: {} },
      { ...SECTIONS, extra: 1 },
      {},
    ]);
    // …down to what is inside a section
    const inside = SECTIONS.sections[0];
    agrees(
      v => isAiSections({ ...SECTIONS, sections: [v] }),
      { safeParse: v => schemas.AiSections.safeParse({ ...SECTIONS, sections: [v] }) },
      [{ ...inside }, { ...inside, chips: { en: [], ar: [] } }],
    );
  });

  it('has the status recognised as the schema recognises it', () => {
    agrees(isAiStatus, schemas.AiStatus, [
      { ai: false, ok: false },
      { ai: true, ok: null, provider: null, model: null, error: null, status: null, at: 0 },
      {
        ai: true,
        ok: true,
        provider: 'cloudflare',
        model: '@cf/x/y',
        error: null,
        status: null,
        at: 7,
      },
      {
        ai: true,
        ok: false,
        provider: 'cloudflare',
        model: null,
        error: 'bad',
        status: 401,
        at: 7,
      },
      { ai: false, ok: true },
      {},
    ]);
  });

  const LISTS = { highlights: ['a'], risks: ['b'], suggestions: ['c'] };
  const CARD = {
    ai: true,
    ok: true,
    model: '@cf/x/y',
    provider: 'cloudflare',
    generated_at: '2026-11-01T10:00:00Z',
    section: 'leads',
    label: 'Leads',
    lang: 'en',
    insights: LISTS,
    extra: { call_list: [{ customer_id: 1, name: 'Ahmed', why: 'hot' }] },
    cached: false,
  };
  it('has the cards recognised as the schema recognises them', () => {
    agrees(isAiInsights, schemas.AiInsights, [
      CARD,
      { ...CARD, extra: {} },
      { ...CARD, extra: { call_list: [{ customer_id: null, name: '', why: '' }] } },
      { ai: false, section: 'leads' },
      { ai: false, ok: false, section: 'accounting', note: 'own cards' },
      { ai: true, ok: false, section: 'accounting', note: 'own cards' },
      { ai: true, ok: false, error: 'boom' },
      {
        ai: true,
        ok: false,
        error: 'busy',
        status: 429,
        busy: 'The assistant is busy',
        model: 'm',
      },
      {},
    ]);
    for (const [k, v] of Object.entries({ ...CARD.insights })) {
      expect(isAiInsights({ ...CARD, insights: { ...LISTS, [k]: [1] } })).toBe(false);
      expect(isAiInsights({ ...CARD, insights: { ...LISTS, [k]: v } })).toBe(true);
    }
  });

  it('has a call list that is not a list of calls turned away, whole, whatever it is instead (and without throwing)', () => {
    const good = { customer_id: 1, name: 'Ahmed', why: 'hot' };
    for (const call_list of [
      'x',
      5,
      null,
      {},
      true,
      [good, 5],
      [good, {}],
      [good, null],
      [{ ...good, name: 7 }],
    ]) {
      const card = { ...CARD, extra: { call_list } };
      expect(isAiInsights(card), JSON.stringify(call_list)).toBe(false);
      expect(schemas.AiInsights.safeParse(card).success, JSON.stringify(call_list)).toBe(false);
    }
    expect(isAiInsights({ ...CARD, extra: { call_list: [good, good] } })).toBe(true);
    expect(isAiInsights({ ...CARD, extra: { call_list: [] } })).toBe(true);
  });

  const ANSWER = {
    ai: true,
    ok: true,
    section: 'leads',
    label: 'Leads',
    answer: 'Three.',
    model: '@cf/x/y',
    provider: 'cloudflare',
    tool_calls: [{ name: 'calculate', args: { expression: '1+2' }, result: { result: 3 } }],
    proposals: [
      { action: { type: 'notify', title: 'x' }, label: 'Notify', description: 'Tell yourself' },
    ],
    lang: 'en',
  };
  it('has the answers recognised as the schema recognises them', () => {
    agrees(isAiChat, schemas.AiChat, [
      ANSWER,
      { ...ANSWER, tool_calls: [], proposals: [] },
      { ai: false, section: 'leads' },
      { ai: true, ok: false, error: 'no' },
      { ai: true, ok: false, section: 'leads', error: 'busy', status: 429, busy: 'busy' },
      {},
    ]);
    // a lookup with no result at all is not a lookup; a proposal with no kind is not one
    expect(isAiChat({ ...ANSWER, tool_calls: [{ name: 'x', args: {} }] })).toBe(
      schemas.AiChat.safeParse({ ...ANSWER, tool_calls: [{ name: 'x', args: {} }] }).success,
    );
    expect(isAiChat({ ...ANSWER, proposals: [{ action: {}, label: 'x', description: 'y' }] })).toBe(
      schemas.AiChat.safeParse({
        ...ANSWER,
        proposals: [{ action: {}, label: 'x', description: 'y' }],
      }).success,
    );
  });

  it('has a lookup that is not one turned away: it names what it asked and what with', () => {
    const lookup = (call: unknown) => ({ ...ANSWER, tool_calls: [call] });
    for (const call of [
      {},
      { name: 'x' },
      { args: {} },
      { name: 7, args: {} },
      { name: 'x', args: 'y' },
      { name: 'x', args: null },
      { name: 'x', args: [] },
      'x',
      null,
    ]) {
      expect(isAiChat(lookup(call)), JSON.stringify(call)).toBe(false);
      expect(schemas.AiChat.safeParse(lookup(call)).success, JSON.stringify(call)).toBe(false);
    }
    expect(isAiChat(lookup({ name: 'x', args: {} }))).toBe(true);
  });

  it('has a carried-out proposal recognised as the schema recognises it', () => {
    agrees(isAiActionDone, schemas.AiActionDone, [
      { ok: true, type: 'notify', message: 'Sent.', result: { to: 'x' } },
      { ok: true, type: 'notify', message: 'Sent.' },
      { ok: false, type: 'notify', message: 'Sent.' },
      {},
    ]);
  });
});

describe('which section a page belongs to', () => {
  const known = knownFrom(SECTIONS);

  it("is the page's own if it has one, and what it borrows otherwise, and Home at last", () => {
    expect(sectionFor(known, 'leads')).toBe('leads');
    expect(sectionFor(known, 'customers')).toBe('leads'); // the server's map
    expect(sectionFor(known, 'rfqs')).toBe('rfq');
    expect(sectionFor(known, 'email')).toBe('home'); // the classic map's, where the server's has none
    expect(sectionFor(known, 'deals')).toBe('home'); // a section this person was not offered
    expect(sectionFor(known, '')).toBe('home');
    expect(sectionFor(known, 'nonsense')).toBe('home');
  });

  it("is the classic map's where the server could not say, and Home where that gives a section not offered", () => {
    const none = knownFrom(null);
    expect(Object.keys(none.sections)).toEqual(['home']);
    expect(sectionFor(none, 'customers')).toBe('home'); // (the map says leads; leads was not offered)
    const noPages = knownFrom({ ...SECTIONS, pages: {} });
    expect(sectionFor(noPages, 'customers')).toBe('leads'); // the classic map
  });

  it('keeps Accounting its own, where it is offered', () => {
    const withAccounting = knownFrom({
      ...SECTIONS,
      sections: [...SECTIONS.sections, SECTION('accounting', 'Accounting')],
    });
    expect(sectionFor(withAccounting, 'accounting')).toBe('accounting');
    expect(sectionFor(known, 'accounting')).toBe('home');
  });

  it('is Home when the server left Home out, and says Home', () => {
    const k = knownFrom({ ...SECTIONS, sections: [SECTION('leads', 'Leads')] });
    expect(k.sections['home']).toBe(HOME);
    expect(labelOf(k, 'home')).toBe('Home');
    expect(labelOf(k, 'leads')).toBe('Leads');
    expect(labelOf(k, 'whatever')).toBe('whatever');
  });

  it('calls a section by its key when the server gave it no name (as the classic panel does), and Home by Home', () => {
    const k = knownFrom({ ...SECTIONS, sections: [SECTION('leads', ''), SECTION('home', '')] });
    expect(labelOf(k, 'leads')).toBe('leads');
    expect(labelOf(k, 'home')).toBe('Home');
  });

  it("puts a card on a section's own page, and on Home, and on the page that is an alias of a section — and nowhere else", () => {
    expect(cardAllowed(known, 'home')).toBe(true);
    expect(cardAllowed(known, 'leads')).toBe(true);
    expect(cardAllowed(known, 'customers')).toBe(true);
    expect(cardAllowed(known, 'rfqs')).toBe(true);
    expect(cardAllowed(known, 'rfq')).toBe(true);
    expect(cardAllowed(known, 'email')).toBe(false); // borrows Home's figures, and is a layout of its own
    expect(cardAllowed(known, 'chat')).toBe(false);
    expect(cardAllowed(known, 'deals')).toBe(false); // not offered to this person
    const without = knownFrom({ ...SECTIONS, sections: [SECTION('home', 'Home')] });
    expect(cardAllowed(without, 'customers')).toBe(false); // its alias is a section they do not have
  });
});

describe('the conversation', () => {
  const turn = (role: 'user' | 'bot', content: string, over: Partial<Turn> = {}): Turn => ({
    role,
    content,
    ...over,
  });

  it('goes to the server as the last eight turns, as who said them, and without a call that did not go', () => {
    const turns = Array.from({ length: 12 }, (_, i) => turn(i % 2 ? 'bot' : 'user', 'turn ' + i));
    const sent = historyOf(turns);
    expect(sent).toHaveLength(8);
    expect(sent[0]).toEqual({ role: 'user', content: 'turn 4' });
    expect(sent[7]).toEqual({ role: 'bot', content: 'turn 11' });
    expect(
      historyOf([
        turn('user', 'q'),
        turn('bot', 'Network error: x', { unsent: true }),
        turn('bot', 'a'),
      ]),
    ).toEqual([
      { role: 'user', content: 'q' },
      { role: 'bot', content: 'a' },
    ]);
    expect(historyOf([])).toEqual([]);
  });

  it('knows Arabic when it sees it, whichever the first letter', () => {
    expect(isAr('مرحبا')).toBe(true);
    expect(isAr('Hello مرحبا')).toBe(true);
    expect(isAr('Hello')).toBe(false);
    expect(isAr(null)).toBe(false);
    expect(isAr(undefined)).toBe(false);
  });

  it("speaks the language chosen, and the browser's when it is left on Auto", () => {
    expect(uiLang('en', 'ar-EG')).toBe('en');
    expect(uiLang('ar', 'en-US')).toBe('ar');
    expect(uiLang('auto', 'ar-EG')).toBe('ar');
    expect(uiLang('auto', 'AR')).toBe('ar');
    expect(uiLang('auto', 'en-US')).toBe('en');
    expect(uiLang('auto', undefined)).toBe('en');
  });

  it("calls a model by its name, without Cloudflare's prefix", () => {
    expect(modelName('@cf/meta/llama-3.1-8b')).toBe('llama-3.1-8b');
    expect(modelName('gemini-2.5-flash')).toBe('gemini-2.5-flash');
    expect(modelName(undefined)).toBe('AI');
    expect(modelName('')).toBe('AI');
  });

  it('says what a record is in front of the person, and what a box is for', () => {
    const r = { kind: 'lead', id: '7', title: 'Ahmed Hassan', sub: 'Hot' };
    expect(lookingAt(r)).toBe('Lead #7 · Ahmed Hassan');
    expect(lookingAt({ ...r, title: '' })).toBe('Lead #7');
    expect(lookingAt({ ...r, id: '' })).toBe('Lead · Ahmed Hassan');
    expect(lookingAt({ ...r, kind: 'planet' })).toBe('planet #7 · Ahmed Hassan');
    expect(placeholderFor(null)).toBe('Ask about this section… · اسأل عن هذا القسم…');
    expect(placeholderFor(r)).toBe('Ask about this lead, or anything else…');
    expect(placeholderFor({ ...r, kind: 'purchase_order' })).toBe(
      'Ask about this po, or anything else…',
    );
  });

  it('keeps a record to the length the server keeps, with its spaces squeezed', () => {
    const sent = recordSent({
      kind: 'lead',
      id: '7',
      title: ' A  long\n title ' + 'x'.repeat(200),
      sub: 's'.repeat(200),
    });
    expect(sent.title.length).toBe(120);
    expect(sent.title.startsWith('A long title')).toBe(true);
    expect(sent.sub.length).toBe(120);
    expect(recordKey({ kind: 'lead', id: '7' })).toBe('lead:7');
    expect(recordKey({ kind: 'deal', id: '7' })).not.toBe(recordKey({ kind: 'lead', id: '7' }));
  });

  it('has the words the classic panel has, to the letter, for the things a person reads most', () => {
    expect(SAID.ready('Leads')).toBe('● Ready · reading Leads');
    expect(SAID.connected('llama', 'Leads')).toBe('● Connected (llama) · reading Leads');
    expect(SAID.failing('bad key')).toBe('● Key set but failing: bad key');
    expect(SAID.busy).toBe('● Busy — out of capacity, retry shortly');
    expect(SAID.notConfigured).toBe(
      '● AI not configured — set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_AI_TOKEN (or GEMINI_API_KEY) on the server',
    );
    expect(SAID.lookups(1)).toBe('Worked out with 1 lookup');
    expect(SAID.lookups(2)).toBe('Worked out with 2 lookups');
    expect(SAID.tag('@cf/a/b')).toBe('AI · b');
    expect(SAID.tag(undefined)).toBe('AI');
    expect(SAID.proposed('Notify')).toBe('Proposed · Notify');
    expect(SAID.cardTitle('Leads')).toBe('AI insights · Leads');
    expect(SAID.welcome('Leads', true).act).toMatch(/you confirm each one with a button/);
    expect(SAID.welcome('Leads', false).act).toBe('');
  });
});

export type { Known };
