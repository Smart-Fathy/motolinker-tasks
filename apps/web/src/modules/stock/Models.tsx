import type { CSSProperties, ReactNode } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { Badge, LinkCell, type Columns } from '../../columns';
import { Loading } from '../../docs/Page';
import { BrandSelect, Btn } from '../../ui';
import { cx } from '../../ui/cx';
import { SAID_FAILED_TO_LOAD, type StockState } from './data';
import {
  bySupplier,
  cardsOf,
  cellText,
  egp,
  lanesOf,
  legacyOf,
  matching,
  nameOf,
  priceOf,
  rowsOf,
  STOCK_ICONS,
  statusMeta,
  statusOptions,
  summaryOf,
  swatch,
  thousands,
  unitsOf,
  VIEWS,
  withoutVin,
  type Row,
  type Summary,
  type Vehicle,
  type View,
} from './model';
import styles from './stock.module.css';

/** What the Models tab is told by the page around it: what narrows the register, and what may be done to a model. */
export interface ModelsProps {
  stock: StockState;
  columns: Columns;
  view: View;
  setView: (v: View) => void;
  /** a status the cars are narrowed to ('' for all) */
  status: string;
  setStatus: (s: string) => void;
  group: boolean;
  setGroup: (on: boolean) => void;
  term: string;
  /** the administrator's search box sits between the figures and the register */
  searchBox: ReactNode;
  mayEdit: boolean;
  /** deleting a model is the administrator's */
  mayDelete: boolean;
  edit: (id: number) => void;
  remove: (v: Vehicle) => void;
  /** the unmatched-cars notice's "Review": every model, no narrowing */
  review: () => void;
}

