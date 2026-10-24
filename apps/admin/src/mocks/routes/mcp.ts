/** MCP: the usage page, the token list and revoking one token. */
import { mcpOverview } from '../derive/mcp';
import { tokenQuery, tokens } from '../derive/tokens';
import { recordAudit } from '../fixtures';
import { HttpError, paginate, rangeOf, type Route } from '../http';

function tokenList(q: URLSearchParams) {
  if (!['active', 'revoked', 'expired', 'ended'].includes(q.get('status') ?? 'active')) throw new HttpError(400, 'Unknown token status.');
  return paginate(tokenQuery(q), q);
}

function revokeToken(id: string | undefined) {
  const t = tokens.find((x) => x.id === id);
  if (!t) throw new HttpError(404, "This token doesn't exist (it may have been deleted with its group).");
  if (t.status === 'revoked') throw new HttpError(409, 'This token was already revoked.');
  Object.assign(t, { status: 'revoked', revokedAt: new Date().toISOString() });
  const auditId = `mock-${Date.now()}`;
  recordAudit({
    id: auditId,
    at: t.revokedAt!,
    action: 'token.revoke',
    summary: `Revoked one MCP token of ${t.person?.name ?? 'a user'}`,
    targetType: 'user',
    targetId: t.person?.id ?? null,
    targetLabel: t.person?.name ?? null,
    details: null,
    changes: [`“${t.name}” (${t.prefix}…) revoked — their other tokens keep working`],
  });
  return { data: { token: t, auditId } };
}

export const mcpRoutes: Route[] = [
  ['GET', /^\/mcp$/, ({ q }) => ({ data: mcpOverview(rangeOf(q), q.get('tool'), q.get('client')) })],
  ['GET', /^\/mcp\/tokens$/, ({ q }) => tokenList(q)],
  ['POST', /^\/tokens\/([^/]+)\/revoke$/, ({ params }) => revokeToken(params[0])],
];
