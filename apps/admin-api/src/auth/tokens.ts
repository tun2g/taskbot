import { createHmac, randomBytes } from 'node:crypto';
import { config } from 'src/config/configuration';

/**
 * Keyed SHA-256 of a secret value. Redis only ever holds hashes of login codes and session ids, so reading
 * Redis (or a backup of it) doesn't give a usable link or cookie.
 */
export function secretHash(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

/** 32 random bytes, base64url (43 characters): login codes, request ids and session ids. */
export const randomToken = () => randomBytes(32).toString('base64url');
export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
