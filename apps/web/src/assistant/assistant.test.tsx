import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, deferred, json, teamMe } from '../test/helpers';
import { open } from '../test/session';
import {
  ANSWER,
  assistantServer as server,
  CARD,
  SECTIONS,
  section,
  STATUS_OK,
} from '../test/assistant';

// The assistant, with the whole app around it and a server that answers as the real one does (src/test/assistant.ts; tests/assistroutes.js
// holds the real one to the same shapes).

function media(desktop: boolean, phone = false) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width: 1024px')
      ? desktop
      : query.includes('max-width: 768px')
        ? phone
        : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  media(false);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty('--ai-w');
  // @ts-expect-error a window with no matchMedia is what the tests start from
  delete window.matchMedia;
});

const pill = () => screen.getByRole('button', { name: 'Ask AI' });
const panel = () => screen.getByRole('dialog', { name: 'AI assistant' });
const openOn = async (
  path = '/submissions',
  said: Record<string, unknown> = {},
  me = adminMe(),
) => {
  const s = server('/api/dashboard', said);
  const app = open('admin', me, { entries: [path], more: s.routes });
  await screen.findByRole('button', { name: 'Ask AI' });
  return { ...s, ...app };
};
const showPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(pill());
  return await screen.findByRole('dialog', { name: 'AI assistant' });
};

describe('the button in the top bar', () => {
  it('is there for the administrator, with the key that opens the panel beside it', async () => {
    await openOn();
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    expect(within(pill()).getByText('Ask AI')).toBeTruthy();
    expect(within(pill()).getByText(/Ctrl K|⌘K/)).toBeTruthy();
    expect(pill().title).toMatch(/Ask the assistant · المساعد/);
  });

  it('names its key ⌘K on an Apple device and Ctrl K on any other', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    await openOn();
    expect(within(pill()).getByText('⌘K')).toBeTruthy();
    expect(pill().title).toMatch(/^⌘K · /);
    cleanup();
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Linux x86_64');
    await openOn();
    expect(within(pill()).getByText('Ctrl K')).toBeTruthy();
    expect(pill().title).toMatch(/^Ctrl\+K · /);
  });

  it('is there for a team member who may ask, and not for one who may not', async () => {
    const s = server('/api/employee');
    open('team', teamMe({ assistant: true }), { entries: ['/home'], more: s.routes });
    expect(await screen.findByRole('button', { name: 'Ask AI' })).toBeTruthy();
    cleanup();
    open('team', teamMe({ assistant: false }), { entries: ['/home'], more: s.routes });
    await screen.findByText(/Signed in as/);
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();
  });

  it('opens the panel when it is pressed, and puts it away when it is pressed again', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn();
    await showPanel(user);
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem('ml_ai_open')).toBe('1');
    await user.click(pill());
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('ml_ai_open')).toBe('0');
  });

  it('has the panel opened and put away by Ctrl+K and ⌘K, from anywhere, and by nothing else', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn();
    await user.keyboard('{Control>}k{/Control}');
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Meta>}k{/Meta}');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{Alt>}{Control>}k{/Control}{/Alt}');
    expect(pill().getAttribute('aria-expanded')).toBe('false'); // (Alt is another thing)
    await user.keyboard('k');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the browser from doing what Ctrl+K does there (it would put the cursor in the address bar)', async () => {
    await openOn();
    const e = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('is not the key of a person who may not ask: Ctrl+K does nothing for them', async () => {
    const s = server('/api/employee');
    open('team', teamMe({ assistant: false }), { entries: ['/home'], more: s.routes });
    await screen.findByText(/Signed in as/);
    const e = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'AI assistant' })).toBeNull();
  });
});

