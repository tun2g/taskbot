import type { AdminMcpOverview, AdminMcpTokenFilter, AdminMcpTokenRow, AdminTokenRevokeResult } from '@tbot/shared';
import { UsageKind } from '@tbot/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { activeTokenFilter, STATUS_MATCH, tokenStatus } from 'src/modules/mcp/helpers/tokens';
import { findOwnerIds, findToken, findTokenPage, LeanToken, markTokenRevoked, mcpUsage } from 'src/modules/mcp/mcp.repository';
import { writeAudit } from 'src/shared/audit';
import { iso } from 'src/shared/format';
import { HttpError, Pagination, searchRegex } from 'src/shared/http';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';
import type { DayWindow } from 'src/stats/range';

/** Label the API uses for calls whose client didn't say what it is (also accepted back as ?client=). */
export const UNKNOWN_CLIENT = 'Unknown client';

/** The usage-event matches for MCP calls and for MCP requests refused by the rate limit. */
function matches(window: DayWindow, tool: string | null, client: string | null) {
  const createdAt = { $gte: window.start, $lt: window.end };
  const calls: Record<string, unknown> = { kind: UsageKind.MCP_TOOL, createdAt };
  if (tool) calls.name = tool;
  if (client) calls.client = client === UNKNOWN_CLIENT ? null : client;
  // Rate-limited MCP requests don't carry a tool name, so a tool filter can't narrow them; a client filter can.
  const limited: Record<string, unknown> = { kind: UsageKind.RATE_LIMITED, channel: 'mcp', createdAt };
  if (client) limited.client = calls.client;
  return { calls, limited };
}

/** GET /mcp — MCP usage from the raw usage events (kept 90 days, the longest range). Tokens are listed by GET /mcp/tokens. */
export async function mcpOverview(window: DayWindow, tool: string | null, client: string | null): Promise<AdminMcpOverview> {
  const { calls, limited } = matches(window, tool, client);
  const { tokenCount, owners, totals, rateLimited, byTool, byClient, topUsers, daily, byGroup, limitedBy } = await mcpUsage(
    calls,
    limited,
    activeTokenFilter(new Date()),
  );
  const people = await loadPersonRefs([...topUsers.map((u) => u._id), ...limitedBy.map((u) => u._id)]);
  const groups = await loadGroupRefs(byGroup.map((g) => g._id));
  const perDay = new Map(daily.map((d) => [String(d._id), d as { calls: number; failed: number }]));
  const limitedByUser = new Map(limitedBy.map((u) => [String(u._id), u.n as number]));

  return {
    activeTokens: tokenCount,
    tokenOwners: owners.length,
    calls: totals[0]?.calls ?? 0,
    failed: totals[0]?.failed ?? 0,
    rateLimited,
    byTool: byTool.map((t) => ({ tool: String(t._id), calls: t.calls, failed: t.failed })),
    byClient: byClient.map((c) => ({ client: c._id ? String(c._id) : UNKNOWN_CLIENT, calls: c.calls, failed: c.failed })),
    topUsers: topUsers
      .filter((u) => people.has(String(u._id)))
      .map((u) => ({ person: people.get(String(u._id))!, calls: u.calls, failed: u.failed, rateLimited: limitedByUser.get(String(u._id)) ?? 0 })),
    daily: window.days.map((day) => ({ day, calls: perDay.get(day)?.calls ?? 0, failed: perDay.get(day)?.failed ?? 0 })),
    byGroup: byGroup.map((g) => ({ group: groups.get(String(g._id))!, calls: g.calls, failed: g.failed })).filter((g) => g.group),
    rateLimitedBy: limitedBy.filter((u) => people.has(String(u._id))).map((u) => ({ person: people.get(String(u._id))!, count: u.n })),
    filter: { tool, client },
  };
}

export interface TokenQuery {
  status: AdminMcpTokenFilter;
  userId: Types.ObjectId | null;
  /** Token name, prefix, or the owner's name / @username. */
  q: unknown;
}

/** The api_tokens filter for ?status=&userId=&q= (q = token name, prefix, or the owner's name / @username). */
export async function tokenFilter(query: TokenQuery, now = new Date()): Promise<Record<string, unknown>> {
  const and: Record<string, unknown>[] = [STATUS_MATCH[query.status](now)];
  if (query.userId) and.push({ userId: query.userId });
  const re = searchRegex(query.q);
  if (re) {
    const owners = await findOwnerIds(re, searchRegex(String(query.q).trim().replace(/^@/, '')));
    and.push({ $or: [{ name: re }, { prefix: re }, { userId: { $in: owners } }] });
  }
  return and.length === 1 ? and[0]! : { $and: and };
}

/** Rows for these tokens, with owner and group refs. */
export async function tokenRows(docs: LeanToken[], now = new Date()): Promise<AdminMcpTokenRow[]> {
  const [people, groups] = await Promise.all([loadPersonRefs(docs.map((t) => t.userId)), loadGroupRefs(docs.map((t) => t.groupId))]);
  return docs.map((t) => ({
    id: String(t._id),
    name: t.name,
    prefix: t.prefix,
    person: t.userId ? (people.get(String(t.userId)) ?? null) : null,
    group: t.groupId ? (groups.get(String(t.groupId)) ?? null) : null,
    lastUsedAt: iso(t.lastUsedAt),
    createdAt: iso(t.createdAt) ?? new Date(0).toISOString(),
    expiresAt: iso(t.expiresAt),
    status: tokenStatus(t, now),
    revokedAt: iso(t.revokedAt),
  }));
}

/** One page of tokens: newest first, or most recently ended first for history. */
export async function tokenPage(query: TokenQuery, ended: boolean, p: Pagination) {
  const filter = await tokenFilter(query);
  const sort: Record<string, 1 | -1> = ended ? { revokedAt: -1, expiresAt: -1, _id: -1 } : { createdAt: -1, _id: -1 };
  const { total, docs } = await findTokenPage(filter, sort, p);
  return { total, rows: await tokenRows(docs) };
}

/**
 * Revokes one MCP token (the person's other tokens keep working). Revoking an already-revoked token is a 409;
 * an expired one can still be revoked, so it can never come back.
 */
export async function revokeToken(req: Request, id: Types.ObjectId): Promise<AdminTokenRevokeResult> {
  const before = await findToken(id);
  if (!before) throw new HttpError(404, "This token doesn't exist (it may have been deleted with its group).");
  if (before.revokedAt) throw new HttpError(409, 'This token was already revoked.');
  const revokedAt = new Date();
  if (!(await markTokenRevoked(id, revokedAt))) throw new HttpError(409, 'This token was already revoked.');
  const [token] = await tokenRows([{ ...before, revokedAt }]);
  const auditId = await writeAudit(req, {
    action: 'token.revoke',
    targetType: 'user',
    targetId: token.person?.id ?? null,
    targetLabel: token.person?.name ?? null,
    details: { tokenId: token.id, name: token.name, prefix: token.prefix, groupId: token.group?.id ?? null, groupName: token.group?.name ?? null },
  });
  return { token, auditId };
}
