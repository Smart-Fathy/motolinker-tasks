import { can } from '@motolinker/contracts/access';
import { useState } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import {
  Badge,
  ColumnHeader,
  ColumnsBar,
  ColumnsLayer,
  CustomCell,
  useColumns,
} from '../../columns';
import { Btn } from '../../ui';
import { cx } from '../../ui/cx';
import { SupplierDetail } from './Detail';
import { SupplierForm } from './SupplierForm';
import { SAID_FAILED_TO_LOAD, useSuppliers, useSupplierWrites } from './data';
import {
  cardFigures,
  countLine,
  initials,
  saveView,
  savedView,
  shortEgp,
  SUPPLIER_COLUMNS,
  SUPPLIER_ICONS,
  type Stats,
  type Supplier,
  type Tab,
  type View,
} from './model';
import styles from './suppliers.module.css';

function Loading({ team }: { team: boolean }) {
  return (
    <div className={styles['loading']} data-part="loading">
      {team ? <span className={styles['spinner']} /> : <div className={styles['spinner']} />}{' '}
      Loading suppliers…
    </div>
  );
}

function Card({
  x,
  stats,
  may,
  open,
  edit,
  remove,
}: {
  x: Supplier;
  stats: Stats;
  may: Record<'edit' | 'delete' | 'docs' | 'purchases', boolean>;
  open: (id: number, tab: Tab) => void;
  edit: (id: number) => void;
  remove: (x: Supplier) => void;
}) {
  const f = cardFigures(x, stats);
  const sub = [x.country, x.contact].filter(Boolean).join(' · ');
  const go = (tab: Tab, label: string, allowed: boolean) =>
    allowed && (
      <button type="button" className={styles['go']} data-part="go" onClick={() => open(x.id, tab)}>
        {label}
      </button>
    );
  const small = { padding: '4px 9px', fontSize: 11 };
  return (
    <article className={styles['card']} data-part="card">
      <div className={styles['cardHead']} data-part="cardHead">
        <span className={styles['av']} data-part="avatar">
          {initials(x.name)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className={styles['name']} data-part="name">
            {x.name || '—'}
          </div>
          {sub && (
            <div className={styles['sub']} data-part="sub">
              {sub}
            </div>
          )}
        </div>
        <div className={styles['acts']} data-part="acts">
          {may.edit && (
            <Btn style={small} title="Edit" data-part="cardEdit" onClick={() => edit(x.id)}>
              <Icon name={SUPPLIER_ICONS.edit} size={13} />
            </Btn>
          )}
          {may.delete && (
            <Btn style={small} title="Delete" data-part="cardDelete" onClick={() => remove(x)}>
              <Icon name={SUPPLIER_ICONS.remove} size={13} />
            </Btn>
          )}
        </div>
      </div>
      <div className={styles['stats']} data-part="stats">
        <div className={styles['stat']}>
          <span>Units</span>
          <b className="num" data-part="figure">
            {stats.haveStock ? f.units : '—'}
          </b>
        </div>
        <div className={styles['stat']}>
          <span>Value</span>
          <b className="num" data-part="figure">
            {stats.haveStock ? (f.value ? 'EGP ' + shortEgp(f.value) : '—') : '—'}
          </b>
        </div>
        <div className={styles['stat']}>
          <span>Catalogue</span>
          <b className="num" data-part="figure">
            {stats.haveCatalogue ? f.catalogue : '—'}
          </b>
        </div>
      </div>
      <div className={styles['gos']} data-part="gos">
        {go('vehicles', 'Vehicles', true)}
        {go('docs', 'Documents', may.docs)}
        {go('purchases', 'Purchases', may.purchases)}
      </div>
    </article>
  );
}

/**
 * The register behind the supplier pickers of the RFQ, purchase-order and stock screens: who is bought from, with what the
 * register holds of each — and, from a card, straight into the page that answers the next question (what they offer, their
 * paperwork, what was bought). The cards lead; the table, whose columns the administrator arranges, is one tab away. The two
 * portals head the page in their own ways and draw the rest alike. Each grant is its own: who may add, edit, delete, see the
 * documents and the purchases is asked of the person, and what they may not do is not drawn.
 */
export function Suppliers() {
  const { portal, access } = useSession();
  const team = portal === 'team';
  const columns = useColumns('suppliers', SUPPLIER_COLUMNS);
  const { items, stats, loading, error } = useSuppliers(columns.loaded);
  const writes = useSupplierWrites();
  const [view, setViewState] = useState<View>(savedView);
  const [form, setForm] = useState<{ id: number | null } | null>(null);
  const [detail, setDetail] = useState<{ id: number; tab: Tab } | null>(null);
  const may = {
    create: can(access.actor, 'suppliers.create'),
    edit: can(access.actor, 'suppliers.edit'),
    delete: can(access.actor, 'suppliers.delete'),
    docs: can(access.actor, 'suppliers.docs'),
    purchases: can(access.actor, 'suppliers.purchases'),
  };
  const setView = (v: View) => {
    setViewState(v);
    saveView(v);
  };
  const remove = (x: Supplier) => {
    if (!window.confirm(`Delete supplier ${x.name}?`)) return;
    void writes.remove(x.id);
  };
  const detailOf = detail ? items.find(s => s.id === detail.id) : undefined;
  const open = (id: number, tab: Tab = 'vehicles') => setDetail({ id, tab });

  const addButton = (
    <Btn kind="primary" data-part="add" onClick={() => setForm({ id: null })}>
      <Icon name={SUPPLIER_ICONS.add} size={15} /> Add supplier
    </Btn>
  );

  let body;
  if (loading) body = <Loading team={team} />;
  else if (error) {
    body = (
      <div className={styles['error']} data-part="error">
        {error.status === 0 ? (
          SAID_FAILED_TO_LOAD
        ) : (
          <>
            {error.message}
            <br />
            <span className={styles['hintSmall']}>
              If this mentions a missing <code>suppliers</code> table, run{' '}
              <code>migrations/003_logistics_deals_docs.sql</code>.
            </span>
          </>
        )}
      </div>
    );
  } else {
    const n = items.length;
    const head = (
      <div className={styles['head']} data-part="head">
        <span className={styles['count']} data-part="count">
          {countLine(n, stats)}
        </span>
        <div className={styles['views']} role="tablist" data-part="views">
          {(
            [
              ['cards', 'Cards', SUPPLIER_ICONS.cards],
              ['table', 'Table', SUPPLIER_ICONS.table],
            ] as const
          ).map(([v, label, icon]) => (
            <button
              key={v}
              type="button"
              className={cx(styles['viewTab'], view === v && styles['active'])}
              data-part="viewTab"
              onClick={() => setView(v)}
            >
              <Icon name={icon} /> {label}
            </button>
          ))}
        </div>
        <ColumnsBar columns={columns} />
      </div>
    );
    if (!n) {
      // (the field controls are offered even now: a register's columns are worth setting up BEFORE the first supplier)
      body = (
        <>
          {head}
          <div className={styles['none']} data-part="none">
            No suppliers yet.
          </div>
        </>
      );
    } else if (view === 'cards') {
      body = (
        <>
          {head}
          <div className={styles['grid']} data-part="grid">
            {items.map(x => (
              <Card
                key={x.id}
                x={x}
                stats={stats}
                may={may}
                open={open}
                edit={id => setForm({ id })}
                remove={remove}
              />
            ))}
          </div>
        </>
      );
    } else {
      body = (
        <>
          {head}
          <div className={styles['tableScroll']} data-part="tableScroll">
            <table className={styles['table']} data-part="table">
              <thead>
                <tr className={styles['headRow']} data-part="headRow">
                  {columns.shown.map(c => (
                    <ColumnHeader
                      key={c.key}
                      columns={columns}
                      col={c}
                      className={styles['th']}
                      style={c.width ? { minWidth: c.width } : undefined}
                      part="th"
                    />
                  ))}
                  <th className={cx(styles['th'], styles['thEnd'])} data-part="thEnd">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map(x => (
                  <tr key={x.id} className={styles['row']} data-part="row">
                    {columns.shown.map(c => {
                      if (!c.builtin) return <CustomCell key={c.key} col={c} record={x} />;
                      const raw = (x as unknown as Record<string, unknown>)[c.key];
                      if (c.type === 'select' || c.type === 'radio')
                        return (
                          <td
                            key={c.key}
                            className={styles['td']}
                            data-part="cell"
                            data-label={c.label}
                          >
                            <Badge col={c} value={raw} />
                          </td>
                        );
                      if (c.key === 'name')
                        return (
                          <td
                            key={c.key}
                            className={cx(styles['td'], styles['strong'])}
                            data-part="cell"
                            data-label={c.label}
                          >
                            {x.name}
                          </td>
                        );
                      if (c.key === 'notes' || c.key === 'address')
                        return (
                          <td
                            key={c.key}
                            className={cx(styles['td'], styles['muted'])}
                            data-part="cell"
                            data-label={c.label}
                          >
                            {String(raw || '')}
                          </td>
                        );
                      return (
                        <td
                          key={c.key}
                          className={styles['td']}
                          data-part="cell"
                          data-label={c.label}
                        >
                          {String(raw || '—')}
                        </td>
                      );
                    })}
                    <td
                      className={cx(styles['td'], styles['end'])}
                      data-part="actionsCell"
                      data-label="Actions"
                    >
                      <Btn
                        style={{ padding: '4px 8px', fontSize: 12 }}
                        data-part="rowOpen"
                        onClick={() => open(x.id)}
                      >
                        Open
                      </Btn>{' '}
                      {may.edit && (
                        <Btn
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          data-part="rowEdit"
                          onClick={() => setForm({ id: x.id })}
                        >
                          Edit
                        </Btn>
                      )}{' '}
                      {may.delete && (
                        <Btn
                          danger
                          style={{ padding: '4px 8px', fontSize: 12 }}
                          data-part="rowDelete"
                          onClick={() => remove(x)}
                        >
                          Delete
                        </Btn>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      );
    }
  }

  const sheets = (
    <>
      <ColumnsLayer columns={columns} />
      {form && (
        <SupplierForm
          columns={columns}
          supplier={form.id === null ? null : (items.find(s => s.id === form.id) ?? null)}
          onClose={() => setForm(null)}
        />
      )}
      {detail && (
        <SupplierDetail
          id={detail.id}
          name={detailOf?.name || 'Supplier'}
          tab={detail.tab}
          setTab={tab => setDetail({ id: detail.id, tab })}
          may={may}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );

  if (!team) {
    return (
      <div data-part="suppliersPage">
        <div className={styles['pageHeader']} data-part="pageHead">
          <span className={styles['pageTitle']} data-part="pageTitle">
            Suppliers
          </span>
          {may.create && addButton}
        </div>
        <div className={styles['adminBody']} data-part="pageBody">
          <div className={styles['lead']} data-part="pageHint">
            Suppliers you order from. Used by RFQs, purchase orders and stock units.
          </div>
          <div className={styles['list']} data-part="list">
            {body}
          </div>
        </div>
        {sheets}
      </div>
    );
  }
  return (
    <div className={styles['teamBody']} data-part="suppliersPage">
      <div className={styles['teamHead']} data-part="pageHead">
        <div>
          <div className={styles['cardTitle']} data-part="pageTitle">
            Suppliers
          </div>
          <div className={styles['cardHint']} data-part="pageHint">
            Suppliers you order from. Used by RFQs, purchase orders and stock units.
          </div>
        </div>
        <div className={styles['teamActions']}>{may.create && addButton}</div>
      </div>
      <div data-part="list">{body}</div>
      {sheets}
    </div>
  );
}
