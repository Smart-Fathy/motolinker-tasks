import { can } from '@motolinker/contracts/access';
import { useEffect, useState } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { ColumnsLayer, useColumns } from '../../columns';
import { Input } from '../../docs/Fields';
import { Btn } from '../../ui';
import { cx } from '../../ui/cx';
import docStyles from '../../docs/docs.module.css';
import { CsvSheet } from './CsvSheet';
import { useStock, useStockWrites } from './data';
import { ModelForm } from './ModelForm';
import { Models } from './Models';
import {
  nameOf,
  saveView,
  savedView,
  STOCK_COLUMNS,
  STOCK_ICONS,
  type Vehicle,
  type View,
} from './model';
import styles from './stock.module.css';
import { Tracking } from './Tracking';

type Tab = 'models' | 'tracking';

/** A tab of the team's strip: a div with an icon, as their page draws it (a key does what a click does). */
function TeamTab({
  on,
  icon,
  label,
  pick,
}: {
  on: boolean;
  icon: string;
  label: string;
  pick: () => void;
}) {
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={on}
      className={cx(styles['tab'], on && styles['active'])}
      data-part="tab"
      onClick={pick}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pick();
        }
      }}
    >
      <Icon name={icon} /> {label}
    </div>
  );
}

/**
 * Inventory & Logistics: two views of one register. **Models** — the cars in stock, a row for each make, model and trim with the
 * physical cars held under it; **Tracking** — the containers those cars arrive in. A car is linked to a box by its VIN, so there
 * is no third list to keep in step. The two portals head the page in their own ways and draw the rest alike. Each grant is its
 * own: who may add a model (`stock.create`), change one (`stock.edit`) and follow the containers (`stock.tracking`) is asked of
 * the person, and what they may not do is not drawn. Deleting a model and the CSV are the administrator's.
 */
export function Stock() {
  const { portal, access } = useSession();
  const team = portal === 'team';
  const columns = useColumns('stock', STOCK_COLUMNS);
  const stock = useStock();
  const writes = useStockWrites();
  const [tab, setTab] = useState<Tab>('models');
  const [view, setViewState] = useState<View>(savedView);
  const [status, setStatus] = useState('');
  const [group, setGroup] = useState(false);
  const [term, setTerm] = useState('');
  const [form, setForm] = useState<{ id: number | null } | null>(null);
  const [csv, setCsv] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const may = {
    create: can(access.actor, 'stock.create'),
    edit: can(access.actor, 'stock.edit'),
    tracking: can(access.actor, 'stock.tracking'),
  };
  const setView = (v: View) => {
    setViewState(v);
    saveView(v);
  };
  const remove = (v: Vehicle) => {
    if (!window.confirm(`Delete ${nameOf(v)} from stock?`)) return;
    void writes.remove(v.id);
  };
  // "Review" puts the models with unmatched cars in front of you: every model, nothing narrowed, the first one in view.
  const review = () => {
    setViewState('model');
    saveView('model');
    setStatus('');
    setTerm('');
    setReviewed(n => n + 1);
  };
  useEffect(() => {
    if (!reviewed) return;
    document
      .querySelector('[data-part="legacyNote"]')
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [reviewed]);

  const search = (
    <Input
      className={team ? styles['teamSearch'] : styles['adminSearch']}
      placeholder="Search make, model or trim…"
      value={term}
      data-part="search"
      onChange={e => setTerm(e.target.value)}
    />
  );
  const add = tab === 'models' && may.create && (
    <Btn kind="primary" data-part="add" onClick={() => setForm({ id: null })}>
      <Icon name={STOCK_ICONS.add} size={15} /> Add model
    </Btn>
  );
  const pane =
    tab === 'models' ? (
      <Models
        stock={stock}
        columns={columns}
        view={view}
        setView={setView}
        status={status}
        setStatus={setStatus}
        group={group}
        setGroup={setGroup}
        term={term}
        searchBox={team ? null : search}
        mayEdit={may.edit}
        mayDelete={!team}
        edit={id => setForm({ id })}
        remove={remove}
        review={review}
      />
    ) : (
      <Tracking />
    );
  const sheets = (
    <>
      <ColumnsLayer columns={columns} />
      {form && columns.loaded && (
        <ModelForm
          key={form.id ?? 'new'}
          id={form.id}
          vehicle={stock.items.find(x => x.id === form.id)}
          columns={columns}
          onClose={() => setForm(null)}
        />
      )}
      {csv && <CsvSheet onClose={() => setCsv(false)} />}
    </>
  );

  if (!team) {
    return (
      <div data-part="stockPage">
        <div className={docStyles['pageHeader']} data-part="pageHead">
          <span className={docStyles['pageTitle']} data-part="pageTitle">
            Inventory &amp; Logistics
          </span>
          <div className={styles['headActions']} data-part="headActions">
            <Btn data-part="csv" onClick={() => setCsv(true)}>
              <Icon name={STOCK_ICONS.upload} size={14} /> Bulk upload CSV
            </Btn>
            {add}
          </div>
        </div>
        <div className={docStyles['adminBody']} data-part="pageBody">
          <div className={styles['dealTabs']} role="tablist" data-part="tabs">
            {(
              [
                ['models', 'Models'],
                ['tracking', 'Tracking'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={cx(styles['dealTab'], tab === k && styles['active'])}
                data-part="tab"
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          {pane}
        </div>
        {sheets}
      </div>
    );
  }
  return (
    <div className={docStyles['teamBody']} data-part="stockPage">
      <div className={docStyles['teamHead']} data-part="pageHead">
        <div>
          <div className={docStyles['cardTitle']} data-part="pageTitle">
            Inventory
          </div>
          <div className={docStyles['cardHint']} data-part="pageHint">
            Cars in stock, with the units held against each model.
          </div>
        </div>
        <div className={docStyles['teamActions']} data-part="headActions">
          {search}
          {add}
        </div>
      </div>
      <div className={styles['tabStrip']} role="tablist" data-part="tabs">
        <TeamTab
          on={tab === 'models'}
          icon={STOCK_ICONS.models}
          label="Models"
          pick={() => setTab('models')}
        />
        {may.tracking && (
          <TeamTab
            on={tab === 'tracking'}
            icon={STOCK_ICONS.tracking}
            label="Tracking"
            pick={() => setTab('tracking')}
          />
        )}
      </div>
      {pane}
      {sheets}
    </div>
  );
}
