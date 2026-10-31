import { Btn, Sheet } from '../../ui';
import { cx } from '../../ui/cx';
import { Docs } from './Docs';
import { Purchases } from './Purchases';
import { Vehicles } from './Vehicles';
import type { Tab } from './model';
import styles from './suppliers.module.css';

export interface Grants {
  edit: boolean;
  delete: boolean;
  docs: boolean;
  purchases: boolean;
}

/** The pane's own loader: a spinner alone (the register's says what it is loading). */
export function PaneLoading() {
  return (
    <div className={styles['loading']} data-part="paneLoading">
      <div className={styles['spinner']} />
    </div>
  );
}

export function PaneError({ message }: { message: string }) {
  return (
    <div className={styles['error']} data-part="paneError">
      {message}
    </div>
  );
}

/**
 * What a supplier offers, their paperwork, and what was bought from them: three pages that answer different questions, in a wide
 * sheet. Each is its own grant (the catalogue is readable with the register; the documents and the purchases are asked for
 * separately) and a page a person may not have has no tab. The purchases are worked out from the stock units and the purchase
 * orders pointed at the supplier, never typed in, so they cannot drift from what happened.
 */
export function SupplierDetail({
  id,
  name,
  tab,
  setTab,
  may,
  onClose,
}: {
  id: number;
  name: string;
  tab: Tab;
  setTab: (t: Tab) => void;
  may: Grants;
  onClose: () => void;
}) {
  const tabs = (
    [
      ['vehicles', 'Vehicles'],
      ['docs', 'Documents'],
      ['purchases', 'Purchases'],
    ] as const
  ).filter(([k]) => (k === 'docs' ? may.docs : k === 'purchases' ? may.purchases : true));
  return (
    <Sheet
      title={name}
      wide
      onClose={onClose}
      footer={
        <Btn data-part="close" onClick={onClose}>
          Close
        </Btn>
      }
    >
      <div className={styles['tabs']} data-part="tabs">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={cx(styles['tab'], tab === k && styles['activeTab'])}
            data-part="tab"
            data-t={k}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={styles['pane']} data-part="pane">
        {tab === 'vehicles' && <Vehicles id={id} />}
        {tab === 'docs' && <Docs id={id} />}
        {tab === 'purchases' && <Purchases id={id} />}
      </div>
    </Sheet>
  );
}
