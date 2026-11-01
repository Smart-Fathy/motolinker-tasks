import styles from './screen.module.css';

/** In the page's place while a screen's file is fetched (see lazyPage): a spinner, after a moment, if it is still not there. */
export function ScreenLoading() {
  return (
    <div className={styles['loading']} data-part="screenLoading" role="status" aria-label="Loading">
      <div className={styles['spinner']} data-part="spinner" />
    </div>
  );
}
