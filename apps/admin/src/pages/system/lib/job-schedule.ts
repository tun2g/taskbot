import type { AdminSystemStatus } from '@tbot/shared';
import { backgroundJobInfo } from '@tbot/shared';

import { formatRelative, formatTimeUtc } from '@/lib/format';

import { describeCron } from './cron';

export type JobRow = AdminSystemStatus['jobs'][number];
export type JobRef = { name: string; cron: string | null };

/**
 * How often the job checks, in words. Jobs that act at a local time per group say so ("Checks every hour; sends
 * at 9:00 local time per group") instead of a bare "Every hour" that contradicts their description.
 */
export function scheduleText(job: Pick<JobRow, 'name' | 'cron'>): { text: string; cron: string | null } {
  if (!job.cron) return { text: 'Only when started', cron: null };
  const info = backgroundJobInfo(job.name, job.cron);
  if (info.schedule) return { text: info.schedule, cron: job.cron };
  return { text: describeCron(job.cron) ?? `cron ${job.cron} (UTC)`, cron: job.cron };
}

/** "Runs again automatically at 10:20 UTC (in 12 min)." — what happens next after a failure. */
export function nextRunSentence(
  nextRunAt: string | null | undefined,
  verb = 'Runs again automatically',
): string | null {
  if (!nextRunAt) return null;
  return `${verb} at ${formatTimeUtc(nextRunAt)} (${formatRelative(nextRunAt)}).`;
}

export const jobRef = (j: Pick<JobRow, 'name' | 'cron'>): JobRef => ({ name: j.name, cron: j.cron });
