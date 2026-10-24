/** System: health, job failures and "Run now". */
import type { AdminJobFailures } from '@tbot/shared';
import { backgroundJobInfo } from '@tbot/shared';

import { JOB_FAILURES, systemStatus } from '../derive/system';
import { nextAt, recordAudit } from '../fixtures';
import type { Route } from '../http';

function jobFailures(name: string | null, cron: string | null): AdminJobFailures {
  return {
    job: name ? { name, cron } : null,
    nextRunAt: name ? nextAt(20, Date.now()) : null,
    failures: JOB_FAILURES.filter((f) => !name || (f.name === name && (!cron || f.cron === cron))),
    olderKept: name ? 12 : 35,
  };
}

function runJob(body: Record<string, unknown>) {
  const name = String(body.name);
  const cron = (body.cron as string | null) ?? null;
  const info = backgroundJobInfo(name, cron);
  recordAudit({
    action: 'system.job.run',
    summary: `Ran “${info.label}” now`,
    targetType: 'system',
    targetLabel: info.label,
    details: { name, cron },
    changes: [info.what],
  });
  return { data: { queuedAt: new Date().toISOString() } };
}

export const systemRoutes: Route[] = [
  ['GET', /^\/system$/, () => ({ data: systemStatus() })],
  ['GET', /^\/system\/jobs\/failures$/, ({ q }) => ({ data: jobFailures(q.get('name'), q.get('cron')) })],
  ['POST', /^\/system\/jobs\/run$/, ({ body }) => runJob(body)],
];
