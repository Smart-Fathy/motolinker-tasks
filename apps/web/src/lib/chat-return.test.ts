import { afterEach, describe, expect, it } from 'vitest';
import { chatReturn, clearChatReturn, takeChatReturn } from './chat-return';
import type { Where } from './arrival';

/** A page at `href`, with a history that records what it was told. */
function page(href: string) {
  const replaced: string[] = [];
  const where: Where = {
    location: { href: `https://app.example.com${href}` },
    history: {
      state: { keep: 'me' },
      replaceState: (_s, _t, url) => void replaced.push(String(url)),
    },
  };
  return { where, replaced };
}

afterEach(() => clearChatReturn());

describe('the reason Google Chat’s consent screen sent someone back with', () => {
  it('is read from the address and taken out of it, with everything else in the address left alone', () => {
    const { where, replaced } = page('/dashboard?gchat_error=Google%20said%20no&x=1#gchat');
    takeChatReturn(where);
    expect(chatReturn()).toBe('Google said no');
    expect(replaced).toEqual(['/dashboard?x=1#gchat']);
  });

  it('leaves no question mark behind when it was the only thing in the query', () => {
    const { where, replaced } = page('/employee?gchat_error=Bad%20Request#gchat');
    takeChatReturn(where);
    expect(chatReturn()).toBe('Bad Request');
    expect(replaced).toEqual(['/employee#gchat']);
  });

  it('does nothing for an address that has no reason in it, and does not touch the history', () => {
    const { where, replaced } = page('/dashboard?x=1#gchat');
    takeChatReturn(where);
    expect(chatReturn()).toBeNull();
    expect(replaced).toEqual([]);
  });

  it('keeps the history’s own state when it takes the reason out', () => {
    const calls: unknown[][] = [];
    takeChatReturn({
      location: { href: 'https://app.example.com/dashboard?gchat_error=x#gchat' },
      history: { state: { keep: 'me' }, replaceState: (...a) => void calls.push(a) },
    });
    expect(calls).toEqual([[{ keep: 'me' }, '', '/dashboard#gchat']]);
  });

  it('takes an empty reason out of the address and holds nothing (the classic page showed nothing for it)', () => {
    const { where, replaced } = page('/dashboard?gchat_error=#gchat');
    takeChatReturn(where);
    expect(chatReturn()).toBeNull();
    expect(replaced).toEqual(['/dashboard#gchat']);
  });

  it('keeps no more of a reason than a person should be shown', () => {
    const { where } = page('/dashboard?gchat_error=' + 'x'.repeat(1000) + '#gchat');
    takeChatReturn(where);
    expect(chatReturn()).toBe('x'.repeat(300));
  });

  it('is held until the screen has shown it, and then it is gone', () => {
    const { where } = page('/dashboard?gchat_error=Bad%20Request#gchat');
    takeChatReturn(where);
    expect(chatReturn()).toBe('Bad Request');
    expect(chatReturn()).toBe('Bad Request');
    clearChatReturn();
    expect(chatReturn()).toBeNull();
  });

  it('is replaced by the next, not added to it', () => {
    takeChatReturn(page('/dashboard?gchat_error=one#gchat').where);
    takeChatReturn(page('/dashboard?gchat_error=two#gchat').where);
    expect(chatReturn()).toBe('two');
  });

  it('reads the same in either portal', () => {
    takeChatReturn(page('/employee?gchat_error=Nope#gchat').where);
    expect(chatReturn()).toBe('Nope');
  });
});
