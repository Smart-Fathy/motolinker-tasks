import { describe, expect, it } from 'vitest';
import { reduce, type Conversations } from './histories';
import type { Turn } from './model';

const proposed = (): Turn => ({
  role: 'bot',
  content: 'I have proposed one.',
  meta: {
    model: 'm',
    tool_calls: [],
    proposals: [
      { action: { type: 'notify' }, label: 'Notify', description: 'Tell yourself' },
      { action: { type: 'create_task' }, label: 'Task', description: 'Make a task' },
    ],
  },
});

describe('the conversations', () => {
  it("start empty, and each section's is its own", () => {
    let state: Conversations = {};
    state = reduce(state, { type: 'asked', section: 'leads', content: 'hello' });
    state = reduce(state, { type: 'asked', section: 'deals', content: 'and you' });
    expect(state['leads']).toEqual([{ role: 'user', content: 'hello' }]);
    expect(state['deals']).toEqual([{ role: 'user', content: 'and you' }]);
  });

  it('go on in the order things were said', () => {
    let state: Conversations = {};
    state = reduce(state, { type: 'asked', section: 'leads', content: 'q1' });
    state = reduce(state, {
      type: 'answered',
      section: 'leads',
      turn: { role: 'bot', content: 'a1' },
    });
    state = reduce(state, { type: 'asked', section: 'leads', content: 'q2' });
    expect((state['leads'] ?? []).map(t => t.content)).toEqual(['q1', 'a1', 'q2']);
  });

  it('are begun again by a new conversation, in that section only', () => {
    let state: Conversations = {};
    state = reduce(state, { type: 'asked', section: 'leads', content: 'q' });
    state = reduce(state, { type: 'asked', section: 'deals', content: 'q' });
    state = reduce(state, { type: 'new', section: 'leads' });
    expect(state['leads']).toEqual([]);
    expect(state['deals']).toHaveLength(1);
  });

  it('say what became of a proposal, in the proposal and nowhere else', () => {
    let state: Conversations = { leads: [{ role: 'user', content: 'q' }, proposed()] };
    state = reduce(state, {
      type: 'proposal',
      section: 'leads',
      turn: 1,
      proposal: 0,
      patch: { state: 'done', message: 'Sent.' },
    });
    const proposals = state['leads']?.[1]?.meta?.proposals ?? [];
    expect(proposals[0]).toMatchObject({ state: 'done', message: 'Sent.', label: 'Notify' });
    expect(proposals[1]?.state).toBeUndefined();
    expect(state['leads']?.[0]).toEqual({ role: 'user', content: 'q' });
  });

  it('leave a conversation as it was when the proposal they speak of is not there', () => {
    const state: Conversations = { leads: [{ role: 'user', content: 'q' }, proposed()] };
    const move = (turn: number, proposal: number, section = 'leads') =>
      reduce(state, { type: 'proposal', section, turn, proposal, patch: { state: 'dismissed' } });
    expect(move(0, 0)).toBe(state); // the question has none
    expect(move(1, 5)).toBe(state); // no such proposal
    expect(move(9, 0)).toBe(state); // no such turn
    expect(move(1, 0, 'deals')).toBe(state); // no such section
  });
});
