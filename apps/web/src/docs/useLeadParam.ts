// "?lead=<id>" on a document screen's address: a new document for that lead is asked for.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * The lead's own page (the classic Leads drawer, in its frame; the Leads screen when it moves) sends the person to a document
 * screen with the lead named in the address. The form is asked for once — and only by whoever may make one — and the address is
 * cleaned, so that a reload or a way back does not open it again. A lead that is not a whole number above nought is none.
 */
export function useLeadParam(allowed: boolean, ask: (lead: number) => void): void {
  const [params, setParams] = useSearchParams();
  const raw = params.get('lead');
  // What an earlier render saw of the address, so that each new one is answered once. (Set while rendering, as React documents
  // for a state that follows what it is given: the screen draws once, with the form already asked for.)
  const [seen, setSeen] = useState<string | null>(null);
  if (raw !== seen) {
    setSeen(raw);
    const lead = Number(raw);
    if (raw !== null && allowed && Number.isInteger(lead) && lead > 0) ask(lead);
  }
  useEffect(() => {
    if (raw === null) return;
    const next = new URLSearchParams(params);
    next.delete('lead');
    setParams(next, { replace: true });
  }, [raw, params, setParams]);
}
