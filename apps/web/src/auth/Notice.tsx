import { Alert } from '../ui';

/** A message for the person signing in: what went wrong, or what happened and what to do next. */
export interface Notice {
  tone: 'error' | 'success';
  text: string;
}

export const failure = (text: string): Notice => ({ tone: 'error', text });
export const success = (text: string): Notice => ({ tone: 'success', text });

export function NoticeLine({ notice }: { notice: Notice | null }) {
  return notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null;
}
