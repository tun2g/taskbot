import { AdminAuditLog, Group, GroupMember, Task, User } from '@tbot/db';
import type { AdminGroupPreviousDecision, AdminGroupRef } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import { Types } from 'mongoose';
import { CLOSED_STATUSES } from 'src/stats/queries';
import { groupRef, LeanGroupRef, LeanUser, statusOf, USER_REF_FIELDS } from 'src/shared/refs';

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
  ai?: { disabled?: boolean; dailyLimit?: number | null; reason?: string | null } | null;
  createdAt: Date;
}

export const GROUP_FIELDS =
  'telegramGroupId groupName timezone isForum eventsTopicId status statusReason statusChangedAt statusBeforeLeft addedBy addedAt approvedAt botLeftAt migratedToChatId lastActivityAt memberCount approvalMessage ai createdAt';

/** The group document (status not yet normalised), or null. */
export async function findGroupDoc(id: Types.ObjectId): Promise<LeanGroup | null> {
  return Group.findById(id).select(GROUP_FIELDS).lean<LeanGroup>();
}

export async function setGroupFields(id: Types.ObjectId, set: Record<string, unknown>): Promise<void> {
  await Group.updateOne({ _id: id }, { $set: set });
}

/** Users by Telegram id (only the fields a person ref needs). */
export async function findUsersByTelegramIds(tgIds: number[]): Promise<LeanUser[]> {
  return tgIds.length
    ? User.find({ telegramUserId: { $in: tgIds } })
        .select(USER_REF_FIELDS)
        .lean<LeanUser[]>()
    : [];
}

export async function countBy(
  model: typeof GroupMember | typeof Task,
  match: Record<string, unknown>,
): Promise<Map<string, number>> {
  const res = await (model as typeof Task).aggregate([
    { $match: match },
    { $group: { _id: '$groupId', n: { $sum: 1 } } },
  ]);
  return new Map(res.map((r) => [String(r._id), r.n as number]));
}

/** Known members per group. */
export function memberCountsBy(groupIds: Types.ObjectId[]): Promise<Map<string, number>> {
  return countBy(GroupMember, { groupId: { $in: groupIds } });
}

export async function taskCountsBy(
  match: Record<string, unknown>,
): Promise<Map<string, { tasks: number; open: number }>> {
  const res = await Task.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$groupId',
        tasks: { $sum: 1 },
        open: { $sum: { $cond: [{ $in: ['$status', CLOSED_STATUSES] }, 0, 1] } },
      },
    },
  ]);
  return new Map(res.map((r) => [String(r._id), { tasks: r.tasks as number, open: r.open as number }]));
}

const DECISION_ACTIONS: Record<string, AdminGroupPreviousDecision['action']> = {
  'group.reject': 'rejected',
  'group.suspend': 'suspended',
  'group.leave': 'removed',
  'group.reconsider': 'reconsidered',
};

/**
 * Moved-to-supergroup groups → the group that continues them (looked up by the new Telegram chat id). Null when the
 * new chat has no group (deleted, or the bot never saw it).
 */
export async function migratedTargets(groups: LeanGroup[]): Promise<Map<string, AdminGroupRef | null>> {
  const moved = groups.filter((g) => statusOf(g) === GroupStatus.MIGRATED);
  const out = new Map<string, AdminGroupRef | null>(moved.map((g) => [String(g._id), null]));
  const chatIds = moved.map((g) => g.migratedToChatId).filter((v): v is number => typeof v === 'number');
  if (!chatIds.length) return out;
  const targets = await Group.find({ telegramGroupId: { $in: chatIds } })
    .select('telegramGroupId groupName status')
    .lean<(LeanGroupRef & { telegramGroupId: number })[]>();
  const byChat = new Map(targets.map((t) => [t.telegramGroupId, t]));
  for (const g of moved) {
    const t = g.migratedToChatId != null ? byChat.get(g.migratedToChatId) : undefined;
    if (t && String(t._id) !== String(g._id)) out.set(String(g._id), groupRef(t));
  }
  return out;
}

/**
 * For groups waiting for approval: the owner's latest reject / suspend / remove decision recorded in the audit log
 * (the group's own statusReason is cleared when it asks again). Null = no earlier decision on record.
 */
export async function previousDecisions(groupIds: string[]): Promise<Map<string, AdminGroupPreviousDecision | null>> {
  const out = new Map<string, AdminGroupPreviousDecision | null>(groupIds.map((id) => [id, null]));
  if (!groupIds.length) return out;
  const rows = await AdminAuditLog.find({
    targetType: 'group',
    targetId: { $in: groupIds },
    action: { $in: Object.keys(DECISION_ACTIONS) },
  })
    .select('targetId action reason createdAt')
    .sort({ createdAt: -1 })
    .lean<{ targetId: string; action: string; reason?: string | null; createdAt: Date }[]>();
  for (const r of rows) {
    if (out.get(r.targetId)) continue;
    out.set(r.targetId, {
      action: DECISION_ACTIONS[r.action],
      at: new Date(r.createdAt).toISOString(),
      reason: r.reason ?? null,
    });
  }
  return out;
}
