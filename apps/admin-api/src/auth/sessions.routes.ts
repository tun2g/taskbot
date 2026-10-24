import type { AdminSessionRow } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { requireOwner, sessionIdOf } from 'src/auth/auth.middleware';
import { listSessions, revokeSession } from 'src/auth/sessions';
import { describeUserAgent } from 'src/auth/user-agent';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, sendError } from 'src/shared/http';

/** The owner's signed-in browsers ("Active sessions" in the account menu). */
export const sessionsRouter: Router = Router();

// GET /auth/sessions — every browser signed in, so the owner can spot one they don't recognise.
sessionsRouter.get(
  '/sessions',
  requireOwner,
  asyncHandler(async (req: Request, res: Response) => {
    const rows: AdminSessionRow[] = (await listSessions(sessionIdOf(req))).map((s) => ({
      id: s.id,
      browser: describeUserAgent(s.userAgent),
      ip: s.ip ?? null,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt ?? null,
      expiresAt: s.expiresAt,
      current: s.current,
    }));
    res.json({ data: rows });
  }),
);

// POST /auth/sessions/:id/revoke — sign out one other browser.
sessionsRouter.post(
  '/sessions/:id/revoke',
  requireOwner,
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    const current = (await listSessions(sessionIdOf(req))).find((s) => s.current);
    if (current?.id === id) {
      sendError(res, 400, 'This is the browser you’re using. Use “Log out” in the account menu instead.');
      return;
    }
    const session = await revokeSession(id);
    if (!session) {
      sendError(res, 404, 'That browser is already signed out.');
      return;
    }
    await writeAudit(req, {
      action: 'auth.session_revoke',
      targetType: 'session',
      details: { browser: describeUserAgent(session.userAgent), ip: session.ip ?? null },
    });
    res.json({ data: { ok: true } });
  }),
);
