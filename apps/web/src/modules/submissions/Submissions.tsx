import { can } from '@motolinker/contracts/access';
import { useNavigate } from 'react-router';
import { useAppTo, useSession } from '../../app/context';
import { useSubmissions } from './data';
import { whenOf, type Submission } from './model';
import styles from './submissions.module.css';

const HEADINGS = ['Name', 'Lead', 'Email', 'Phone', 'Car Interest', 'Message', 'Submitted'];

function Loading() {
  return (
    <div className={styles['loading']} data-part="loading">
      <span className={styles['spinner']} /> Loading submissions…
    </div>
  );
}

function Empty() {
  return (
    <div className={styles['empty']} data-part="empty">
      <div className={styles['emptyMark']}>—</div>
      <div className={styles['emptyTitle']}>No submissions yet</div>
      <div className={styles['emptyHint']}>Submissions from website forms will appear here.</div>
    </div>
  );
}

interface TableProps {
  items: readonly Submission[];
  mayDelete: boolean;
  openLead: () => void;
  onDelete: (id: number) => void;
}

function Table({ items, mayDelete, openLead, onDelete }: TableProps) {
  return (
    <div className={styles['tableScroll']} data-part="tableScroll">
      <table className={styles['table']} data-part="table">
        <thead className={styles['thead']}>
          <tr className={styles['headRow']} data-part="headRow">
            {HEADINGS.map(h => (
              <th key={h} className={styles['th']} data-part="th">
                {h}
              </th>
            ))}
            <th className={styles['thEnd']} />
          </tr>
        </thead>
        <tbody className={styles['tbody']}>
          {items.map(s => (
            <tr key={s.id} className={styles['row']} data-part="row">
              <td className={styles['tdName']} data-part="name" data-label="Name">
                {s.name}
              </td>
              <td className={styles['tdLead']} data-part="lead" data-label="Lead">
                {s.customer_id ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className={styles['chip']}
                    data-part="leadChip"
                    title="Open lead profile"
                    onClick={openLead}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openLead();
                      }
                    }}
                  >
                    → {s.lead_name || 'lead'}
                  </span>
                ) : (
                  <span className={styles['none']}>—</span>
                )}
              </td>
              <td className={styles['tdEmail']} data-part="email" data-label="Email">
                <a className={styles['mail']} href={`mailto:${s.email}`}>
                  {s.email}
                </a>
              </td>
              <td className={styles['tdPhone']} data-part="phone" data-label="Phone">
                {s.phone || '—'}
              </td>
              <td className={styles['tdCar']} data-part="car" data-label="Car Interest">
                {s.car_interest || '—'}
              </td>
              <td className={styles['tdMessage']} data-part="message" data-label="Message">
                {s.message || '—'}
              </td>
              <td className={styles['tdWhen']} data-part="when" data-label="Submitted">
                {whenOf(s.created_at)}
              </td>
              <td className={styles['tdActions']} data-part="actions" data-label="">
                {mayDelete && (
                  <button
                    type="button"
                    className={styles['delete']}
                    data-part="delete"
                    onClick={() => onDelete(s.id)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What the website's form sent us: who, the lead each one became, how to reach them, what they asked about and when. The
 * two portals head it differently (the admin's page title, the team's card title and a line under it) and have it in the
 * same table. Whoever may delete one sees the button; a lead's chip goes to Leads, where the lead's own page opens.
 */
export function Submissions() {
  const { portal, access } = useSession();
  const to = useAppTo();
  const navigate = useNavigate();
  const { items, loading, error, refresh, remove } = useSubmissions();
  const mayDelete = can(access.actor, 'submissions.delete');

  const onDelete = (id: number) => {
    if (!window.confirm('Delete this submission?')) return;
    void remove(id).then(ok => {
      if (!ok) window.alert('Delete failed');
    });
  };
  const refreshButton = (
    <button type="button" className={styles['refresh']} data-part="refresh" onClick={refresh}>
      Refresh
    </button>
  );
  const body = loading ? (
    <Loading />
  ) : error ? (
    <div className={styles['error']} data-part="error">
      {error}
    </div>
  ) : items.length === 0 ? (
    <Empty />
  ) : (
    <Table
      items={items}
      mayDelete={mayDelete}
      openLead={() => void navigate(to('/leads'))}
      onDelete={onDelete}
    />
  );

  if (portal === 'admin') {
    return (
      <div data-part="submissionsPage">
        <div className={styles['pageHeader']} data-part="pageHead">
          <span className={styles['pageTitle']} data-part="pageTitle">
            Form Submissions
          </span>
          {refreshButton}
        </div>
        <div className={styles['adminBody']} data-part="pageBody">
          <div className={styles['container']} data-part="container">
            {body}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={styles['teamBody']} data-part="submissionsPage">
      <div className={styles['teamHead']} data-part="pageHead">
        <div>
          <div className={styles['cardTitle']} data-part="pageTitle">
            Website Submissions
          </div>
          <div className={styles['cardHint']} data-part="pageHint">
            Enquiries the public website sent us.
          </div>
        </div>
        <div className={styles['teamActions']}>{refreshButton}</div>
      </div>
      <div data-part="container">{body}</div>
    </div>
  );
}
