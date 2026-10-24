import { AdminAuditLog, Group, User } from '@tbot/db';
import type { AdminAuditEntry } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { Types } from 'mongoose';
import { auditChanges, auditSummary } from 'src/shared/audit';
import { asyncHandler, paginated, pagination } from 'src/shared/http';

export const auditRouter: Router = Router();

const TARGET_TYPES = ['group', 'user', 'settings', 'session'];

interface LeanAudit {
  _id: Types.ObjectId;
  createdAt: Date;
  action: string;
  targetType: AdminAuditEntry['targetType'];
  targetId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
}

export function auditEntry(a: LeanAudit, missing?: Set<string>): AdminAuditEntry {
  const changes = auditChanges(a.action, a.details);
  return {
    id: String(a._id),
    at: new Date(a.createdAt).toISOString(),
    action: a.action,
    summary: auditSummary(a.action, a.targetLabel),
    targetType: a.targetType ?? null,
    targetId: a.targetId ?? null,
    targetLabel: a.targetLabel ?? null,
    ...(missing && a.targetId && missing.has(`${a.targetType}:${a.targetId}`) ? { targetMissing: true } : {}),
    ...(changes.length ? { changes } : {}),
    reason: a.reason ?? null,
    details: a.details ?? null,
  };
}

/** "group:<id>" / "user:<id>" keys of entries whose group or person no longer exists (deleted since). */
export async function missingTargets(rows: LeanAudit[]): Promise<Set<string>> {
  const ids = (type: string) => [
    ...new Set(rows.filter((r) => r.targetType === type && r.targetId && Types.ObjectId.isValid(r.targetId)).map((r) => r.targetId!)),
  ];
  const groupIds = ids('group');
  const userIds = ids('user');
  const [groups, users] = await Promise.all([
    groupIds.length ? Group.find({ _id: { $in: groupIds } }).select('_id').lean<{ _id: Types.ObjectId }[]>() : Promise.resolve([]),
    userIds.length ? User.find({ _id: { $in: userIds } }).select('_id').lean<{ _id: Types.ObjectId }[]>() : Promise.resolve([]),
  ]);
  const found = new Set([...groups.map((g) => `group:${g._id}`), ...users.map((u) => `user:${u._id}`)]);
  return new Set([...groupIds.map((id) => `group:${id}`), ...userIds.map((id) => `user:${id}`)].filter((k) => !found.has(k)));
}

// GET /audit-log?page=&limit=&targetType=&targetId=
auditRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const p = pagination(req.query as Record<string, unknown>, 50, 200);
    const filter: Record<string, unknown> = {};
    if (typeof req.query.targetType === 'string' && TARGET_TYPES.includes(req.query.targetType)) filter.targetType = req.query.targetType;
    if (typeof req.query.targetId === 'string' && req.query.targetId) filter.targetId = req.query.targetId.slice(0, 64);
    const [total, rows] = await Promise.all([
      AdminAuditLog.countDocuments(filter),
      AdminAuditLog.find(filter).select('-ip').sort({ createdAt: -1, _id: -1 }).skip(p.skip).limit(p.limit).lean<LeanAudit[]>(),
    ]);
    const missing = await missingTargets(rows);
    res.json(paginated(rows.map((r) => auditEntry(r, missing)), p, total));
  }),
);
