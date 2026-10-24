import { getKv } from 'src/shared/redis';
import { randomToken, secretHash, TOKEN_FORMAT } from 'src/auth/tokens';

export const LOGIN_CODE_TTL_SECONDS = 5 * 60;

const loginKey = (hash: string) => `admin:login:${hash}`;
/** Whether the link sent for one "Send login link" request was used — so the waiting page can say so. */
const loginRequestKey = (hash: string) => `admin:loginreq:${hash}`;

/**
 * A one-time code for the link, plus a separate request id for the browser that asked. The request id only
 * answers "was the link used?" — it can never be traded for a session.
 */
export async function createLoginCode(): Promise<{ code: string; requestId: string }> {
  const code = randomToken();
  const requestId = randomToken();
  const request = secretHash(requestId);
  await getKv().setEx(
    loginKey(secretHash(code)),
    LOGIN_CODE_TTL_SECONDS,
    JSON.stringify({ createdAt: new Date().toISOString(), request }),
  );
  await getKv().setEx(loginRequestKey(request), LOGIN_CODE_TTL_SECONDS, 'unused');
  return { code, requestId };
}

/** True once per valid, unexpired code (atomic GETDEL — a second use or a racing request gets false). */
export async function consumeLoginCode(code: string): Promise<boolean> {
  if (!TOKEN_FORMAT.test(code)) return false;
  const raw = await getKv().getDel(loginKey(secretHash(code)));
  if (raw === null) return false;
  try {
    const { request } = JSON.parse(raw) as { request?: string };
    if (request) await getKv().setEx(loginRequestKey(request), LOGIN_CODE_TTL_SECONDS, 'used');
  } catch {
    /* an older code without a request id */
  }
  return true;
}

/** "used" once the link of this request was opened (in any browser), "expired" when unknown or too old. */
export async function loginLinkStatus(requestId: string): Promise<'unused' | 'used' | 'expired'> {
  if (!TOKEN_FORMAT.test(requestId)) return 'expired';
  const v = await getKv().get(loginRequestKey(secretHash(requestId)));
  return v === 'used' ? 'used' : v === 'unused' ? 'unused' : 'expired';
}

export async function discardLoginCode(code: string): Promise<void> {
  await getKv().del(loginKey(secretHash(code)));
}
