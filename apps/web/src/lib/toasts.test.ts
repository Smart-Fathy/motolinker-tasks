import { describe, expect, it, vi } from 'vitest';
import { createToasts } from './toasts';

describe('the toasts', () => {
  it('hold what was shown, in the order it was shown, each with a number of its own', () => {
    const toasts = createToasts();
    toasts.show('first');
    toasts.show('second');
    const list = toasts.getSnapshot();
    expect(list.map(t => t.text)).toEqual(['first', 'second']);
    expect(new Set(list.map(t => t.id)).size).toBe(2);
  });

  it('are the same array until something changes, so a screen that reads them is not redrawn for nothing', () => {
    const toasts = createToasts();
    toasts.show('a');
    const before = toasts.getSnapshot();
    expect(toasts.getSnapshot()).toBe(before);
    toasts.dismiss(999);
    expect(toasts.getSnapshot()).toBe(before);
  });

  it('let one go without touching the others', () => {
    const toasts = createToasts();
    toasts.show('a');
    toasts.show('b');
    const [a] = toasts.getSnapshot();
    toasts.dismiss(a!.id);
    expect(toasts.getSnapshot().map(t => t.text)).toEqual(['b']);
  });

  it('say so to whoever is listening, and stop when they stop', () => {
    const toasts = createToasts();
    const heard = vi.fn();
    const stop = toasts.subscribe(heard);
    toasts.show('a');
    toasts.dismiss(toasts.getSnapshot()[0]!.id);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    toasts.show('b');
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('never reuse a number, so a late dismissal cannot take away a newer toast', () => {
    const toasts = createToasts();
    toasts.show('a');
    const old = toasts.getSnapshot()[0]!.id;
    toasts.dismiss(old);
    toasts.show('b');
    toasts.dismiss(old);
    expect(toasts.getSnapshot().map(t => t.text)).toEqual(['b']);
  });
});
