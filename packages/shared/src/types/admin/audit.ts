/** The audit log of the owner's changes. */

/** GET /audit-log?page=&limit=&targetType=&targetId= */
export interface AdminAuditEntry {
  id: string;
  at: string;
  action: string;
  /** Plain sentence, e.g. "Suspended group “Acme Mobile Team”". */
  summary: string;
  targetType: 'group' | 'user' | 'settings' | 'session' | 'system' | null;
  targetId: string | null;
  targetLabel: string | null;
  /** The group / person no longer exists (deleted) — show the label without a link. */
  targetMissing?: boolean;
  reason: string | null;
  /** Plain-language lines about what changed (e.g. "Daily call limit: 500 → 200"). */
  changes?: string[];
  details: Record<string, unknown> | null;
}