describe('the panel', () => {
  it('says what it reads and how the model is doing, and offers a few things to ask', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/submissions');
    const p = await showPanel(user);
    expect(within(p).getByText('Assistant')).toBeTruthy();
    expect(within(p).getByText('Submissions', { selector: '[data-part=aiSection] ' })).toBeTruthy();
    await waitFor(() =>
      expect(within(p).getByText('● Connected (llama-stub) · reading Submissions')).toBeTruthy(),
    );
    expect(within(p).getByText(/section — only what you are allowed to see/)).toBeTruthy();
    expect(within(p).getByText(/you confirm each one with a button/)).toBeTruthy();
    expect(within(p).getByRole('button', { name: 'Ask about Submissions' })).toBeTruthy();
  });

  it('offers to propose things only to a person who may act, and only in a section where there is something to propose', async () => {
    const user = userEvent.setup({ delay: null });
    const PROPOSING = /you confirm each one with a button/;
    // may act, and the section has actions: the offer is made
    await openOn('/submissions');
    expect(within(await showPanel(user)).queryByText(PROPOSING)).not.toBeNull();
    cleanup();
    // may not act, though the section has actions
    await openOn('/submissions', { sections: { ...SECTIONS, act: false } });
    expect(within(await showPanel(user)).queryByText(PROPOSING)).toBeNull();
    cleanup();
    // may act, but nothing can be proposed in the section
    await openOn('/submissions', {
      sections: {
        ...SECTIONS,
        sections: [section('home', 'Home'), section('submissions', 'Submissions', [])],
      },
    });
    const p = await showPanel(user);
    expect(within(p).getByText(/section — only what you are allowed to see/)).toBeTruthy();
    expect(within(p).queryByText(PROPOSING)).toBeNull();
  });

  it('slides in the first time as it does every time: it is there, closed, and opens a frame later', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => frames.push(cb));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const user = userEvent.setup({ delay: null });
    await openOn();
    const p = await showPanel(user);
    const scrim = document.querySelector('[data-part=aiOverlay]') as HTMLElement;
    expect(p.className).not.toMatch(/panelOpen/);
    expect(scrim.className).not.toMatch(/overlayOpen/);
    act(() => {
      for (const cb of frames.splice(0)) cb(0);
    });
    expect(p.className).toMatch(/panelOpen/);
    expect(scrim.className).toMatch(/overlayOpen/);
  });

  it("reads the section the page belongs to (and Home for a page that is nobody's)", async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/notifications');
    const p = await showPanel(user);
    expect(within(p).getByText('Home', { selector: '[data-part=aiSection] ' })).toBeTruthy();
    expect(within(p).getByRole('button', { name: 'Plan my day' })).toBeTruthy();
  });

  it('tells the person when the server is not set up for it, and when the model is busy or failing', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/submissions', { status: { ai: false, ok: false } });
    let p = await showPanel(user);
    await waitFor(() =>
      expect(within(p).getByText(/AI not configured — set CLOUDFLARE_ACCOUNT_ID/)).toBeTruthy(),
    );
    cleanup();
    await openOn('/submissions', {
      status: { ...STATUS_OK, ok: false, status: 429, error: 'Capacity' },
    });
    p = await showPanel(userEvent.setup({ delay: null }));
    await waitFor(() =>
      expect(within(p).getByText('● Busy — out of capacity, retry shortly')).toBeTruthy(),
    );
    cleanup();
    await openOn('/submissions', {
      status: { ...STATUS_OK, ok: false, status: 401, error: 'bad key' },
    });
    p = await showPanel(userEvent.setup({ delay: null }));
    await waitFor(() => expect(within(p).getByText('● Key set but failing: bad key')).toBeTruthy());
    cleanup();
    await openOn('/submissions', { status: { ...STATUS_OK, ok: null, model: null } });
    p = await showPanel(userEvent.setup({ delay: null }));
    await waitFor(() => expect(within(p).getByText('● Ready · reading Submissions')).toBeTruthy());
  });

  it('says "…" while it asks how the model is doing, and nothing at all if that cannot be had', async () => {
    const user = userEvent.setup({ delay: null });
    const wait = deferred<Response>();
    const s = server('/api/dashboard');
    s.routes['/api/dashboard/ai/status'] = () => wait.promise;
    open('admin', adminMe(), { entries: ['/submissions'], more: s.routes });
    await screen.findByRole('button', { name: 'Ask AI' });
    const p = await showPanel(user);
    const line = () => p.querySelector('[data-part=aiStatus]')?.textContent;
    expect(line()).toBe('…');
    wait.resolve(json(500, { error: 'boom' }));
    await waitFor(() => expect(line()).toBe(''));
  });

  it('asks how the model is doing each time it is opened, and says nothing where that cannot be had', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions');
    await showPanel(user);
    await waitFor(() => expect(s.heard.status).toBe(1));
    await user.click(pill());
    await user.click(pill());
    await waitFor(() => expect(s.heard.status).toBe(2));
  });

  it('speaks the language chosen: Arabic chips for Arabic, English where there are none in Arabic', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/notifications');
    const p = await showPanel(user);
    await user.selectOptions(within(p).getByTitle('Language'), 'ar');
    expect(within(p).getByRole('button', { name: 'ما الذي يحتاج انتباهي اليوم؟' })).toBeTruthy();
    expect(within(p).queryByRole('button', { name: 'Plan my day' })).toBeNull();
    await user.selectOptions(within(p).getByTitle('Language'), 'en');
    expect(within(p).getByRole('button', { name: 'Plan my day' })).toBeTruthy();
  });

  it('closes with its × and with Escape while it has the keyboard', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn();
    let p = await showPanel(user);
    await user.click(within(p).getByRole('button', { name: 'Close' }));
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    p = await showPanel(user);
    within(p).getByRole('textbox').focus();
    await user.keyboard('{Escape}');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves Escape to a dialog that is open over it, and to a page that is not on a desktop', async () => {
    const user = userEvent.setup({ delay: null });
    media(true);
    await openOn();
    await showPanel(user);
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    await user.keyboard('{Escape}');
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    modal.remove();
    await user.keyboard('{Escape}'); // (on a desktop, with nothing else open, it is the panel's)
    expect(pill().getAttribute('aria-expanded')).toBe('false');
    media(false);
    await user.click(pill());
    await user.keyboard('{Escape}'); // (not on a desktop, with the keyboard elsewhere: it is not)
    expect(pill().getAttribute('aria-expanded')).toBe('true');
  });

  it('is put back where it was on a desktop, without taking the keyboard, and not on a phone', async () => {
    localStorage.setItem('ml_ai_open', '1');
    media(true);
    await openOn();
    await waitFor(() => expect(pill().getAttribute('aria-expanded')).toBe('true'));
    await new Promise(r => setTimeout(r, 250)); // (the box takes the keyboard 120 ms after it is opened on purpose)
    expect(document.activeElement).not.toBe(within(panel()).getByRole('textbox'));
    cleanup();
    media(false);
    await openOn();
    await screen.findByRole('button', { name: 'Ask AI' });
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('puts the cursor in its box when it is opened on purpose — and not on a phone, whose keyboard would cover the answer — and leaves it be once it is put away', async () => {
    const user = userEvent.setup({ delay: null });
    media(true);
    await openOn();
    const p = await showPanel(user);
    await waitFor(() => expect(document.activeElement).toBe(within(p).getByRole('textbox')));
    await user.click(within(p).getByRole('button', { name: 'Close' }));
    await new Promise(r => setTimeout(r, 250));
    expect(document.activeElement).not.toBe(within(p).getByRole('textbox'));
    cleanup();
    media(false, true);
    await openOn();
    const q = await showPanel(user);
    await new Promise(r => setTimeout(r, 250));
    expect(document.activeElement).not.toBe(within(q).getByRole('textbox'));
  });

  it('gives the page its room on a desktop (docked), and covers it with a scrim where it cannot', async () => {
    const user = userEvent.setup({ delay: null });
    media(true);
    await openOn();
    const content = () => document.querySelector('[data-part=content]') as HTMLElement;
    expect(content().className).not.toMatch(/contentDocked/);
    await showPanel(user);
    expect(content().className).toMatch(/contentDocked/);
    expect((document.querySelector('[data-part=aiRoot]') as HTMLElement).className).toMatch(
      /docked/,
    );
    await user.click(pill());
    expect(content().className).not.toMatch(/contentDocked/);
    cleanup();
    media(false);
    await openOn();
    await showPanel(user);
    expect(content().className).not.toMatch(/contentDocked/);
    expect((document.querySelector('[data-part=aiRoot]') as HTMLElement).className).not.toMatch(
      /docked/,
    );
    const leave = document.querySelector('[data-part=aiOverlay] [data-close]') as HTMLElement;
    expect(leave.getAttribute('aria-hidden')).toBe('true'); // (a mouse's way out only; the keyboard has Escape and the ×)
    expect(leave.getAttribute('tabindex')).toBe('-1');
    await user.click(document.querySelector('[data-part=aiOverlay]') as HTMLElement);
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('remembers a width it was dragged to, between 340 and 760, and starts at 420', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn();
    expect(document.documentElement.style.getPropertyValue('--ai-w')).toBe('420px');
    const p = await showPanel(user);
    const grip = p.querySelector('[data-part=aiGrip]') as HTMLElement;
    p.getBoundingClientRect = () => ({ width: 420 }) as DOMRect;
    expect(grip.className).not.toMatch(/gripOn/);
    fireEvent.mouseDown(grip, { clientX: 1000 });
    expect(grip.className).toMatch(/gripOn/); // (the grip lights while it is held, and the page's text is not selected under it)
    expect(document.body.style.userSelect).toBe('none');
    fireEvent.mouseMove(window, { clientX: 900 }); // 100 to the left: 100 wider
    expect(document.documentElement.style.getPropertyValue('--ai-w')).toBe('520px');
    fireEvent.mouseMove(window, { clientX: -2000 });
    expect(document.documentElement.style.getPropertyValue('--ai-w')).toBe('760px');
    fireEvent.mouseMove(window, { clientX: 5000 });
    expect(document.documentElement.style.getPropertyValue('--ai-w')).toBe('340px');
    fireEvent.mouseMove(window, { clientX: 880 });
    fireEvent.mouseUp(window);
    expect(grip.className).not.toMatch(/gripOn/);
    expect(document.body.style.userSelect).toBe('');
    fireEvent.mouseMove(window, { clientX: 100 }); // (let go: it no longer follows)
    expect(document.documentElement.style.getPropertyValue('--ai-w')).toBe('540px');
    expect(localStorage.getItem('ml_ai_w')).toBe('540');
  });

  it('starts at the width it was left at, if that is a width it may be', async () => {
    for (const good of ['600', '340', '760']) {
      localStorage.setItem('ml_ai_w', good);
      await openOn();
      expect(document.documentElement.style.getPropertyValue('--ai-w')).toBe(`${good}px`);
      cleanup();
    }
    for (const bad of ['100', '339', '761', '9000', 'wide', '']) {
      localStorage.setItem('ml_ai_w', bad);
      await openOn();
      expect(document.documentElement.style.getPropertyValue('--ai-w')).toBe('420px');
      cleanup();
    }
  });
});

describe('a conversation', () => {
  const type = async (user: ReturnType<typeof userEvent.setup>, p: HTMLElement, words: string) => {
    await user.type(within(p).getByRole('textbox'), words);
  };

  it('sends what is typed with Enter, shows it, shows the answer with the model that gave it, and sends what the server needs', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions');
    const p = await showPanel(user);
    await type(user, p, 'How many today?{Enter}');
    const mine = within(p).getByText('How many today?');
    expect(mine.getAttribute('data-part')).toBe('msgUser');
    expect(mine.className).toMatch(/msgUser/);
    expect(mine.className).not.toMatch(/msgBot/);
    const theirs = await within(p).findByText('Three came today.');
    expect(theirs.getAttribute('data-part')).toBe('msgBot');
    expect(theirs.className).toMatch(/msgBot/);
    expect(theirs.className).not.toMatch(/msgUser/);
    expect(theirs.querySelector('details')).toBeNull(); // (it looked nothing up: there is no working to open)
    expect(within(p).getByText('AI · llama-stub')).toBeTruthy();
    expect(s.heard.chat).toHaveLength(1);
    expect(s.heard.chat[0]).toMatchObject({
      section: 'submissions',
      page: 'submissions',
      message: 'How many today?',
      history: [],
      screen: { page: 'submissions', section: 'submissions' },
    });
    expect(s.heard.chat[0]).not.toHaveProperty('lang');
    expect((within(p).getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('sends the conversation so far, but not the question it is asking, and the language if one was chosen', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions');
    const p = await showPanel(user);
    await type(user, p, 'first{Enter}');
    await within(p).findByText('Three came today.');
    await user.selectOptions(within(p).getByTitle('Language'), 'ar');
    await type(user, p, 'second{Enter}');
    await waitFor(() => expect(s.heard.chat).toHaveLength(2));
    expect(s.heard.chat[1]).toMatchObject({
      message: 'second',
      lang: 'ar',
      history: [
        { role: 'user', content: 'first' },
        { role: 'bot', content: 'Three came today.' },
      ],
    });
  });

  it('breaks the line on Shift+Enter, sends nothing that is empty, and nothing while a word is being composed', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions');
    const p = await showPanel(user);
    await type(user, p, 'one{Shift>}{Enter}{/Shift}two');
    expect((within(p).getByRole('textbox') as HTMLTextAreaElement).value).toBe('one\ntwo');
    expect(s.heard.chat).toHaveLength(0);
    await user.clear(within(p).getByRole('textbox'));
    await type(user, p, '   {Enter}');
    expect(s.heard.chat).toHaveLength(0);
    expect((within(p).getByRole('textbox') as HTMLTextAreaElement).value).toBe('   '); // (nothing was sent, so nothing was taken away)
    fireEvent.keyDown(within(p).getByRole('textbox'), { key: 'Enter', isComposing: true });
    expect(s.heard.chat).toHaveLength(0);
  });

  it('sends a chip as a question; the chips go, and the welcome stays above the first question', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions');
    const p = await showPanel(user);
    await user.click(within(p).getByRole('button', { name: 'Ask about Submissions' }));
    await within(p).findByText('Three came today.');
    expect(s.heard.chat[0]).toMatchObject({ message: 'Ask about Submissions' });
    expect(within(p).queryByRole('button', { name: 'Ask about Submissions' })).toBeNull();
    const body = p.querySelector('[data-part=aiBody]') as HTMLElement;
    expect(body.firstElementChild?.getAttribute('data-part')).toBe('welcome');
    expect(within(p).getByText(/section — only what you are allowed to see/)).toBeTruthy();
  });

  it('draws the welcome again, with the chips, in a new conversation; and a conversation that is drawn again (the panel opened again) is only what was said', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/submissions');
    let p = await showPanel(user);
    await type(user, p, 'first{Enter}');
    await within(p).findByText('Three came today.');
    await user.click(within(p).getByRole('button', { name: 'New conversation' }));
    expect(within(p).getByRole('button', { name: 'Ask about Submissions' })).toBeTruthy();
    await type(user, p, 'second{Enter}');
    await within(p).findByText('Three came today.');
    await user.click(pill()); // put away
    p = await showPanel(user); // …and opened again
    expect(p.querySelector('[data-part=welcome]')).toBeNull();
    expect(within(p).queryByText(/section — only what you are allowed to see/)).toBeNull();
    expect(within(p).getByText('second')).toBeTruthy();
  });

  it('answers one question at a time: the send is held while one is being answered, and says it is thinking', async () => {
    const user = userEvent.setup({ delay: null });
    const wait = deferred<Response>();
    const s = await openOn('/submissions', { chat: () => wait.promise });
    const p = await showPanel(user);
    await type(user, p, 'slow one{Enter}');
    expect(await within(p).findByText('…')).toBeTruthy();
    expect((within(p).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await type(user, p, 'impatient{Enter}');
    expect(s.heard.chat).toHaveLength(1);
    // …nor by a chip in another section, whose box is free: it is the model that is busy
    await user.click(screen.getByRole('link', { name: 'Issues' }));
    await user.click(await within(p).findByRole('button', { name: 'Ask about Issues' }));
    expect(s.heard.chat).toHaveLength(1);
    await user.click(screen.getByRole('link', { name: 'Submissions' }));
    wait.resolve(json(200, ANSWER));
    await within(p).findByText('Three came today.');
    expect(within(p).queryByText('…')).toBeNull();
    expect((within(p).getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('puts an answer in Arabic from the right, and shows the working of a lookup, a sum as a sum', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/submissions', {
      chat: {
        ...ANSWER,
        answer: 'الجواب ثلاثة',
        tool_calls: [
          {
            name: 'calculate',
            args: { expression: '1+2' },
            result: { expression: '1+2', result: 3 },
          },
          { name: 'calculate', args: { expression: '1/0' }, result: { error: 'Division by zero' } },
          // a sum is set out the way a person writes it: thousands apart, and no more than four places
          {
            name: 'calculate',
            args: { expression: '1234567.891234*1' },
            result: { result: 1234567.891234 },
          },
          { name: 'section_query', args: { query: 'find', q: 'x' }, result: { rows: [] } },
          // a lookup that found nothing to count has found "0", not an empty answer
          { name: 'count_rows', args: {}, result: 0 },
          { name: 'propose_action', args: { type: 'notify' }, result: { proposed: true } },
        ],
      },
    });
    const p = await showPanel(user);
    await type(user, p, 'مرحبا{Enter}');
    const answer = await within(p).findByText(/الجواب ثلاثة/);
    expect(answer.className).toMatch(/msgAr/);
    expect(within(p).getByText('مرحبا').className).toMatch(/msgAr/);
    expect(within(p).getByText('Worked out with 5 lookups')).toBeTruthy();
    const codes = [...p.querySelectorAll('details code')].map(c => c.textContent);
    expect(codes).toEqual([
      'calculate(1+2)\n= 3',
      'calculate(1/0)\nerror: Division by zero',
      'calculate(1234567.891234*1)\n= 1,234,567.8912',
      'section_query({"query":"find","q":"x"})\n{"rows":[]}',
      'count_rows({})\n0',
    ]);
  });

  it('says what went wrong in words: a busy model, a failing one, no model at all, and a call that did not go', async () => {
    const user = userEvent.setup({ delay: null });
    const said = async (reply: unknown) => {
      cleanup();
      await openOn('/submissions', { chat: reply });
      const p = await showPanel(userEvent.setup({ delay: null }));
      await type(user, p, 'hello{Enter}');
      return p;
    };
    let p = await said({
      ai: true,
      ok: false,
      error: 'cloudflare: Capacity',
      status: 429,
      busy: 'The assistant is busy right now.',
    });
    expect(await within(p).findByText('The assistant is busy right now.')).toBeTruthy();
    p = await said({ ai: true, ok: false, error: 'cloudflare: bad key', status: 401 });
    expect(
      await within(p).findByText('I could not answer just now: cloudflare: bad key'),
    ).toBeTruthy();
    p = await said({ ai: false, section: 'submissions' });
    expect(
      await within(p).findByText(/The assistant is not configured\. Set CLOUDFLARE_ACCOUNT_ID/),
    ).toBeTruthy();
    p = await said(() => json(500, { error: 'boom' }));
    expect(await within(p).findByText('Network error: boom')).toBeTruthy();
    p = await said({
      ai: true,
      ok: true,
      section: 'submissions',
      label: 'Submissions',
      answer: '',
      model: 'm',
      provider: 'p',
      tool_calls: [],
      proposals: [],
      lang: 'en',
    });
    expect(await within(p).findByText('I have nothing to add.')).toBeTruthy();
    p = await said({ nonsense: true });
    expect(await within(p).findByText('Network error: The answer could not be read')).toBeTruthy();
  });

  it('does not take what failed to go as something the assistant said, when the conversation goes on', async () => {
    const user = userEvent.setup({ delay: null });
    let n = 0;
    const s = await openOn('/submissions', {
      chat: () => (++n === 1 ? json(500, { error: 'boom' }) : json(200, ANSWER)),
    });
    const p = await showPanel(user);
    await type(user, p, 'one{Enter}');
    await within(p).findByText('Network error: boom');
    await type(user, p, 'two{Enter}');
    await within(p).findByText('Three came today.');
    expect(s.heard.chat[1]).toMatchObject({ history: [{ role: 'user', content: 'one' }] });
  });

  it('keeps a conversation for each section, and begins a new one on request', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/submissions');
    let p = await showPanel(user);
    await type(user, p, 'about submissions{Enter}');
    await within(p).findByText('Three came today.');
    await user.click(screen.getByRole('link', { name: 'Issues' }));
    p = panel();
    expect(
      await within(p).findByText('Issues', { selector: '[data-part=aiSection] ' }),
    ).toBeTruthy();
    expect(within(p).queryByText('about submissions')).toBeNull(); // (this section has none yet)
    await user.click(screen.getByRole('link', { name: 'Submissions' }));
    expect(await within(panel()).findByText('about submissions')).toBeTruthy();
    await user.click(within(panel()).getByRole('button', { name: 'New conversation' }));
    expect(within(panel()).queryByText('about submissions')).toBeNull();
    expect(within(panel()).getByText(/section — only what you are allowed to see/)).toBeTruthy();
  });
});

describe('a proposal', () => {
  const PROPOSAL = {
    action: { type: 'notify', title: 'Call Mona', to: 'me' },
    label: 'Notify',
    description: 'Send yourself a note: Call Mona.',
  };
  const WITH = { ...ANSWER, proposals: [PROPOSAL] };
  const ask = async (user: ReturnType<typeof userEvent.setup>, p: HTMLElement) => {
    await user.type(within(p).getByRole('textbox'), 'remind me{Enter}');
    return await within(p).findByText('Proposed · Notify');
  };

  it('comes under the answer as something to confirm, and nothing happens until it is', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions', { chat: WITH });
    const p = await showPanel(user);
    await ask(user, p);
    expect(within(p).getByText('Send yourself a note: Call Mona.')).toBeTruthy();
    expect(within(p).getByRole('button', { name: 'Confirm' })).toBeTruthy();
    expect(within(p).getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect((p.querySelector('[data-part=action]') as HTMLElement).className).not.toMatch(
      /actionFailed/,
    );
    expect(s.heard.run).toHaveLength(0);
  });

  it('is carried out when it is confirmed, as the card kept it, and says what was done, in the panel and at the foot of the screen', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions', { chat: WITH });
    const p = await showPanel(user);
    await ask(user, p);
    await user.click(within(p).getByRole('button', { name: 'Confirm' }));
    expect(await within(p).findByText('Notification sent to you.')).toBeTruthy();
    expect(within(p).getByText('Done')).toBeTruthy();
    expect(within(p).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(s.heard.run).toEqual([{ action: PROPOSAL.action }]);
    expect(
      document.querySelector('[data-part=toast], [role=status]')?.textContent ??
        document.body.textContent,
    ).toMatch(/Notification sent to you\./);
  });

  it('is held while it is being carried out, and cannot be confirmed twice', async () => {
    const user = userEvent.setup({ delay: null });
    const wait = deferred<Response>();
    const s = await openOn('/submissions', { chat: WITH, run: () => wait.promise });
    const p = await showPanel(user);
    await ask(user, p);
    const confirm = within(p).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
    await user.click(confirm);
    expect(confirm.disabled).toBe(true);
    expect((within(p).getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(confirm);
    expect(s.heard.run).toHaveLength(1);
    wait.resolve(json(200, { ok: true, type: 'notify', message: 'Done it.' }));
    expect(await within(p).findByText('Done it.')).toBeTruthy();
  });

  it('says why when the server would not carry it out, and offers nothing more to press', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/submissions', { chat: WITH, run: () => json(403, { error: 'Not permitted' }) });
    const p = await showPanel(user);
    await ask(user, p);
    await user.click(within(p).getByRole('button', { name: 'Confirm' }));
    expect(await within(p).findByText('Not permitted')).toBeTruthy();
    expect((p.querySelector('[data-part=actionFailed]') as HTMLElement).className).toMatch(
      /actionFailed/,
    );
    expect(within(p).queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(p).queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('is put away when it is dismissed, and stays away when the panel is drawn again', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions', { chat: WITH });
    const p = await showPanel(user);
    await ask(user, p);
    await user.click(within(p).getByRole('button', { name: 'Dismiss' }));
    expect(within(p).queryByText('Proposed · Notify')).toBeNull();
    await user.click(pill());
    await user.click(pill());
    expect(within(panel()).queryByText('Proposed · Notify')).toBeNull();
    expect(s.heard.run).toHaveLength(0);
  });

  it('has the page read again once it is done, so that the page shows what was done (and not the cards, which are left as they are)', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions', { chat: WITH });
    const p = await showPanel(user);
    await screen.findByText('AI insights · Submissions');
    const reads = () => s.calls('/api/v1/submissions').length;
    const cards = () => s.heard.insights.length;
    const before = [reads(), cards()];
    await ask(user, p);
    await user.click(within(p).getByRole('button', { name: 'Confirm' }));
    await within(p).findByText('Notification sent to you.');
    await waitFor(() => expect(reads()).toBeGreaterThan(before[0] ?? 0));
    expect(cards()).toBe(before[1]);
  });
});

describe('the card at the top of a page', () => {
  it('shows what the assistant sees in the section: highlights, risks and suggestions, who to call first, which model and when', async () => {
    await openOn('/submissions');
    expect(await screen.findByText('AI insights · Submissions')).toBeTruthy();
    expect(await screen.findByText('3 today')).toBeTruthy();
    expect(screen.getByText('1 unanswered')).toBeTruthy();
    expect(screen.getByText('Call Mona')).toBeTruthy();
    expect(screen.getByText('Call first')).toBeTruthy();
    expect(screen.getByText('1. Mona Saleh')).toBeTruthy();
    expect(screen.getByText('asked twice')).toBeTruthy();
    expect(screen.getByText('llama-stub · 10:42')).toBeTruthy();
    for (const word of ['3 today', '1 unanswered', 'Call Mona']) {
      expect(screen.getByText(word).closest('ul')?.className ?? '').not.toMatch(/rtl/);
    }
  });

  it('sets a list from the right when one of its lines is in Arabic, and only that list', async () => {
    await openOn('/submissions', {
      insights: {
        ...CARD,
        insights: {
          highlights: ['وصلت ٣ طلبات اليوم'],
          risks: ['واحد', 'One is late'],
          suggestions: ['Call Mona'],
        },
      },
    });
    const ul = async (text: string) => (await screen.findByText(text)).closest('ul');
    expect((await ul('وصلت ٣ طلبات اليوم'))?.className).toMatch(/rtl/);
    expect((await ul('One is late'))?.className).toMatch(/rtl/);
    expect((await ul('Call Mona'))?.className ?? '').not.toMatch(/rtl/);
  });

  it('is shown, not put away, where the browser will not say what was chosen', async () => {
    const real = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key.startsWith('ml_ai_card')) throw new Error('storage is refused');
      return real.call(this, key);
    });
    await openOn('/submissions');
    expect(await screen.findByText('3 today')).toBeTruthy();
  });

  it('says "cached" of a card the server kept, and "Nothing to flag." of a list with nothing in it', async () => {
    await openOn('/submissions', {
      insights: {
        ...CARD,
        cached: true,
        insights: { highlights: [], risks: [], suggestions: [] },
        extra: {},
      },
    });
    expect(await screen.findByText('cached · llama-stub · 10:42')).toBeTruthy();
    expect(screen.getAllByText('Nothing to flag.')).toHaveLength(3);
    expect(screen.queryByText('Call first')).toBeNull();
  });

  const card = () => document.querySelector('[data-part=aiCard]') as HTMLElement;

  it('asks again, whatever the server has kept, on Refresh (the page has a Refresh of its own, which is not this)', async () => {
    const user = userEvent.setup({ delay: null });
    const wait = deferred<Response>();
    let n = 0;
    const s = await openOn('/submissions', {
      insights: () => (++n === 1 ? json(200, CARD) : wait.promise),
    });
    await screen.findByText('3 today');
    expect(s.heard.insights).toEqual([{ page: 'submissions', refresh: false }]);
    await user.click(within(card()).getByRole('button', { name: 'Refresh' }));
    // (the card is "Reading this section…" until the new one comes, as the classic card is)
    expect(await within(card()).findByText('Reading this section…')).toBeTruthy();
    expect(within(card()).queryByText('3 today')).toBeNull();
    expect(s.heard.insights[1]).toEqual({ page: 'submissions', refresh: true });
    wait.resolve(json(200, { ...CARD, insights: { ...CARD.insights, highlights: ['4 today'] } }));
    expect(await within(card()).findByText('4 today')).toBeTruthy();
  });

  it('is asked for in the language chosen in the panel, and again when that changes', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions');
    await screen.findByText('3 today');
    const p = await showPanel(user);
    await user.selectOptions(within(p).getByTitle('Language'), 'ar');
    await waitFor(() => expect(s.heard.insights).toHaveLength(2));
    expect(s.heard.insights[1]).toEqual({ page: 'submissions', refresh: false, lang: 'ar' });
    await user.selectOptions(within(p).getByTitle('Language'), 'auto');
    await waitFor(() => expect(s.heard.insights).toHaveLength(3));
    expect(s.heard.insights[2]).toEqual({ page: 'submissions', refresh: false });
  });

  it('is put away with Hide and brought back with Show, remembered, and asks for nothing while it is put away', async () => {
    const user = userEvent.setup({ delay: null });
    const s = await openOn('/submissions');
    await screen.findByText('3 today');
    const card = () => document.querySelector('[data-part=aiCard]') as HTMLElement;
    expect(card().className).not.toMatch(/collapsed/);
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(localStorage.getItem('ml_ai_card_submissions')).toBe('closed');
    expect(screen.getByRole('button', { name: 'Show' })).toBeTruthy();
    expect(card().className).toMatch(/collapsed/);
    cleanup();
    const s2 = await openOn('/submissions');
    await screen.findByText('AI insights · Submissions');
    expect(await screen.findByRole('button', { name: 'Show' })).toBeTruthy();
    expect(s2.heard.insights).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(localStorage.getItem('ml_ai_card_submissions')).toBe('open');
    await screen.findByText('3 today');
    expect(s2.heard.insights).toHaveLength(1);
    expect(s.heard.insights).toHaveLength(1);
  });

  it('opens the panel on Ask', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/submissions');
    await user.click(await screen.findByRole('button', { name: 'Ask' }));
    expect(pill().getAttribute('aria-expanded')).toBe('true');
  });

  it("says what the server says where there is nothing to show: no model, a busy one, one that failed, the Accounting page's own", async () => {
    const wait = async (said: Record<string, unknown>) => {
      cleanup();
      await openOn('/submissions', said);
    };
    await wait({ insights: { ai: false, section: 'submissions' } });
    expect(
      await screen.findByText(
        /AI not configured — set CLOUDFLARE_ACCOUNT_ID .* to turn on insights and the assistant\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText('AI off')).toBeTruthy();
    await wait({
      insights: {
        ai: true,
        ok: false,
        error: 'cloudflare: Capacity',
        status: 429,
        busy: 'Busy right now.',
      },
    });
    expect(await screen.findByText('Busy right now.')).toBeTruthy();
    expect(screen.getByText('busy')).toBeTruthy();
    await wait({ insights: { ai: true, ok: false, error: 'cloudflare: bad key', status: 401 } });
    expect(await screen.findByText('cloudflare: bad key')).toBeTruthy();
    expect(screen.queryByText('busy')).toBeNull(); // (only a model out of capacity is called busy)
    await wait({
      insights: {
        ai: true,
        ok: false,
        section: 'accounting',
        note: 'The Accounting page carries its own insight cards.',
      },
    });
    expect(
      await screen.findByText('The Accounting page carries its own insight cards.'),
    ).toBeTruthy();
  });

  it('says that the call did not go, in the card, without taking the page with it', async () => {
    const s = server('/api/dashboard');
    s.routes['/api/dashboard/ai/insights'] = () => json(500, { error: 'boom' });
    open('admin', adminMe(), { entries: ['/submissions'], more: s.routes });
    expect(await screen.findByText('boom')).toBeTruthy();
    expect(screen.getByText('No submissions yet')).toBeTruthy();
  });

  it('is on the pages that have a section, for the person who may ask, and nowhere else', async () => {
    const user = userEvent.setup({ delay: null });
    await openOn('/submissions');
    await screen.findByText('AI insights · Submissions');
    await user.click(screen.getByRole('link', { name: 'Notifications' }));
    await screen.findByRole('button', { name: 'Ask AI' });
    expect(screen.queryByText(/^AI insights/)).toBeNull();
    cleanup();
    const s = server('/api/employee');
    open('team', teamMe({ assistant: false, submissions: true }), {
      entries: ['/submissions'],
      more: { ...s.routes, '/api/v1/submissions': () => json(200, { items: [] }) },
    });
    await screen.findByText('No submissions yet');
    expect(screen.queryByText(/^AI insights/)).toBeNull();
    expect(s.heard.insights).toHaveLength(0);
  });
});

