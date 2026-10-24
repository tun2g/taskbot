import { Request, Response, Router } from 'express';
import { asyncHandler, objectIdParam, paginated, pagination } from 'src/shared/http';
import { parseRange, rangeWindows } from 'src/stats/range';
import { mcpOverview } from './overview';
import { revokeToken } from './revoke';
import { tokenFilter, tokenPage } from './tokens';

export { UNKNOWN_CLIENT } from './overview';

export const mcpRouter: Router = Router();

function textParam(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
}

// GET /mcp?range=30d&tool=&client=
mcpRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { current: window } = rangeWindows(parseRange(req.query.range));
    res.json({ data: await mcpOverview(window, textParam(req.query.tool), textParam(req.query.client)) });
  }),
);

// GET /mcp/tokens?status=active|revoked|expired|ended&userId=&q=&page=&limit=
mcpRouter.get(
  '/tokens',
  asyncHandler(async (req: Request, res: Response) => {
    const p = pagination(req.query as Record<string, unknown>, 20, 100);
    const ended = req.query.status !== undefined && req.query.status !== 'active';
    const { rows, total } = await tokenPage(await tokenFilter(req.query), ended, p);
    res.json(paginated(rows, p, total));
  }),
);

/** /tokens — actions on one MCP token. */
export const tokensRouter: Router = Router();

// POST /tokens/:id/revoke — only this token stops working (audited).
tokensRouter.post(
  '/:id/revoke',
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: await revokeToken(req, objectIdParam(req.params.id, 'token')) });
  }),
);
