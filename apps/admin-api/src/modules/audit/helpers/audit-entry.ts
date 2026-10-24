import type { AdminAuditEntry } from '@tbot/shared';
import type { LeanAudit } from 'src/modules/audit/audit.repository';
import { auditChanges, auditSummary } from 'src/shared/audit';

export const TARGET_TYPES = ['group', 'user', 'settings', 'session', 'system'];

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
