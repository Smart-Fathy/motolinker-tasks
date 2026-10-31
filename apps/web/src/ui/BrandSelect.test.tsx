import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrandSelect, type SelectOption } from './BrandSelect';
import { Sheet } from './Sheet';

afterEach(cleanup);

const LENGTHS: SelectOption[] = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
];

function Field({
  options = LENGTHS,
  initial = '30',
  onChange = () => undefined,
}: {
  options?: SelectOption[];
  initial?: string;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="length">Length</label>
      <BrandSelect
        id="length"
        value={value}
        options={options}
        onChange={v => {
          setValue(v);
          onChange(v);
        }}
      />
    </>
  );
}

describe('the dropdown drawn as a button of the page’s own', () => {
  it('shows the page’s words on the page’s class instead of its own label, and still lists and chooses', async () => {
    const user = userEvent.setup({ delay: null });
    const chosen = vi.fn();
    render(
      <BrandSelect
        part="filter"
        value=""
        options={[{ value: '', label: 'All' }, ...LENGTHS]}
        onChange={chosen}
        look={{ className: 'tbar-btn', children: <i data-testid="mine">Filter</i> }}
      />,
    );
    const trigger = document.querySelector('[data-part=filter]') as HTMLElement;
    expect(trigger.className).toBe('tbar-btn');
    expect(trigger.textContent).toBe('Filter');
    expect(screen.getByTestId('mine')).toBeTruthy();
    await user.click(trigger);
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      'All',
      '15 min',
      '30 min',
      '45 min',
    ]);
    await user.click(screen.getByRole('option', { name: '45 min' }));
    expect(chosen).toHaveBeenCalledWith('45');
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('the dropdown', () => {
  it('is a button named by its label that shows the choice, with the options closed', () => {
    render(<Field />);
    const trigger = screen.getByLabelText('Length');
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.textContent).toBe('30 min');
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('listbox')).toBeNull();
    // (its own look, which an open list adds to)
    expect(trigger.className).toMatch(/trigger/);
    expect(trigger.className).not.toMatch(/open/);
  });

  it('opens a panel of the options with the chosen one marked, drawn on the page itself', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<Field />);
    await user.click(screen.getByLabelText('Length'));
    expect(screen.getByLabelText('Length').className).toMatch(/open/);
    const panel = screen.getByRole('listbox');
    expect(container.contains(panel)).toBe(false);
    expect(screen.getByLabelText('Length').getAttribute('aria-expanded')).toBe('true');
    expect(
      screen.getAllByRole('option').map(o => [o.textContent, o.getAttribute('aria-selected')]),
    ).toEqual([
      ['15 min', 'false'],
      ['30 min', 'true'],
      ['45 min', 'false'],
    ]);
  });

  it('chooses an option: the panel closes, the button shows it, and the change is told once', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    await user.click(screen.getByLabelText('Length'));
    await user.click(screen.getByRole('option', { name: '45 min' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Length').textContent).toBe('45 min');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('45');
    // choosing what is already chosen is not a change
    await user.click(screen.getByLabelText('Length'));
    await user.click(screen.getByRole('option', { name: '45 min' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape, on a click elsewhere, and on a second click on the button — and keeps its choice', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <>
        <Field />
        <button type="button">elsewhere</button>
      </>,
    );
    const trigger = screen.getByLabelText('Length');
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.textContent).toBe('30 min');
  });

  it('can be opened and walked with the arrow keys, and chosen with Enter', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Field initial="15" />);
    screen.getByLabelText('Length').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    // (it opens on the choice)
    expect(document.activeElement?.textContent).toBe('15 min');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('30 min');
    await user.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('45 min');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('15 min');
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toBe('45 min');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByLabelText('Length').textContent).toBe('45 min');
  });

  it('shows an option that cannot be chosen and does not take it', async () => {
    const user = userEvent.setup({ delay: null });
    const onChange = vi.fn();
    render(
      <Field
        options={[...LENGTHS, { value: 'x', label: 'Not yet', disabled: true }]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText('Length'));
    const no = screen.getByRole('option', { name: 'Not yet' });
    expect(no.getAttribute('aria-disabled')).toBe('true');
    await user.click(no);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Length').textContent).toBe('30 min');
  });

  it('offers a search box when the list is long, which narrows it, says when nothing is left, and takes the first on Enter', async () => {
    const user = userEvent.setup({ delay: null });
    const many = Array.from({ length: 12 }, (_, i) => ({
      value: String(i),
      label: i % 2 ? `Lead ${i}` : `Car ${i}`,
    }));
    render(<Field options={many} initial="0" />);
    await user.click(screen.getByLabelText('Length'));
    const search = screen.getByRole('textbox', { name: 'Search' });
    await user.type(search, 'lead');
    expect(
      screen.getAllByRole('option').filter(o => (o as HTMLElement).style.display !== 'none'),
    ).toHaveLength(6);
    await user.clear(search);
    await user.type(search, 'zzz');
    expect(screen.getByText('No matches').style.display).toBe('block');
    await user.clear(search);
    await user.type(search, 'lead 5');
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Length').textContent).toBe('Lead 5');
  });

  it('has no search box for a short list', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Field />);
    await user.click(screen.getByLabelText('Length'));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows nothing (a space) for a value that is not among the options', () => {
    render(<Field initial="zzz" />);
    expect(screen.getByLabelText('Length').textContent).toBe(' ');
  });

  it('inside a dialog, Escape closes the panel and leaves the dialog open; the next Escape closes the dialog', async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    render(
      <Sheet title="A question" onClose={onClose} footer={<button type="button">Done</button>}>
        <Field />
      </Sheet>,
    );
    await user.click(screen.getByLabelText('Length'));
    expect(screen.getByRole('listbox')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the window changes width, and only moves when it changes height', async () => {
    const user = userEvent.setup({ delay: null });
    render(<Field />);
    await user.click(screen.getByLabelText('Length'));
    const width = window.innerWidth;
    const height = window.innerHeight;
    act(() => {
      window.innerHeight = height - 100;
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByRole('listbox')).toBeTruthy();
    act(() => {
      window.innerWidth = width + 10;
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    window.innerWidth = width;
    window.innerHeight = height;
  });
});
