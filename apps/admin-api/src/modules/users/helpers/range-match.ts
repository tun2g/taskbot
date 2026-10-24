import type { AdminRange } from '@tbot/shared';
import { rangeWindows } from 'src/stats/range';

/** [start, end) of a range — the one window the list, the person's KPIs and every table footer use. */
export function rangeMatch(range: AdminRange, now = new Date()) {
  const { current } = rangeWindows(range, now);
  return { window: current, createdAt: { $gte: current.start, $lt: current.end } };
}
