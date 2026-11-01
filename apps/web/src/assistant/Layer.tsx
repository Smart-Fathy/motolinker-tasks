import { Component, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../app/context';
import { lazyPage, type LazyPage } from '../app/define-module';
import { SAID } from './model';
import { useAssistant } from './state';

// The panel is the biggest piece of the assistant and most people open it rarely, so it is not part of the file the app opens with.
const makePanel = (): LazyPage => lazyPage(() => import('./Panel'), 'Panel');
const first = makePanel();

/** Ask for the panel's file early (the pill does, as the pointer reaches it), so that it is there when the first click opens it. */
export function preloadPanel(): void {
  first.preload();
}

/**
 * The panel's file could not come (the connection dropped, or the app was updated since this page was opened and the old files are
 * gone): the app goes on, the panel is put away, and the person is told. A new opening tries again — with a new attempt at the file,
 * for a page that has once failed to draw is not asked again (`resetKey` is the count of openings).
 */
class PanelBoundary extends Component<
  { resetKey: number; onReset: () => void; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.error('The assistant could not be opened:', error);
  }

  override componentDidUpdate(before: { resetKey: number }): void {
    if (this.state.failed && before.resetKey !== this.props.resetKey) {
      this.props.onReset();
      this.setState({ failed: false });
    }
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PanelFailed() {
  const { toasts } = useSession();
  const close = useAssistant()?.closePanel;
  useEffect(() => {
    toasts.show(SAID.panelFailed);
    close?.();
  }, [toasts, close]);
  return null;
}

/** Where the panel lives. It is fetched the first time it is wanted, and stays once it has been (so that closing it slides it away). */
export function AssistantLayer() {
  const assistant = useAssistant();
  const [wanted, setWanted] = useState(false);
  const [Panel, setPanel] = useState<LazyPage>(() => first);
  if (assistant?.open && !wanted) setWanted(true);
  if (!assistant?.available || !wanted) return null;
  return (
    <PanelBoundary
      resetKey={assistant.focusTick}
      onReset={() => setPanel(() => makePanel())}
      fallback={<PanelFailed />}
    >
      <Suspense fallback={null}>
        <Panel />
      </Suspense>
    </PanelBoundary>
  );
}
