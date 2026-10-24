import express, { Express, NextFunction, Request, Response } from 'express';
import { csrfGuard, requireOwner } from 'src/auth/auth.middleware';
import { authRouter } from 'src/auth/auth.routes';
import { aiRouter } from 'src/routes/ai.routes';
import { auditRouter } from 'src/routes/audit.routes';
import { groupsRouter } from 'src/routes/groups.routes';
import { mcpRouter } from 'src/routes/mcp.routes';
import { overviewRouter } from 'src/routes/overview.routes';
import { settingsRouter } from 'src/routes/settings.routes';
import { systemRouter } from 'src/routes/system.routes';
import { usersRouter } from 'src/routes/users.routes';
import { errorHandler, sendError } from 'src/shared/http';

export function createApp(): Express {
  const app = express();
  // Behind Caddy: req.ip is the client address from X-Forwarded-For (one proxy hop).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Same-origin API (Caddy serves the admin app and proxies /api here): no CORS headers on purpose.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const api = express.Router();
  api.use(csrfGuard);
  api.use('/auth', authRouter);
  // Everything below needs the owner's session.
  api.use(requireOwner);
  api.use('/overview', overviewRouter);
  api.use('/groups', groupsRouter);
  api.use('/users', usersRouter);
  api.use('/ai', aiRouter);
  api.use('/settings', settingsRouter);
  api.use('/mcp', mcpRouter);
  api.use('/system', systemRouter);
  api.use('/audit-log', auditRouter);
  api.use((_req: Request, res: Response) => sendError(res, 404, 'This page of the admin API does not exist.'));
  app.use('/api', api);

  app.use(errorHandler);
  return app;
}
