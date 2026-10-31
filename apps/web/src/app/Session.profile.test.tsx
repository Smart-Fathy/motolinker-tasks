import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, teamMe, team } from '../test/helpers';
import { frame } from '../test/session';
import { Session } from './Session';

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
  document.documentElement.setAttribute('data-mode', 'dark');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('what a person has just changed about themselves', () => {
  it("is shown at once, and gives way to the server's own word the next time it is asked", async () => {
    const user = userEvent.setup({ delay: null });
    const f = frame('team', {
      '/api/employee/status': () => json(200, { status_text: 'Focusing', status_emoji: '📚' }),
    });
    const props = {
      env: team,
      token: 'tok',
      signOut: vi.fn(),
      onUnauthorized: vi.fn(),
      fetchImpl: f.fetchImpl,
      entries: ['/'],
      safe: false,
    };
    const first = teamMe({}, 'Sales', {}, { statusText: '', statusEmoji: '' });
    const view = render(<Session {...props} me={first} />);
    await user.click(await screen.findByRole('button', { name: 'Your account' }));
    await user.click(document.querySelector('[data-part=status]')!);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Status updated');
    await user.click(screen.getByRole('button', { name: 'Your account' }));
    expect(document.querySelector('[data-part=status]')!.textContent).toBe('📚 Focusing');

    // the server is asked again, and it says something else (it was changed on another device): that is what is shown
    view.rerender(
      <Session
        {...props}
        me={teamMe({}, 'Sales', {}, { statusText: 'On holiday', statusEmoji: '🏝️' })}
      />,
    );
    expect(document.querySelector('[data-part=status]')!.textContent).toBe('🏝️ On holiday');
  });
});
