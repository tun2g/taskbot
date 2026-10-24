/** Sign-in: login links, the session, other browsers. Logging out is remembered in localStorage. */
import type { AdminSessionRow } from '@tbot/shared';

import { DAY, HOUR, iso, MINUTE, recordAudit } from '../fixtures';
import { HttpError, type Route } from '../http';

const SESSION_KEY = 'tbot-admin:mock-logged-out';

/** In mock mode a link counts as "opened in another browser" this long after it was sent. */
const USED_AFTER_MS = 15_000;

/** Login-link requests of this page load: requestId → when it was sent. */
const requests = new Map<string, number>();

const sessions: AdminSessionRow[] = [
  { id: 'a1b2c3d4e5f6a7b8c9d0e1f2', browser: 'Chrome on Mac', ip: '113.161.42.7', createdAt: iso(2 * HOUR), lastSeenAt: iso(MINUTE), expiresAt: iso(-10 * HOUR), current: true },
  { id: 'f1e2d3c4b5a6f7e8d9c0b1a2', browser: 'Safari on iPhone', ip: '27.72.98.15', createdAt: iso(9 * HOUR), lastSeenAt: iso(5 * HOUR), expiresAt: iso(-3 * HOUR), current: false },
];

const session = () => ({ data: { owner: { telegramUserId: 50_000_000, name: 'Tung Nguyen', username: 'tun2g' }, expiresAt: iso(-7 * DAY) } });

function me() {
  if (localStorage.getItem(SESSION_KEY)) throw new HttpError(401, 'Not logged in.');
  return session();
}

/** Remembers the request so link-status can answer. */
function requestLink() {
  const requestId = `mock-${Date.now()}`;
  requests.set(requestId, Date.now());
  return { data: { sentTo: '@tun2g', expiresInSeconds: 300, requestId } };
}

function exchange(code: unknown) {
  if (code === 'expired') throw new HttpError(401, 'This login link has expired or was already used.');
  localStorage.removeItem(SESSION_KEY);
  return session();
}

function logout() {
  localStorage.setItem(SESSION_KEY, '1');
  return { data: { ok: true } };
}

function linkStatus(requestId: string) {
  const sentAt = requests.get(requestId);
  const status = sentAt == null ? 'expired' : Date.now() - sentAt > USED_AFTER_MS ? 'used' : 'unused';
  return { data: { status } };
}

function revokeSession(id: string) {
  const i = sessions.findIndex((s) => s.id === id);
  if (i >= 0) {
    const [s] = sessions.splice(i, 1);
    recordAudit({
      action: 'auth.session_revoke',
      summary: 'Signed out another browser',
      targetType: 'session',
      targetLabel: null,
      details: { browser: s!.browser, ip: s!.ip },
      changes: [`${s!.browser} · ${s!.ip}`],
    });
  }
  return { data: { ok: true } };
}

export const authRoutes: Route[] = [
  ['GET', /^\/auth\/me$/, () => me()],
  ['POST', /^\/auth\/request-link$/, () => requestLink()],
  ['POST', /^\/auth\/exchange$/, ({ body }) => exchange(body.code)],
  ['POST', /^\/auth\/logout(-all)?$/, () => logout()],
  ['GET', /^\/auth\/link-status$/, ({ q }) => linkStatus(q.get('requestId') ?? '')],
  ['GET', /^\/auth\/sessions$/, () => ({ data: sessions })],
  ['POST', /^\/auth\/sessions\/([^/]+)\/revoke$/, ({ params }) => revokeSession(params[0]!)],
];
