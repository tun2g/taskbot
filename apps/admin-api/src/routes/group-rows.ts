import { AdminAuditLog, GroupMember, Task, User } from '@tbot/db';
import type { AdminGroupPreviousDecision, AdminGroupRow, AdminPersonRef } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import { Types } from 'mongoose';
import { roundUsd } from 'src/stats/aggregate';
import { aiTotalsBy, CLOSED_STATUSES } from 'src/stats/queries';
import { lastDays } from 'src/stats/range';
import { personRef, statusOf, USER_REF_FIELDS, LeanUser } from 'src/shared/refs';

/** The group fields the admin API reads (never task content). */
export interface LeanGroup {
  _id: Types.ObjectId;
  telegramGroupId: number;
  groupName: string;
  timezone?: string;
  isForum?: boolean;
  /** Forum topic the bot posts task events in (fallback for notices when General is closed). */
  eventsTopicId?: number | null;
  status: GroupStatus;
  statusReason?: string | null;
  statusChangedAt?: Date | null;
  statusBeforeLeft?: GroupStatus | null;
  addedBy?: { telegramUserId: number; name: string; username?: string | null } | null;
  addedAt?: Date | null;
  approvedAt?: Date | null;
  botLeftAt?: Date | null;
  migratedToChatId?: number | null;
  lastActivityAt?: Date | null;
  memberCount?: number | null;
  approvalMessage?: { chatId: number; messageId: number } | null;
  ai?: { disabled?: boolean; dailyLimit?: number | null } | null;
  createdAt: Date;
}

export const GROUP_FIELDS =
  'telegramGroupId groupName timezone isForum eventsTopicId status statusReason statusChangedAt statusBeforeLeft addedBy addedAt approvedAt botLeftAt migratedToChatId lastActivityAt memberCount approvalMessage ai createdAt';

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function countBy(model: typeof GroupMember | typeof Task, match: Record<string, unknown>): Promise<Map<string, number>> {
  const res = await (model as typeof Task).aggregate([{ $match: match }, { $group: { _id: '$groupId', n: { $sum: 1 } } }]);
  return new Map(res.map((r) => [String(r._id), r.n as number]));
}

export async function taskCountsBy(match: Record<string, unknown>): Promise<Map<string, { tasks: number; open: number }>> {
  const res = await Task.aggregate([
    { $match: match },
    { $group: { _id: '$groupId', tasks: { $sum: 1 }, open: { $sum: { $cond: [{ $in: ['$status', CLOSED_STATUSES] }, 0, 1] } } } },
  ]);
  return new Map(res.map((r) => [String(r._id), { tasks: r.tasks as number, open: r.open as number }]));
}

/** Who added the bot, as a person ref (linked to the users collection when they ever used the bot). */
function addedByRef(g: LeanGroup, usersByTg: Map<number, LeanUser>): AdminPersonRef | null {
  if (!g.addedBy) return null;
  const u = usersByTg.get(g.addedBy.telegramUserId);
  if (u) return personRef(u);
  return { id: null, telegramUserId: g.addedBy.telegramUserId, name: g.addedBy.name, username: g.addedBy.username || null };
}

const DECISION_ACTIONS: Record<string, AdminGroupPreviousDecision['action']> = {
  'group.reject': 'rejected',
  'group.suspend': 'suspended',
  'group.leave': 'removed',
};

/**
 * For groups waiting for approval: the owner's latest reject / suspend / remove decision recorded in the audit log
 * (the group's own statusReason is cleared when it asks again). Null = no earlier decision on record.
 */
export async function previousDecisions(groupIds: string[]): Promise<Map<string, AdminGroupPreviousDecision | null>> {
  const out = new Map<string, AdminGroupPreviousDecision | null>(groupIds.map((id) => [id, null]));
  if (!groupIds.length) return out;
  const rows = await AdminAuditLog.find({ targetType: 'group', targetId: { $in: groupIds }, action: { $in: Object.keys(DECISION_ACTIONS) } })
    .select('targetId action reason createdAt')
    .sort({ createdAt: -1 })
    .lean<{ targetId: string; action: string; reason?: string | null; createdAt: Date }[]>();
  for (const r of rows) {
    if (out.get(r.targetId)) continue;
    out.set(r.targetId, { action: DECISION_ACTIONS[r.action], at: new Date(r.createdAt).toISOString(), reason: r.reason ?? null });
  }
  return out;
}

/** Turns group docs into list rows (counts and 30-day AI numbers in a few batched queries). */
export async function groupRows(groups: LeanGroup[], now = new Date()): Promise<AdminGroupRow[]> {
  if (!groups.length) return [];
  const ids = groups.map((g) => g._id);
  const tgIds = groups.map((g) => g.addedBy?.telegramUserId).filter((v): v is number => typeof v === 'number');
  const pendingIds = groups.filter((g) => statusOf(g) === GroupStatus.PENDING).map((g) => String(g._id));
  const [members, tasks, ai, adders, decisions] = await Promise.all([
    countBy(GroupMember, { groupId: { $in: ids } }),
    taskCountsBy({ groupId: { $in: ids } }),
    aiTotalsBy({ groupId: { $in: ids }, createdAt: { $gte: lastDays(30, now).start } }, 'groupId'),
    tgIds.length ? User.find({ telegramUserId: { $in: tgIds } }).select(USER_REF_FIELDS).lean<LeanUser[]>() : Promise.resolve([] as LeanUser[]),
    previousDecisions(pendingIds),
  ]);
  const usersByTg = new Map(adders.map((u) => [u.telegramUserId, u]));
  return groups.map((g) => {
    const id = String(g._id);
    const t = tasks.get(id);
    const a = ai.get(id);
    return {
      id,
      name: g.groupName,
      status: statusOf(g),
      telegramGroupId: g.telegramGroupId,
      isForum: !!g.isForum,
      memberCount: g.memberCount ?? null,
      knownMembers: members.get(id) ?? 0,
      tasks: t?.tasks ?? 0,
      openTasks: t?.open ?? 0,
      lastActivityAt: iso(g.lastActivityAt),
      aiCostUsd30d: roundUsd(a?.costUsd ?? 0),
      aiCalls30d: a?.calls ?? 0,
      addedBy: addedByRef(g, usersByTg),
      addedAt: iso(g.addedAt),
      statusReason: g.statusReason ?? null,
      statusChangedAt: iso(g.statusChangedAt),
      aiDisabled: !!g.ai?.disabled,
      aiDailyLimit: g.ai?.dailyLimit ?? null,
      createdAt: iso(g.createdAt) ?? new Date(0).toISOString(),
      ...(decisions.has(id) ? { previousDecision: decisions.get(id) ?? null } : {}),
    };
  });
}

export { iso };

/** Lean group with a guaranteed status (see statusOf). */
export function normalizeGroup<T extends LeanGroup | null>(g: T): T {
  return (g ? { ...g, status: statusOf(g) } : g) as T;
}
