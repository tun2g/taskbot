/** Small helpers shared by the routes: breakdown totals, earliest day, display names. */
import type { AdminAiBreakdownRow } from '@tbot/shared';

import { roundUsd } from './day-stats';

/** Totals of breakdown rows (for AdminAiUsage.totals). */
export function sumBreakdown(rows: AdminAiBreakdownRow[]): Omit<AdminAiBreakdownRow, 'key' | 'label'> {
  const t = { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0 };
  for (const r of rows) {
    t.calls += r.calls;
    t.failed += r.failed;
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.costUsd += r.costUsd;
    t.unpriced += r.unpriced;
  }
  t.costUsd = roundUsd(t.costUsd);
  return t;
}

/** Earliest of several "YYYY-MM-DD" days (nulls ignored). */
export function earliestDay(...days: (string | null | undefined)[]): string | null {
  const real = days.filter((d): d is string => !!d).sort();
  return real[0] ?? null;
}

/** "An Nguyen" / "@an" / "User 123" — a display name from a users row. */
export function personName(u: { firstName?: string | null; lastName?: string | null; username?: string | null; telegramUserId: number }): string {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (u.username) return `@${u.username}`;
  return `User ${u.telegramUserId}`;
}
