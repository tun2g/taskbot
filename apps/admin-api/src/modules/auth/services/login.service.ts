import type { AdminLoginLinkResponse, AdminSession } from '@tbot/shared';
import type { Request } from 'express';
import { config } from 'src/config/configuration';
import { loginMessage, signInNotice } from 'src/modules/auth/helpers/notify';
import { describeUserAgent } from 'src/modules/auth/helpers/user-agent';
import {
  consumeLoginCode,
  createLoginCode,
  discardLoginCode,
  LOGIN_CODE_TTL_SECONDS,
} from 'src/modules/auth/services/login-codes.service';
import { ownerProfile } from 'src/modules/auth/services/owner.service';
import { hitRateLimit } from 'src/modules/auth/services/rate-limit.service';
import {
  createSession,
  deleteAllSessions,
  deleteSession,
  getSession,
  StoredSession,
} from 'src/modules/auth/services/sessions.service';
import { writeAudit } from 'src/shared/audit';
import { HttpError } from 'src/shared/http';
import logger from 'src/shared/logger';
import { telegram } from 'src/shared/telegram';

/** Login-link limits: per IP and for the whole server (the link always goes to the owner, so this is anti-spam). */
export const LINK_LIMIT_PER_IP = { limit: 5, windowSeconds: 15 * 60 };
export const LINK_LIMIT_GLOBAL = { limit: 20, windowSeconds: 60 * 60 };
export const EXCHANGE_LIMIT_PER_IP = { limit: 20, windowSeconds: 15 * 60 };

const waitText = (seconds: number) => (seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`);

/** Browser + address of the request (see deviceOf). */
export interface Device {
  userAgent: string;
  browser: string;
  ip: string | null;
}

export async function sessionBody(session: StoredSession): Promise<AdminSession> {
  const owner = await ownerProfile();
  return {
    owner: { telegramUserId: owner.telegramUserId, name: owner.name, username: owner.username },
    expiresAt: session.expiresAt,
  };
}

/** Rate-limits, then DMs the owner a one-time login link. */
export async function requestLoginLink(ip: string | undefined): Promise<AdminLoginLinkResponse> {
  const perIp = await hitRateLimit(`link:ip:${ip}`, LINK_LIMIT_PER_IP.limit, LINK_LIMIT_PER_IP.windowSeconds);
  if (!perIp.allowed)
    throw new HttpError(429, `Too many login links requested. Try again in ${waitText(perIp.retryAfterSeconds)}.`);
  const global = await hitRateLimit('link:global', LINK_LIMIT_GLOBAL.limit, LINK_LIMIT_GLOBAL.windowSeconds);
  if (!global.allowed)
    throw new HttpError(
      429,
      `Too many login links were requested recently. Try again in ${waitText(global.retryAfterSeconds)}.`,
    );

  const { code, requestId } = await createLoginCode();
  const link = `${config.publicUrl}/login/callback?code=${encodeURIComponent(code)}`;
  const { text, buttons } = loginMessage(link, LOGIN_CODE_TTL_SECONDS);
  const sent = await telegram.sendMessage(
    config.ownerTelegramId,
    text,
    buttons ? { inline_keyboard: [[{ text: 'Open admin', url: link }]] } : undefined,
  );
  if (!sent.ok) {
    await discardLoginCode(code);
    throw new HttpError(
      502,
      "Couldn't send the login link on Telegram. Make sure you have started a private chat with the bot, then try again.",
    );
  }
  const owner = await ownerProfile();
  return {
    sentTo: owner.username ? `@${owner.username}` : 'your Telegram account',
    expiresInSeconds: LOGIN_CODE_TTL_SECONDS,
    requestId,
  };
}

/** Counts a sign-in attempt from this address (checked before the body is even read). */
export async function checkExchangeLimit(ip: string | undefined): Promise<void> {
  const limited = await hitRateLimit(
    `exchange:ip:${ip}`,
    EXCHANGE_LIMIT_PER_IP.limit,
    EXCHANGE_LIMIT_PER_IP.windowSeconds,
  );
  if (!limited.allowed)
    throw new HttpError(429, `Too many sign-in attempts. Try again in ${waitText(limited.retryAfterSeconds)}.`);
}

/** Trades a login code for a new owner session. */
export async function exchangeLoginCode(code: string, device: Device): Promise<{ id: string; session: StoredSession }> {
  if (!(await consumeLoginCode(code)))
    throw new HttpError(401, 'This login link is invalid, already used or expired. Request a new one.');
  return createSession(config.ownerTelegramId, { userAgent: device.userAgent, ip: device.ip });
}

/** Audit entry + Telegram notice for a successful sign-in. */
export async function recordSignIn(req: Request, device: Device): Promise<void> {
  const owner = await ownerProfile();
  await writeAudit(req, {
    action: 'auth.login',
    targetType: 'session',
    targetLabel: owner.name,
    details: { browser: device.browser, ip: device.ip },
  });
  await sendSignInNotice(device.browser, device.ip);
}

/** DMs the owner about a successful sign-in. Never fails the sign-in. */
async function sendSignInNotice(browser: string, ip: string | null): Promise<void> {
  const https = config.publicUrl.startsWith('https://');
  const notice = await telegram.sendMessage(
    config.ownerTelegramId,
    signInNotice(browser, ip, new Date()),
    https ? { inline_keyboard: [[{ text: 'Open admin', url: config.publicUrl }]] } : undefined,
  );
  if (!notice.ok) logger.warn(`Couldn't send the sign-in notice: ${notice.error}`);
}

/** Ends this browser's session (if any) and records it. */
export async function logout(req: Request, sessionId: string | undefined): Promise<void> {
  const session = await getSession(sessionId);
  await deleteSession(sessionId);
  if (session) {
    await writeAudit(req, {
      action: 'auth.logout',
      targetType: 'session',
      details: { browser: describeUserAgent(session.userAgent), ip: session.ip ?? null },
    });
  }
}

/** Signs out every browser. Returns how many sessions were still alive. */
export async function logoutEverywhere(req: Request): Promise<number> {
  const removed = await deleteAllSessions();
  await writeAudit(req, { action: 'auth.logout_all', targetType: 'session', details: { sessions: removed } });
  return removed;
}
