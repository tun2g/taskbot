import type { AdminLoginLinkStatus } from '@tbot/shared';
import { Request, Response } from 'express';
import { sessionIdOf } from 'src/modules/auth/auth.middleware';
import { exchangeSchema, statusSchema } from 'src/modules/auth/auth.schemas';
import { cookieOptions } from 'src/modules/auth/helpers/cookies';
import { deviceOf } from 'src/modules/auth/helpers/user-agent';
import { loginLinkStatus } from 'src/modules/auth/services/login-codes.service';
import {
  checkExchangeLimit,
  exchangeLoginCode,
  logout,
  logoutEverywhere,
  recordSignIn,
  requestLoginLink,
  sessionBody,
} from 'src/modules/auth/services/login.service';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, StoredSession } from 'src/modules/auth/services/sessions.service';
import { parseOr400 } from 'src/shared/http';

// POST /auth/request-link
export async function requestLink(req: Request, res: Response) {
  res.json({ data: await requestLoginLink(req.ip) });
}

// GET /auth/link-status?requestId= — only "was the link used?"; it never signs this browser in.
export async function linkStatus(req: Request, res: Response) {
  const { requestId } = parseOr400(statusSchema, req.query);
  const body: AdminLoginLinkStatus = { status: await loginLinkStatus(requestId) };
  res.json({ data: body });
}

// POST /auth/exchange — trades the code from the link for the session cookie.
export async function exchange(req: Request, res: Response) {
  await checkExchangeLimit(req.ip);
  const { code } = parseOr400(exchangeSchema, req.body);
  const device = deviceOf(req);
  const { id, session } = await exchangeLoginCode(code, device);
  res.cookie(SESSION_COOKIE, id, { ...cookieOptions(), maxAge: SESSION_TTL_SECONDS * 1000 });
  await recordSignIn(req, device);
  res.json({ data: await sessionBody(session) });
}

// POST /auth/logout
export async function logoutHandler(req: Request, res: Response) {
  await logout(req, sessionIdOf(req));
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.json({ data: { ok: true } });
}

// POST /auth/logout-all
export async function logoutAll(req: Request, res: Response) {
  const removed = await logoutEverywhere(req);
  res.clearCookie(SESSION_COOKIE, cookieOptions());
  res.json({ data: { ok: true, sessions: removed } });
}

// GET /auth/me
export async function me(_req: Request, res: Response) {
  res.json({ data: await sessionBody(res.locals.session as StoredSession) });
}
