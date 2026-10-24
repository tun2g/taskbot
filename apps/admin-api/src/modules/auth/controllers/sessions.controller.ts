import { Request, Response } from 'express';
import { sessionIdOf } from 'src/modules/auth/auth.middleware';
import { listSessionRows, revokeOtherSession } from 'src/modules/auth/services/session-list.service';

// GET /auth/sessions — every browser signed in, so the owner can spot one they don't recognise.
export async function listSessionsHandler(req: Request, res: Response) {
  res.json({ data: await listSessionRows(sessionIdOf(req)) });
}

// POST /auth/sessions/:id/revoke — sign out one other browser.
export async function revokeSessionHandler(req: Request, res: Response) {
  await revokeOtherSession(req, sessionIdOf(req), String(req.params.id ?? ''));
  res.json({ data: { ok: true } });
}
