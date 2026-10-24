import { Request, Response } from 'express';
import { AuditFilter, listAuditLog } from 'src/modules/audit/audit.service';
import { TARGET_TYPES } from 'src/modules/audit/helpers/audit-entry';
import { paginated, pagination } from 'src/shared/http';

// GET /audit-log?page=&limit=&targetType=&targetId=
export async function getAuditLog(req: Request, res: Response) {
  const p = pagination(req.query as Record<string, unknown>, 50, 200);
  const filter: AuditFilter = {};
  if (typeof req.query.targetType === 'string' && TARGET_TYPES.includes(req.query.targetType)) filter.targetType = req.query.targetType;
  if (typeof req.query.targetId === 'string' && req.query.targetId) filter.targetId = req.query.targetId.slice(0, 64);
  const { rows, total } = await listAuditLog(filter, p);
  res.json(paginated(rows, p, total));
}
