import type { AdminLoginLinkResponse, AdminSession } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { requireOwner, sessionIdOf } from 'src/auth/auth.middleware';
import {
  consumeLoginCode,
  createLoginCode,
  createSession,
  deleteAllSessions,
  deleteSession,
  discardLoginCode,
  hitRateLimit,
  LOGIN_CODE_TTL_SECONDS,
  ownerProfile,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  StoredSession,
} from 'src/auth/auth.service';
import { config } from 'src/config/configuration';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, parseOr400, sendError } from 'src/shared/http';
import { telegram } from 'src/shared/telegram';

/** Login-link limits: per IP and for the whole server (the link always goes to the owner, so this is anti-spam). */
export const LINK_LIMIT_PER_IP = { limit: 5, windowSeconds: 15 * 60 };
export const LINK_LIMIT_GLOBAL = { limit: 20, windowSeconds: 60 * 60 };
export const EXCHANGE_LIMIT_PER_IP = { limit: 20, windowSeconds: 15 * 60 };

const waitText = (seconds: number) => (seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`);

function cookieOptions() {
  return {
    httpOnly: true,
    secure: !config.devMode,
    sameSite: 'strict' as const,
    path: '/api',
  };
}

async function sessionBody(session: StoredSession): Promise<AdminSession> {
  const owner = await ownerProfile();
  return { owner: { telegramUserId: owner.telegramUserId, name: owner.name, username: owner.username }, expiresAt: session.expiresAt };
}

export function loginMessage(link: string): { text: string; buttons: boolean } {
  const minutes = Math.round(LOGIN_CODE_TTL_SECONDS / 60);
  const https = link.startsWith('https://');
  const text =
    '🔐 <b>Sign in to the TaskBot admin app</b>\n\n' +
    `Tap <b>Open admin</b> to sign in. The link works once and expires in ${minutes} minutes.` +
    (https ? '' : `\n\n${link}`) +
    "\n\nIf you didn't ask for this, ignore it — nobody can sign in without this link.";
  return { text, buttons: https };
}

export const authRouter: Router = Router();

authRouter.post(
  '/request-link',
  asyncHandler(async (req: Request, res: Response) => {
    const perIp = await hitRateLimit(`link:ip:${req.ip}`, LINK_LIMIT_PER_IP.limit, LINK_LIMIT_PER_IP.windowSeconds);
    if (!perIp.allowed) {
      sendError(res, 429, `Too many login links requested. Try again in ${waitText(perIp.retryAfterSeconds)}.`);
      return;
    }
    const global = await hitRateLimit('link:global', LINK_LIMIT_GLOBAL.limit, LINK_LIMIT_GLOBAL.windowSeconds);
    if (!global.allowed) {
      sendError(res, 429, `Too many login links were requested recently. Try again in ${waitText(global.retryAfterSeconds)}.`);
      return;
    }

    const code = await createLoginCode();
    const link = `${config.publicUrl}/login/callback?code=${encodeURIComponent(code)}`;
    const { text, buttons } = loginMessage(link);
    const sent = await telegram.sendMessage(
      config.ownerTelegramId,
      text,
      buttons ? { inline_keyboard: [[{ text: 'Open admin', url: link }]] } : undefined,
    );
    if (!sent.ok) {
      await discardLoginCode(code);
      sendError(
        res,
        502,
        "Couldn't send the login link on Telegram. Make sure you have started a private chat with the bot, then try again.",
      );
      return;
    }
    const owner = await ownerProfile();
    const body: AdminLoginLinkResponse = {
      sentTo: owner.username ? `@${owner.username}` : 'your Telegram account',
      expiresInSeconds: LOGIN_CODE_TTL_SECONDS,
    };
    res.json({ data: body });
  }),
);

const exchangeSchema = z.object({ code: z.string({ message: 'The login link is missing its code.' }).min(1).max(200) });

authRouter.post(
  '/exchange',
  asyncHandler(async (req: Request, res: Response) => {
    const limited = await hitRateLimit(`exchange:ip:${req.ip}`, EXCHANGE_LIMIT_PER_IP.limit, EXCHANGE_LIMIT_PER_IP.windowSeconds);
    if (!limited.allowed) {
      sendError(res, 429, `Too many sign-in attempts. Try again in ${waitText(limited.retryAfterSeconds)}.`);
      return;
    }
    const { code } = parseOr400(exchangeSchema, req.body);
    if (!(await consumeLoginCode(code))) {
      sendError(res, 401, 'This login link is invalid, already used or expired. Request a new one.');
      return;
    }
    const { id, session } = await createSession(config.ownerTelegramId);
    res.cookie(SESSION_COOKIE, id, { ...cookieOptions(), maxAge: SESSION_TTL_SECONDS * 1000 });
    const owner = await ownerProfile();
    await writeAudit(req, { action: 'auth.login', targetType: 'session', targetLabel: owner.name });
    res.json({ data: await sessionBody(session) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    await deleteSession(sessionIdOf(req));
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    res.json({ data: { ok: true } });
  }),
);

authRouter.post(
  '/logout-all',
  requireOwner,
  asyncHandler(async (req: Request, res: Response) => {
    const removed = await deleteAllSessions();
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    await writeAudit(req, { action: 'auth.logout_all', targetType: 'session', details: { sessions: removed } });
    res.json({ data: { ok: true, sessions: removed } });
  }),
);

authRouter.get(
  '/me',
  requireOwner,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ data: await sessionBody(res.locals.session as StoredSession) });
  }),
);
