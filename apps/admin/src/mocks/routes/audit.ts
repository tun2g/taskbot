/** GET /audit-log — newest first, filterable by target; deleted groups are marked missing. */
import { auditLog, groups } from '../fixtures';
import { paginate, type Route } from '../http';

function list(q: URLSearchParams) {
  const rows = auditLog
    .filter((e) => (!q.get('targetType') || e.targetType === q.get('targetType')) && (!q.get('targetId') || e.targetId === q.get('targetId')))
    .map((e) => (e.targetType === 'group' && e.targetId && !groups.some((g) => g.id === e.targetId) ? { ...e, targetMissing: true } : e));
  return paginate(rows, q);
}

export const auditRoutes: Route[] = [['GET', /^\/audit-log$/, ({ q }) => list(q)]];
