/** Read-only group endpoints: the list, one group, and its people / tasks / epics. Same contracts as admin-api. */
import type { AdminGroupDetail, AdminGroupMemberSort, AdminGroupTaskCounts, AdminGroupTaskFilter, AdminRange, UsageChannel } from '@tbot/shared';
import { UsageKind } from '@tbot/shared';

import { featureRows } from '../derive/ai';
import { activeIn, daily, periodStats } from '../derive/daily';
import { epicsOf, matches, MEMBER_METRIC, memberRows, TASK_FILTERS, tasksOf } from '../derive/group-lists';
import { findGroup, groupDetailExtras, groupRow, ref } from '../derive/group-row';
import { aiCalls, groups, inRange, type MockGroup, since } from '../fixtures';
import { paginate, rangeOf, type Route, searchOf } from '../http';

const LIST_SORTS: Record<string, (a: MockGroup, b: MockGroup) => number> = {
  lastActivity: (a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
  aiCost: (a, b) => b.aiCostUsd30d - a.aiCostUsd30d,
  tasks: (a, b) => b.tasks - a.tasks,
  members: (a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0),
  added: (a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''),
};

function list(q: URLSearchParams) {
  const status = q.get('status');
  const search = q.get('q')?.toLowerCase();
  const sort = q.get('sort') ?? 'lastActivity';
  const period = q.get('activeIn') as AdminRange | null;
  const pool = period ? activeIn(period) : groups;
  let rows = pool.filter((g) => (!status || g.status === status) && (!search || g.name.toLowerCase().includes(search)));
  if (period) {
    const stats = new Map(rows.map((g) => [g.id, periodStats(g, period)]));
    const score = (g: MockGroup) => (sort === 'tasks' ? stats.get(g.id)!.tasksCreated : stats.get(g.id)!.events);
    if (sort === 'tasks' || sort === 'lastActivity') rows = [...rows].sort((a, b) => score(b) - score(a));
    return paginate(
      rows.map((g) => ({ ...groupRow(g), inPeriod: stats.get(g.id)! })),
      q,
    );
  }
  rows = [...rows].sort(LIST_SORTS[sort] ?? LIST_SORTS.lastActivity);
  return paginate(rows.map(groupRow), q);
}

function usageOf(d: AdminGroupDetail['daily']): AdminGroupDetail['usage'] {
  const ch = (c: UsageChannel) => d.reduce((s, x) => s + (x.channels[c] ?? 0), 0);
  const rows: [UsageChannel, UsageKind, number][] = [
    ['telegram', UsageKind.COMMAND, Math.round(ch('telegram') * 0.55)],
    ['telegram', UsageKind.CALLBACK, Math.round(ch('telegram') * 0.3)],
    ['telegram', UsageKind.MENTION, Math.round(ch('telegram') * 0.15)],
    ['app', UsageKind.API, ch('app')],
    ['mcp', UsageKind.MCP_TOOL, ch('mcp')],
    ['telegram', UsageKind.RATE_LIMITED, d.reduce((s, x) => s + x.rateLimited, 0)],
  ];
  return rows.filter(([, , count]) => count > 0).map(([channel, kind, count]) => ({ channel, kind, count }));
}

function detail(g: MockGroup, range: AdminRange): AdminGroupDetail {
  const calls = aiCalls.filter((c) => c.group?.id === g.id && inRange(c.at, range));
  const d = daily(range, { group: g });
  return {
    ...groupRow(g),
    timezone: g.timezone,
    approvedAt: g.approvedAt,
    botLeftAt: g.botLeftAt,
    migratedToChatId: g.migratedToChatId,
    publicLink: g.publicLink,
    counts: { epics: g.epics, activities: g.activities, activeTokens: g.activeTokens },
    daily: d,
    aiByFeature: featureRows(calls),
    ...groupDetailExtras(g, range),
    usage: usageOf(d),
  };
}

function members(g: MockGroup, q: URLSearchParams) {
  const search = searchOf(q);
  const by = MEMBER_METRIC[(q.get('sort') as AdminGroupMemberSort) ?? 'events'] ?? MEMBER_METRIC.events;
  const rows = memberRows(g, rangeOf(q))
    .filter((m) => !search || m.person.name.toLowerCase().includes(search) || m.person.username?.toLowerCase().includes(search))
    .sort((a, b) => by(b) - by(a) || b.events - a.events);
  return paginate(rows, q, 25);
}

function tasks(g: MockGroup, q: URLSearchParams) {
  const filter = (q.get('filter') as AdminGroupTaskFilter) || 'open';
  const createdIn = q.get('createdIn') as AdminRange | null;
  const search = searchOf(q, /^#/);
  const base = tasksOf(g).filter(
    (t) => (!createdIn || Date.parse(t.createdAt) >= since(createdIn)) && (!search || t.title.toLowerCase().includes(search) || String(t.number) === search),
  );
  const counts = Object.fromEntries(TASK_FILTERS.map((f) => [f, base.filter((t) => matches(t, f)).length])) as AdminGroupTaskCounts;
  let rows = base.filter((t) => matches(t, filter));
  if (filter === 'overdue') rows = [...rows].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return { ...paginate(rows, q, 25), counts };
}

function epics(g: MockGroup, q: URLSearchParams) {
  const all = tasksOf(g);
  const rows = epicsOf(g)
    .map((e) => {
      const mine = all.filter((t) => t.epic?.id === e.id);
      return { ...e, tasks: mine.length, openTasks: mine.filter((t) => t.completedAt == null).length };
    })
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1));
  return paginate(rows, q, 25);
}

function deletePreview(g: MockGroup) {
  return { data: { group: ref(g), tasks: g.tasks, epics: g.epics, members: g.knownMembers, activities: g.activities, tokens: g.activeTokens } };
}

export const groupRoutes: Route[] = [
  ['GET', /^\/groups$/, ({ q }) => list(q)],
  ['GET', /^\/groups\/([^/]+)\/delete-preview$/, ({ params }) => deletePreview(findGroup(params[0]!))],
  ['GET', /^\/groups\/([^/]+)\/members$/, ({ params, q }) => members(findGroup(params[0]!), q)],
  ['GET', /^\/groups\/([^/]+)\/tasks$/, ({ params, q }) => tasks(findGroup(params[0]!), q)],
  ['GET', /^\/groups\/([^/]+)\/epics$/, ({ params, q }) => epics(findGroup(params[0]!), q)],
  ['GET', /^\/groups\/([^/]+)$/, ({ params, q }) => ({ data: detail(findGroup(params[0]!), rangeOf(q)) })],
];
