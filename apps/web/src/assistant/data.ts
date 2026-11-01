// What the assistant asks of the server: what this person may ask about, how the model is doing, the card at the top of a page, a
// question, and a proposal that was confirmed. The classic pages read the sections once and keep them for as long as the page is open; the
// status each time the panel is opened; the card each time its page is shown (the server keeps one for ten minutes); and nothing else.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { useSession } from '../app/context';
import type { Api } from '../lib/api';
import {
  isAiActionDone,
  isAiChat,
  isAiInsights,
  isAiSections,
  isAiStatus,
  knownFrom,
  type AiActionDone,
  type AiChat,
  type AiInsights,
  type AiSections,
  type AiStatus,
  type Known,
  type ScreenSnapshot,
} from './model';

/** What is kept is kept under this key, each thing for one person (the sections and the cards differ from one person to the next). */
const ROOT = 'assistant';
export const sectionsKey = (actor: string) => [ROOT, 'sections', actor] as const;
export const statusKey = (actor: string) => [ROOT, 'status', actor] as const;
export const insightsKey = (actor: string, page: string, lang: string) =>
  [ROOT, 'insights', actor, page, lang] as const;

export interface Sections {
  /** the sections this person may ask about, or Home alone where the server could not say */
  known: Known;
  /** may they have the assistant propose actions */
  act: boolean;
}

/**
 * What this person may ask about. A call that fails leaves Home alone, as the classic panel has it: the assistant is still there to
 * ask, about the page that is open.
 */
export function useSections(enabled: boolean): Sections {
  const { api, me } = useSession();
  const query = useQuery({
    queryKey: sectionsKey(me.actor.key),
    queryFn: async ({ signal }): Promise<AiSections | null> => {
      try {
        const body = await api.get<unknown>(`${api.base}/ai/sections`, { signal });
        return isAiSections(body) ? body : null;
      } catch {
        return null;
      }
    },
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const answer = query.data ?? null;
  const known = useMemo(() => knownFrom(answer), [answer]);
  return { known, act: answer?.act === true };
}

export interface StatusState {
  /** how the model is doing; nothing while it is being asked, and nothing where it cannot be told */
  status: AiStatus | null;
  pending: boolean;
}

/** How the model is doing, asked each time the panel is opened (and each time the page changes while it is). */
export function useStatus(enabled: boolean, page: string): StatusState {
  const { api, me } = useSession();
  const query = useQuery({
    queryKey: [...statusKey(me.actor.key), page],
    queryFn: async ({ signal }): Promise<AiStatus | null> => {
      try {
        const body = await api.get<unknown>(`${api.base}/ai/status`, { signal });
        return isAiStatus(body) ? body : null;
      } catch {
        return null;
      }
    },
    enabled,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    gcTime: 0,
    staleTime: 0,
  });
  return { status: enabled ? (query.data ?? null) : null, pending: enabled && query.isPending };
}

export interface InsightsState {
  /** the card has not come yet */
  loading: boolean;
  /** what came, or why it did not (the words of a call that did not go are in `failed`) */
  result: AiInsights | null;
  failed: string | null;
  /** ask the model again, whatever the server has kept */
  refresh: () => void;
}

/** The card at the top of a section's page. Asked for when it is shown, not while it is put away. */
export function useInsights(
  page: string,
  lang: 'en' | 'ar' | undefined,
  enabled: boolean,
): InsightsState {
  const { api, me } = useSession();
  const again = useRef(false);
  const query = useQuery({
    queryKey: insightsKey(me.actor.key, page, lang ?? 'auto'),
    queryFn: async ({ signal }): Promise<AiInsights> => {
      const refresh = again.current;
      again.current = false;
      const body = await api.post<unknown>(
        `${api.base}/ai/insights`,
        { page, ...(lang ? { lang } : {}), refresh },
        { signal },
      );
      if (!isAiInsights(body)) throw new Error('The answer could not be read');
      return body;
    },
    enabled,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    gcTime: 0,
    staleTime: Infinity,
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    again.current = true;
    void refetch();
  }, [refetch]);
  return {
    loading: enabled && (query.isPending || query.isFetching),
    result: query.data ?? null,
    failed: query.error ? query.error.message : null,
    refresh,
  };
}

/** What a question carries to the server: the words, the conversation so far, the language if one was chosen, and what is on the screen. */
export interface Question {
  section: string;
  page: string;
  message: string;
  history: { role: 'user' | 'bot'; content: string }[];
  lang?: 'en' | 'ar';
  screen: ScreenSnapshot;
}

/** Ask. A call that did not go, or went wrong, throws (the panel tells the person); an answer that is not one is an error too. */
export async function ask(api: Api, question: Question): Promise<AiChat> {
  const body = await api.post<unknown>(`${api.base}/ai/chat`, question);
  if (!isAiChat(body)) throw new Error('The answer could not be read');
  return body;
}

/** Carry out a proposal the person confirmed. The server checks it again, and answers in words what it did (or why not). */
export async function runAction(api: Api, action: Record<string, unknown>): Promise<AiActionDone> {
  const body = await api.post<unknown>(`${api.base}/ai/actions/run`, { action });
  if (!isAiActionDone(body)) throw new Error('The answer could not be read');
  return body;
}
