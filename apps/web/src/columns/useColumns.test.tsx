import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { MouseEvent, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContext, type SessionValue } from '../app/context';
import { adminMe, teamMe } from '../test/helpers';
import type { Column } from './model';
import { useColumns } from './useColumns';

afterEach(cleanup);

const col = (key: string, over: Partial<Column> = {}): Column => ({
  key,
  label: key[0]!.toUpperCase() + key.slice(1),
  type: 'text',
  builtin: true,
  visible: true,
  ...over,
});
const BUILTINS = [col('name'), col('contact'), col('notes')];

/** The engine for one table, mounted under a session of this portal whose server holds this saved arrangement. */
function setup(portal: 'admin' | 'team', saved: unknown = null) {
  const put = vi.fn(async () => ({ ok: true }));
  const get = vi.fn(async () => ({ columns: saved, entity: 'suppliers' }));
  const toasts = { show: vi.fn() };
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const value = {
    portal,
    me: portal === 'admin' ? adminMe() : teamMe({ suppliers: true }),
    api: { base: '/api/dashboard', get, put },
    toasts,
  } as unknown as SessionValue;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SessionContext value={value}>{children}</SessionContext>
    </QueryClientProvider>
  );
  return { wrapper, put, get };
}
const pointer = (x = 40, y = 50) =>
  ({ clientX: x, clientY: y, stopPropagation: () => undefined }) as unknown as MouseEvent;

describe('who may open the editor', () => {
  it('is the administrator: for anybody else nothing opens, whatever a screen asks for', async () => {
    const s = setup('team');
    const { result } = renderHook(() => useColumns('suppliers', BUILTINS), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canEdit).toBe(false);
    // (one at a time: opening a dialog puts a menu away, which would hide a menu that had wrongly opened)
    for (const ask of [
      () => result.current.openMenu(pointer(), 'name'),
      () => result.current.openPicker(pointer()),
      () => result.current.openAdd(),
      () => result.current.openField('name'),
      () => result.current.openType('name'),
      () => result.current.openOptions('name'),
    ]) {
      act(ask);
      expect(result.current.menu).toBeNull();
      expect(result.current.dialog).toBeNull();
    }
  });

  it('opens a column’s menu, the list and each dialog for the administrator', async () => {
    const s = setup('admin');
    const { result } = renderHook(() => useColumns('suppliers', BUILTINS), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canEdit).toBe(true);
    act(() => result.current.openMenu(pointer(), 'name'));
    expect(result.current.menu).toMatchObject({ kind: 'column', key: 'name' });
    act(() => result.current.openPicker(pointer()));
    expect(result.current.menu?.kind).toBe('picker');
    act(() => result.current.openPicker(pointer()));
    expect(result.current.menu).toBeNull();
    for (const [open, kind] of [
      [() => result.current.openAdd(), 'add'],
      [() => result.current.openField('name'), 'field'],
      [() => result.current.openType('name'), 'type'],
      [() => result.current.openOptions('name'), 'options'],
    ] as const) {
      act(open);
      expect(result.current.dialog?.kind).toBe(kind);
    }
    // a column that is not there opens nothing
    act(() => result.current.closeDialog());
    act(() => result.current.openField('nope'));
    expect(result.current.dialog).toBeNull();
    act(() => result.current.openMenu(pointer(), 'nope'));
    expect(result.current.menu).toBeNull();
  });
});

describe('what a drag does', () => {
  it('moves a column onto the place of the one it is dropped on, and saves the list; onto itself it does nothing', async () => {
    const s = setup('admin');
    const { result } = renderHook(() => useColumns('suppliers', BUILTINS), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    act(() => result.current.reorder('name', 'name'));
    expect(s.put).not.toHaveBeenCalled();
    act(() => result.current.reorder('name', 'notes'));
    expect(s.put).toHaveBeenCalledTimes(1);
    const sent = (s.put.mock.calls[0] as unknown as [string, { columns: Column[] }])[1];
    expect(sent.columns.map(c => c.key)).toEqual(['contact', 'notes', 'name']);
    await waitFor(() =>
      expect(result.current.shown.map(c => c.key)).toEqual(['contact', 'notes', 'name']),
    );
  });
});

describe('what the server says of the arrangement', () => {
  it('is used as it is when it is a list of columns', async () => {
    const saved = [col('notes', { label: 'Remarks' }), col('name')];
    const s = setup('admin', saved);
    const { result } = renderHook(() => useColumns('suppliers', BUILTINS), { wrapper: s.wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.shown.map(c => `${c.key}:${c.label}`)).toEqual([
      'notes:Remarks',
      'name:Name',
      'contact:Contact',
    ]);
  });

  it('is nothing arranged when it is not one: the screen’s own columns stand', async () => {
    for (const saved of [
      [{ key: 'name', label: 'Mine', type: 'bogus', builtin: true, visible: true }],
      [{ label: 'no key' }],
      'columns',
      [null],
    ]) {
      const s = setup('admin', saved);
      const { result, unmount } = renderHook(() => useColumns('suppliers', BUILTINS), {
        wrapper: s.wrapper,
      });
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.shown.map(c => `${c.key}:${c.label}`)).toEqual([
        'name:Name',
        'contact:Contact',
        'notes:Notes',
      ]);
      unmount();
    }
  });
});
