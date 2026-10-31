// The state of the PDF viewer of a screen that has one (purchase orders, contracts): it opens at once, is filled when the PDF is made
// (or says why it could not be), and gives the PDF back when it closes, when another is asked for and when the screen goes away.
import { useCallback, useEffect, useRef, useState } from 'react';
import { pdfUrl } from './files';
import type { Viewing } from './Viewer';

/** What a screen's way of making a document hands back: the PDF (base64) and the name it is downloaded under (no extension). */
export interface MadePdf {
  pdf: string;
  name: string;
}

export function useViewer(): {
  viewing: Viewing | null;
  /**
   * Opens the viewer at once under `plain`. `make` reads what it needs and makes the PDF; it may call `say` with the document's
   * proper title as soon as it knows it (a number), which is the title the viewer ends up with, whether it is filled or says why not.
   * An answer that comes after the viewer was closed, or after another document was asked for, is not shown: the classic viewer
   * stayed shut when it was closed too.
   */
  show: (plain: string, make: (say: (title: string) => void) => Promise<MadePdf>) => Promise<void>;
  close: () => void;
} {
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const url = useRef<string | null>(null);
  /** which asking is the current one: closing and asking again both end the one before */
  const turn = useRef(0);

  const forget = useCallback(() => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }, []);
  useEffect(
    () => () => {
      turn.current++;
      forget();
    },
    [forget],
  );

  const close = useCallback(() => {
    turn.current++;
    forget();
    setViewing(null);
  }, [forget]);

  const show = useCallback(
    async (plain: string, make: (say: (title: string) => void) => Promise<MadePdf>) => {
      const mine = ++turn.current;
      forget();
      let title = plain;
      setViewing({ state: 'loading', title });
      try {
        const out = await make(t => {
          title = t;
        });
        if (mine !== turn.current) return;
        url.current = pdfUrl(out.pdf);
        setViewing({ state: 'ready', title, url: url.current, name: out.name });
      } catch (e) {
        if (mine !== turn.current) return;
        setViewing({
          state: 'error',
          title,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [forget],
  );

  return { viewing, show, close };
}
