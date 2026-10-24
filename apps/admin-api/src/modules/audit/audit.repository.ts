import { AdminAuditLog, Group, User } from '@tbot/db';
import type { AdminAuditEntry } from '@tbot/shared';
import { Types } from 'mongoose';
import { Pagination } from 'src/shared/http';

export interface LeanAudit {
  _id: Types.ObjectId;
  createdAt: Date;
  action: string;
  targetType: AdminAuditEntry['targetType'];
  targetId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
}

/** One page of audit entries (newest first, without the IP), and how many match. */
export async function findAuditPage(filter: Record<string, unknown>, p: Pagination) {
  const [total, rows] = await Promise.all([
    AdminAuditLog.countDocuments(filter),
    AdminAuditLog.find(filter).select('-ip').sort({ createdAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean<LeanAudit[]>(),
  ]);
  return { total, rows };
}

/** The groups and people of these ids that still exist. */
export async function existingTargets(groupIds: string[], userIds: string[]) {
  const [groups, users] = await Promise.all([
    groupIds.length ? Group.find({ _id: { $in: groupIds } }).select('_id').lean<{ _id: Types.ObjectId }[]>() : Promise.resolve([]),
    userIds.length ? User.find({ _id: { $in: userIds } }).select('_id').lean<{ _id: Types.ObjectId }[]>() : Promise.resolve([]),
  ]);
  return { groups, users };
}
