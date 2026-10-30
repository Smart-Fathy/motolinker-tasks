import { useQuery } from '@tanstack/react-query';
import { useApi } from './context';
import { readNavConfig, type NavConfig } from './nav';

/**
 * The arrangement the admin saved for the sidebar (Arrange sections), shared by both portals. It only decorates the rail, so
 * a server that cannot say, or says something unreadable, leaves the rail as shipped — and the app does not wait for it.
 */
export function useNavConfig(): NavConfig | null {
  const api = useApi();
  const query = useQuery({
    queryKey: ['nav-config'],
    queryFn: async ({ signal }) =>
      readNavConfig(await api.get(`${api.base}/nav-config`, { signal })),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return query.data ?? null;
}
