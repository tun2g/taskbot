import { GroupStatus } from '@tbot/shared';
import { Types } from 'mongoose';
import { Group, IGroup } from './models/group.model.js';

/** Owner decisions and which states they apply to. LEFT / MIGRATED are set by the bot from Telegram events. */
export const GROUP_TRANSITIONS = {
  // Not from REJECTED: the bot already left that chat; re-adding the bot makes it PENDING again.
  approve: { from: [GroupStatus.PENDING], to: GroupStatus.ACTIVE },
  reject: { from: [GroupStatus.PENDING], to: GroupStatus.REJECTED },
  suspend: { from: [GroupStatus.ACTIVE, GroupStatus.PENDING], to: GroupStatus.SUSPENDED },
  unsuspend: { from: [GroupStatus.SUSPENDED], to: GroupStatus.ACTIVE },
} as const;

export type GroupDecision = keyof typeof GROUP_TRANSITIONS;

export type GroupDecisionResult =
  | { ok: true; group: IGroup; from: GroupStatus }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'wrong_state'; current: GroupStatus };

/**
 * Applies an owner decision atomically (only from an allowed state, so a double click or a DM button racing
 * the admin app can't apply twice). Messaging the group / leaving the chat is the caller's job.
 */
export async function decideGroup(
  groupId: Types.ObjectId | string,
  decision: GroupDecision,
  reason?: string | null,
): Promise<GroupDecisionResult> {
  const { from, to } = GROUP_TRANSITIONS[decision];
  const now = new Date();
  const set: Record<string, unknown> = { status: to, statusChangedAt: now, statusReason: reason?.trim() || null };
  if (decision === 'approve') set.approvedAt = now;
  const before = await Group.findOneAndUpdate(
    { _id: new Types.ObjectId(String(groupId)), status: { $in: from } },
    { $set: set },
    { new: false },
  );
  if (!before) {
    const current = await Group.findById(groupId);
    return current ? { ok: false, reason: 'wrong_state', current: current.status } : { ok: false, reason: 'not_found' };
  }
  const group = (await Group.findById(before._id))!;
  return { ok: true, group, from: before.status };
}
