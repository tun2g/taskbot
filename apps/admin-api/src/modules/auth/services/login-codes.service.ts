import { randomToken, secretHash, TOKEN_FORMAT } from 'src/modules/auth/helpers/tokens';
import {
  deleteLoginCode,
  findLoginRequestStatus,
  saveLoginCode,
  saveLoginRequestStatus,
  takeLoginCode,
} from 'src/modules/auth/repositories/login-codes.repository';

export const LOGIN_CODE_TTL_SECONDS = 5 * 60;

/**
 * A one-time code for the link, plus a separate request id for the browser that asked. The request id only
 * answers "was the link used?" — it can never be traded for a session.
 */
export async function createLoginCode(): Promise<{ code: string; requestId: string }> {
  const code = randomToken();
  const requestId = randomToken();
  const request = secretHash(requestId);
  await saveLoginCode(
    secretHash(code),
    LOGIN_CODE_TTL_SECONDS,
    JSON.stringify({ createdAt: new Date().toISOString(), request }),
  );
  await saveLoginRequestStatus(request, LOGIN_CODE_TTL_SECONDS, 'unused');
  return { code, requestId };
}

/** True once per valid, unexpired code (atomic GETDEL — a second use or a racing request gets false). */
export async function consumeLoginCode(code: string): Promise<boolean> {
  if (!TOKEN_FORMAT.test(code)) return false;
  const raw = await takeLoginCode(secretHash(code));
  if (raw === null) return false;
  try {
    const { request } = JSON.parse(raw) as { request?: string };
    if (request) await saveLoginRequestStatus(request, LOGIN_CODE_TTL_SECONDS, 'used');
  } catch {
    /* an older code without a request id */
  }
  return true;
}

/** "used" once the link of this request was opened (in any browser), "expired" when unknown or too old. */
export async function loginLinkStatus(requestId: string): Promise<'unused' | 'used' | 'expired'> {
  if (!TOKEN_FORMAT.test(requestId)) return 'expired';
  const v = await findLoginRequestStatus(secretHash(requestId));
  return v === 'used' ? 'used' : v === 'unused' ? 'unused' : 'expired';
}

export async function discardLoginCode(code: string): Promise<void> {
  await deleteLoginCode(secretHash(code));
}
