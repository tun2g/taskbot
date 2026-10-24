import { getKv } from 'src/shared/redis';

const loginKey = (hash: string) => `admin:login:${hash}`;
/** Whether the link sent for one "Send login link" request was used — so the waiting page can say so. */
const loginRequestKey = (hash: string) => `admin:loginreq:${hash}`;

export async function saveLoginCode(codeHash: string, ttlSeconds: number, json: string): Promise<void> {
  await getKv().setEx(loginKey(codeHash), ttlSeconds, json);
}

/** Reads and deletes a login code in one step (atomic GETDEL). */
export async function takeLoginCode(codeHash: string): Promise<string | null> {
  return getKv().getDel(loginKey(codeHash));
}

export async function deleteLoginCode(codeHash: string): Promise<void> {
  await getKv().del(loginKey(codeHash));
}

export async function saveLoginRequestStatus(
  requestHash: string,
  ttlSeconds: number,
  status: 'unused' | 'used',
): Promise<void> {
  await getKv().setEx(loginRequestKey(requestHash), ttlSeconds, status);
}

export async function findLoginRequestStatus(requestHash: string): Promise<string | null> {
  return getKv().get(loginRequestKey(requestHash));
}
