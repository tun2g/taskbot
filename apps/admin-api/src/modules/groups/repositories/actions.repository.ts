import { decideGroup, Group, GroupDecision, GroupDecisionResult } from '@tbot/db';
import { GroupStatus } from '@tbot/shared';
import { Types } from 'mongoose';

/** Atomic status change for an owner decision (only from an allowed state). */
export function decideGroupStatus(
  id: Types.ObjectId,
  decision: GroupDecision,
  reason: string | null,
): Promise<GroupDecisionResult> {
  return decideGroup(id, decision, reason);
}

/**
 * Marks the group LEFT. Unconditional on purpose: the bot's own "I was removed" handler may race us and write the
 * same values.
 */
export async function markGroupLeft(
  id: Types.ObjectId,
  statusBefore: GroupStatus,
  reason: string | null,
  now: Date,
): Promise<void> {
  await Group.updateOne(
    { _id: id },
    {
      $set: {
        status: GroupStatus.LEFT,
        statusBeforeLeft: statusBefore,
        botLeftAt: now,
        statusChangedAt: now,
        statusReason: reason,
      },
    },
  );
}

/**
 * Rejected → bot removed (undecided). Conditional on the status, so a re-add racing us (rejected → pending) is never
 * overwritten. Returns whether the group changed.
 */
export async function reconsiderRejected(id: Types.ObjectId, now: Date): Promise<boolean> {
  const res = await Group.updateOne(
    { _id: id, status: GroupStatus.REJECTED },
    {
      $set: {
        status: GroupStatus.LEFT,
        statusBeforeLeft: GroupStatus.PENDING,
        statusChangedAt: now,
        statusReason: null,
      },
    },
  );
  return !!res.modifiedCount;
}
