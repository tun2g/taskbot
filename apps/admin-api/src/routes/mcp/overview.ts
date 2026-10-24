import { ApiToken, UsageEvent } from '@tbot/db';
import type { AdminMcpOverview } from '@tbot/shared';
import { UsageKind } from '@tbot/shared';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';
import { DAY_EXPR } from 'src/stats/queries';
import type { DayWindow } from 'src/stats/range';
import { activeTokenFilter } from './tokens';

/** Label the API uses for calls whose client didn't say what it is (also accepted back as ?client=). */
export const UNKNOWN_CLIENT = 'Unknown client';

const FAILED = { $sum: { $cond: ['$ok', 0, 1] } };

/** The usage-event matches for MCP calls and for MCP requests refused by the rate limit. */
function matches(window: DayWindow, tool: string | null, client: string | null) {
  const createdAt = { $gte: window.start, $lt: window.end };
  const calls: Record<string, unknown> = { kind: UsageKind.MCP_TOOL, createdAt };
  if (tool) calls.name = tool;
  if (client) calls.client = client === UNKNOWN_CLIENT ? null : client;
  // Rate-limited MCP requests don't carry a tool name, so a tool filter can't narrow them; a client filter can.
  const limited: Record<string, unknown> = { kind: UsageKind.RATE_LIMITED, channel: 'mcp', createdAt };
  if (client) limited.client = calls.client;
  return { calls, limited };
}

const top = (match: Record<string, unknown>, by: string, limit: number) =>
  UsageEvent.aggregate([{ $match: match }, { $group: { _id: `$${by}`, calls: { $sum: 1 }, failed: FAILED } }, { $sort: { calls: -1 } }, { $limit: limit }]);

/** GET /mcp — MCP usage from the raw usage events (kept 90 days, the longest range). Tokens are listed by GET /mcp/tokens. */
export async function mcpOverview(window: DayWindow, tool: string | null, client: string | null): Promise<AdminMcpOverview> {
  const { calls, limited } = matches(window, tool, client);
  const active = activeTokenFilter(new Date());
  const [tokenCount, owners, totals, rateLimited, byTool, byClient, topUsers, daily, byGroup, limitedBy] = await Promise.all([
    ApiToken.countDocuments(active),
    ApiToken.distinct('userId', active),
    UsageEvent.aggregate([{ $match: calls }, { $group: { _id: null, calls: { $sum: 1 }, failed: FAILED } }]),
    UsageEvent.countDocuments(limited),
    top(calls, 'name', 50),
    top(calls, 'client', 20),
    top({ ...calls, userId: { $ne: null } }, 'userId', 10),
    UsageEvent.aggregate([{ $match: calls }, { $group: { _id: DAY_EXPR('createdAt'), calls: { $sum: 1 }, failed: FAILED } }]),
    top({ ...calls, groupId: { $ne: null } }, 'groupId', 10),
    UsageEvent.aggregate([{ $match: { ...limited, userId: { $ne: null } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 10 }]),
  ]);
  const people = await loadPersonRefs([...topUsers.map((u) => u._id), ...limitedBy.map((u) => u._id)]);
  const groups = await loadGroupRefs(byGroup.map((g) => g._id));
  const perDay = new Map(daily.map((d) => [String(d._id), d as { calls: number; failed: number }]));
  const limitedByUser = new Map(limitedBy.map((u) => [String(u._id), u.n as number]));

  return {
    activeTokens: tokenCount,
    tokenOwners: owners.length,
    calls: totals[0]?.calls ?? 0,
    failed: totals[0]?.failed ?? 0,
    rateLimited,
    byTool: byTool.map((t) => ({ tool: String(t._id), calls: t.calls, failed: t.failed })),
    byClient: byClient.map((c) => ({ client: c._id ? String(c._id) : UNKNOWN_CLIENT, calls: c.calls, failed: c.failed })),
    topUsers: topUsers
      .filter((u) => people.has(String(u._id)))
      .map((u) => ({ person: people.get(String(u._id))!, calls: u.calls, failed: u.failed, rateLimited: limitedByUser.get(String(u._id)) ?? 0 })),
    daily: window.days.map((day) => ({ day, calls: perDay.get(day)?.calls ?? 0, failed: perDay.get(day)?.failed ?? 0 })),
    byGroup: byGroup.map((g) => ({ group: groups.get(String(g._id))!, calls: g.calls, failed: g.failed })).filter((g) => g.group),
    rateLimitedBy: limitedBy.filter((u) => people.has(String(u._id))).map((u) => ({ person: people.get(String(u._id))!, count: u.n })),
    filter: { tool, client },
  };
}
