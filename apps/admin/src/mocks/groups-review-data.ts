/** Deterministic people / tasks / epics for one mock group (see groups-review.ts for the routes). */
import type {
  AdminGroupEpicRow,
  AdminGroupMemberRow,
  AdminGroupMemberSort,
  AdminGroupTaskFilter,
  AdminGroupTaskRow,
  AdminRange,
  AdminTaskVia,
} from '@tbot/shared';
import { GroupStatus, TaskStatus } from '@tbot/shared';

import { aiCalls, iso, type MockGroup, now, people, personRef } from './fixtures';

const DAY = 86_400_000;
const RANGE_DAYS: Record<AdminRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const noise = (key: string, max: number) => hash(key) % (max + 1);

export const since = (range: AdminRange) => now - RANGE_DAYS[range] * DAY;

// ── people ──────────────────────────────────────────────────────────────────

export function memberRows(g: MockGroup, range: AdminRange): AdminGroupMemberRow[] {
  const calls = aiCalls.filter((c) => c.group?.id === g.id && Date.parse(c.at) >= since(range) && c.status !== 'quota' && c.status !== 'disabled');
  return g.seed.members.map((i) => {
    const p = people[i]!;
    const mine = calls.filter((c) => c.person?.id === p.id);
    const here = g.lastActivityAt ? new Date(Date.parse(g.lastActivityAt) - noise(p.id + g.id, 48) * 3_600_000).toISOString() : null;
    return {
      person: personRef(p),
      joinedAt: iso((g.seed.addedDaysAgo - noise(p.id, 10) / 10) * DAY),
      lastSeenAt: here ? new Date(Math.min(now, Date.parse(here) + noise(p.id, 20) * 3_600_000)).toISOString() : null,
      lastActiveHereAt: here,
      activeTokens: noise(p.id + g.id, 2),
      events: g.status === GroupStatus.ACTIVE ? 20 + noise(p.id + g.id, 400) : 0,
      aiCalls: mine.length,
      aiCostUsd: mine.reduce((s, c) => s + c.costUsd, 0),
      tasksCreated: Math.round(g.tasks / Math.max(1, g.seed.members.length)) + noise(p.id, 5),
    };
  });
}

export const MEMBER_METRIC: Record<AdminGroupMemberSort, (m: AdminGroupMemberRow) => number> = {
  lastActive: (m) => (m.lastActiveHereAt ? Date.parse(m.lastActiveHereAt) : 0),
  events: (m) => m.events,
  aiCalls: (m) => m.aiCalls,
  aiCost: (m) => m.aiCostUsd,
  tasks: (m) => m.tasksCreated,
  tokens: (m) => m.activeTokens ?? 0,
  joined: (m) => (m.joinedAt ? Date.parse(m.joinedAt) : 0),
};

// ── tasks & epics ───────────────────────────────────────────────────────────

const TITLES = [
  'Fix login on Android 14', 'Write onboarding checklist', 'Prepare sprint review', 'Update pricing page copy',
  'Migrate push notifications', 'Review design for settings', 'Invoice March clients', 'Plan team offsite',
  'Investigate slow board load', 'Add export to CSV', 'Clean up old feature flags', 'Draft Q4 roadmap',
];
const STATUSES: TaskStatus[] = [TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.BACKLOG, TaskStatus.PENDING];
const VIAS: AdminTaskVia[] = ['bot', 'bot', 'app', 'ai', 'mcp'];
const EPIC_TITLES = ['Onboarding', 'Q4 launch', 'Billing', 'Mobile app', 'Design system', 'Hiring', 'Ops cleanup', 'Docs', 'Growth', 'Infra', 'Support'];

export function epicsOf(g: MockGroup): AdminGroupEpicRow[] {
  return Array.from({ length: g.epics }, (_, i) => ({
    id: `${g.id}-e${i}`,
    title: EPIC_TITLES[i % EPIC_TITLES.length]!,
    status: i % 4 === 3 ? 'done' : 'open',
    tasks: 0,
    openTasks: 0,
    createdAt: iso((g.seed.addedDaysAgo - i * 3) * DAY),
  }));
}

export function tasksOf(g: MockGroup): AdminGroupTaskRow[] {
  const epics = epicsOf(g);
  const members = g.seed.members;
  return Array.from({ length: g.tasks }, (_, i) => {
    const n = g.tasks - i;
    const open = i < g.openTasks;
    const ageDays = (i / Math.max(1, g.tasks)) * g.seed.addedDaysAgo + noise(`${g.id}${n}a`, 2);
    const due = noise(`${g.id}${n}d`, 3) === 0 ? null : iso((ageDays - 7 - noise(`${g.id}${n}x`, 14)) * DAY);
    const epic = epics.length && noise(`${g.id}${n}e`, 2) === 0 ? epics[n % epics.length]! : null;
    const who = members.length && noise(`${g.id}${n}w`, 4) > 0 ? people[members[n % members.length]!]! : null;
    return {
      id: `${g.id}-t${n}`,
      number: n,
      title: TITLES[n % TITLES.length]!,
      status: open ? STATUSES[n % STATUSES.length]! : n % 9 === 0 ? TaskStatus.CANCELLED : TaskStatus.DONE,
      parentNumber: n > 5 && n % 7 === 0 ? n - 3 : null,
      epic: epic ? { id: epic.id, title: epic.title } : null,
      assignee: who ? personRef(who) : null,
      dueDate: due,
      overdue: open && !!due && Date.parse(due) < now,
      createdAt: iso(ageDays * DAY),
      completedAt: open ? null : iso(Math.max(0, ageDays - 2) * DAY),
      createdVia: n % 11 === 0 ? null : VIAS[n % VIAS.length]!,
    };
  });
}

export const TASK_FILTERS: AdminGroupTaskFilter[] = ['open', 'overdue', 'done', 'all'];
export const matches = (t: AdminGroupTaskRow, f: AdminGroupTaskFilter) =>
  f === 'all' ? true : f === 'done' ? t.completedAt != null : f === 'overdue' ? t.overdue : t.completedAt == null;
