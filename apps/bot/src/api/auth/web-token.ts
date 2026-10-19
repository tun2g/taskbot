import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { configService } from 'src/configs/configuration';

/** Browser login tokens live for 30 days. */
export const WEB_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface WebTokenPayload {
  uid: number;
  exp: number;
}

function signingKey(): Buffer {
  const secret = configService.webAuthSecret || configService.botToken || '';
  // Domain-separated so the key never equals the Telegram login/initData secrets.
  return createHash('sha256').update(`tbot-web-token:${secret}`).digest();
}

function sign(body: string): string {
  return createHmac('sha256', signingKey()).update(body).digest('base64url');
}

/** Stateless token: `base64url(json{uid, exp}).base64url(hmac)`. */
export function signWebToken(telegramUserId: number, now: number = Date.now()): { token: string; expiresAt: Date } {
  const exp = now + WEB_TOKEN_TTL_MS;
  const payload: WebTokenPayload = { uid: telegramUserId, exp };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${body}.${sign(body)}`, expiresAt: new Date(exp) };
}

/** Returns the Telegram user id carried by a valid, unexpired token, or null. */
export function verifyWebToken(token: string, now: number = Date.now()): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<WebTokenPayload>;
    if (typeof payload.uid !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= now) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
