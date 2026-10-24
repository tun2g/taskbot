import { getRouteApi } from '@tanstack/react-router';
import { useCallback } from 'react';

import type { GroupDetailSearch } from '@/lib/search';

const route = getRouteApi('/_app/groups/$groupId');

/** The group page's URL state (tab, list view, sort, search, page) and a way to change part of it. */
export function useDetailSearch() {
  const { groupId } = route.useParams();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const update = useCallback(
    (patch: Partial<GroupDetailSearch>) => void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true }),
    [navigate],
  );
  return { groupId, search, update };
}
