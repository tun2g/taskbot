import express, { Express } from 'express';
import { errorHandler } from 'src/api/middlewares/error-handler.middleware';
import { apiRouter } from 'src/api/routes/index';
import { configService } from 'src/configs/configuration';
import { mcpRouter } from 'src/mcp/mcp.router';

const app: Express = express();

// CORS for the Mini App and the browser version (Bearer tokens via Authorization).
// The MCP endpoint is for desktop/CLI agents (no browser origin), so it needs no extra origins.
app.use((_req, res, next) => {
  const allowedOrigins = [configService.webappUrl, 'http://localhost:5173'].filter(Boolean);
  const origin = _req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, ngrok-skip-browser-warning, Mcp-Session-Id, Mcp-Protocol-Version',
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, WWW-Authenticate');
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Remote MCP server for Claude Code / Cursor (personal access tokens). Mounted before the global JSON
// parser: it parses its own bodies (bigger limit, JSON-RPC style parse errors).
app.use('/mcp', mcpRouter);

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Mount API routes
app.use('/api', apiRouter);

// Global error handler (must be last)
app.use(errorHandler);

export { app };
