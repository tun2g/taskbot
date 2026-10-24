/** System health and background jobs — the bot's real schedules (apps/bot/src/index.ts). */
import type { AdminJobFailure, AdminSystemStatus } from '@tbot/shared';

import { HOUR, iso, MINUTE, nextAt } from '../fixtures';

/** When the bot (fixture) last started. */
export const mockBot: AdminSystemStatus['bot'] = { startedAt: iso(3 * 24 * HOUR + 5 * HOUR) };

const ROLLUP_ERROR = 'MongoServerSelectionError: connection timed out after 30000 ms';

/** The hourly stats run failed twice today (matches the jobs list). */
export const JOB_FAILURES: AdminJobFailure[] = [
  { id: '4102', name: 'stats-rollup', cron: '20 * * * *', at: iso(23 * MINUTE), error: ROLLUP_ERROR, attempt: 1 },
  { id: '4087', name: 'stats-rollup', cron: '20 * * * *', at: iso(HOUR + 23 * MINUTE), error: ROLLUP_ERROR, attempt: 1 },
];

function jobs(): AdminSystemStatus['jobs'] {
  return [
    { name: 'due-reminder', cron: '5 * * * *', lastRunAt: iso(38 * MINUTE), lastError: null, lastSuccessAt: iso(38 * MINUTE), failuresLast24h: 0, nextRunAt: nextAt(5) },
    { name: 'daily-digest', cron: '0 * * * *', lastRunAt: iso(43 * MINUTE), lastError: null, lastSuccessAt: iso(43 * MINUTE), failuresLast24h: 0, nextRunAt: nextAt(0) },
    { name: 'stats-rollup', cron: '10 0 * * *', lastRunAt: iso(14 * HOUR), lastError: null, lastSuccessAt: iso(14 * HOUR), failuresLast24h: 0, nextRunAt: iso(-10 * HOUR) },
    {
      name: 'stats-rollup',
      cron: '20 * * * *',
      lastRunAt: iso(23 * MINUTE),
      lastError: ROLLUP_ERROR,
      lastSuccessAt: iso(2 * HOUR + 23 * MINUTE),
      failuresLast24h: 2,
      nextRunAt: nextAt(20),
    },
  ].map((j) => ({ ...j, key: `${j.name}|${j.cron}` }));
}

export function systemStatus(): AdminSystemStatus {
  return {
    mongo: { ok: true, latencyMs: 3 },
    redis: { ok: true, latencyMs: 1 },
    queue: { waiting: 0, active: 0, failed: 37, delayed: 4, completed: 200, failedLast24h: 2, oldestWaitingSeconds: null },
    jobs: jobs(),
    lastEventAt: iso(40_000),
    lastEventByChannel: { telegram: iso(40_000), app: iso(6 * MINUTE), mcp: iso(52 * MINUTE) },
    activity: { lastHour: 46, usualThisHour: 38.4 },
    versions: { adminApi: '0.1.0 (2a69084)' },
    bot: mockBot,
  };
}
