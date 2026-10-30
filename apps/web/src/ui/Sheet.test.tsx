import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

afterEach(cleanup);

function Page({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      {open && (
        <Sheet
          title="A question"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          footer={<button type="button">Done</button>}
        >
          <input aria-label="Your answer" />
        </Sheet>
      )}
    </>
  );
}

describe('the shared sheet', () => {
  it('is a modal dialog named by its title, with its body and its buttons — drawn on the page itself, not inside what opened it', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    const dialog = screen.getByRole('dialog', { name: 'A question' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('takes focus when it opens, and gives it back to what had it when it closes', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Open it' });
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape and on its ×, and asks to be closed each time rather than going by itself', async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is not closed by a click on the curtain around it, so that what was typed is not lost to a stray click', async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    render(<Page onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    await user.type(screen.getByRole('textbox', { name: 'Your answer' }), 'half');
    await user.click(document.querySelector('[data-part=curtain]')!);
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'Your answer' }) as HTMLInputElement).value).toBe(
      'half',
    );
  });

  it('keeps Tab inside it: from the last control round to the first, and Shift+Tab from the first round to the last', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    const close = screen.getByRole('button', { name: 'Close' });
    const answer = screen.getByRole('textbox', { name: 'Your answer' });
    const done = screen.getByRole('button', { name: 'Done' });
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(answer);
    await user.tab();
    expect(document.activeElement).toBe(done);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(done);
    // …and Shift+Tab from the dialog itself, where focus starts, does not leave it either
    (document.querySelector('[role=dialog]') as HTMLElement).focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(done);
  });

  it('pulls focus back in when it has gone somewhere else and Tab is pressed', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    // (something drawn after the dialog, where Tab would otherwise go on to the start of the page behind it)
    const after = document.createElement('button');
    document.body.append(after);
    after.focus();
    expect(document.activeElement).toBe(after);
    await user.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    after.remove();
  });

  it('keeps focus where it is when it is drawn again (a parent redrawing is not a reason to take it back)', async () => {
    const user = userEvent.setup({ delay: null });
    const { rerender } = render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    const box = screen.getByRole('textbox', { name: 'Your answer' });
    await user.click(box);
    rerender(<Page />);
    expect(document.activeElement).toBe(box);
  });
});
