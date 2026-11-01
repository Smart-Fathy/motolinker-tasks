import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, teamMe } from '../test/helpers';
import { open } from '../test/session';
import type { LazyPage } from './define-module';
import { registry } from './registry';

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const preloadOf = (id: string) =>
  vi.spyOn(registry.get(id)?.Page as LazyPage, 'preload').mockImplementation(() => undefined);

describe("the rail's items", () => {
  it('start the fetch of their screen when the pointer reaches them, so it is there by the time they are pressed', async () => {
    const user = userEvent.setup({ delay: null });
    const preload = preloadOf('issues');
    open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    const rail = screen.getByRole('navigation', { name: 'Sections' });
    expect(preload).not.toHaveBeenCalled();
    await user.hover(within(rail).getByRole('link', { name: 'Issues' }));
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('start it for the keyboard too, as focus arrives', async () => {
    const preload = preloadOf('issues');
    open('admin', adminMe());
    await screen.findByText(/Signed in as Admin/);
    within(screen.getByRole('navigation', { name: 'Sections' }))
      .getByRole('link', { name: 'Issues' })
      .focus();
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it("are the team's buttons, which do the same", async () => {
    const user = userEvent.setup({ delay: null });
    const preload = preloadOf('submissions');
    open('team', teamMe({ submissions: true }));
    await screen.findByText(/Signed in as/);
    const rail = screen.getByRole('navigation', { name: 'Sections' });
    await user.hover(within(rail).getByRole('button', { name: /Submissions/ }));
    expect(preload).toHaveBeenCalledTimes(1);
    within(rail)
      .getByRole('button', { name: /Submissions/ })
      .focus();
    expect(preload).toHaveBeenCalledTimes(2);
  });
});

describe("the phone's bottom bar", () => {
  it('starts the fetch as a finger goes down, the moment before it lifts, and as focus arrives', async () => {
    const preload = preloadOf('home');
    open('team', teamMe());
    await screen.findByText(/Signed in as/);
    const bar = screen.getByRole('navigation', { name: 'Quick links' });
    // (the event itself, which moves no focus: a finger going down does both, and the two are told apart here)
    fireEvent.pointerDown(within(bar).getByRole('button', { name: /Home/ }));
    expect(preload).toHaveBeenCalledTimes(1);
    within(bar).getByRole('button', { name: /Home/ }).focus();
    expect(preload).toHaveBeenCalledTimes(2);
  });
});
