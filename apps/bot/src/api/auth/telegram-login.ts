import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Login Widget payloads older than this are rejected. */
export const TELEGRAM_LOGIN_MAX_AGE_SECONDS = 24 * 60 * 60;

export type TelegramLoginCheck = 'ok' | 'invalid' | 'expired';

/**
 * Verify a Telegram Login Widget payload (https://core.telegram.org/widgets/login#checking-authorization).
 * secret = SHA256(botToken); data_check_string = sorted `key=value` lines of every field except `hash`.
 */
export function verifyTelegramLogin(
  payload: Record<string, unknown>,
  botToken: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): TelegramLoginCheck {
  const hash = payload.hash;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) return 'invalid';

  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== 'hash' && payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join('\n');

  const secret = createHash('sha256').update(botToken).digest();
  const expected = Buffer.from(createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  const given = Buffer.from(hash.toLowerCase());
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return 'invalid';
  if (nowSeconds - authDate > TELEGRAM_LOGIN_MAX_AGE_SECONDS) return 'expired';

  return 'ok';
}
