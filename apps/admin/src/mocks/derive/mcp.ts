/** The MCP page: calls split by tool / client / person / group from the daily MCP numbers. */
import type { AdminGroupRef, AdminMcpOverview, AdminRange } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { dayStr, groups, people, personRef } from '../fixtures';

import { daily } from './daily';
import { ref } from './group-row';
import { tokens } from './tokens';

/** Real tool names (apps/bot/src/mcp/tools) with their share of calls. */
const MCP_TOOL_SHARES: [string, number][] = [
  ['list_tasks', 0.34],
  ['get_task', 0.2],
  ['update_task', 0.16],
  ['create_tasks', 0.12],
  ['ask_taskbot', 0.07],
  ['list_groups', 0.04],
  ['list_members', 0.03],
  ['list_epics', 0.02],
  ['undo_last', 0.01],
  ['delete_task', 0.01],
];

const toolFailRate = (t: string) => (t === 'update_task' ? 0.09 : t === 'ask_taskbot' ? 0.05 : 0.01);

const MCP_CLIENT_SHARES: [string, number][] = [
  ['Claude Desktop', 0.52],
  ['Cursor', 0.31],
  ['Claude Code', 0.12],
  ['Unknown client', 0.05],
];

const shareOf = (list: [string, number][], key: string | null) => (key ? (list.find(([k]) => k === key)?.[1] ?? 0) : 1);

/** Who was refused by the rate limit (top 10). */
function rateLimitedBy(rateLimited: number): AdminMcpOverview['rateLimitedBy'] {
  if (!rateLimited) return [];
  return [
    { person: personRef(people[6]!), count: Math.round(rateLimited * 0.8) },
    { person: personRef(people[0]!), count: Math.round(rateLimited * 0.1) },
    { person: personRef(people[2]!), count: rateLimited - Math.round(rateLimited * 0.8) - Math.round(rateLimited * 0.1) },
  ].filter((r) => r.count > 0);
}

export function mcpOverview(range: AdminRange, tool: string | null, client: string | null): AdminMcpOverview {
  // Share of all MCP calls that match the filter (tools × clients are independent in the fixtures).
  const clientShare = shareOf(MCP_CLIENT_SHARES, client);
  const share = shareOf(MCP_TOOL_SHARES, tool) * clientShare;
  const d = daily(range, {}).map((x) => {
    const calls = Math.round(x.mcpCalls * share);
    return { day: x.day, calls, failed: Math.round(calls * (tool ? toolFailRate(tool) : x.day === dayStr(0) ? 0.06 : 0.021)) };
  });
  const calls = d.reduce((s, x) => s + x.calls, 0);
  const failed = d.reduce((s, x) => s + x.failed, 0);
  const all = daily(range, {}).reduce((s, x) => s + x.mcpCalls, 0);
  const rateLimited = Math.round(all * 0.006 * clientShare);
  const split = <T,>(rows: [T, number][], failRate = 0.021) =>
    rows.map(([key, w]) => ({ key, calls: Math.round(calls * w), failed: Math.round(calls * w * failRate) })).filter((r) => r.calls > 0);
  const active = tokens.filter((t) => t.status === 'active');
  return {
    activeTokens: active.length,
    tokenOwners: new Set(active.map((t) => t.person?.id)).size,
    calls,
    failed,
    rateLimited,
    byTool: MCP_TOOL_SHARES.filter(([t]) => !tool || t === tool).map(([t, w]) => {
      const n = Math.round(calls * (tool ? 1 : w));
      return { tool: t, calls: n, failed: tool ? failed : Math.round(n * toolFailRate(t)) };
    }),
    byClient: split(MCP_CLIENT_SHARES.filter(([c]) => !client || c === client).map(([c, w]) => [c, client ? 1 : w] as [string, number])).map((r) => ({
      client: r.key,
      calls: r.calls,
      failed: r.failed,
    })),
    topUsers: split([0, 2, 8, 6, 4].map((i, k) => [i, [0.34, 0.22, 0.18, 0.1, 0.06][k]!] as [number, number])).map((r, k) => ({
      person: personRef(people[r.key]!),
      calls: r.calls,
      failed: r.failed,
      rateLimited: k === 3 ? Math.round(rateLimited * 0.8) : k === 0 ? Math.round(rateLimited * 0.1) : 0,
    })),
    daily: d,
    byGroup: split(
      groups
        .filter((g) => g.status === GroupStatus.ACTIVE)
        .slice(0, 5)
        .map((g, k) => [ref(g), [0.41, 0.27, 0.14, 0.1, 0.05][k]!] as [AdminGroupRef, number]),
    ).map((r) => ({ group: r.key, calls: r.calls, failed: r.failed })),
    rateLimitedBy: rateLimitedBy(rateLimited),
    filter: { tool, client },
  };
}
