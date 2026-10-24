import { ApiToken, GroupMember, Task, User, UsageEvent } from '@tbot/db';
import type { AdminGroupMemberRow, AdminGroupMemberSort } from '@tbot/shared';
import { Types } from 'mongoose';
import { iso } from 'src/routes/group-rows';
import { searchRegex } from 'src/shared/http';
import { LeanUser, personRef, USER_REF_FIELDS } from 'src/shared/refs';
import { roundUsd } from 'src/stats/aggregate';
import { AiTotals, aiTotalsBy } from 'src/stats/queries';

export const MEMBER_SORTS: readonly AdminGroupMemberSort[] = ['lastActive', 'events', 'aiCalls', 'aiCost', 'tasks', 'tokens', 'joined'];

export interface MemberDoc {
  userId: Types.ObjectId;
  telegramUserId: number;
  joinedAt?: Date;
}

/** Everyone linked to the group (no cap), narrowed by name / @username / Telegram id when `q` is set. */
export async function findMembers(groupId: Types.ObjectId, rawQ: unknown): Promise<MemberDoc[]> {
  const docs = await GroupMember.find({ groupId }).select('userId telegramUserId joinedAt').lean<MemberDoc[]>();
  const q = typeof rawQ === 'string' ? rawQ.trim().replace(/^@/, '') : '';
  const re = searchRegex(q);
  if (!re) return docs;
  const hits = await User.find({ _id: { $in: docs.map((m) => m.userId) }, $or: [{ firstName: re }, { lastName: re }, { username: re }] })
    .select('_id')
    .lean<{ _id: Types.ObjectId }[]>();
  const ids = new Set(hits.map((u) => String(u._id)));
  return docs.filter((m) => ids.has(String(m.userId)) || String(m.telegramUserId) === q);
}

export interface MemberMetrics {
  events: Map<string, number>;
  ai: Map<string, AiTotals>;
  created: Map<string, number>;
  lastHere: Map<string, Date>;
  tokens: Map<string, number>;
}

/** Per-person numbers for the whole group, so any column can be sorted before paging. */
export async function memberMetrics(groupId: Types.ObjectId, userIds: Types.ObjectId[], window: { start: Date; end: Date }): Promise<MemberMetrics> {
  const inRange = { $gte: window.start, $lt: window.end };
  const now = new Date();
  const [eventsByUser, ai, tasksByUser, lastHereByUser, tokenRows] = await Promise.all([
    UsageEvent.aggregate([{ $match: { groupId, createdAt: inRange, userId: { $ne: null } } }, { $group: { _id: '$userId', n: { $sum: 1 } } }]),
    aiTotalsBy({ groupId, createdAt: inRange }, 'userId'),
    Task.aggregate([{ $match: { groupId, createdAt: inRange } }, { $group: { _id: '$createdBy', n: { $sum: 1 } } }]),
    // Last time each person used the bot in this group (usage events are kept 90 days).
    UsageEvent.aggregate([{ $match: { groupId, userId: { $ne: null } } }, { $group: { _id: '$userId', at: { $max: '$createdAt' } } }]),
    // Tokens that reach this group: scoped to it, or to all of the person's groups.
    userIds.length
      ? ApiToken.aggregate([
          {
            $match: {
              userId: { $in: userIds },
              revokedAt: null,
              $and: [{ $or: [{ groupId }, { groupId: null }] }, { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }],
            },
          },
          { $group: { _id: '$userId', n: { $sum: 1 } } },
        ])
      : Promise.resolve([]),
  ]);
  return {
    events: new Map(eventsByUser.map((e) => [String(e._id), e.n as number])),
    ai,
    created: new Map(tasksByUser.map((t) => [String(t._id), t.n as number])),
    lastHere: new Map(lastHereByUser.map((e) => [String(e._id), e.at as Date])),
    tokens: new Map(tokenRows.map((t) => [String(t._id), t.n as number])),
  };
}

const time = (d: Date | null | undefined) => (d ? new Date(d).getTime() : 0);

/** Sorts by the column (highest / newest first), then by activity, then by Telegram id (stable). */
export function sortMembers(docs: MemberDoc[], m: MemberMetrics, sort: AdminGroupMemberSort): MemberDoc[] {
  const metric: Record<AdminGroupMemberSort, (d: MemberDoc) => number> = {
    lastActive: (d) => time(m.lastHere.get(String(d.userId))),
    events: (d) => m.events.get(String(d.userId)) ?? 0,
    aiCalls: (d) => m.ai.get(String(d.userId))?.calls ?? 0,
    aiCost: (d) => m.ai.get(String(d.userId))?.costUsd ?? 0,
    tasks: (d) => m.created.get(String(d.userId)) ?? 0,
    tokens: (d) => m.tokens.get(String(d.userId)) ?? 0,
    joined: (d) => time(d.joinedAt),
  };
  const by = metric[sort];
  return [...docs].sort((a, b) => by(b) - by(a) || metric.events(b) - metric.events(a) || a.telegramUserId - b.telegramUserId);
}

/** Rows for one page of people (loads only those people's names). */
export async function memberRows(page: MemberDoc[], m: MemberMetrics): Promise<AdminGroupMemberRow[]> {
  const users = page.length
    ? await User.find({ _id: { $in: page.map((d) => d.userId) } })
        .select(`${USER_REF_FIELDS} lastSeenAt`)
        .lean<(LeanUser & { lastSeenAt?: Date | null })[]>()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));
  return page.map((d) => {
    const uid = String(d.userId);
    const u = userById.get(uid);
    const ai = m.ai.get(uid);
    return {
      person: u ? personRef(u) : { id: uid, telegramUserId: d.telegramUserId, name: `User ${d.telegramUserId}`, username: null },
      joinedAt: iso(d.joinedAt),
      lastSeenAt: iso(u?.lastSeenAt),
      lastActiveHereAt: iso(m.lastHere.get(uid)),
      activeTokens: m.tokens.get(uid) ?? 0,
      events: m.events.get(uid) ?? 0,
      aiCalls: ai?.calls ?? 0,
      aiCostUsd: roundUsd(ai?.costUsd ?? 0),
      tasksCreated: m.created.get(uid) ?? 0,
    };
  });
}
