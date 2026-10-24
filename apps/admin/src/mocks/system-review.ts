/**
 * Mock answers for the System / Audit / Settings / sign-in endpoints added in the system review (job failures,
 * "Run now", sessions, link status, settings restore). Stateful in memory like the rest of the mock adapter.
 */
import type { AdminAuditEntry, AdminJobFailures, AdminSessionRow, AdminSystemStatus } from '@tbot/shared';
import { aiSettingsChangeLines, backgroundJobInfo } from '@tbot/shared';

import { auditLog, iso, settings } from './fixtures';

type Handler = (ctx: { q: URLSearchParams; body: Record<string, unknown>; params: string[] }) => unknown;

const MIN = 60_000;
const HOUR = 60 * MIN;

/** The hourly stats run failed twice today (matches the System fixture). */
const FAILURES = [
  {
    id: '4102',
    name: 'stats-rollup',
    cron: '20 * * * *',
    at: iso(23 * MIN),
    error: 'MongoServerSelectionError: connection timed out after 30000 ms',
    attempt: 1,
  },
  {
    id: '4087',
    name: 'stats-rollup',
    cron: '20 * * * *',
    at: iso(HOUR + 23 * MIN),
    error: 'MongoServerSelectionError: connection timed out after 30000 ms',
    attempt: 1,
  },
];

const sessions: AdminSessionRow[] = [
  {
    id: 'a1b2c3d4e5f6a7b8c9d0e1f2',
    browser: 'Chrome on Mac',
    ip: '113.161.42.7',
    createdAt: iso(2 * HOUR),
    lastSeenAt: iso(MIN),
    expiresAt: iso(-10 * HOUR),
    current: true,
  },
  {
    id: 'f1e2d3c4b5a6f7e8d9c0b1a2',
    browser: 'Safari on iPhone',
    ip: '27.72.98.15',
    createdAt: iso(9 * HOUR),
    lastSeenAt: iso(5 * HOUR),
    expiresAt: iso(-3 * HOUR),
    current: false,
  },
];

const requests = new Map<string, number>();
/** In mock mode a link counts as "opened in another browser" this long after it was sent. */
const USED_AFTER_MS = 15_000;

function audit(entry: Omit<AdminAuditEntry, 'id' | 'at' | 'targetId' | 'reason'> & { targetId?: string | null }) {
  auditLog.unshift({ id: `mock-${Date.now()}`, at: new Date().toISOString(), reason: null, targetId: null, ...entry });
}

export const systemReviewRoutes: [string, RegExp, Handler][] = [
  [
    'GET',
    /^\/system\/jobs\/failures$/,
    ({ q }) => {
      const name = q.get('name');
      const cron = q.get('cron');
      const rows = FAILURES.filter((f) => !name || (f.name === name && (!cron || f.cron === cron)));
      const data: AdminJobFailures = {
        job: name ? { name, cron } : null,
        nextRunAt: name ? nextAt(20) : null,
        failures: rows,
        olderKept: name ? 12 : 35,
      };
      return { data };
    },
  ],
  [
    'POST',
    /^\/system\/jobs\/run$/,
    ({ body }) => {
      const name = String(body.name);
      const cron = (body.cron as string | null) ?? null;
      audit({
        action: 'system.job.run',
        summary: `Ran “${backgroundJobInfo(name, cron).label}” now`,
        targetType: 'system',
        targetLabel: backgroundJobInfo(name, cron).label,
        details: { name, cron },
        changes: [backgroundJobInfo(name, cron).what],
      });
      return { data: { queuedAt: new Date().toISOString() } };
    },
  ],
  [
    'GET',
    /^\/auth\/link-status$/,
    ({ q }) => {
      const sentAt = requests.get(q.get('requestId') ?? '');
      const status = sentAt == null ? 'expired' : Date.now() - sentAt > USED_AFTER_MS ? 'used' : 'unused';
      return { data: { status } };
    },
  ],
  ['GET', /^\/auth\/sessions$/, () => ({ data: sessions })],
  [
    'POST',
    /^\/auth\/sessions\/([^/]+)\/revoke$/,
    ({ params }) => {
      const i = sessions.findIndex((s) => s.id === params[0]);
      if (i >= 0) {
        const [s] = sessions.splice(i, 1);
        audit({
          action: 'auth.session_revoke',
          summary: 'Signed out another browser',
          targetType: 'session',
          targetLabel: null,
          details: { browser: s!.browser, ip: s!.ip },
          changes: [`${s!.browser} · ${s!.ip}`],
        });
      }
      return { data: { ok: true } };
    },
  ],
];

/** POST /auth/request-link in mock mode: remembers the request so link-status can answer. */
export function mockRequestLink() {
  const requestId = `mock-${Date.now()}`;
  requests.set(requestId, Date.now());
  return { data: { sentTo: '@tun2g', expiresInSeconds: 300, requestId } };
}

/** PUT /settings/ai in mock mode: saves and writes the same audit lines the API would. */
export function mockSaveSettings(body: Record<string, unknown>) {
  const before = { ...settings, defaults: undefined };
  const { restoredFrom, ...values } = body;
  Object.assign(settings, values, { defaults: settings.defaults, lastChangedAt: new Date().toISOString() });
  audit({
    action: restoredFrom ? 'settings.ai.restore' : 'settings.ai.update',
    summary: restoredFrom ? 'Restored earlier AI settings' : 'Changed AI settings',
    targetType: 'settings',
    targetLabel: 'AI settings',
    details: { before, after: values, ...(restoredFrom ? { restoredFrom } : {}) },
    changes: aiSettingsChangeLines(before, values, settings.defaults.builtInPricing),
  });
  return { data: settings };
}

/** When the bot (fixture) last started. */
export const mockBot: AdminSystemStatus['bot'] = { startedAt: iso(3 * 24 * HOUR + 5 * HOUR) };

function nextAt(minute: number) {
  const d = new Date();
  d.setUTCMinutes(minute, 0, 0);
  if (d.getTime() <= Date.now()) d.setUTCHours(d.getUTCHours() + 1);
  return d.toISOString();
}
