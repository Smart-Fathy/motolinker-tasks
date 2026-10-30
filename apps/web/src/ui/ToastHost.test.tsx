import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToasts, TOAST_FADE_MS, TOAST_MS } from '../lib/toasts';
import { ToastHost } from './ToastHost';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const shown = (el: HTMLElement) => /shown/.test(el.className);

describe('the toast host', () => {
  it('draws a toast, fades it in on the next frame, fades it out after its time, and removes it once it has faded', () => {
    const toasts = createToasts();
    render(<ToastHost toasts={toasts} />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => toasts.show('New task assigned · Quote the Hilux'));
    const toast = screen.getByRole('status');
    expect(toast.textContent).toBe('New task assigned · Quote the Hilux');
    expect(shown(toast)).toBe(false);

    act(() => void vi.advanceTimersByTime(50));
    expect(shown(screen.getByRole('status'))).toBe(true);

    act(() => void vi.advanceTimersByTime(TOAST_MS));
    expect(shown(screen.getByRole('status'))).toBe(false);
    expect(screen.getByRole('status')).toBeTruthy();

    act(() => void vi.advanceTimersByTime(TOAST_FADE_MS));
    expect(screen.queryByRole('status')).toBeNull();
    expect(toasts.getSnapshot()).toEqual([]);
  });

  it('draws toasts that come close together, each with its own time', () => {
    const toasts = createToasts();
    render(<ToastHost toasts={toasts} />);
    act(() => toasts.show('first'));
    act(() => void vi.advanceTimersByTime(3000));
    act(() => toasts.show('second'));
    expect(screen.getAllByRole('status').map(t => t.textContent)).toEqual(['first', 'second']);
    act(() => void vi.advanceTimersByTime(1500));
    expect(screen.getAllByRole('status').map(t => t.textContent)).toEqual(['second']);
  });

  it('leaves no timer running when it goes', () => {
    const toasts = createToasts();
    const view = render(<ToastHost toasts={toasts} />);
    act(() => toasts.show('a'));
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
