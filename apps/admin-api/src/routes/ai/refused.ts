import type { AdminAiRefusalRow } from '@tbot/shared';
import type { Pagination } from 'src/shared/http';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';
import { refusalsBy, sumReasons } from 'src/stats/refusals';

export const REFUSED_BY = ['person', 'group'] as const;
export type RefusedBy = (typeof REFUSED_BY)[number];

/** Who was refused (most first), one page of it, and how many rows there are in all. */
export async function refusedRows(match: Record<string, unknown>, by: RefusedBy, p: Pagination): Promise<{ rows: AdminAiRefusalRow[]; total: number }> {
  const counts = await refusalsBy(match, by === 'person' ? 'userId' : 'groupId');
  const ranked = [...counts.entries()]
    .map(([key, byReason]) => ({ key, byReason, count: sumReasons(byReason) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const page = ranked.slice(p.skip, p.skip + p.limit);
  const keys = page.map((r) => r.key).filter(Boolean);
  if (by === 'person') {
    const people = await loadPersonRefs(keys);
    return { rows: page.map((r) => ({ person: r.key ? (people.get(r.key) ?? null) : null, count: r.count, byReason: r.byReason })), total: ranked.length };
  }
  const groups = await loadGroupRefs(keys);
  return { rows: page.map((r) => ({ group: r.key ? (groups.get(r.key) ?? null) : null, count: r.count, byReason: r.byReason })), total: ranked.length };
}
