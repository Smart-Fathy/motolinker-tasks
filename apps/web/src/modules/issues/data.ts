// The tickets and their replies, as the Issues centre asks for them: the queue each time the screen opens, a ticket's replies
// each time it is opened and again after one is sent, and a ticket's status as the server last said it. Closing or reopening
// puts the server's answer in the queue; nothing is guessed ahead of it.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSession } from '../../app/context';
import { ApiError, type Api } from '../../lib/api';
import {
  isIssue,
  isIssueCommentList,
  isIssueList,
  type Issue,
  type IssueComment,
  type IssueStatus,
} from './model';

const LIST = '/api/v1/issues';

/** The queue, and (separately, so that one does not refetch the other) a ticket's replies. */
export const issuesKey = (actorKey: string) => ['issues', actorKey, 'list'] as const;
export const commentsKey = (actorKey: string, id: number) =>
  ['issues', actorKey, 'comments', id] as const;

/** What was asked of the server and how it went: the value, or the words to tell the person. */
export type Outcome<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

const failed = (e: unknown): { ok: false; message: string } => ({
  ok: false,
  message:
    e instanceof ApiError ? e.message : `Error: ${e instanceof Error ? e.message : String(e)}`,
});

async function fetchIssues(api: Api, signal: AbortSignal): Promise<Issue[]> {
  const body = await api.get<unknown>(LIST, { signal });
  if (!isIssueList(body)) {
    throw new ApiError(502, 'The issues came back in a form this app does not know.');
  }
  return body.items;
}

async function fetchComments(api: Api, id: number, signal: AbortSignal): Promise<IssueComment[]> {
  const body = await api.get<unknown>(`${LIST}/${id}/comments`, { signal });
  if (!isIssueCommentList(body)) {
    throw new ApiError(502, 'The replies came back in a form this app does not know.');
  }
  return body.items;
}

const NONE: readonly never[] = [];

export interface IssuesState {
  items: readonly Issue[];
  /** the queue has not come yet */
  loading: boolean;
  /** why it could not be had, in words (a queue already in hand is kept when asking again fails) */
  error: string | null;
  /** close a ticket or reopen it; the queue then holds the ticket as the server returned it */
  setStatus: (id: number, status: IssueStatus) => Promise<Outcome<Issue>>;
}

export function useIssues(): IssuesState {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const key = useMemo(() => issuesKey(me.actor.key), [me.actor.key]);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchIssues(api, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const setStatus = useCallback(
    async (id: number, status: IssueStatus): Promise<Outcome<Issue>> => {
      try {
        const body = await api.patch<unknown>(`${LIST}/${id}`, { status });
        if (!isIssue(body)) return { ok: false, message: 'Failed' };
        qc.setQueryData<Issue[]>(key, old => old?.map(i => (i.id === body.id ? body : i)));
        return { ok: true, value: body };
      } catch (e) {
        return failed(e);
      }
    },
    [api, qc, key],
  );
  return {
    items: query.data ?? NONE,
    loading: query.isPending,
    error: query.isError && !query.data ? query.error.message : null,
    setStatus,
  };
}

export interface CommentsState {
  items: readonly IssueComment[];
  loading: boolean;
  error: string | null;
  /** reply with words; the thread is then asked for again */
  post: (body: string) => Promise<Outcome>;
}

export function useComments(id: number): CommentsState {
  const { api, me } = useSession();
  const qc = useQueryClient();
  const key = useMemo(() => commentsKey(me.actor.key, id), [me.actor.key, id]);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchComments(api, id, signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const post = useCallback(
    async (body: string): Promise<Outcome> => {
      try {
        await api.post(`${LIST}/${id}/comments`, { body });
      } catch (e) {
        return failed(e);
      }
      void qc.invalidateQueries({ queryKey: key });
      return { ok: true, value: undefined };
    },
    [api, qc, key, id],
  );
  return {
    items: query.data ?? NONE,
    loading: query.isPending,
    error: query.isError && !query.data ? query.error.message : null,
    post,
  };
}

export interface Report {
  title: string;
  description: string;
  file: File | null;
}

/**
 * A report: words, and a file if there is one, as a form (the server reads it as multipart). When it does not go, the person
 * is told "Error: " and the server's words, as the classic form tells them.
 */
export async function sendReport(api: Api, report: Report): Promise<Outcome> {
  const form = new FormData();
  form.append('title', report.title);
  form.append('description', report.description);
  if (report.file) form.append('file', report.file);
  try {
    await api.postForm(LIST, form);
  } catch (e) {
    return { ok: false, message: `Error: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true, value: undefined };
}
