import type { AdminAuditEntry } from '@tbot/shared';
import { Types } from 'mongoose';
import { existingTargets, findAuditPage, LeanAudit } from 'src/modules/audit/audit.repository';
import { auditEntry } from 'src/modules/audit/helpers/audit-entry';
import { Pagination } from 'src/shared/http';

/** "group:<id>" / "user:<id>" keys of entries whose group or person no longer exists (deleted since). */
export async function missingTargets(rows: LeanAudit[]): Promise<Set<string>> {
  const ids = (type: string) => [
    ...new Set(rows.filter((r) => r.targetType === type && r.targetId && Types.ObjectId.isValid(r.targetId)).map((r) => r.targetId!)),
  ];
  const groupIds = ids('group');
  const userIds = ids('user');
  const { groups, users } = await existingTargets(groupIds, userIds);
  const found = new Set([...groups.map((g) => `group:${g._id}`), ...users.map((u) => `user:${u._id}`)]);
  return new Set([...groupIds.map((id) => `group:${id}`), ...userIds.map((id) => `user:${id}`)].filter((k) => !found.has(k)));
}

export interface AuditFilter {
  targetType?: string;
  targetId?: string;
}

/** One page of the audit log, newest first, with entries whose target was deleted since marked. */
export async function listAuditLog(filter: AuditFilter, p: Pagination): Promise<{ rows: AdminAuditEntry[]; total: number }> {
  const { total, rows } = await findAuditPage({ ...filter }, p);
  const missing = await missingTargets(rows);
  return { total, rows: rows.map((r) => auditEntry(r, missing)) };
}
