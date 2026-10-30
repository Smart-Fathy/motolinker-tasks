import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeCore from '@theme-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Gallery from './Gallery';
import { galleryAt } from './route';

beforeEach(() => {
  document.head.innerHTML = '<style id="ws-theme">/* server */</style>';
  document.documentElement.setAttribute('data-mode', 'dark');
  document.documentElement.setAttribute('data-portal', 'admin');
});
afterEach(cleanup);

describe('where the gallery is', () => {
  it('is at <the portal>/__gallery, and nowhere else', () => {
    expect(galleryAt('/dashboard/__gallery')).toBe(true);
    expect(galleryAt('/employee/__gallery/')).toBe(true);
    expect(galleryAt('/__gallery')).toBe(true);
    expect(galleryAt('/dashboard')).toBe(false);
    expect(galleryAt('/dashboard/__gallery/x')).toBe(false);
    expect(galleryAt('/dashboard/leads')).toBe(false);
  });
});

describe('the gallery', () => {
  it('shows the colours, the primitives, the sign-in card and the real frame', async () => {
    render(<Gallery />);
    for (const section of ['colours', 'buttons', 'fields', 'sign-in', 'frame']) {
      expect(document.querySelector(`[data-section=${section}]`), section).toBeTruthy();
    }
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeTruthy();
    // every section of the rail is open, so there is nothing to measure that is not drawn
    expect(document.querySelectorAll('[data-part=group][class*=groupOpen]').length).toBe(8);
  });

  it('keeps every section of the frame open, and remembers nothing of what is pressed in it', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Gallery />);
    const head = await screen.findByRole('button', { name: /^CRM/ });
    await user.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(localStorage.getItem('ml_admin_navgroups')).toBeNull();
  });

  it('wears the look it is asked for, through the runtime the app uses', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Gallery />);
    await user.selectOptions(screen.getByLabelText('Look'), 'cyberpunk');
    await waitFor(() =>
      expect(document.getElementById('ws-theme')?.textContent).toBe(
        ThemeCore.renderThemeCss(ThemeCore.normalize({ theme: { preset: 'cyberpunk' } })),
      ),
    );
    await user.selectOptions(screen.getByLabelText('Mode'), 'light');
    await waitFor(() => expect(document.documentElement.getAttribute('data-mode')).toBe('light'));
  });

  it('switches the portal, and the page says which it is for the stylesheets', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Gallery />);
    await user.selectOptions(screen.getByLabelText('Portal'), 'team');
    await waitFor(() => expect(document.documentElement.dataset['portal']).toBe('team'));
    expect(await screen.findByRole('button', { name: 'Your account' })).toBeTruthy();
  });

  it('does not change the colour a person chose for the app', async () => {
    localStorage.setItem('ml_mode', 'light');
    const user = userEvent.setup({ delay: null });
    render(<Gallery />);
    await user.selectOptions(screen.getByLabelText('Mode'), 'dark');
    expect(localStorage.getItem('ml_mode')).toBe('light');
    localStorage.clear();
  });
});
