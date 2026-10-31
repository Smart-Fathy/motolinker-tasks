import { createPortal } from 'react-dom';
import { Icon } from '../app/shell/icons';
import { Btn } from '../ui';
import { cx } from '../ui/cx';
import { useDialog } from '../ui/useDialog';
import styles from './docs.module.css';
import { DOC_ICONS } from './model';

/** What the viewer is showing: the document being made, why it could not be, or the PDF itself. */
export type Viewing =
  | { state: 'loading'; title: string }
  | { state: 'error'; title: string; message: string }
  | { state: 'ready'; title: string; url: string; name: string };

/**
 * The classic portals' shared document viewer (`#doc-modal`): a large card over a dimmed page with the document's title, a
 * Download and a Close, and the PDF in a frame under them. It opens at once, with "Rendering PDF…", and the PDF replaces it
 * when it is made; a document that could not be made says so in the same place. (The admin's card is the one colour it always
 * was, the team's is its surface: each portal's own CSS, as the classic pages have them.)
 */
export function DocViewer({
  viewing,
  onClose,
  variant = 'document',
}: {
  viewing: Viewing;
  onClose: () => void;
  /** 'contract': the administrator's contract preview, which is a little narrower and worded for a contract */
  variant?: 'document' | 'contract';
}) {
  const box = useDialog(onClose, { over: true });
  const ready = viewing.state === 'ready';
  const contract = variant === 'contract';
  const download = () => {
    if (viewing.state !== 'ready') return;
    const a = document.createElement('a');
    a.href = viewing.url;
    a.download = `${viewing.name}.pdf`;
    a.click();
  };
  return createPortal(
    <div
      className={cx(styles['viewerCurtain'], contract && styles['viewerCurtainContract'])}
      data-part="docModal"
    >
      <div
        ref={box}
        className={cx(styles['viewerCard'], contract && styles['viewerCardContract'])}
        role="dialog"
        aria-modal="true"
        aria-label={viewing.title}
        tabIndex={-1}
        data-part="docCard"
      >
        <div
          className={cx(styles['viewerHead'], contract && styles['viewerHeadContract'])}
          data-part="docHead"
        >
          <div
            className={cx(styles['viewerTitle'], contract && styles['viewerTitleContract'])}
            data-part="docTitle"
          >
            <span className={cx(styles['viewerIcon'], contract && styles['viewerIconContract'])}>
              <Icon
                name={contract ? DOC_ICONS.contract : DOC_ICONS.file}
                size={contract ? 18 : 17}
              />
            </span>
            <span
              className={cx(styles['viewerText'], contract && styles['viewerTextContract'])}
              data-part="docTitleText"
            >
              {contract ? 'Contract Preview' : viewing.title || 'Document'}
            </span>
          </div>
          <div
            className={cx(styles['viewerButtons'], contract && styles['viewerButtonsContract'])}
            data-part="docButtons"
          >
            <Btn kind="primary" small data-part="docDownload" onClick={download}>
              <Icon name={DOC_ICONS.download} size={14} /> {contract ? 'Download PDF' : 'Download'}
            </Btn>
            <Btn small data-part="docClose" onClick={onClose}>
              Close
            </Btn>
          </div>
        </div>
        <div className={styles['viewerBody']} data-part="docBody">
          {!ready && (
            <div className={styles['viewerLoading']} data-part="docLoading">
              {viewing.state === 'error' ? (
                <div className={styles['errorBox']} data-part="docError">
                  Could not render this document: {viewing.message}
                </div>
              ) : (
                <>
                  <div className={styles['viewerSpinner']} /> Rendering PDF…
                </>
              )}
            </div>
          )}
          {viewing.state === 'ready' && (
            <iframe
              className={cx(styles['viewerFrame'], contract && styles['viewerFrameContract'])}
              src={viewing.url}
              title={viewing.title}
              data-part="docFrame"
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
