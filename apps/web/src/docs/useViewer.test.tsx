import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../test/helpers';
import { useViewer } from './useViewer';

const PDF = btoa('%PDF-1.4');

let made = 0;
const create = vi.fn(() => `blob:pdf-${++made}`);
const revoke = vi.fn();
beforeEach(() => {
  made = 0;
  create.mockClear();
  revoke.mockClear();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ok = (name = 'Contract_1') => Promise.resolve({ pdf: PDF, name });

describe('the PDF viewer of a screen', () => {
  it('is not there until a document is asked for', () => {
    const { result } = renderHook(() => useViewer());
    expect(result.current.viewing).toBeNull();
  });

  it('opens at once under the plain title, and is filled with the PDF, its address and its name when it is made', async () => {
    const gate = deferred<void>();
    const { result } = renderHook(() => useViewer());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.show('Contract', async () => {
        await gate.promise;
        return { pdf: PDF, name: 'Contract_MC1' };
      });
    });
    expect(result.current.viewing).toEqual({ state: 'loading', title: 'Contract' });
    expect(create).not.toHaveBeenCalled();
    gate.resolve();
    await act(() => pending);
    expect(result.current.viewing).toEqual({
      state: 'ready',
      title: 'Contract',
      url: 'blob:pdf-1',
      name: 'Contract_MC1',
    });
    expect((create.mock.calls[0] as unknown as [Blob])[0].type).toBe('application/pdf');
  });

  it("takes the document's proper title once the screen has said it, whether the PDF is made or not", async () => {
    const { result } = renderHook(() => useViewer());
    await act(() =>
      result.current.show('Contract', async say => {
        say('Contract MC1');
        return { pdf: PDF, name: 'x' };
      }),
    );
    expect(result.current.viewing).toMatchObject({ state: 'ready', title: 'Contract MC1' });
    await act(() =>
      result.current.show('Contract', async say => {
        say('Contract MC2');
        throw new Error('no browser');
      }),
    );
    expect(result.current.viewing).toEqual({
      state: 'error',
      title: 'Contract MC2',
      message: 'no browser',
    });
  });

  it('keeps the plain title for a document that failed before it could be named, and says why in words for anything thrown', async () => {
    const { result } = renderHook(() => useViewer());
    await act(() =>
      result.current.show('Purchase order', async () => {
        throw new Error('Purchase order not found');
      }),
    );
    expect(result.current.viewing).toEqual({
      state: 'error',
      title: 'Purchase order',
      message: 'Purchase order not found',
    });
    await act(() =>
      result.current.show('Purchase order', () => Promise.reject('plain words') as never),
    );
    expect(result.current.viewing).toMatchObject({ state: 'error', message: 'plain words' });
  });

  it('gives the PDF back when it is closed, and when another is asked for, and when the screen goes away', async () => {
    const { result, unmount } = renderHook(() => useViewer());
    await act(() => result.current.show('A', () => ok()));
    expect(revoke).not.toHaveBeenCalled();
    act(() => result.current.close());
    expect(result.current.viewing).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenLastCalledWith('blob:pdf-1');

    await act(() => result.current.show('B', () => ok()));
    await act(() => result.current.show('C', () => ok()));
    expect(revoke).toHaveBeenLastCalledWith('blob:pdf-2');
    expect(result.current.viewing).toMatchObject({ title: 'C', url: 'blob:pdf-3' });
    unmount();
    expect(revoke).toHaveBeenLastCalledWith('blob:pdf-3');
    expect(revoke).toHaveBeenCalledTimes(3);
  });

  it('gives back nothing when there is nothing to give back', () => {
    const { result, unmount } = renderHook(() => useViewer());
    act(() => result.current.close());
    unmount();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('stays shut when it was closed while its PDF was being made — the PDF that comes later is not shown, and is not kept', async () => {
    const gate = deferred<void>();
    const { result } = renderHook(() => useViewer());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.show('Contract', async () => {
        await gate.promise;
        return { pdf: PDF, name: 'late' };
      });
    });
    act(() => result.current.close());
    expect(result.current.viewing).toBeNull();
    gate.resolve();
    await act(() => pending);
    expect(result.current.viewing).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('…and the reason a closed one could not be made is not shown either', async () => {
    const gate = deferred<void>();
    const { result } = renderHook(() => useViewer());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.show('Contract', async () => {
        await gate.promise;
        throw new Error('too late to say');
      });
    });
    act(() => result.current.close());
    gate.resolve();
    await act(() => pending);
    expect(result.current.viewing).toBeNull();
  });

  it('is not taken over by the answer to an earlier asking when another document was asked for since', async () => {
    const first = deferred<void>();
    const { result } = renderHook(() => useViewer());
    let one!: Promise<void>;
    act(() => {
      one = result.current.show('First', async () => {
        await first.promise;
        return { pdf: PDF, name: 'first' };
      });
    });
    act(() => result.current.close());
    await act(() => result.current.show('Second', () => ok('second')));
    expect(result.current.viewing).toMatchObject({
      title: 'Second',
      name: 'second',
      url: 'blob:pdf-1',
    });
    first.resolve();
    await act(() => one);
    expect(result.current.viewing).toMatchObject({
      title: 'Second',
      name: 'second',
      url: 'blob:pdf-1',
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('is not taken over by an earlier failure either', async () => {
    const first = deferred<void>();
    const { result } = renderHook(() => useViewer());
    let one!: Promise<void>;
    act(() => {
      one = result.current.show('First', async () => {
        await first.promise;
        throw new Error('the first one failed');
      });
    });
    await act(() => result.current.show('Second', () => ok()));
    first.resolve();
    await act(() => one);
    expect(result.current.viewing).toMatchObject({ state: 'ready', title: 'Second' });
  });

  it('does not make a PDF address for a screen that has gone away', async () => {
    const gate = deferred<void>();
    const { result, unmount } = renderHook(() => useViewer());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.show('Contract', async () => {
        await gate.promise;
        return { pdf: PDF, name: 'late' };
      });
    });
    unmount();
    gate.resolve();
    await pending;
    expect(create).not.toHaveBeenCalled();
  });
});
