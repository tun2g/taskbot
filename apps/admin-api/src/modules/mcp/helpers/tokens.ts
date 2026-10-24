import type { AdminMcpTokenFilter, AdminMcpTokenStatus } from '@tbot/shared';

export const TOKEN_FILTERS: AdminMcpTokenFilter[] = ['active', 'revoked', 'expired', 'ended'];

export const activeTokenFilter = (now: Date) => ({ revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] });

export const STATUS_MATCH: Record<AdminMcpTokenFilter, (now: Date) => Record<string, unknown>> = {
  active: activeTokenFilter,
  revoked: () => ({ revokedAt: { $ne: null } }),
  expired: (now) => ({ revokedAt: null, expiresAt: { $ne: null, $lte: now } }),
  ended: (now) => ({ $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $ne: null, $lte: now } }] }),
};

export function tokenStatus(t: { revokedAt?: Date | null; expiresAt: Date | null }, now = new Date()): AdminMcpTokenStatus {
  if (t.revokedAt) return 'revoked';
  if (t.expiresAt && t.expiresAt <= now) return 'expired';
  return 'active';
}
