import type { ReactNode } from 'react';
import { useSession } from '../app/context';
import { Icon } from '../app/shell/icons';
import { Btn } from '../ui';
import styles from './docs.module.css';
import { DOC_ICONS } from './model';

/** "Loading RFQs…": the classic pages' loader (a block in the admin's, a line in the team's). */
export function Loading({ what }: { what: string }) {
  const { portal } = useSession();
  return (
    <div className={styles['loading']} data-part="loading">
      {portal === 'team' ? (
        <span className={styles['spinner']} />
      ) : (
        <div className={styles['spinner']} />
      )}{' '}
      Loading {what}…
    </div>
  );
}

/**
 * The page around a list of documents, each portal's own: the admin's has a header with the title and the button that makes
 * a new one, then a hint and the list; the team's has a card-sized title and hint on the left and the button on the right.
 */
export function DocPage({
  title,
  hint,
  add,
  children,
  sheets,
}: {
  title: string;
  hint: string;
  /** the button that makes a new document, for those who may */
  add: { label: string; onClick: () => void } | null;
  children: ReactNode;
  /** the forms and the viewer, which the page opens over itself */
  sheets: ReactNode;
}) {
  const { portal } = useSession();
  const button = add && (
    <Btn kind="primary" data-part="add" onClick={add.onClick}>
      <Icon name={DOC_ICONS.add} size={15} /> {add.label}
    </Btn>
  );
  if (portal === 'admin') {
    return (
      <div data-part="docPage">
        <div className={styles['pageHeader']} data-part="pageHead">
          <span className={styles['pageTitle']} data-part="pageTitle">
            {title}
          </span>
          {button}
        </div>
        <div className={styles['adminBody']} data-part="pageBody">
          <div className={styles['lead']} data-part="pageHint">
            {hint}
          </div>
          <div className={styles['list']} data-part="list">
            {children}
          </div>
        </div>
        {sheets}
      </div>
    );
  }
  return (
    <div className={styles['teamBody']} data-part="docPage">
      <div className={styles['teamHead']} data-part="pageHead">
        <div>
          <div className={styles['cardTitle']} data-part="pageTitle">
            {title}
          </div>
          <div className={styles['cardHint']} data-part="pageHint">
            {hint}
          </div>
        </div>
        <div className={styles['teamActions']}>{button}</div>
      </div>
      <div data-part="list">{children}</div>
      {sheets}
    </div>
  );
}
