import { Router } from 'express';
import { getOverview, getTokens, postRevoke } from 'src/modules/mcp/mcp.controller';
import { asyncHandler } from 'src/shared/http';

export const mcpRouter: Router = Router();

mcpRouter.get('/', asyncHandler(getOverview));
mcpRouter.get('/tokens', asyncHandler(getTokens));

/** /tokens — actions on one MCP token. */
export const tokensRouter: Router = Router();

tokensRouter.post('/:id/revoke', asyncHandler(postRevoke));
