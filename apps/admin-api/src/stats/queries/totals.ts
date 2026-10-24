/** Totals keyed by a field: AI calls, usage events, distinct people, and when tracking started. */
import { AiCall, StatsDaily, UsageEvent } from '@tbot/db';
import { dayOf } from 'src/stats/range';

import { FAILED_CALL, idKey, PROVIDER_CALL, REFUSED_CALL, UNPRICED_CALL } from './exprs';

export interface AiTotals {
  calls: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: number;
  refused: number;
}

const groupKey = (by: string | Record<string, unknown>) => (typeof by === 'string' ? `$${by}` : by);

/** AI call totals keyed by `by` (a field path such as "groupId", "userId", "feature", "aiModel" or a day). */
export async function aiTotalsBy(match: Record<string, unknown>, by: string | Record<string, unknown>): Promise<Map<string, AiTotals>> {
  const res = await AiCall.aggregate([
    { $match: match },
    {
      $group: {
        _id: groupKey(by),
        calls: { $sum: PROVIDER_CALL },
        failed: { $sum: FAILED_CALL },
        refused: { $sum: REFUSED_CALL },
        inputTokens: { $sum: '$inputTokens' },
        outputTokens: { $sum: '$outputTokens' },
        costUsd: { $sum: '$costUsd' },
        unpriced: { $sum: UNPRICED_CALL },
      },
    },
  ]);
  return new Map(res.map((r) => [idKey(r._id), r as AiTotals]));
}

/** Usage event counts keyed by `by` (field path). */
export async function eventCountsBy(match: Record<string, unknown>, by: string | Record<string, unknown>): Promise<Map<string, number>> {
  const res = await UsageEvent.aggregate([{ $match: match }, { $group: { _id: groupKey(by), n: { $sum: 1 } } }]);
  return new Map(res.map((r) => [idKey(r._id), r.n as number]));
}

/** Distinct people with any usage event since `since`. */
export async function distinctActiveUsers(since: Date, match: Record<string, unknown> = {}): Promise<number> {
  const res = await UsageEvent.aggregate([
    { $match: { createdAt: { $gte: since }, userId: { $ne: null }, ...match } },
    { $group: { _id: '$userId' } },
    { $count: 'n' },
  ]);
  return res[0]?.n ?? 0;
}

/** First day with any usage / AI tracking (stats start when telemetry was deployed). */
export async function trackingSince(): Promise<string | null> {
  const [stat, event, ai] = await Promise.all([
    StatsDaily.findOne({ $or: [{ activeUsers: { $gt: 0 } }, { aiCalls: { $gt: 0 } }, { mcpCalls: { $gt: 0 } }, { rateLimited: { $gt: 0 } }] })
      .sort({ day: 1 })
      .select('day')
      .lean<{ day: string }>(),
    UsageEvent.findOne().sort({ createdAt: 1 }).select('createdAt').lean<{ createdAt: Date }>(),
    AiCall.findOne().sort({ createdAt: 1 }).select('createdAt').lean<{ createdAt: Date }>(),
  ]);
  const days = [stat?.day, event ? dayOf(event.createdAt) : null, ai ? dayOf(ai.createdAt) : null].filter((d): d is string => !!d).sort();
  return days[0] ?? null;
}
