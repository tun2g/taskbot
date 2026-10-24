import type { AdminGroupMemberRow, AdminGroupMemberSort, AdminRange } from '@tbot/shared';
import { Types } from 'mongoose';
import { findGroup } from 'src/modules/groups/groups.service';
import {
  activeTokensByUser,
  eventsByUser,
  findMemberDocs,
  findMemberUsers,
  findUserIdsMatching,
  lastHereByUser,
  MemberDoc,
  tasksCreatedByUser,
} from 'src/modules/groups/repositories/members.repository';
import { iso } from 'src/shared/format';
import type { Pagination } from 'src/shared/http';
import { searchRegex } from 'src/shared/http';
import { personRef } from 'src/shared/refs';
import { roundUsd } from 'src/stats/aggregate';
import { AiTotals, aiTotalsBy } from 'src/stats/queries';
import { rangeWindows } from 'src/stats/range';

/** Everyone linked to the group (no cap), narrowed by name / @username / Telegram id when `q` is set. */
export async function findMembers(groupId: Types.ObjectId, rawQ: unknown): Promise<MemberDoc[]> {
  const docs = await findMemberDocs(groupId);
  const q = typeof rawQ === 'string' ? rawQ.trim().replace(/^@/, '') : '';
  const re = searchRegex(q);
  if (!re) return docs;
  const hits = await findUserIdsMatching(
    docs.map((m) => m.userId),
    re,
  );
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
export async function memberMetrics(
  groupId: Types.ObjectId,
  userIds: Types.ObjectId[],
  window: { start: Date; end: Date },
): Promise<MemberMetrics> {
  const inRange = { $gte: window.start, $lt: window.end };
  const now = new Date();
  const [events, ai, created, lastHere, tokens] = await Promise.all([
    eventsByUser(groupId, inRange),
    aiTotalsBy({ groupId, createdAt: inRange }, 'userId'),
    tasksCreatedByUser(groupId, inRange),
    lastHereByUser(groupId),
    activeTokensByUser(groupId, userIds, now),
  ]);
  return { events, ai, created, lastHere, tokens };
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
  return [...docs].sort(
    (a, b) => by(b) - by(a) || metric.events(b) - metric.events(a) || a.telegramUserId - b.telegramUserId,
  );
}

/** Rows for one page of people (loads only those people's names). */
export async function memberRows(page: MemberDoc[], m: MemberMetrics): Promise<AdminGroupMemberRow[]> {
  const users = page.length ? await findMemberUsers(page.map((d) => d.userId)) : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));
  return page.map((d) => {
    const uid = String(d.userId);
    const u = userById.get(uid);
    const ai = m.ai.get(uid);
    return {
      person: u
        ? personRef(u)
        : { id: uid, telegramUserId: d.telegramUserId, name: `User ${d.telegramUserId}`, username: null },
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

/** People in the group who used the bot: sorted on the whole group, then one page of rows. */
export async function listMembers(
  id: Types.ObjectId,
  q: unknown,
  sort: AdminGroupMemberSort,
  range: AdminRange,
  p: Pagination,
): Promise<{ rows: AdminGroupMemberRow[]; total: number }> {
  await findGroup(id);
  const { current: window } = rangeWindows(range);
  const docs = await findMembers(id, q);
  const metrics = await memberMetrics(
    id,
    docs.map((d) => d.userId),
    window,
  );
  const page = sortMembers(docs, metrics, sort).slice(p.skip, p.skip + p.limit);
  return { rows: await memberRows(page, metrics), total: docs.length };
}
