import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../api/client.js';

/** The business profile and settings (VAT, credit days, numbering, calendar). Cleared when the business changes. */
export const useSettings = () =>
  useQuery({
    queryKey: ['settings'],
    queryFn: ({ signal }) => apiFetch('/settings', { signal }).then((r) => r.data),
    staleTime: 60_000,
  });
