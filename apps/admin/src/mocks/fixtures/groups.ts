/** The groups in the fixtures: one of every status, plus the odd cases the UI has to explain. */
import type { AdminGroupRow } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';

import { DAY, iso } from './clock';
import { people, personRef } from './people';
import { int, oid } from './random';

export interface GroupSeed {
  name: string;
  status: GroupStatus;
  isForum?: boolean;
  memberCount: number | null;
  /** Indexes into `people`. */
  members: number[];
  tasks: number;
  openTasks: number;
  addedDaysAgo: number;
  lastActivityHoursAgo: number | null;
  reason?: string;
  statusChangedDaysAgo?: number;
  aiDisabled?: boolean;
  aiDailyLimit?: number | null;
  /** Relative AI usage weight. */
  aiWeight: number;
  /** Uses a model with no price → unpriced calls. */
  unpricedModel?: boolean;
  /** Only uses a model with no price → AI calls but a $0 cost ("$0 · N calls unpriced"). */
  allUnpriced?: boolean;
  publicLink?: string;
  /** Bot removed only: what a re-add restores (default active). */
  statusBeforeLeft?: GroupStatus;
}

const GROUP_SEEDS: GroupSeed[] = [
  { name: 'Acme Mobile Team', status: GroupStatus.ACTIVE, isForum: true, memberCount: 42, members: [0, 1, 2, 3, 4, 5, 6], tasks: 128, openTasks: 37, addedDaysAgo: 160, lastActivityHoursAgo: 0.2, aiWeight: 10 },
  { name: 'Saigon Devs', status: GroupStatus.ACTIVE, memberCount: 18, members: [1, 7, 8, 9], tasks: 86, openTasks: 21, addedDaysAgo: 120, lastActivityHoursAgo: 1.5, aiWeight: 5, publicLink: 'https://t.me/saigondevs' },
  { name: 'Night Shift Ops', status: GroupStatus.ACTIVE, memberCount: 9, members: [3, 10, 11], tasks: 54, openTasks: 12, addedDaysAgo: 75, lastActivityHoursAgo: 3, aiWeight: 4, unpricedModel: true },
  { name: 'Design Guild', status: GroupStatus.ACTIVE, isForum: true, memberCount: 23, members: [2, 5, 12, 13], tasks: 61, openTasks: 18, addedDaysAgo: 90, lastActivityHoursAgo: 6, aiWeight: 2 },
  { name: 'Research Lab', status: GroupStatus.ACTIVE, memberCount: 7, members: [8, 13], tasks: 33, openTasks: 9, addedDaysAgo: 40, lastActivityHoursAgo: 26, aiWeight: 3, aiDailyLimit: 50 },
  { name: 'Indie Game Jam', status: GroupStatus.ACTIVE, memberCount: 31, members: [4, 6, 10], tasks: 19, openTasks: 11, addedDaysAgo: 30, lastActivityHoursAgo: 50, aiWeight: 0.5, aiDisabled: true, statusChangedDaysAgo: 30 },
  { name: 'Hanoi Marketing', status: GroupStatus.PENDING, memberCount: 14, members: [11], tasks: 0, openTasks: 0, addedDaysAgo: 0.08, lastActivityHoursAgo: 2, aiWeight: 0 },
  { name: 'Book Club Planning', status: GroupStatus.PENDING, memberCount: 6, members: [12], tasks: 0, openTasks: 0, addedDaysAgo: 1.2, lastActivityHoursAgo: 28, aiWeight: 0 },
  { name: 'Freelance Crew', status: GroupStatus.PENDING, isForum: true, memberCount: 57, members: [9], tasks: 0, openTasks: 0, addedDaysAgo: 3.4, lastActivityHoursAgo: 80, aiWeight: 0 },
  { name: 'Old Startup HQ', status: GroupStatus.SUSPENDED, memberCount: 12, members: [0, 7], tasks: 212, openTasks: 64, addedDaysAgo: 300, lastActivityHoursAgo: 24 * 9, reason: 'Paused until the team confirms they still need it.', statusChangedDaysAgo: 9, aiWeight: 0.3 },
  { name: 'Crypto Signals 💰', status: GroupStatus.REJECTED, memberCount: 1840, members: [], tasks: 0, openTasks: 0, addedDaysAgo: 20, lastActivityHoursAgo: 24 * 20, reason: 'Not a work group.', statusChangedDaysAgo: 20, aiWeight: 0 },
  { name: 'Family Chores', status: GroupStatus.LEFT, memberCount: null, members: [5], tasks: 14, openTasks: 3, addedDaysAgo: 140, lastActivityHoursAgo: 24 * 33, statusChangedDaysAgo: 33, aiWeight: 0 },
  { name: 'Design Guild (old chat)', status: GroupStatus.MIGRATED, memberCount: null, members: [2], tasks: 0, openTasks: 0, addedDaysAgo: 200, lastActivityHoursAgo: 24 * 92, statusChangedDaysAgo: 92, aiWeight: 0 },
  { name: 'Translation Desk', status: GroupStatus.ACTIVE, memberCount: 11, members: [6, 12], tasks: 24, openTasks: 7, addedDaysAgo: 25, lastActivityHoursAgo: 4, aiWeight: 1.5, allUnpriced: true },
];

export type MockGroup = AdminGroupRow & {
  seed: GroupSeed;
  timezone: string;
  approvedAt: string | null;
  botLeftAt: string | null;
  migratedToChatId: number | null;
  publicLink: string | null;
  epics: number;
  activities: number;
  activeTokens: number;
};

function toGroup(g: GroupSeed, i: number): MockGroup {
  const addedBy = g.members.length ? personRef(people[g.members[0]!]!) : personRef(people[13]!);
  return {
    id: oid(500 + i),
    name: g.name,
    status: g.status,
    telegramGroupId: -1001_000_000_000 - i * 104_729,
    isForum: !!g.isForum,
    memberCount: g.memberCount,
    knownMembers: g.members.length,
    tasks: g.tasks,
    openTasks: g.openTasks,
    lastActivityAt: g.lastActivityHoursAgo == null ? null : iso(g.lastActivityHoursAgo * 3_600_000),
    // Filled in from the AI calls (ai-calls.ts).
    aiCostUsd30d: 0,
    aiCalls30d: 0,
    addedBy,
    addedAt: iso(g.addedDaysAgo * DAY),
    statusReason: g.reason ?? null,
    statusChangedAt: g.statusChangedDaysAgo != null ? iso(g.statusChangedDaysAgo * DAY) : null,
    aiDisabled: !!g.aiDisabled,
    aiDailyLimit: g.aiDailyLimit ?? null,
    createdAt: iso(g.addedDaysAgo * DAY),
    seed: g,
    timezone: i % 3 === 0 ? 'Asia/Ho_Chi_Minh' : i % 3 === 1 ? 'Europe/Berlin' : 'UTC',
    approvedAt: g.status === GroupStatus.PENDING || g.status === GroupStatus.REJECTED ? null : iso((g.addedDaysAgo - 0.1) * DAY),
    botLeftAt: g.status === GroupStatus.LEFT ? iso((g.statusChangedDaysAgo ?? 1) * DAY) : null,
    migratedToChatId: g.status === GroupStatus.MIGRATED ? -1001_000_000_000 - 3 * 104_729 : null,
    publicLink: g.publicLink ?? null,
    epics: Math.round(g.tasks / 20),
    activities: g.tasks * 6,
    activeTokens: g.status === GroupStatus.ACTIVE ? Math.min(g.members.length, int(0, 3)) : 0,
  };
}

export const groups: MockGroup[] = GROUP_SEEDS.map(toGroup);