describe('what is open in front of the person', () => {
  const type = async (user: ReturnType<typeof userEvent.setup>, p: HTMLElement, words: string) => {
    await user.type(within(p).getByRole('textbox'), words);
  };
  const ticket = (id: number, title: string) => ({
    id,
    title,
    description: 'Details',
    file_url: '',
    reporter_id: 9,
    reporter_name: 'Sara Ali',
    status: 'open',
    created_at: '2026-10-01T09:30:00.000Z',
    resolved_at: null,
    resolved_by: '',
  });
  const issues = (said: Record<string, unknown> = {}) => {
    const s = server('/api/dashboard', said);
    s.routes['/api/dashboard/ai/sections'] = () =>
      json(200, {
        ...SECTIONS,
        sections: [...SECTIONS.sections],
      });
    s.routes['/api/v1/issues'] = () =>
      json(200, { items: [ticket(4, 'Cannot log hours'), ticket(7, 'Wi-Fi drops')] });
    s.routes['/api/v1/issues/4/comments'] = () => json(200, { items: [] });
    s.routes['/api/v1/issues/7/comments'] = () => json(200, { items: [] });
    open('admin', adminMe(), { entries: ['/issues'], more: s.routes });
    return s;
  };
  const chip = () => document.querySelector('[data-part=aiScreen]') as HTMLElement;
  const card = (title: string) =>
    [...document.querySelectorAll<HTMLElement>('[data-part=card]')].find(c =>
      c.textContent?.includes(title),
    ) as HTMLElement;

  it('is said under the head of the panel as the record the questions are about, with the box asking about it', async () => {
    const user = userEvent.setup({ delay: null });
    issues();
    const p = await showPanel(user);
    await screen.findByText('Cannot log hours');
    expect(chip().textContent).toBe('');
    expect(chip().className).not.toMatch(/screenOn/);
    expect((within(p).getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe(
      'Ask about this section… · اسأل عن هذا القسم…',
    );
    await user.click(card('Cannot log hours'));
    await waitFor(() => expect(chip().textContent).toBe('Looking atIssue #4 · Cannot log hours×'));
    expect(chip().className).toMatch(/screenOn/);
    expect((within(p).getByRole('textbox') as HTMLTextAreaElement).placeholder).toBe(
      'Ask about this issue, or anything else…',
    );
  });

  it('goes with the question, as the server takes it (the kind, the number, what it is called)', async () => {
    const user = userEvent.setup({ delay: null });
    const s = issues();
    const p = await showPanel(user);
    await user.click(await screen.findByText('Cannot log hours'));
    await waitFor(() => expect(chip().textContent).toMatch(/Issue #4/));
    await type(user, p, 'summarise this{Enter}');
    await within(p).findByText('Three came today.');
    expect(s.heard.chat[0]?.['screen']).toMatchObject({
      page: 'issues',
      record: { kind: 'issue', id: '4', title: 'Cannot log hours', sub: '' },
    });
  });

  it('is let go of when the person says so, and the next question is about the section; another record is a new thing to look at', async () => {
    const user = userEvent.setup({ delay: null });
    const s = issues();
    const p = await showPanel(user);
    await user.click(await screen.findByText('Cannot log hours'));
    await user.click(await within(p).findByTitle('Ignore this record'));
    expect(chip().textContent).toBe('');
    await type(user, p, 'and now?{Enter}');
    await within(p).findByText('Three came today.');
    expect(s.heard.chat[0]?.['screen']).not.toHaveProperty('record');
    await user.click(screen.getByText('Wi-Fi drops'));
    await waitFor(() => expect(chip().textContent).toBe('Looking atIssue #7 · Wi-Fi drops×'));
  });

  it('is forgotten when the screen is left', async () => {
    const user = userEvent.setup({ delay: null });
    issues();
    await showPanel(user);
    await user.click(await screen.findByText('Cannot log hours'));
    await waitFor(() => expect(chip().textContent).toMatch(/Issue #4/));
    await user.click(screen.getByRole('link', { name: 'Submissions' }));
    await waitFor(() => expect(chip().textContent).toBe(''));
  });
});
