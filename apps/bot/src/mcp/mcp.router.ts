import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { NextFunction, Request, Response, Router } from 'express';
import { resolveClientLabel } from 'src/mcp/client-label';
import { mcpAuthMiddleware, McpRequest } from 'src/mcp/mcp-auth.middleware';
import { buildMcpServer } from 'src/mcp/server';
import logger from 'src/shared/logger/logger';

/** create_tasks with 20 tasks × 2000-character descriptions is well over express.json's 100kb default. */
const MCP_BODY_LIMIT = '1mb';

const jsonRpcError = (res: Response, status: number, code: number, message: string) =>
  res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });

/** POST /mcp — one stateless McpServer + transport per request (JSON responses, no SSE sessions). */
async function handlePost(req: McpRequest, res: Response) {
  const user = req.user!;
  const clientLabel = await resolveClientLabel(String(req.apiToken!._id), req.body, req.headers['user-agent']);
  const server = buildMcpServer({ user, clientLabel, scopeGroup: req.scopeGroup ?? null });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error(`MCP request failed: ${error instanceof Error ? error.stack : error}`);
    if (!res.headersSent) jsonRpcError(res, 500, -32603, 'Internal server error');
  }
}

/** Stateless server: no standalone SSE stream (GET) and no sessions to end (DELETE). */
function methodNotAllowed(_req: Request, res: Response) {
  res.setHeader('Allow', 'POST');
  jsonRpcError(res, 405, -32000, 'Method not allowed. This MCP server is stateless: send JSON-RPC requests with POST.');
}

/** Malformed JSON → a JSON-RPC parse error instead of the REST API's error shape. */
function parseErrorHandler(
  err: Error & { type?: string; status?: number },
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  if (err.type === 'entity.parse.failed')
    return jsonRpcError(res, 400, -32700, 'Parse error: the body is not valid JSON.');
  if (err.type === 'entity.too.large')
    return jsonRpcError(res, 413, -32600, `Request too large (max ${MCP_BODY_LIMIT}).`);
  next(err);
}

const router: Router = Router();
router.use(express.json({ limit: MCP_BODY_LIMIT }));
router.use(parseErrorHandler);
router.post('/', mcpAuthMiddleware as never, (req, res) => void handlePost(req as McpRequest, res));
router.get('/', mcpAuthMiddleware as never, methodNotAllowed);
router.delete('/', mcpAuthMiddleware as never, methodNotAllowed);

export { router as mcpRouter };
