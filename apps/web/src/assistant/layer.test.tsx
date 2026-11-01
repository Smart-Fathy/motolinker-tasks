import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantLayer } from './Layer';
import { SAID } from './model';

// The panel is its own file. When that file cannot come (the connection dropped; or the app was updated since this page was opened and
// the file it names is gone) the app must go on: the person is told, the panel is put away, and the next opening tries again.

const made = vi.hoisted(() => ({ files: 0 }));
const toast = vi.fn();
const toasts = { show: toast };
const close = vi.fn();
const assistant = { available: true, open: true, focusTick: 1, closePanel: close };

vi.mock('./state', () => ({ useAssistant: () => assistant }));
vi.mock('../app/context', () => ({ useSession: () => ({ toasts }) }));
// (a panel whose file never comes: it throws as it is drawn, which is what a failed fetch does to a lazy page)
vi.mock('../app/define-module', () => ({
  lazyPage: () => {
    made.files += 1;
    const Offline = () => {
      throw new Error('Failed to fetch dynamically imported module');
    };
    return Object.assign(Offline, { preload: vi.fn() });
  },
}));

afterEach(() => {
  cleanup();
  toast.mockClear();
  close.mockClear();
  Object.assign(assistant, { available: true, open: true, focusTick: 1 });
  vi.restoreAllMocks();
});

describe('the panel, when its file cannot come', () => {
  it('leaves the app standing, tells the person, and puts the panel away', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(
      <div data-part="app">
        <AssistantLayer />
      </div>,
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith(SAID.panelFailed));
    expect(close).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('[data-part=app]')).not.toBeNull();
  });

  it('tries again, with a new attempt at the file, at the next opening — and not before', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(<AssistantLayer />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1));
    const attempts = made.files;
    view.rerender(<AssistantLayer />); // (nothing opened it again: nothing is asked for again)
    await new Promise(r => setTimeout(r, 50));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(made.files).toBe(attempts);
    assistant.focusTick = 2; // opened again
    view.rerender(<AssistantLayer />);
    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2));
    expect(made.files).toBe(attempts + 1);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('draws nothing, and asks for nothing, for a person who may not ask or has not opened it', () => {
    Object.assign(assistant, { available: false, open: false });
    const view = render(<AssistantLayer />);
    expect(view.container.innerHTML).toBe('');
    Object.assign(assistant, { available: true, open: false });
    view.rerender(<AssistantLayer />);
    expect(view.container.innerHTML).toBe('');
    expect(toast).not.toHaveBeenCalled();
  });
});
