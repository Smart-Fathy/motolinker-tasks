import { useRef, useState } from 'react';
import { Icon } from '../../app/shell/icons';
import { Btn } from '../../ui';
import { PaneError, PaneLoading } from './Detail';
import { useDocs, useDocWrites } from './data';
import { kb, SUPPLIER_ICONS } from './model';
import styles from './suppliers.module.css';

/** A supplier's paperwork: files kept in Google Drive (under MotoLinker / Suppliers), each opened from its link. */
export function Docs({ id }: { id: number }) {
  const docs = useDocs(id);
  const writes = useDocWrites(id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setProblem(null);
    const out = await writes.upload(file);
    setBusy(false);
    if (!out.ok) setProblem(out.message || 'Upload failed.');
  };

  if (docs.loading) return <PaneLoading />;
  if (docs.error) return <PaneError message={docs.error} />;
  const rows = docs.data ?? [];
  return (
    <>
      <div className={styles['upload']} data-part="upload">
        <input
          ref={input}
          type="file"
          hidden
          data-part="fileInput"
          onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f);
          }}
        />
        <Btn small data-part="uploadButton" onClick={() => input.current?.click()}>
          <Icon name={SUPPLIER_ICONS.upload} size={13} /> Upload document
        </Btn>
        <span className={styles['uploadHint']}>
          Stored in Google Drive, under MotoLinker / Suppliers.
        </span>
      </div>
      <div data-part="docNote">
        {busy && <div className={styles['uploading']}>Uploading…</div>}
        {problem && (
          <div className={styles['error']} style={{ display: 'block' }} data-part="docError">
            {problem}
          </div>
        )}
      </div>
      {rows.length ? (
        <div className={styles['files']} data-part="files">
          {rows.map(d => (
            <a
              key={d.id}
              className={styles['file']}
              href={d.web_link || '#'}
              target="_blank"
              rel="noopener"
              data-part="file"
            >
              <div className={styles['fileIcon']}>
                <Icon name={SUPPLIER_ICONS.file} size={22} />
              </div>
              <div>
                <div className={styles['fileName']}>{d.name || 'file'}</div>
                <div className={styles['fileSub']}>{kb(d.size_bytes)}</div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <div className={styles['nothing']} data-part="nothing">
          No documents yet.
        </div>
      )}
    </>
  );
}
