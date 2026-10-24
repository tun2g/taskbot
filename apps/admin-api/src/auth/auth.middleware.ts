import type { NextFunction, Request, Response } from 'express';
import { config } from 'src/config/configuration';
import { deleteSession, getSession, SESSION_COOKIE, StoredSession } from 'src/auth/auth.service';
import { asyncHandler, sendError } from 'src/shared/http';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!name || name in out) continue;
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

export const sessionIdOf = (req: Request) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence (on top of the SameSite=Strict cookie): every state-changing request must be
 * `Content-Type: application/json` — an HTML form or a "simple" cross-site fetch can't send that without a
 * CORS preflight, and this API answers no preflights. When the browser sends an Origin header it must be the
 * admin app's own origin (skipped in development so a Vite dev server on another port works).
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const type = String(req.headers['content-type'] ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (type !== 'application/json') {
    sendError(res, 415, 'Requests that change something must be sent as JSON (Content-Type: application/json).');
    return;
  }
  const origin = req.headers.origin;
  if (origin && !config.devMode && config.publicUrl) {
    let allowed = '';
    try {
      allowed = new URL(config.publicUrl).origin;
    } catch {
      /* validated at startup */
    }
    if (origin !== allowed) {
      sendError(res, 403, 'This request came from another website and was blocked.');
      return;
    }
  }
  next();
}

export interface AuthedLocals {
  session: StoredSession;
  sessionId: string;
}

/**
 * Only the bot owner gets in: a live session whose telegramUserId is the CURRENT BOT_OWNER_TELEGRAM_ID.
 * A session for anyone else (e.g. the owner id was changed) is deleted on sight.
 */
export const requireOwner = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const id = sessionIdOf(req);
  const session = await getSession(id);
  if (!session) {
    sendError(res, 401, 'Please sign in to continue.');
    return;
  }
  if (session.telegramUserId !== config.ownerTelegramId) {
    await deleteSession(id);
    sendError(res, 401, 'Your session is no longer valid. Please sign in again.');
    return;
  }
  res.locals.session = session;
  res.locals.sessionId = id;
  next();
});