/** Where the cars are, before a single row: how many, in what state, and what the register is worth. */
function Band({ s, review }: { s: Summary; review: () => void }) {
  return (
    <>
      <div className={styles['mixBand']} data-part="mix">
        <div className={styles['mixTotal']} data-part="mixTotal">
          <span className={cx(styles['statValue'], styles['num'])} data-part="mixCount">
            {s.total.toLocaleString()}
          </span>
          <span className={styles['mixUnit']} data-part="mixUnit">
            unit{s.total === 1 ? '' : 's'}
          </span>
        </div>
        <div className={styles['mixBody']} data-part="mixBody">
          {s.segments.length ? (
            <>
              <div className={styles['mixBar']} data-part="mixBar">
                {s.segments.map(x => (
                  <span
                    key={x.label}
                    title={`${x.label}: ${x.n}`}
                    style={{ flex: x.n, background: x.color }}
                  />
                ))}
              </div>
              <div className={styles['mixLegend']} data-part="mixLegend">
                {s.segments.map(x => (
                  <span key={x.label} className={styles['mixKey']} data-part="mixKey">
                    <i style={{ background: x.color }} />
                    {x.label}
                    <b className={styles['num']}>{x.n}</b>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <div className={styles['none']} data-part="none">
              No units recorded yet.
            </div>
          )}
        </div>
        <div className={styles['mixSide']} data-part="mixSide">
          <span className={cx(styles['mixSideV'], styles['num'])} data-part="mixValue">
            {egp(s.value)}
          </span>
          <span className={styles['mixSideL']} data-part="mixLabel">
            {s.models} model{s.models === 1 ? '' : 's'} · register value
          </span>
        </div>
      </div>
      {s.legacy > 0 && (
        <div className={styles['notice']} data-part="notice">
          <Icon name={STOCK_ICONS.warn} size={16} />
          <span>
            <strong>
              {s.legacy} unit{s.legacy === 1 ? ' is' : 's are'} unmatched.
            </strong>{' '}
            {s.legacy === 1 ? 'It was' : 'They were'} recorded before VIN tracking — add{' '}
            {s.legacy === 1 ? 'its VIN' : 'their VINs'} to bring those models back into stock.
          </span>
          <Btn className={styles['review']} data-part="review" onClick={review}>
            Review
          </Btn>
        </div>
      )}
    </>
  );
}

/** One cell of a car's row, drawn as the column it is under says. */
function Cell({
  col,
  row,
  options,
}: {
  col: Columns['shown'][number];
  row: Row;
  options: ReturnType<typeof statusOptions>;
}) {
  const { u, v } = row;
  const k = col.key;
  const raw = u[k];
  if (k === 'status') {
    return (
      <td data-label={col.label}>
        <StatusPill options={options} value={u.status} />
      </td>
    );
  }
  if (k === 'vin')
    return (
      <td data-label={col.label} className={styles['vin']}>
        {u.vin || '—'}
      </td>
    );
  if (k === 'colour')
    return (
      <td data-label={col.label}>
        {u.colour ? (
          <span className={styles['colour']}>
            <i style={{ background: swatch(u.colour) }} />
            {u.colour}
          </span>
        ) : (
          <span className={styles['muted']}>—</span>
        )}
      </td>
    );
  if (col.type === 'select' || col.type === 'radio')
    return (
      <td data-label={col.label}>
        <Badge col={col} value={raw} />
      </td>
    );
  if (col.type === 'number') {
    const n = Number(raw) || (k === 'price_list' ? Number(v.price) || 0 : 0);
    return (
      <td data-label={col.label} className={cx(styles['price'], styles['num'])}>
        {n ? n.toLocaleString() : '—'}
      </td>
    );
  }
  if (col.type === 'checkbox')
    return (
      <td data-label={col.label} style={{ textAlign: 'center' }}>
        {cellText(col, raw)}
      </td>
    );
  if (col.type === 'link')
    return (
      <td data-label={col.label}>
        <LinkCell raw={raw} />
      </td>
    );
  return <td data-label={col.label}>{cellText(col, raw)}</td>;
}

function StatusPill({
  options,
  value,
}: {
  options: ReturnType<typeof statusOptions>;
  value: string | undefined;
}) {
  const st = statusMeta(options, value);
  return (
    <span
      className={styles['pill']}
      style={{ '--c': hue(st.color) } as CSSProperties}
      data-part="pill"
    >
      {st.label}
    </span>
  );
}

/** A colour written as hex reads its theme token (--h-<hex>) where a look defines one: sunk on a light page, lifted on a dark one. */
const hue = (c: string): string =>
  /^#[0-9a-f]{6}$/i.test(c) ? `var(--h-${c.slice(1).toLowerCase()},${c})` : c;

function UnitRows({
  rows,
  columns,
  mayEdit,
  edit,
}: {
  rows: readonly Row[];
  columns: Columns;
  mayEdit: boolean;
  edit: (id: number) => void;
}) {
  const cols = columns.shown;
  const options = statusOptions(cols);
  return (
    <div className={cx(styles['tableCard'], styles['tableScroll'])} data-part="unitCard">
      <table className={styles['table']} data-part="unitTable">
        <thead>
          <tr>
            <th>Vehicle</th>
            {cols.map(c => (
              <th key={c.key} style={c.type === 'number' ? { textAlign: 'right' } : undefined}>
                {c.label}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.v.id}:${r.at}`} data-part="unitRow">
              <td data-label="Vehicle">
                <div className={styles['veh']} data-part="veh">
                  {r.v.make || ''} {r.v.model || ''}
                </div>
                {r.v.trim ? (
                  <div className={styles['vtrim']} data-part="vtrim">
                    {r.v.trim}
                  </div>
                ) : null}
              </td>
              {cols.map(c => (
                <Cell key={c.key} col={c} row={r} options={options} />
              ))}
              {/* (the classic page's mobile.js labels every cell from its table's own heading; the actions column has none) */}
              <td data-label="">
                {mayEdit && (
                  <Btn
                    className={styles['editBtn']}
                    title="Edit this model"
                    data-part="rowEdit"
                    onClick={() => edit(r.v.id)}
                  >
                    <Icon name={STOCK_ICONS.edit} size={13} />
                  </Btn>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AllView(p: ModelsProps & { rows: readonly Row[] }) {
  if (!p.rows.length)
    return (
      <div className={styles['none']} data-part="none">
        No units match.
      </div>
    );
  const table = (list: readonly Row[]) => (
    <UnitRows rows={list} columns={p.columns} mayEdit={p.mayEdit} edit={p.edit} />
  );
  if (!p.group) return table(p.rows);
  return (
    <>
      {bySupplier(p.rows).map(([supplier, list]) => (
        <div key={supplier} className={styles['group']} data-part="supplierGroup">
          <div className={styles['groupHead']} data-part="supplierHead">
            {supplier}
            <span className={cx(styles['groupN'], styles['num'])}>{list.length}</span>
          </div>
          {table(list)}
        </div>
      ))}
    </>
  );
}

function Board({
  rows,
  options,
}: {
  rows: readonly Row[];
  options: ReturnType<typeof statusOptions>;
}) {
  return (
    <div className={styles['board']} data-part="board">
      {lanesOf(rows, options).map(l => (
        <section
          key={l.key || '(none)'}
          className={styles['lane']}
          style={{ '--c': l.color } as CSSProperties}
          data-part="lane"
        >
          <div className={styles['laneHead']} data-part="laneHead">
            <div className={styles['laneTop']}>
              <span
                className={styles['pill']}
                style={{ '--c': hue(l.color) } as CSSProperties}
                data-part="pill"
              >
                {l.label}
              </span>
              <span className={cx(styles['laneN'], styles['num'])} data-part="laneN">
                {l.rows.length}
              </span>
            </div>
            <div>
              <span className={cx(styles['laneVal'], styles['num'])} data-part="laneVal">
                {l.value ? egp(l.value) : '—'}
              </span>
              <span className={cx(styles['laneShare'], styles['num'])} data-part="laneShare">
                {l.share}% of units
              </span>
            </div>
          </div>
          <div className={styles['laneBody']} data-part="laneBody">
            {l.rows.length ? (
              l.rows.map(r => (
                <article
                  key={`${r.v.id}:${r.at}`}
                  className={styles['laneCard']}
                  data-part="laneCard"
                >
                  <div className={styles['laneName']} data-part="laneName">
                    {r.v.make || ''} {r.v.model || ''}
                  </div>
                  <div className={styles['laneMeta']} data-part="laneMeta">
                    <Icon name={STOCK_ICONS.vin} size={12} />
                    <span>{r.u.vin || 'No VIN'}</span>
                  </div>
                  {r.u.colour ? (
                    <div className={styles['laneMeta']} data-part="laneMeta">
                      <Icon name={STOCK_ICONS.colour} size={12} />
                      <span>{r.u.colour}</span>
                    </div>
                  ) : null}
                  <div className={cx(styles['laneBudget'], styles['num'])} data-part="laneBudget">
                    {thousands(priceOf(r))}
                  </div>
                  {r.u.supplier ? (
                    <div className={styles['laneFoot']} data-part="laneFoot">
                      {r.u.supplier}
                    </div>
                  ) : null}
                </article>
              ))
            ) : (
              <div className={styles['none']} data-part="none">
                Nothing here
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

function ModelCard({
  v,
  columns,
  mayEdit,
  mayDelete,
  edit,
  remove,
}: {
  v: Vehicle;
  columns: Columns;
  mayEdit: boolean;
  mayDelete: boolean;
  edit: (id: number) => void;
  remove: (v: Vehicle) => void;
}) {
  const units = unitsOf(v);
  const qty = units.length;
  const noVin = withoutVin(v);
  const legacy = legacyOf(v);
  const cols = columns.shown;
  const small = { padding: '5px 10px', fontSize: 12 };
  return (
    <div className={styles['modelCard']} data-part="modelCard">
      <div className={styles['modelHead']} data-part="modelHead">
        <div style={{ minWidth: 0 }}>
          <div className={styles['modelTitle']} data-part="modelTitle">
            {v.make || ''} {v.model || ''}
          </div>
          {v.trim ? (
            <div className={styles['modelTrim']} data-part="modelTrim">
              {v.trim}
            </div>
          ) : null}
        </div>
        <span className={cx(styles['qty'], qty > 0 ? styles['in'] : styles['out'])} data-part="qty">
          {qty} in stock
        </span>
      </div>
      <div className={styles['modelPrice']} data-part="modelPrice">
        {v.price ? egp(v.price) : 'Price not set'}
      </div>
      {units.length > 0 && (
        <div className={styles['sec']} data-part="modelSec">
          <div className={styles['secLabel']} data-part="secLabel">
            Units ({units.length})
          </div>
          <div className={styles['tableScroll']} data-part="cardScroll">
            <table className={styles['units']} data-part="cardUnits">
              <thead>
                <tr>
                  {cols.map(c => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {units.map((u, i) => (
                  <tr key={i}>
                    {cols.map(c => {
                      const raw = u[c.key];
                      if (c.type === 'select' || c.type === 'radio')
                        return (
                          <td key={c.key} data-label={c.label}>
                            <Badge col={c} value={raw} />
                          </td>
                        );
                      if (c.type === 'number')
                        return (
                          <td key={c.key} data-label={c.label} style={{ textAlign: 'right' }}>
                            {cellText(c, raw)}
                          </td>
                        );
                      if (c.type === 'checkbox')
                        return (
                          <td key={c.key} data-label={c.label} style={{ textAlign: 'center' }}>
                            {cellText(c, raw)}
                          </td>
                        );
                      return (
                        <td key={c.key} data-label={c.label}>
                          {raw == null ? '—' : String(raw) || '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {legacy > 0 && (
        <div className={styles['legacy']} data-part="legacyNote">
          <Icon name={STOCK_ICONS.warn} size={14} />
          <span>
            <strong>
              {legacy} car{legacy === 1 ? '' : 's'}
            </strong>{' '}
            {legacy === 1 ? 'was' : 'were'} recorded here before VIN tracking. Add{' '}
            {legacy === 1 ? 'it' : 'them'} to bring this model back into stock.
          </span>
        </div>
      )}
      {noVin > 0 && (
        <div className={styles['legacy']} data-part="legacyNote">
          <Icon name={STOCK_ICONS.warn} size={14} />
          <span>
            {noVin} car{noVin === 1 ? ' has' : 's have'} no VIN yet.
          </span>
        </div>
      )}
      {v.notes ? (
        <div className={styles['notes']} data-part="notes">
          {v.notes}
        </div>
      ) : null}
      {(mayEdit || mayDelete) && (
        <div className={styles['modelActions']} data-part="modelActions">
          {mayEdit && (
            <Btn style={small} data-part="cardEdit" onClick={() => edit(v.id)}>
              <Icon name={STOCK_ICONS.edit} size={13} /> Edit
            </Btn>
          )}
          {mayDelete && (
            <Btn style={small} danger data-part="cardDelete" onClick={() => remove(v)}>
              <Icon name={STOCK_ICONS.remove} size={13} /> Delete
            </Btn>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Models tab: the figures over the register, then the register itself in one of three views — every car in a table (which a
 * status narrows and a supplier groups), the cars in a lane for each status, or a card for each model with its cars inside. The
 * columns of a car are the administrator's to arrange; a search narrows by make, model, trim or VIN.
 */
export function Models(p: ModelsProps) {
  const { portal } = useSession();
  const team = portal === 'team';
  const { stock, columns } = p;
  const options = statusOptions(columns.shown);
  const loading = stock.loading || !columns.loaded;

  let body: ReactNode;
  let band: ReactNode = null;
  if (loading) {
    // (the team's page is born saying "Loading inventory…"; the loader the page's script puts in its place says "Loading stock…" once
    // the columns are had and the register is being asked for)
    body = <Loading what={team && !columns.loaded ? 'inventory' : 'stock'} />;
  } else if (stock.error) {
    body = (
      <div className={styles['errorBox']} data-part="error">
        {stock.error.status === 0 ? SAID_FAILED_TO_LOAD : stock.error.message}
      </div>
    );
  } else {
    const items = stock.items;
    const all = rowsOf(items);
    band = <Band s={summaryOf(items, options)} review={p.review} />;
    const rows = matching(all, p.term, p.status);
    const chrome = (
      <>
        <div className={styles['views']} role="tablist" data-part="views">
          {VIEWS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={p.view === k}
              className={cx(styles['viewTab'], p.view === k && styles['active'])}
              data-part="viewTab"
              onClick={() => p.setView(k)}
            >
              <Icon name={STOCK_ICONS.views[k]} size={14} /> {label}
            </button>
          ))}
        </div>
        {p.view !== 'model' && (
          <div className={styles['controls']} data-part="controls">
            <BrandSelect
              part="filter"
              value={p.status}
              options={[
                { value: '', label: '— All statuses —' },
                ...options.map(o => ({ value: o.key, label: o.label })),
              ]}
              onChange={p.setStatus}
              look={{
                className: cx(styles['tbar'], p.status && styles['on']),
                children: (
                  <>
                    <Icon name={STOCK_ICONS.filter} size={14} />{' '}
                    {p.status ? statusMeta(options, p.status).label : 'Filter'}
                  </>
                ),
              }}
            />
            {p.view === 'all' && (
              <button
                type="button"
                className={cx(styles['tbar'], p.group && styles['on'])}
                data-part="groupBy"
                onClick={() => p.setGroup(!p.group)}
              >
                <Icon name={STOCK_ICONS.group} size={14} /> Group: {p.group ? 'Supplier' : 'None'}
              </button>
            )}
            {p.status && (
              <button
                type="button"
                className={styles['chip']}
                data-part="chip"
                onClick={() => p.setStatus('')}
              >
                {statusMeta(options, p.status).label} <span aria-hidden="true">&times;</span>
              </button>
            )}
          </div>
        )}
      </>
    );
    let view: ReactNode;
    if (p.view === 'all') view = <AllView {...p} rows={rows} />;
    else if (p.view === 'status') view = <Board rows={rows} options={options} />;
    else {
      const cards = cardsOf(items, rows, p.term, p.status);
      view = cards.length ? (
        <div className={styles['modelGrid']} data-part="modelGrid">
          {cards.map(v => (
            <ModelCard
              key={v.id}
              v={v}
              columns={columns}
              mayEdit={p.mayEdit}
              mayDelete={p.mayDelete}
              edit={p.edit}
              remove={p.remove}
            />
          ))}
        </div>
      ) : (
        <div className={styles['none']} data-part="none">
          {items.length ? (
            'No vehicles match your search.'
          ) : (
            <>
              No vehicles in stock yet.
              <br />
              Click “Add vehicle” or “Bulk upload CSV” to get started.
            </>
          )}
        </div>
      );
    }
    body = (
      <>
        {chrome}
        {view}
      </>
    );
  }
  return (
    <div data-part="modelsPane">
      <div
        className={
          team
            ? cx(styles['paneSummaryTeam'], !band && styles['statsGrid'])
            : styles['paneSummaryAdmin']
        }
        data-part="summary"
      >
        {band}
      </div>
      {p.searchBox}
      <div className={team ? undefined : styles['paneTableAdmin']} data-part="register">
        {body}
      </div>
    </div>
  );
}

export { nameOf };
