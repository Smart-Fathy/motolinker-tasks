// The assistant, as a test with the whole app around it sees it: the panel opened by its key, and what it says it is looking at.
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { json } from './helpers';
import type { Answer } from './session';

/** Ctrl+K: the panel opens (or, if it was open, is put away). */
export async function pressAsk(): Promise<void> {
  await userEvent.keyboard('{Control>}k{/Control}');
}

/** Ctrl+K, and the panel is there (it comes in its own piece of the app, a moment after the key) to be read. */
export async function askOpen(): Promise<HTMLElement> {
  await pressAsk();
  return await screen.findByRole('dialog', { name: 'AI assistant' });
}

/** What the open panel says the person is looking at ("Supplier #3 · Yu Motors"), or nothing. */
export function looking(): string {
  const chip = document.querySelector('[data-part=aiScreen]');
  if (!chip) return '';
  return (chip.textContent ?? '').replace(/^Looking at/, '').replace(/×$/, '');
}

// ── A server that answers as the real one does (tests/assistroutes.js holds the real one to the same shapes) ──

export const CHIPS = {
  en: ['What needs my attention today?', 'Plan my day'],
  ar: ['ما الذي يحتاج انتباهي اليوم؟'],
};
export const section = (key: string, label: string, actions: string[] = ['notify']) => ({
  key,
  label,
  chips: key === 'home' ? CHIPS : { en: [`Ask about ${label}`], ar: [] },
  actions,
});
export const SECTIONS = {
  ai: true,
  act: true,
  sections: [
    section('home', 'Home'),
    section('submissions', 'Submissions'),
    section('issues', 'Issues'),
    section('suppliers', 'Suppliers', []),
  ],
  pages: { customers: 'leads' },
};
export const STATUS_OK = {
  ai: true,
  ok: true,
  provider: 'cloudflare',
  model: '@cf/meta/llama-stub',
  error: null,
  status: null,
  at: 1,
};
export const ANSWER = {
  ai: true,
  ok: true,
  section: 'submissions',
  label: 'Submissions',
  answer: 'Three came today.',
  model: '@cf/meta/llama-stub',
  provider: 'cloudflare',
  tool_calls: [],
  proposals: [],
  lang: 'en',
};
export const CARD = {
  ai: true,
  ok: true,
  model: '@cf/meta/llama-stub',
  provider: 'cloudflare',
  generated_at: '2026-11-01T10:42:00.000Z',
  section: 'submissions',
  label: 'Submissions',
  lang: 'en',
  insights: { highlights: ['3 today'], risks: ['1 unanswered'], suggestions: ['Call Mona'] },
  extra: { call_list: [{ customer_id: 7, name: 'Mona Saleh', why: 'asked twice' }] },
  cached: false,
};

/** The assistant's routes, answering with what a test says, and a record of what was heard. */
export function assistantServer(
  base: '/api/dashboard' | '/api/employee',
  said: Record<string, unknown> = {},
) {
  const heard = {
    chat: [] as Record<string, unknown>[],
    run: [] as Record<string, unknown>[],
    insights: [] as Record<string, unknown>[],
    status: 0,
  };
  const body = (init: RequestInit) =>
    JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
  const routes: Record<string, Answer> = {
    [`${base}/ai/sections`]: () => json(200, said['sections'] ?? SECTIONS),
    [`${base}/ai/status`]: () => {
      heard.status += 1;
      return json(200, said['status'] ?? STATUS_OK);
    },
    [`${base}/ai/insights`]: init => {
      heard.insights.push(body(init));
      const reply = said['insights'];
      return typeof reply === 'function'
        ? (reply as (b: Record<string, unknown>) => Response | Promise<Response>)(body(init))
        : json(200, reply ?? CARD);
    },
    [`${base}/ai/chat`]: init => {
      heard.chat.push(body(init));
      const reply = said['chat'];
      return typeof reply === 'function'
        ? (reply as (b: Record<string, unknown>) => Response | Promise<Response>)(body(init))
        : json(200, reply ?? ANSWER);
    },
    [`${base}/ai/actions/run`]: init => {
      heard.run.push(body(init));
      const reply = said['run'];
      return typeof reply === 'function'
        ? (reply as () => Response | Promise<Response>)()
        : json(
            200,
            reply ?? { ok: true, type: 'notify', message: 'Notification sent to you.', result: {} },
          );
    },
    '/api/v1/submissions': () => json(200, { items: [] }),
    '/api/v1/issues': () => json(200, { items: [] }),
  };
  return { heard, routes };
}
