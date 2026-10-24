/**
 * Dev-only axios adapter that answers admin API calls from fixtures (VITE_ADMIN_MOCK=1). Stateful in memory,
 * so approving / suspending / deleting a group changes what the next request returns (until reload).
 */
import type {
  AdminAiBreakdownRow,
  AdminAiCallRow,
  AdminAiUsage,
  AdminDailyPoint,
  AdminGroupDetail,
  AdminGroupRef,
  AdminGroupRow,
  AdminAttentionItem,
  AdminMcpOverview,
  AdminOverview,
  AdminRange,
  AdminSystemStatus,
  AdminUserDetail,
  AdminUserRow,
  UsageChannel,
} from '@tbot/shared';
import { AI_FEATURE_LABELS, AiFeature, backgroundJobInfo, GroupStatus, UsageKind } from '@tbot/shared';
import { type AxiosAdapter, AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import {
  aiCalls,
  auditLog,
  dayStr,
  groups,
  iso,
  type MockGroup,
  now,
  people,
  personRef,
  refused,
  settings,
  trackingSince,
  TRACKING_SINCE_DAYS_AGO,
} from './fixtures';
import { groupDetailExtras, groupReviewRoutes, groupRowExtras, MockHttpError } from './groups-review';

const DAY = 86_400_000;
const RANGE_DAYS: Record<AdminRange, number> = { '7d': 7, '30d': 30, '90d': 90 };
const SESSION_KEY = 'tbot-admin:mock-logged-out';

// ── helpers ─────────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const ERROR_NAMES: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 409: 'Conflict' };

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable pseudo-random number for (key, day). */
function noise(key: string, max: number): number {
  return hash(key) % (max + 1);
}

const rangeOf = (q: URLSearchParams): AdminRange => (q.get('range') as AdminRange) || '30d';
const ref = (g: MockGroup): AdminGroupRef => ({ id: g.id, name: g.name, status: g.status });

/** Like the real API: a group deleted after the record was written shows as "Deleted group". */
function liveRef(r: AdminGroupRef | null): AdminGroupRef | null {
  if (!r) return null;
  const g = groups.find((x) => x.id === r.id);
  return g ? ref(g) : { id: r.id, name: 'Deleted group', status: GroupStatus.LEFT, deleted: true };
}

/** Groups with any activity in the period (same rule as the overview's "Active groups"). */
function activeIn(range: AdminRange): MockGroup[] {
  return groups.filter((g) => {
    const d = daily(range, { group: g });
    return d.some((x) => x.tasksCreated + x.aiCalls + (x.channels.telegram ?? 0) + (x.channels.app ?? 0) + (x.channels.mcp ?? 0) > 0);
  });
}

function periodStats(g: MockGroup, range: AdminRange) {
  const d = daily(range, { group: g });
  return {
    events: d.reduce((s, x) => s + (x.channels.telegram ?? 0) + (x.channels.app ?? 0) + (x.channels.mcp ?? 0), 0),
    tasksCreated: d.reduce((s, x) => s + x.tasksCreated, 0),
    aiCalls: d.reduce((s, x) => s + x.aiCalls, 0),
    aiCostUsd: d.reduce((s, x) => s + x.aiCostUsd, 0),
    aiUnpriced: aiCalls.filter((c) => c.group?.id === g.id && inRange(c.at, range) && !c.priced).length,
  };
}

function days(range: AdminRange, offset = 0): string[] {
  const n = RANGE_DAYS[range];
  return Array.from({ length: n }, (_, i) => dayStr(n - 1 - i + offset));
}

function inRange(at: string, range: AdminRange, offset = 0): boolean {
  const day = at.slice(0, 10);
  const list = days(range, offset);
  return day >= list[0]! && day <= list[list.length - 1]!;
}

function paginate<T>(rows: T[], q: URLSearchParams) {
  const page = Math.max(1, Number(q.get('page')) || 1);
  const limit = Math.max(1, Number(q.get('limit')) || 20);
  const data = rows.slice((page - 1) * limit, page * limit);
  return { data, meta: { page, limit, total: rows.length, hasMore: page * limit < rows.length } };
}

function breakdown(calls: AdminAiCallRow[], keyOf: (c: AdminAiCallRow) => [string, string]): AdminAiBreakdownRow[] {
  const map = new Map<string, AdminAiBreakdownRow>();
  for (const c of calls) {
    const [key, label] = keyOf(c);
    const row = map.get(key) ?? { key, label, calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0, refused: 0 };
    // Same rule as the API: refusals never reached the model, so they are neither calls nor failures.
    if (refused(c.status)) {
      row.refused = (row.refused ?? 0) + 1;
      map.set(key, row);
      continue;
    }
    row.calls++;
    if (c.status === 'failed' || c.status === 'invalid') row.failed++;
    row.inputTokens += c.inputTokens;
    row.outputTokens += c.outputTokens;
    row.costUsd += c.costUsd;
    if (!c.priced) row.unpriced++;
    map.set(key, row);
  }
  return [...map.values()];
}

function totals(calls: AdminAiCallRow[]): AdminAiUsage['totals'] {
  const [row] = breakdown(calls, () => ['all', 'all']);
  return row
    ? { calls: row.calls, failed: row.failed, inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUsd: row.costUsd, unpriced: row.unpriced, refused: row.refused }
    : { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0, refused: 0 };
}

const featureRows = (calls: AdminAiCallRow[]) =>
  breakdown(calls, (c) => [c.feature, AI_FEATURE_LABELS[c.feature]]).sort((a, b) => b.costUsd - a.costUsd);

function daily(range: AdminRange, scope: { group?: MockGroup }): AdminDailyPoint[] {
  const tracked = dayStr(TRACKING_SINCE_DAYS_AGO);
  const weight = scope.group ? Math.max(0.15, scope.group.seed.aiWeight / 10) : 1;
  const active = scope.group ? scope.group.status === GroupStatus.ACTIVE || scope.group.status === GroupStatus.SUSPENDED : true;
  return days(range).map((day) => {
    const calls = aiCalls.filter((c) => c.at.startsWith(day) && (!scope.group || c.group?.id === scope.group.id));
    const isTracked = day >= tracked;
    const base = active ? 1 : 0;
    const weekday = new Date(day).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.45 : 1;
    const k = scope.group?.id ?? 'all';
    const scale = (n: number) => Math.round(n * weight * weekend * base);
    const telegram = isTracked ? scale(220 + noise(`${k}t${day}`, 120)) : 0;
    const app = isTracked ? scale(90 + noise(`${k}a${day}`, 60)) : 0;
    const mcp = isTracked ? scale(25 + noise(`${k}m${day}`, 30)) : 0;
    return {
      day,
      activeUsers: isTracked ? Math.max(scope.group ? 0 : 3, scale(14 + noise(`${k}u${day}`, 9))) : 0,
      // Task counts exist before tracking (they come from task documents).
      tasksCreated: scale(9 + noise(`${k}c${day}`, 12)),
      tasksCompleted: scale(6 + noise(`${k}d${day}`, 10)),
      // Like stats_daily: provider calls only (refusals were never sent); "failed" = errors + unusable replies.
      aiCalls: calls.filter((c) => !refused(c.status)).length,
      aiFailed: calls.filter((c) => c.status === 'failed' || c.status === 'invalid').length,
      aiCostUsd: calls.reduce((s, c) => s + c.costUsd, 0),
      mcpCalls: mcp,
      rateLimited: isTracked ? noise(`${k}r${day}`, 4) : 0,
      channels: isTracked ? { telegram, app, mcp } : {},
    };
  });
}

function groupRow(g: MockGroup): AdminGroupRow {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { seed, timezone, approvedAt, botLeftAt, migratedToChatId, publicLink, epics, activities, activeTokens, ...base } = g;
  const row: AdminGroupRow = { ...base, ...groupRowExtras(g) };
  if (g.status !== GroupStatus.PENDING) return row;
  const last = auditLog.find((e) => e.targetId === g.id && ['group.reject', 'group.suspend', 'group.leave', 'group.reconsider'].includes(e.action));
  const action = { 'group.reject': 'rejected', 'group.suspend': 'suspended', 'group.leave': 'removed', 'group.reconsider': 'reconsidered' } as const;
  return {
    ...row,
    previousDecision: last ? { action: action[last.action as keyof typeof action], at: last.at, reason: last.reason } : null,
  };
}

function findGroup(id: string): MockGroup {
  const g = groups.find((x) => x.id === id);
  if (!g) throw new HttpError(404, 'This group no longer exists.');
  return g;
}

function userRow(i: number): AdminUserRow {
  const p = people[i]!;
  const calls = aiCalls.filter((c) => c.person?.id === p.id);
  const memberOf = groups.filter((g) => g.seed.members.includes(i));
  const last = memberOf.map((g) => g.lastActivityAt).filter(Boolean).sort().pop() ?? null;
  return {
    person: personRef(p),
    groups: memberOf.length,
    lastSeenAt: last,
    aiCalls30d: calls.length,
    aiCostUsd30d: calls.reduce((s, c) => s + c.costUsd, 0),
    events30d: 40 + noise(p.id, 600),
    activeTokens: i % 4 === 0 ? 2 : i % 3 === 0 ? 1 : 0,
    aiDisabled: i === 10,
    aiDailyLimit: i === 3 ? 10 : null,
    createdAt: iso(p.createdDaysAgo * DAY),
    ...userOverrides.get(p.id),
  };
}

const userOverrides = new Map<string, Partial<AdminUserRow>>();

function personIndex(id: string): number {
  const i = people.findIndex((p) => p.id === id);
  if (i < 0) throw new HttpError(404, 'This person was not found.');
  return i;
}

// ── MCP, system and "needs attention" ───────────────────────────────────────

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

/** Every active token, from the same per-person rows the People page shows. */
function mcpTokens(): NonNullable<AdminMcpOverview['tokens']> {
  return people
    .flatMap((p, i) =>
      Array.from({ length: userRow(i).activeTokens }, (_, k) => {
        const g = groups.find((x) => x.seed.members.includes(i));
        return {
          id: `${p.id}-t${k}`,
          name: k === 0 ? 'Claude Desktop' : 'Cursor (work laptop)',
          prefix: `tbot_${p.id.slice(-4)}${k}`,
          person: personRef(p),
          group: k === 0 && g ? ref(g) : null,
          lastUsedAt: i === 9 ? null : iso((k + 1) * (i + 1) * 3_600_000),
          createdAt: iso((20 + k * 7 + i) * DAY),
          expiresAt: k === 0 ? null : iso(-60 * DAY),
        };
      }),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const HOUR_MS = 3_600_000;
const nextAt = (minute: number) => {
  const d = new Date(now);
  d.setUTCMinutes(minute, 0, 0);
  if (d.getTime() <= now) d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
};

/** The bot's real schedules (apps/bot/src/index.ts); the hourly stats run failed twice today. */
function systemStatus(): AdminSystemStatus {
  const jobs: AdminSystemStatus['jobs'] = [
    { name: 'due-reminder', cron: '5 * * * *', lastRunAt: iso(38 * 60_000), lastError: null, lastSuccessAt: iso(38 * 60_000), failuresLast24h: 0, nextRunAt: nextAt(5) },
    { name: 'daily-digest', cron: '0 * * * *', lastRunAt: iso(43 * 60_000), lastError: null, lastSuccessAt: iso(43 * 60_000), failuresLast24h: 0, nextRunAt: nextAt(0) },
    { name: 'stats-rollup', cron: '10 0 * * *', lastRunAt: iso(14 * HOUR_MS), lastError: null, lastSuccessAt: iso(14 * HOUR_MS), failuresLast24h: 0, nextRunAt: iso(-10 * HOUR_MS) },
    {
      name: 'stats-rollup',
      cron: '20 * * * *',
      lastRunAt: iso(23 * 60_000),
      lastError: 'MongoServerSelectionError: connection timed out after 30000 ms',
      lastSuccessAt: iso(2 * HOUR_MS + 23 * 60_000),
      failuresLast24h: 2,
      nextRunAt: nextAt(20),
    },
  ].map((j) => ({ ...j, key: `${j.name}|${j.cron}` }));
  return {
    mongo: { ok: true, latencyMs: 3 },
    redis: { ok: true, latencyMs: 1 },
    queue: { waiting: 0, active: 0, failed: 37, delayed: 4, completed: 200, failedLast24h: 2, oldestWaitingSeconds: null },
    jobs,
    lastEventAt: iso(40_000),
    lastEventByChannel: { telegram: iso(40_000), app: iso(6 * 60_000), mcp: iso(52 * 60_000) },
    activity: { lastHour: 46, usualThisHour: 38.4 },
    versions: { adminApi: '0.1.0 (2a69084)' },
  };
}

/** Same rules as apps/admin-api/src/stats/attention.ts, applied to the fixtures. */
function attention(): AdminAttentionItem[] {
  const items: AdminAttentionItem[] = [];
  const failing = systemStatus().jobs.filter((j) => j.lastError);
  if (failing.length) {
    const info = backgroundJobInfo(failing[0]!.name, failing[0]!.cron);
    items.push({
      kind: 'failed_jobs',
      severity: 'danger',
      title: `“${info.label}” failed on its last run`,
      detail: `${info.ifFailing} Error: ${failing[0]!.lastError}`,
      link: '/system',
      linkLabel: 'See the job errors',
    });
  }
  const todayCalls = aiCalls.filter((c) => c.at.startsWith(dayStr(0)));
  const quota = todayCalls.filter((c) => c.status === 'quota').length;
  const rateLimited = 24;
  if (quota > 0 || rateLimited >= 20) {
    const parts = [
      quota > 0 ? `${quota} AI request${quota === 1 ? '' : 's'} refused by a daily AI limit` : null,
      `${rateLimited} requests blocked for coming too fast (most in “Saigon Devs”)`,
    ].filter(Boolean);
    items.push({
      kind: 'refused',
      severity: 'warn',
      title: 'Requests were refused by limits today',
      detail: `${parts.join('; ')}. Raise the limit in Settings if this is expected use.`,
      link: quota > 0 ? '/ai?range=7d&status=quota' : `/groups/${groups[1]!.id}`,
      linkLabel: quota > 0 ? 'See the refused requests' : 'Open the group',
    });
  }
  const waiting = groups.filter((g) => g.status === GroupStatus.PENDING && g.addedAt && now - Date.parse(g.addedAt) > 24 * HOUR_MS);
  if (waiting.length) {
    const oldest = [...waiting].sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''))[0]!;
    const hours = (now - Date.parse(oldest.addedAt!)) / HOUR_MS;
    items.push({
      kind: 'pending_groups',
      severity: 'warn',
      title:
        waiting.length === 1
          ? `“${oldest.name}” has waited ${hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`} for your approval`
          : `${waiting.length} groups have waited over a day for your approval`,
      detail: 'They were told it usually takes less than a day, and can’t use the bot until you decide.',
      link: '/groups?status=pending',
      linkLabel: 'Review them',
    });
  }
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : 1));
}


// ── routes ──────────────────────────────────────────────────────────────────

type Handler = (ctx: { q: URLSearchParams; body: Record<string, unknown>; params: string[] }) => unknown;

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/auth\/me$/, () => {
    if (localStorage.getItem(SESSION_KEY)) throw new HttpError(401, 'Not logged in.');
    return { data: { owner: { telegramUserId: 50_000_000, name: 'Tung Nguyen', username: 'tun2g' }, expiresAt: iso(-7 * DAY) } };
  }],
  ['POST', /^\/auth\/request-link$/, () => ({ data: { sentTo: '@tun2g', expiresInSeconds: 300 } })],
  ['POST', /^\/auth\/exchange$/, ({ body }) => {
    if (body.code === 'expired') throw new HttpError(401, 'This login link has expired or was already used.');
    localStorage.removeItem(SESSION_KEY);
    return { data: { owner: { telegramUserId: 50_000_000, name: 'Tung Nguyen', username: 'tun2g' }, expiresAt: iso(-7 * DAY) } };
  }],
  ['POST', /^\/auth\/logout(-all)?$/, () => {
    localStorage.setItem(SESSION_KEY, '1');
    return { data: { ok: true } };
  }],

  ['GET', /^\/overview$/, ({ q }) => {
    const range = rangeOf(q);
    const list = days(range);
    const cur = daily(range, {});
    const prevCalls = aiCalls.filter((c) => inRange(c.at, range, RANGE_DAYS[range]));
    const curCalls = aiCalls.filter((c) => inRange(c.at, range));
    const today = aiCalls.filter((c) => c.at.startsWith(dayStr(0)) && !refused(c.status));
    const blocked = aiCalls.filter((c) => c.at.startsWith(dayStr(0)) && refused(c.status)).length;
    const byStatus = Object.fromEntries(Object.values(GroupStatus).map((s) => [s, groups.filter((g) => g.status === s).length])) as Record<GroupStatus, number>;
    const activity = groups
      .filter((g) => g.status === GroupStatus.ACTIVE)
      .map((g) => ({ group: ref(g), events: daily(range, { group: g }).reduce((s, d) => s + (d.channels.telegram ?? 0) + (d.channels.app ?? 0) + (d.channels.mcp ?? 0), 0) }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 5);
    const cost = groups
      .map((g) => {
        const c = curCalls.filter((x) => x.group?.id === g.id);
        return { group: ref(g), costUsd: c.reduce((s, x) => s + x.costUsd, 0), calls: c.length };
      })
      .filter((x) => x.calls > 0)
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 5);
    const sum = (k: keyof AdminDailyPoint) => cur.reduce((s, d) => s + (d[k] as number), 0);
    const overview: AdminOverview = {
      range,
      from: list[0]!,
      to: list[list.length - 1]!,
      trackingSince,
      kpis: {
        dau: 17,
        wau: 41,
        mau: 63,
        activeGroups: { value: activeIn(range).length, previous: range === '7d' ? 5 : 3 },
        tasksCreated: { value: sum('tasksCreated'), previous: Math.round(sum('tasksCreated') * 0.86) },
        aiCalls: { value: curCalls.length, previous: prevCalls.length },
        aiCostUsd: { value: curCalls.reduce((s, c) => s + c.costUsd, 0), previous: prevCalls.reduce((s, c) => s + c.costUsd, 0) },
        mcpCalls: { value: sum('mcpCalls'), previous: Math.round(sum('mcpCalls') * 0.7) },
      },
      aiToday: { costUsd: today.reduce((s, c) => s + c.costUsd, 0), calls: today.length, blocked, budgetUsd: settings.dailyBudgetUsd, callLimit: settings.dailyCallLimit },
      groupsByStatus: byStatus,
      pending: groups
        .filter((g) => g.status === GroupStatus.PENDING)
        .sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''))
        .slice(0, 5)
        .map(groupRow),
      daily: cur,
      topGroupsByActivity: activity,
      topGroupsByAiCost: cost,
      attention: attention(),
    };
    return { data: overview };
  }],

  ['GET', /^\/groups$/, ({ q }) => {
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
    const by: Record<string, (a: MockGroup, b: MockGroup) => number> = {
      lastActivity: (a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''),
      aiCost: (a, b) => b.aiCostUsd30d - a.aiCostUsd30d,
      tasks: (a, b) => b.tasks - a.tasks,
      members: (a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0),
      added: (a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? ''),
    };
    rows = [...rows].sort(by[sort] ?? by.lastActivity);
    return paginate(rows.map(groupRow), q);
  }],
  ['GET', /^\/groups\/([^/]+)\/delete-preview$/, ({ params }) => {
    const g = findGroup(params[0]!);
    return { data: { group: ref(g), tasks: g.tasks, epics: g.epics, members: g.knownMembers, activities: g.activities, tokens: g.activeTokens } };
  }],
  ...groupReviewRoutes,
  ['GET', /^\/groups\/([^/]+)$/, ({ params, q }) => {
    const g = findGroup(params[0]!);
    const range = rangeOf(q);
    const calls = aiCalls.filter((c) => c.group?.id === g.id && inRange(c.at, range));
    const d = daily(range, { group: g });
    const ch = (c: UsageChannel) => d.reduce((s, x) => s + (x.channels[c] ?? 0), 0);
    const usage: AdminGroupDetail['usage'] = (
      [
        ['telegram', UsageKind.COMMAND, Math.round(ch('telegram') * 0.55)],
        ['telegram', UsageKind.CALLBACK, Math.round(ch('telegram') * 0.3)],
        ['telegram', UsageKind.MENTION, Math.round(ch('telegram') * 0.15)],
        ['app', UsageKind.API, ch('app')],
        ['mcp', UsageKind.MCP_TOOL, ch('mcp')],
        ['telegram', UsageKind.RATE_LIMITED, d.reduce((s, x) => s + x.rateLimited, 0)],
      ] as [UsageChannel, UsageKind, number][]
    )
      .filter(([, , count]) => count > 0)
      .map(([channel, kind, count]) => ({ channel, kind, count }));
    const detail: AdminGroupDetail = {
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
      usage,
    };
    return { data: detail };
  }],
  ['POST', /^\/groups\/([^/]+)\/(approve|reject|suspend|unsuspend|leave)$/, ({ params, body }) => {
    const g = findGroup(params[0]!);
    const action = params[1]!;
    const allowed: Record<string, GroupStatus[]> = {
      approve: [GroupStatus.PENDING],
      reject: [GroupStatus.PENDING],
      suspend: [GroupStatus.ACTIVE],
      unsuspend: [GroupStatus.SUSPENDED],
      leave: [GroupStatus.ACTIVE, GroupStatus.SUSPENDED, GroupStatus.PENDING],
    };
    if (!allowed[action]!.includes(g.status)) {
      const already: Record<string, string> = {
        approve: g.status === GroupStatus.ACTIVE ? 'This group is already active.' : 'Only groups waiting for approval can be approved.',
        reject: 'Only groups waiting for approval can be rejected.',
        suspend: g.status === GroupStatus.SUSPENDED ? 'This group is already suspended.' : 'Only active groups can be suspended.',
        unsuspend: 'This group is not suspended.',
        leave: 'The bot is not in this chat.',
      };
      throw new HttpError(409, already[action]!);
    }
    if ((action === 'reject' || action === 'suspend') && !String(body.reason ?? '').trim()) {
      throw new HttpError(400, 'A reason is required.');
    }
    const next: Record<string, GroupStatus> = {
      approve: GroupStatus.ACTIVE,
      reject: GroupStatus.REJECTED,
      suspend: GroupStatus.SUSPENDED,
      unsuspend: GroupStatus.ACTIVE,
      leave: GroupStatus.LEFT,
    };
    g.status = next[action]!;
    g.statusReason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    g.statusChangedAt = new Date().toISOString();
    if (action === 'approve') g.approvedAt = g.statusChangedAt;
    if (action === 'leave' || action === 'reject') g.botLeftAt = g.statusChangedAt;
    auditLog.unshift({
      id: `mock-${Date.now()}`,
      at: new Date().toISOString(),
      action: `group.${action}`,
      summary: `${action === 'unsuspend' ? 'Unsuspended' : action === 'leave' ? 'Made the bot leave' : action[0]!.toUpperCase() + action.slice(1) + 'd'} group “${g.name}”`,
      targetType: 'group',
      targetId: g.id,
      targetLabel: g.name,
      reason: g.statusReason,
      details: null,
    });
    // The bot can fail to post the notice (e.g. it lost permission to send messages).
    const warnings = g.name === 'Freelance Crew' && action === 'approve' ? ['The welcome message could not be posted: the bot is not allowed to send messages in this chat.'] : undefined;
    return { data: groupRow(g), warnings };
  }],
  ['PATCH', /^\/groups\/([^/]+)\/ai$/, ({ params, body }) => {
    const g = findGroup(params[0]!);
    if (typeof body.disabled === 'boolean') g.aiDisabled = body.disabled;
    if ('dailyLimit' in body) g.aiDailyLimit = (body.dailyLimit as number | null) ?? null;
    return { data: groupRow(g) };
  }],
  ['DELETE', /^\/groups\/([^/]+)$/, ({ params, body }) => {
    const g = findGroup(params[0]!);
    if (body.confirmName !== g.name) throw new HttpError(400, 'The name you typed does not match the group name.');
    groups.splice(groups.indexOf(g), 1);
    return { data: { deleted: true } };
  }],

  ['GET', /^\/users$/, ({ q }) => {
    const search = q.get('q')?.toLowerCase().replace(/^@/, '');
    const sort = q.get('sort') ?? 'lastSeen';
    const windowDays = { today: 1, '7d': 7, '30d': 30 }[q.get('activeIn') ?? ''] ?? 0;
    const since = windowDays ? dayStr(windowDays - 1) : null;
    let rows = people
      .map((_, i) => userRow(i))
      .filter((r) => !since || (r.lastSeenAt != null && r.lastSeenAt.slice(0, 10) >= since))
      .filter((r) => !q.get('hasTokens') || r.activeTokens > 0)
      .filter((r) => !search || r.person.name.toLowerCase().includes(search) || r.person.username?.toLowerCase().includes(search));
    const by: Record<string, (a: AdminUserRow, b: AdminUserRow) => number> = {
      lastSeen: (a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''),
      aiCost: (a, b) => b.aiCostUsd30d - a.aiCostUsd30d,
      aiCalls: (a, b) => b.aiCalls30d - a.aiCalls30d,
      events: (a, b) => b.events30d - a.events30d,
      tokens: (a, b) => b.activeTokens - a.activeTokens,
    };
    rows = rows.sort(by[sort] ?? by.lastSeen);
    return paginate(rows, q);
  }],
  ['GET', /^\/users\/([^/]+)$/, ({ params, q }) => {
    const i = personIndex(params[0]!);
    const p = people[i]!;
    const range = rangeOf(q);
    const calls = aiCalls.filter((c) => c.person?.id === p.id && inRange(c.at, range));
    const row = userRow(i);
    const detail: AdminUserDetail = {
      ...row,
      groupList: groups
        .filter((g) => g.seed.members.includes(i))
        .map((g) => ({ group: ref(g), joinedAt: iso((g.seed.addedDaysAgo - 1) * DAY), events: 10 + noise(p.id + g.id, 300), aiCostUsd: calls.filter((c) => c.group?.id === g.id).reduce((s, c) => s + c.costUsd, 0) })),
      daily: days(range).map((day) => {
        const dc = calls.filter((c) => c.at.startsWith(day));
        return { day, events: day >= trackingSince ? noise(p.id + day, 30) : 0, aiCalls: dc.length, aiCostUsd: dc.reduce((s, c) => s + c.costUsd, 0) };
      }),
      aiByFeature: featureRows(calls),
      tokens: Array.from({ length: row.activeTokens }, (_, k) => {
        const g = groups.find((x) => x.seed.members.includes(i));
        return {
          id: `${p.id}-t${k}`,
          name: k === 0 ? 'Claude Desktop' : 'Cursor (work laptop)',
          prefix: `tbot_${p.id.slice(-4)}${k}`,
          group: k === 0 && g ? ref(g) : null,
          lastUsedAt: iso((k + 1) * 5 * 3_600_000),
          createdAt: iso((20 + k * 7) * DAY),
          expiresAt: k === 0 ? null : iso(-60 * DAY),
        };
      }),
    };
    return { data: detail };
  }],
  ['PATCH', /^\/users\/([^/]+)\/ai$/, ({ params, body }) => {
    const p = people[personIndex(params[0]!)]!;
    const o = userOverrides.get(p.id) ?? {};
    if (typeof body.disabled === 'boolean') o.aiDisabled = body.disabled;
    if ('dailyLimit' in body) o.aiDailyLimit = (body.dailyLimit as number | null) ?? null;
    userOverrides.set(p.id, o);
    return { data: { ok: true } };
  }],
  ['POST', /^\/users\/([^/]+)\/revoke-tokens$/, ({ params }) => {
    const i = personIndex(params[0]!);
    const revoked = userRow(i).activeTokens;
    userOverrides.set(people[i]!.id, { ...userOverrides.get(people[i]!.id), activeTokens: 0 });
    return { data: { revoked } };
  }],

  ['GET', /^\/ai\/usage$/, ({ q }) => {
    const range = rangeOf(q);
    const groupBy = (q.get('groupBy') ?? 'day') as AdminAiUsage['groupBy'];
    const calls = aiCalls.filter(
      (c) => inRange(c.at, range) && (!q.get('groupId') || c.group?.id === q.get('groupId')) && (!q.get('userId') || c.person?.id === q.get('userId')),
    );
    const keyOf: Record<AdminAiUsage['groupBy'], (c: AdminAiCallRow) => [string, string]> = {
      day: (c) => [c.at.slice(0, 10), c.at.slice(0, 10)],
      feature: (c) => [c.feature, AI_FEATURE_LABELS[c.feature]],
      model: (c) => [c.model, c.model],
      group: (c) => [c.group?.id ?? 'none', liveRef(c.group)?.name ?? 'No group'],
      user: (c) => [c.person?.id ?? 'none', c.person?.name ?? 'Unknown'],
    };
    let rows = breakdown(calls, keyOf[groupBy]);
    if (groupBy === 'day') {
      const map = new Map(rows.map((r) => [r.key, r]));
      rows = days(range).map((d) => map.get(d) ?? { key: d, label: d, calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0 });
    } else rows.sort((a, b) => b.costUsd - a.costUsd);
    return { data: { range, groupBy, totals: totals(calls), rows } };
  }],
  ['GET', /^\/ai\/calls$/, ({ q }) => {
    const range = q.get('range') as AdminRange | null;
    const rows = aiCalls.filter(
      (c) =>
        (!range || inRange(c.at, range)) &&
        (!q.get('status') || c.status === q.get('status')) &&
        (!q.get('feature') || c.feature === q.get('feature')) &&
        (!q.get('groupId') || c.group?.id === q.get('groupId')) &&
        (!q.get('userId') || c.person?.id === q.get('userId')),
    );
    const page = paginate(rows, q);
    return { ...page, data: page.data.map((c) => ({ ...c, group: liveRef(c.group) })) };
  }],

  ['GET', /^\/mcp$/, ({ q }) => {
    const range = rangeOf(q);
    const tool = q.get('tool');
    const client = q.get('client');
    // Share of all MCP calls that match the filter (tools × clients are independent in the fixtures).
    const toolShare = tool ? (MCP_TOOL_SHARES.find(([t]) => t === tool)?.[1] ?? 0) : 1;
    const clientShare = client ? (MCP_CLIENT_SHARES.find(([c]) => c === client)?.[1] ?? 0) : 1;
    const share = toolShare * clientShare;
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
    const tokens = mcpTokens();
    const overview: AdminMcpOverview = {
      activeTokens: tokens.length,
      tokenOwners: new Set(tokens.map((t) => t.person?.id)).size,
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
      rateLimitedBy: rateLimited
        ? [
            { person: personRef(people[6]!), count: Math.round(rateLimited * 0.8) },
            { person: personRef(people[0]!), count: Math.round(rateLimited * 0.1) },
            { person: personRef(people[2]!), count: rateLimited - Math.round(rateLimited * 0.8) - Math.round(rateLimited * 0.1) },
          ].filter((r) => r.count > 0)
        : [],
      tokens,
      filter: { tool, client },
    };
    return { data: overview };
  }],

  ['GET', /^\/system$/, () => ({ data: systemStatus() })],

  ['GET', /^\/audit-log$/, ({ q }) => {
    const rows = auditLog
      .filter((e) => (!q.get('targetType') || e.targetType === q.get('targetType')) && (!q.get('targetId') || e.targetId === q.get('targetId')))
      .map((e) => (e.targetType === 'group' && e.targetId && !groups.some((g) => g.id === e.targetId) ? { ...e, targetMissing: true } : e));
    return paginate(rows, q);
  }],

  ['GET', /^\/settings\/ai$/, () => ({ data: settings })],
  ['PUT', /^\/settings\/ai$/, ({ body }) => {
    Object.assign(settings, body, { defaults: settings.defaults });
    return { data: settings };
  }],
];

void AiFeature;

export const mockAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const method = (config.method ?? 'get').toUpperCase();
  const url = new URL(config.url ?? '/', 'http://mock');
  const q = new URLSearchParams(url.search);
  for (const [k, v] of Object.entries((config.params ?? {}) as Record<string, unknown>)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const body = typeof config.data === 'string' && config.data ? (JSON.parse(config.data) as Record<string, unknown>) : ((config.data as Record<string, unknown>) ?? {});
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 250));

  const respond = (status: number, data: unknown): AxiosResponse => ({ data, status, statusText: String(status), headers: {}, config });

  try {
    for (const [m, re, handler] of routes) {
      const match = m === method ? re.exec(url.pathname) : null;
      if (match) return respond(200, handler({ q, body, params: match.slice(1) }));
    }
    throw new HttpError(404, `Mock: no fixture for ${method} ${url.pathname}`);
  } catch (e) {
    if (!(e instanceof HttpError) && !(e instanceof MockHttpError)) throw e;
    const response = respond(e.status, { error: ERROR_NAMES[e.status] ?? 'Error', message: e.message, statusCode: e.status });
    throw new AxiosError(e.message, String(e.status), config, null, response);
  }
};

export { now };
