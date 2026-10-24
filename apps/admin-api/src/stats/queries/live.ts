/** Daily numbers computed live from the raw collections (for days the rollup hasn't written yet). */
import { AiCall, Task, UsageEvent } from '@tbot/db';
import { UsageKind } from '@tbot/shared';
import { DayStats, emptyDayStats } from 'src/stats/aggregate';
import { DayWindow } from 'src/stats/range';

import { DAY_EXPR, FAILED_CALL, groupMatch, LiveFilter, PROVIDER_CALL, UNPRICED_CALL } from './exprs';

type DayId = { day: string; g?: unknown };

function queryLive(window: Pick<DayWindow, 'start' | 'end'>, filter: LiveFilter, perGroup: boolean) {
  const range = { $gte: window.start, $lt: window.end };
  const gid = perGroup ? '$groupId' : null;
  return Promise.all([
    UsageEvent.aggregate([
      { $match: { createdAt: range, ...groupMatch(filter) } },
      { $group: { _id: { day: DAY_EXPR('createdAt'), g: gid, kind: '$kind', channel: '$channel' }, n: { $sum: 1 } } },
    ]),
    UsageEvent.aggregate([
      { $match: { createdAt: range, userId: { $ne: null }, ...groupMatch(filter) } },
      { $group: { _id: { day: DAY_EXPR('createdAt'), g: gid }, users: { $addToSet: '$userId' } } },
      { $project: { n: { $size: '$users' } } },
    ]),
    AiCall.aggregate([
      { $match: { createdAt: range, ...groupMatch(filter) } },
      {
        $group: {
          _id: { day: DAY_EXPR('createdAt'), g: gid },
          calls: { $sum: PROVIDER_CALL },
          failed: { $sum: FAILED_CALL },
          input: { $sum: '$inputTokens' },
          output: { $sum: '$outputTokens' },
          cost: { $sum: '$costUsd' },
          unpriced: { $sum: UNPRICED_CALL },
        },
      },
    ]),
    Task.aggregate([
      { $match: { createdAt: range, ...groupMatch(filter) } },
      { $group: { _id: { day: DAY_EXPR('createdAt'), g: gid }, n: { $sum: 1 } } },
    ]),
    Task.aggregate([
      { $match: { completedAt: range, ...groupMatch(filter) } },
      { $group: { _id: { day: DAY_EXPR('completedAt'), g: gid }, n: { $sum: 1 } } },
    ]),
  ]);
}

/** One DayStats per (day, group) key, created on first use. */
function dayRows() {
  const rows = new Map<string, DayStats>();
  const row = (id: DayId) => {
    const k = `${id.day}|${id.g ? String(id.g) : ''}`;
    let r = rows.get(k);
    if (!r) {
      r = emptyDayStats(id.day, id.g ? String(id.g) : null);
      rows.set(k, r);
    }
    return r;
  };
  return { row, all: () => [...rows.values()] };
}

/**
 * Daily numbers computed from the raw collections for [start, end). perGroup=true gives one row per
 * (day, group); false gives one row per day (activeUsers then counts distinct people across groups).
 */
export async function liveDayStats(window: Pick<DayWindow, 'start' | 'end'>, filter: LiveFilter, perGroup: boolean): Promise<DayStats[]> {
  const [eventCounts, eventUsers, ai, created, completed] = await queryLive(window, filter, perGroup);
  const { row, all } = dayRows();
  for (const e of eventCounts) {
    const r = row(e._id);
    r.events[e._id.kind] = (r.events[e._id.kind] ?? 0) + e.n;
    r.channels[e._id.channel] = (r.channels[e._id.channel] ?? 0) + e.n;
    if (e._id.kind === UsageKind.MCP_TOOL) r.mcpCalls += e.n;
    if (e._id.kind === UsageKind.RATE_LIMITED) r.rateLimited += e.n;
  }
  for (const u of eventUsers) row(u._id).activeUsers = u.n;
  for (const a of ai) {
    const r = row(a._id);
    r.aiCalls = a.calls;
    r.aiFailed = a.failed;
    r.aiInputTokens = a.input;
    r.aiOutputTokens = a.output;
    r.aiCostUsd = a.cost;
    r.aiUnpriced = a.unpriced;
  }
  for (const t of created) row(t._id).tasksCreated = t.n;
  for (const t of completed) row(t._id).tasksCompleted = t.n;
  return all();
}
