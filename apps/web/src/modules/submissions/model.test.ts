import { schemas } from '@motolinker/contracts';
import { describe, expect, it } from 'vitest';
import { isSubmission, isSubmissionList, whenOf } from './model';

const sub = (over: Record<string, unknown> = {}) => ({
  id: 3,
  name: 'Layla',
  email: 'layla@example.com',
  phone: '+20 100 555 0101',
  message: 'Hello',
  car_interest: 'Hilux',
  source: 'website',
  customer_id: 1,
  lead_name: 'Layla Hassan',
  created_at: '2026-09-21T10:30:00.000Z',
  ...over,
});

describe('what a submission is', () => {
  // The browser does not carry zod for this: these guards are held to the contract's schema, on what is right and on every
  // way of being wrong that the page could be handed.
  const corpus: unknown[] = [
    sub(),
    sub({ customer_id: null, lead_name: '' }),
    sub({ phone: '', message: '', car_interest: '' }),
    sub({ id: 1.5 }),
    sub({ id: '3' }),
    sub({ id: null }),
    sub({ name: null }),
    sub({ email: 5 }),
    sub({ phone: undefined }),
    sub({ message: [] }),
    sub({ car_interest: {} }),
    sub({ source: false }),
    sub({ customer_id: '1' }),
    sub({ customer_id: 2.5 }),
    sub({ customer_id: undefined }),
    sub({ lead_name: null }),
    sub({ created_at: 5 }),
    sub({ created_at: undefined }),
    null,
    undefined,
    'text',
    7,
    [],
    {},
  ];

  it.each(corpus.map((v, i) => [i, v] as const))(
    '%i: the guard agrees with the contract',
    (_i, v) => {
      expect(isSubmission(v)).toBe(schemas.Submission.safeParse(v).success);
    },
  );

  it('knows a list from what is not one', () => {
    const lists: unknown[] = [
      { items: [] },
      { items: [sub(), sub({ id: 4 })] },
      { items: [sub(), sub({ id: 'x' })] },
      { items: 'nope' },
      { items: null },
      { rows: [] },
      [],
      [sub()],
      null,
      'x',
    ];
    for (const v of lists)
      expect(isSubmissionList(v)).toBe(schemas.SubmissionList.safeParse(v).success);
    expect(isSubmissionList({ items: [] })).toBe(true);
    expect(isSubmissionList([sub()])).toBe(false);
  });
});

describe('when it came', () => {
  it("is written as the browser writes a date and a time, as the classic page's toLocaleString() does", () => {
    const iso = '2026-09-21T10:30:00.000Z';
    expect(whenOf(iso)).toBe(new Date(iso).toLocaleString());
    expect(whenOf(iso)).toMatch(/2026/);
  });
});
