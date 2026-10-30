import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/** A failed call is worth asking again when the server could not be reached or fell over; a "no" will not change. */
export function worthRetrying(failures: number, error: unknown): boolean {
  if (failures >= 2) return false;
  if (error instanceof ApiError) return error.status === 0 || error.status >= 500;
  return true;
}

/**
 * What the screens' data lives in. One per signed-in session — a new sign-in gets a new one, so nothing one person's
 * session fetched can show to the next — and calls that fail for good are not repeated.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: worthRetrying },
      mutations: { retry: false },
    },
  });
}
