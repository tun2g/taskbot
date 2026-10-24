import type { AdminSessionRow } from '@tbot/shared';
import type { Request } from 'express';
import { describeUserAgent } from 'src/modules/auth/helpers/user-agent';
import { listSessions, revokeSession } from 'src/modules/auth/services/sessions.service';
import { writeAudit } from 'src/shared/audit';
import { HttpError } from 'src/shared/http';

/** Every browser signed in, so the owner can spot one they don't recognise. */
export async function listSessionRows(currentId: string | undefined): Promise<AdminSessionRow[]> {
  return (await listSessions(currentId)).map((s) => ({
    id: s.id,
    browser: describeUserAgent(s.userAgent),
    ip: s.ip ?? null,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt ?? null,
    expiresAt: s.expiresAt,
    current: s.current,
  }));
}

/** Signs out one other browser (by its public id) and records it. */
export async function revokeOtherSession(req: Request, currentId: string | undefined, id: string): Promise<void> {
  const current = (await listSessions(currentId)).find((s) => s.current);
  if (current?.id === id)
    throw new HttpError(400, 'This is the browser you’re using. Use “Log out” in the account menu instead.');
  const session = await revokeSession(id);
  if (!session) throw new HttpError(404, 'That browser is already signed out.');
  await writeAudit(req, {
    action: 'auth.session_revoke',
    targetType: 'session',
    details: { browser: describeUserAgent(session.userAgent), ip: session.ip ?? null },
  });
}
