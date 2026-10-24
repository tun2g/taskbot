import type { AdminMcpTokenFilter } from '@tbot/shared';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { TOKEN_FILTERS } from 'src/modules/mcp/helpers/tokens';
import { mcpOverview, revokeToken, TokenQuery, tokenPage } from 'src/modules/mcp/mcp.service';
import { HttpError, objectIdParam, paginated, pagination } from 'src/shared/http';
import { parseRange, rangeWindows } from 'src/stats/range';

function textParam(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
}

const objectId = (v: unknown, what: string) => {
  if (!/^[a-f0-9]{24}$/i.test(String(v))) throw new HttpError(400, `The ${what} filter is not a valid id.`);
  return new Types.ObjectId(String(v));
};

/** ?status=&userId=&q= of the token list (400 on an unknown status or a malformed person id). */
function tokenQuery(query: Request['query']): TokenQuery {
  const status = String(query.status ?? 'active') as AdminMcpTokenFilter;
  if (!TOKEN_FILTERS.includes(status)) throw new HttpError(400, `Unknown token status “${status}”.`);
  return { status, userId: query.userId ? objectId(query.userId, 'person') : null, q: query.q };
}

// GET /mcp?range=30d&tool=&client=
export async function getOverview(req: Request, res: Response) {
  const { current: window } = rangeWindows(parseRange(req.query.range));
  res.json({ data: await mcpOverview(window, textParam(req.query.tool), textParam(req.query.client)) });
}

// GET /mcp/tokens?status=active|revoked|expired|ended&userId=&q=&page=&limit=
export async function getTokens(req: Request, res: Response) {
  const p = pagination(req.query as Record<string, unknown>, 20, 100);
  const ended = req.query.status !== undefined && req.query.status !== 'active';
  const { rows, total } = await tokenPage(tokenQuery(req.query), ended, p);
  res.json(paginated(rows, p, total));
}

// POST /tokens/:id/revoke — only this token stops working (audited).
export async function postRevoke(req: Request, res: Response) {
  res.json({ data: await revokeToken(req, objectIdParam(req.params.id, 'token')) });
}
