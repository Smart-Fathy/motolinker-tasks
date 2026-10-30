import { useId, useRef, useState } from 'react';
import { useSession } from '../../app/context';
import { Icon } from '../../app/shell/icons';
import { Modal } from '../../ui';
import { cx } from '../../ui/cx';
import { sendReport } from './data';
import { fileHint, ISSUE_ICONS, problemWith, SAID } from './model';
import styles from './report.module.css';

/**
 * "Report an issue": the form a team member fills in to raise a ticket, which goes straight to the Chief Technical Officer.
 * A summary or details (either), and a screenshot or file up to 10 MB. It says what is wrong with a report before it sends it,
 * and what went wrong after; it stays open when the server would not take it.
 */
export function ReportIssue({ onClose }: { onClose: () => void }) {
  const { api, toasts } = useSession();
  const ids = { title: useId(), details: useId(), file: useId() };
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const report = { title: title.trim(), description: details.trim(), file };
    const problem = problemWith(report);
    if (problem) {
      toasts.show(problem);
      return;
    }
    setBusy(true);
    const out = await sendReport(api, report);
    setBusy(false);
    if (out.ok) {
      onClose();
      toasts.show(SAID.sent);
    } else {
      toasts.show(out.message);
    }
  };

  return (
    <Modal
      title="Report an Issue"
      hint="Describe the problem — your ticket goes straight to the Chief Technical Officer."
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className={cx(styles['btn'], styles['outline'])}
            data-part="cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className={cx(styles['btn'], styles['primary'])}
            data-part="submit"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? 'Sending…' : 'Submit Ticket'}
          </button>
        </>
      }
    >
      <div>
        <label className={styles['label']} htmlFor={ids.title}>
          Summary
        </label>
        <input
          id={ids.title}
          className={styles['control']}
          data-part="summary"
          maxLength={150}
          placeholder="e.g. Can't log hours"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
      </div>
      <div>
        <label className={styles['label']} htmlFor={ids.details}>
          Details
        </label>
        <textarea
          id={ids.details}
          className={cx(styles['control'], styles['area'])}
          data-part="details"
          rows={4}
          maxLength={2000}
          placeholder="What happened? What did you expect?"
          value={details}
          onChange={e => setDetails(e.target.value)}
        />
      </div>
      <div>
        <label className={styles['label']} htmlFor={ids.file}>
          Attachment <span className={styles['optional']}>(optional, up to 10 MB)</span>
        </label>
        <input
          ref={picker}
          id={ids.file}
          type="file"
          className={styles['file']}
          data-part="file"
          accept="image/*,.pdf,.log,.txt,.zip,.mp4"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        <label htmlFor={ids.file} className={styles['dropzone']} data-part="dropzone">
          <span className={styles['clip']}>
            <Icon name={ISSUE_ICONS.attachment} />
          </span>
          <span className={cx(styles['hint'], file && styles['chosen'])} data-part="fileHint">
            {fileHint(file)}
          </span>
        </label>
      </div>
    </Modal>
  );
}
