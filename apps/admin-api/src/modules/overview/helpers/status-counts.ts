import { GROUP_STATUS_VALUES, GroupStatus } from '@tbot/shared';

/** Count of groups per status, with every status present (0 when none). */
export function statusCounts(rows: { _id: string; n: number }[]): Record<GroupStatus, number> {
  const out = Object.fromEntries(GROUP_STATUS_VALUES.map((s) => [s, 0])) as Record<GroupStatus, number>;
  for (const r of rows) if (r._id in out) out[r._id as GroupStatus] = r.n;
  return out;
}
