/**
 * Mock routes for the group detail lists (people, tasks, epics) and "Reconsider" — same contracts as
 * apps/admin-api/src/routes/groups.routes.ts. Deterministic, built from the fixtures.
 */
import type { AdminGroupMemberSort, AdminGroupRef, AdminGroupTaskCounts, AdminGroupTaskFilter, AdminRange } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { aiCalls, auditLog, groups, type MockGroup } from './fixtures';
import { epicsOf, matches, MEMBER_METRIC, memberRows, since, TASK_FILTERS, tasksOf } from './groups-review-data';

export class MockHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function findGroup(id: string): MockGroup {
  const g = groups.find((x) => x.id === id);
  if (!g) throw new MockHttpError(404, 'This group no longer exists.');
  return g;
}

function paginate<T>(rows: T[], q: URLSearchParams) {
  const page = Math.max(1, Number(q.get('page')) || 1);
  const limit = Math.max(1, Number(q.get('limit')) || 25);
  return { data: rows.slice((page - 1) * limit, page * limit), meta: { page, limit, total: rows.length, hasMore: page * limit < rows.length } };
}

// ── extra row fields ────────────────────────────────────────────────────────

/** Fields the real API adds to every group row: unpriced AI calls (30 days) and where a moved group went. */
export function groupRowExtras(g: MockGroup): { aiCalls30d: number; aiUnpriced30d: number; migratedTo?: AdminGroupRef | null } {
  const mine = aiCalls.filter((c) => c.group?.id === g.id && c.status !== 'quota' && c.status !== 'disabled');
  const target = g.migratedToChatId != null ? groups.find((x) => x.telegramGroupId === g.migratedToChatId && x.id !== g.id) : undefined;
  return {
    aiCalls30d: mine.length,
    aiUnpriced30d: mine.filter((c) => !c.priced).length,
    ...(g.status === GroupStatus.MIGRATED ? { migratedTo: target ? { id: target.id, name: target.name, status: target.status } : null } : {}),
  };
}

/** Detail-only extras: AI refusals in the range and what a re-add restores. */
export function groupDetailExtras(g: MockGroup, range: AdminRange) {
  return {
    aiRefused: aiCalls.filter((c) => c.group?.id === g.id && Date.parse(c.at) >= since(range) && (c.status === 'quota' || c.status === 'disabled')).length,
    statusBeforeLeft: g.status === GroupStatus.LEFT ? (g.seed.statusBeforeLeft ?? GroupStatus.ACTIVE) : null,
  };
}

// ── routes ──────────────────────────────────────────────────────────────────

type Handler = (ctx: { q: URLSearchParams; body: Record<string, unknown>; params: string[] }) => unknown;

export const groupReviewRoutes: [string, RegExp, Handler][] = [
  ['GET', /^\/groups\/([^/]+)\/members$/, ({ params, q }) => {
    const g = findGroup(params[0]!);
    const search = q.get('q')?.toLowerCase().replace(/^@/, '');
    const by = MEMBER_METRIC[(q.get('sort') as AdminGroupMemberSort) ?? 'events'] ?? MEMBER_METRIC.events;
    const rows = memberRows(g, (q.get('range') as AdminRange) || '30d')
      .filter((m) => !search || m.person.name.toLowerCase().includes(search) || m.person.username?.toLowerCase().includes(search))
      .sort((a, b) => by(b) - by(a) || b.events - a.events);
    return paginate(rows, q);
  }],
  ['GET', /^\/groups\/([^/]+)\/tasks$/, ({ params, q }) => {
    const g = findGroup(params[0]!);
    const filter = (q.get('filter') as AdminGroupTaskFilter) || 'open';
    const createdIn = q.get('createdIn') as AdminRange | null;
    const search = q.get('q')?.toLowerCase().replace(/^#/, '');
    const base = tasksOf(g).filter(
      (t) => (!createdIn || Date.parse(t.createdAt) >= since(createdIn)) && (!search || t.title.toLowerCase().includes(search) || String(t.number) === search),
    );
    const counts = Object.fromEntries(TASK_FILTERS.map((f) => [f, base.filter((t) => matches(t, f)).length])) as AdminGroupTaskCounts;
    let rows = base.filter((t) => matches(t, filter));
    if (filter === 'overdue') rows = [...rows].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    return { ...paginate(rows, q), counts };
  }],
  ['GET', /^\/groups\/([^/]+)\/epics$/, ({ params, q }) => {
    const g = findGroup(params[0]!);
    const tasks = tasksOf(g);
    const rows = epicsOf(g)
      .map((e) => {
        const mine = tasks.filter((t) => t.epic?.id === e.id);
        return { ...e, tasks: mine.length, openTasks: mine.filter((t) => t.completedAt == null).length };
      })
      .sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1));
    return paginate(rows, q);
  }],
  ['POST', /^\/groups\/([^/]+)\/reconsider$/, ({ params }) => {
    const g = findGroup(params[0]!);
    if (g.status !== GroupStatus.REJECTED) throw new MockHttpError(409, 'Only rejected groups can be reconsidered.');
    g.status = GroupStatus.LEFT;
    g.seed.statusBeforeLeft = GroupStatus.PENDING;
    g.statusReason = null;
    g.statusChangedAt = new Date().toISOString();
    auditLog.unshift({
      id: `mock-${Date.now()}`,
      at: g.statusChangedAt,
      action: 'group.reconsider',
      summary: `Cleared the rejection of group “${g.name}”`,
      targetType: 'group',
      targetId: g.id,
      targetLabel: g.name,
      reason: null,
      details: null,
      changes: ['If the bot is added again, the group waits for your approval like a new one'],
    });
    return { data: { id: g.id, name: g.name, status: g.status, warnings: [] } };
  }],
];
