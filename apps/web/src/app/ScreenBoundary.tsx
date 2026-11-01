import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Keeps a screen that cannot be shown from taking the whole app with it: the file of a screen that is fetched when it is opened
 * can fail to arrive (the connection dropped, or the app was updated since this page was opened and the old files are gone),
 * and a page that fails while it draws is no better. Either way the frame stays, and `fallback` says so and offers the way out.
 * It is keyed by the screen, so going to another one is a fresh start.
 */
export class ScreenBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('A screen could not be shown:', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
