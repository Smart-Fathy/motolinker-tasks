import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, json } from '../test/helpers';
import { open } from '../test/session';

// The file of the Issues screen never arrives (the connection dropped, or the app was updated since this page was opened and the
// old files are gone): importing it fails, as a fetch of a file that is not there does.
vi.mock('../modules/issues/Issues', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a screen whose file cannot be had', () => {
  it('says so inside the frame, with the way out, instead of taking the whole app down', async () => {
    open('admin', adminMe(), { entries: ['/issues'] });
    expect(await screen.findByText(/This screen could not be shown/)).toBeTruthy();
    // the rail and the top bar are still there
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Toggle menu' })).toBeTruthy();
    // …and the card offers the classic page, at its own address
    const card = screen.getByText(/This screen could not be shown/).closest('section');
    expect(card).toBeTruthy();
    expect(
      within(card as HTMLElement)
        .getByRole('link', { name: /classic portal/ })
        .getAttribute('href'),
    ).toMatch(/^\/legacy\/dashboard/);
    expect(within(card as HTMLElement).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('offers a reload, which is what a screen from an older build needs', async () => {
    const reload = vi.fn();
    const real = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...real, reload, assign: real.assign.bind(real) },
    });
    try {
      const user = userEvent.setup({ delay: null });
      open('admin', adminMe(), { entries: ['/issues'] });
      await user.click(await screen.findByRole('button', { name: 'Try again' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: real });
    }
  });

  it('does not follow the person to the next screen they choose', async () => {
    const user = userEvent.setup({ delay: null });
    open('admin', adminMe(), {
      entries: ['/issues'],
      more: { '/api/v1/submissions': () => json(200, { items: [] }) },
    });
    await screen.findByText(/This screen could not be shown/);
    const rail = screen.getByRole('navigation', { name: 'Sections' });
    await user.click(within(rail).getByRole('link', { name: 'Submissions' }));
    expect(await screen.findByText('No submissions yet')).toBeTruthy();
    expect(screen.queryByText(/This screen could not be shown/)).toBeNull();
  });
});
