import { describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle';

describe('throttle', () => {
  it('does the first call at once, drops the ones that follow within the time, and allows one again after it', () => {
    let t = 1000;
    const fn = vi.fn();
    const slow = throttle(fn, 5000, () => t);
    slow();
    t += 4999;
    slow();
    slow();
    expect(fn).toHaveBeenCalledTimes(1);
    t += 1;
    slow();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('counts from the call that was let through, not from the ones that were dropped', () => {
    let t = 0;
    const fn = vi.fn();
    const slow = throttle(fn, 100, () => t);
    slow();
    t = 90;
    slow();
    t = 110;
    slow();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('lets the very first call through even when the clock reads zero', () => {
    const fn = vi.fn();
    throttle(fn, 100, () => 0)();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
