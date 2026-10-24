/** MCP usage and tokens. */
import type { AdminGroupRef, AdminPersonRef } from './common.js';

/**
 * GET /mcp?range=30d&tool=&client= — `tool` / `client` narrow every call number (not the token numbers) to
 * one tool or one client, so a row of "By tool" / "By client" opens into who and which groups.
 */
export interface AdminMcpOverview {
  activeTokens: number;
  tokenOwners: number;
  calls: number;
  /** Tool calls that returned an error. */
  failed: number;
  /** Requests refused because a token sent too many too quickly (not included in `calls`). */
  rateLimited: number;
  byTool: { tool: string; calls: number; failed: number }[];
  byClient: { client: string; calls: number; failed?: number }[];
  topUsers: { person: AdminPersonRef; calls: number; failed?: number; rateLimited?: number }[];
  daily: { day: string; calls: number; failed?: number }[];
  /** Calls per group (top 10). */
  byGroup?: { group: AdminGroupRef; calls: number; failed: number }[];
  /** Who was refused by the rate limit (top 10). */
  rateLimitedBy?: { person: AdminPersonRef; count: number }[];
  /** The filter that was applied (echo). */
  filter?: { tool: string | null; client: string | null };
}

/** A row of GET /mcp/tokens (paginated). */
export interface AdminMcpTokenRow {
  id: string;
  name: string;
  prefix: string;
  person: AdminPersonRef | null;
  /** null = works in all of the person's groups. */
  group: AdminGroupRef | null;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: AdminMcpTokenStatus;
  revokedAt: string | null;
}

export type AdminMcpTokenStatus = 'active' | 'revoked' | 'expired';

/** GET /mcp/tokens?status=active|revoked|expired|ended&userId=&q=&page=&limit= ("ended" = revoked or expired). */
export type AdminMcpTokenFilter = AdminMcpTokenStatus | 'ended';

/** POST /tokens/:id/revoke → the token after revoking (only this token stops working). */
export interface AdminTokenRevokeResult {
  token: AdminMcpTokenRow;
  /** The audit entry for this change. */
  auditId: string | null;
}
