import { useMemo, useState } from 'react';
import { Btn, HuddleSheet } from '../ui';
import type { Offer } from '../modules/suppliers';
import styles from './docs.module.css';

const money = (n: unknown): string => (Number(n) || 0).toLocaleString();

/** A vehicle of a supplier's catalogue as one name: its brand, model and trim. */
export const offerLabel = (v: Offer): string =>
  [v.brand, v.model, v.trim].filter(Boolean).join(' ') || '(unnamed)';

/** Does this vehicle match what was typed? (its name, or its supplier's) */
export const offerMatches = (v: Offer, term: string): boolean => {
  const t = term.trim().toLowerCase();
  return (
    !t ||
    offerLabel(v).toLowerCase().includes(t) ||
    String(v.supplier_name ?? '')
      .toLowerCase()
      .includes(t)
  );
};

/**
 * The classic portals' "Add from supplier catalogue": a small sheet over the form with a search box and the vehicles of every
 * supplier, each with a box to tick; "Add selected" hands the ticked ones to the form (which makes a line of each).
 */
export function Catalogue({
  offers,
  onPick,
  onClose,
}: {
  offers: readonly Offer[];
  /** the vehicles ticked; none is the sheet's own "Pick at least one vehicle." */
  onPick: (picked: Offer[]) => void;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => offers.filter(v => offerMatches(v, term)), [offers, term]);
  const toggle = (id: number, on: boolean) =>
    setTicked(was => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <HuddleSheet
      title="Add from supplier catalogue"
      onClose={onClose}
      footer={
        <>
          <Btn small data-part="catCancel" onClick={onClose}>
            Cancel
          </Btn>
          <Btn
            kind="primary"
            small
            data-part="catAdd"
            onClick={() => onPick(offers.filter(v => ticked.has(v.id)))}
          >
            Add selected
          </Btn>
        </>
      }
    >
      <input
        className={styles['catSearch']}
        placeholder="Search brand, model or supplier…"
        value={term}
        onChange={e => setTerm(e.target.value)}
        data-part="catSearch"
      />
      <div className={styles['catList']} data-part="catList">
        {rows.length ? (
          rows.map(v => (
            <label key={v.id} className={styles['catRow']} data-part="catRow">
              <input
                type="checkbox"
                checked={ticked.has(v.id)}
                onChange={e => toggle(v.id, e.target.checked)}
              />
              <span className={styles['catText']}>
                <span className={styles['catName']}>
                  {offerLabel(v)}
                  {v.model_year ? ' · ' + v.model_year : ''}
                </span>
                <span className={styles['catSub']}>
                  {v.supplier_name || ''}
                  {v.fob_price ? ' · ' + (v.currency || 'USD') + ' ' + money(v.fob_price) : ''}
                  {v.lead_time ? ' · ' + v.lead_time : ''}
                </span>
              </span>
            </label>
          ))
        ) : (
          <div className={styles['catNone']} data-part="catNone">
            Nothing matched that.
          </div>
        )}
      </div>
    </HuddleSheet>
  );
}
