import { cleanup, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineModule, isLazyPage, lazyPage, type LazyPage } from './define-module';
import { preloadScreen, registry, registryFrom } from './registry';
import { ScreenBoundary } from './ScreenBoundary';
import { ScreenLoading } from './ScreenLoading';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const Hello = () => <p>hello</p>;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('a page that is fetched when its screen is opened', () => {
  it("draws the file's named export once the file has come, and stands in for it until then", async () => {
    const load = vi.fn(async () => ({ Hello }));
    const Page = lazyPage(load, 'Hello');
    render(
      <Suspense fallback={<p>waiting</p>}>
        <Page />
      </Suspense>,
    );
    expect(screen.getByText('waiting')).toBeTruthy();
    expect(await screen.findByText('hello')).toBeTruthy();
    expect(screen.queryByText('waiting')).toBeNull();
  });

  it('is fetched once, however often it is asked for early and then drawn', async () => {
    const load = vi.fn(async () => ({ Hello }));
    const Page = lazyPage(load, 'Hello');
    Page.preload();
    Page.preload();
    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    );
    await screen.findByText('hello');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('asks again after a fetch that failed, rather than keeping the failure as its answer', async () => {
    const load = vi
      .fn<() => Promise<{ Hello: typeof Hello }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ Hello });
    const Page = lazyPage(load, 'Hello');
    Page.preload(); // the rail asks as the pointer passes, and the network is down: nothing is shown, nothing is thrown
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    Page.preload(); // the pointer passes again
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    );
    expect(await screen.findByText('hello')).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('is told from a page that is not fetched on demand', () => {
    expect(isLazyPage(lazyPage(async () => ({ Hello }), 'Hello'))).toBe(true);
    expect(isLazyPage(Hello)).toBe(false);
    // (a component that happens to have something called preload is not one that can be asked for early)
    expect(isLazyPage(Object.assign(() => null, { preload: 1 }) as never)).toBe(false);
  });

  it('is what a module can be made of', () => {
    const Page = lazyPage(async () => ({ Hello }), 'Hello');
    expect(defineModule('leads', { Page }).Page).toBe(Page);
  });
});

describe('a screen that cannot be shown', () => {
  it('leaves the frame around it standing and shows the way out in its place, when its file never comes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Gone = lazyPage(
      () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
      'Hello',
    );
    render(
      <div>
        <nav>the rail</nav>
        <ScreenBoundary fallback={<p>This screen could not be shown.</p>}>
          <Suspense fallback={<ScreenLoading />}>
            <Gone />
          </Suspense>
        </ScreenBoundary>
      </div>,
    );
    expect(await screen.findByText('This screen could not be shown.')).toBeTruthy();
    expect(screen.getByText('the rail')).toBeTruthy();
  });

  it('does the same for a page that fails while it is drawn, and says what failed where a developer will see it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = (): never => {
      throw new Error('boom');
    };
    render(
      <ScreenBoundary fallback={<p>sorry</p>}>
        <Boom />
      </ScreenBoundary>,
    );
    expect(screen.getByText('sorry')).toBeTruthy();
    expect(logged.mock.calls.some(call => call[0] === 'A screen could not be shown:')).toBe(true);
  });

  it('shows its children, and nothing of the fallback, while all is well', () => {
    render(
      <ScreenBoundary fallback={<p>sorry</p>}>
        <Hello />
      </ScreenBoundary>,
    );
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.queryByText('sorry')).toBeNull();
  });
});

describe('the stand-in while a screen is on its way', () => {
  it('says it is loading, to a screen reader too, with the spinner a sighted person sees', () => {
    render(<ScreenLoading />);
    const status = screen.getByRole('status', { name: 'Loading' });
    expect(status.querySelector('[data-part=spinner]')).toBeTruthy();
  });
});

describe('asking for a screen early', () => {
  it('fetches the page of a screen that has moved', () => {
    const preload = vi
      .spyOn(registry.get('gchat')?.Page as LazyPage, 'preload')
      .mockImplementation(() => undefined);
    preloadScreen('gchat');
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a screen that has not moved, or that is not a screen at all', () => {
    expect(registry.has('leads')).toBe(false);
    expect(() => preloadScreen('leads')).not.toThrow();
    expect(() => preloadScreen('nonsense')).not.toThrow();
  });

  it('does nothing for a page that comes with the app: there is nothing to fetch', () => {
    const eager = registryFrom({
      '../modules/leads/index.ts': { default: defineModule('leads', { Page: Hello }) },
    });
    expect(() => preloadScreen('leads', eager)).not.toThrow();
  });

  it('fetches the page of whichever registry it is given', () => {
    const Page = lazyPage(async () => ({ Hello }), 'Hello');
    const preload = vi.spyOn(Page, 'preload').mockImplementation(() => undefined);
    const lazy = registryFrom({
      '../modules/leads/index.ts': { default: defineModule('leads', { Page }) },
    });
    preloadScreen('leads', lazy);
    expect(preload).toHaveBeenCalledTimes(1);
  });
});

describe('the screens that have moved', () => {
  it('all come in files of their own', () => {
    const eager = [...registry.values()].filter(m => !isLazyPage(m.Page)).map(m => m.id);
    expect(eager).toEqual([]);
  });
});
