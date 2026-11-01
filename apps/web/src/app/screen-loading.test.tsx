import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe } from '../test/helpers';
import { open } from '../test/session';

// The file of the Issues screen is on its way and does not arrive: importing it never settles.
vi.mock('../modules/issues/Issues', () => new Promise(() => undefined));

beforeEach(() => {
  localStorage.clear();
  document.head.innerHTML = `<title data-ws-title="{ws} · Admin">Acme · Admin</title><style id="ws-theme">/* server */</style>`;
});
afterEach(cleanup);

describe('a screen whose file is on its way', () => {
  it('stands in its place, inside the frame, which is up at once', async () => {
    open('admin', adminMe(), { entries: ['/issues'] });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(within(screen.getByRole('main')).getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy();
  });
});
