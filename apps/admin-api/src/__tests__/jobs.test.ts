/* eslint-disable @typescript-eslint/no-explicit-any */
import * as db from '@tbot/db';
import { createApp } from 'src/app';
import { createSession, SESSION_COOKIE } from 'src/modules/auth/auth.service';
import { setBotQueue } from 'src/modules/system/system.service';
import { setKv } from 'src/shared/redis';
import { fakeQueue, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const mdb = db as unknown as Record<string, any>;
let server: TestServer;
let cookie: string;

const NOW = Date.now();
const HOURLY = '20 * * * *';
const DAILY = '10 0 * * *';
const failedJob = (id: number, minutesAgo: number, cron: string | null, error: string, attemptsMade = 1) => ({
  id,
  name: 'stats-rollup',
  finishedOn: NOW - minutesAgo * 60_000,
  failedReason: error,
  attemptsMade,
  opts: cron ? { repeat: { cron } } : {},
  data: cron ? {} : { schedule: HOURLY, ranFromAdmin: true },
});

beforeAll(async () => {
  server = await startServer(createApp());
});
afterAll(() => server.close());
beforeEach(async () => {
  setKv(new FakeKv());
  cookie = `${SESSION_COOKIE}=${(await createSession(1001)).id}`;
});

describe('GET /system/jobs/failures', () => {
  it('lists the failed runs of one schedule in the last 24 h, newest first, with when it runs again', async () => {
    setBotQueue(
      fakeQueue({
        getFailed: async () => [
          failedJob(1, 30, HOURLY, 'MongoServerSelectionError: timed out', 2),
          failedJob(2, 90, DAILY, 'other schedule'),
          failedJob(3, 5, null, 'manual run failed'),
          failedJob(4, 3 * 24 * 60, HOURLY, 'old'),
        ],
        getRepeatableJobs: async () => [
          { name: 'stats-rollup', cron: HOURLY, next: NOW + 10 * 60_000 },
          { name: 'stats-rollup', cron: DAILY, next: NOW + 5 * 3600_000 },
        ],
      }),
    );
    const res = await server.req(
      'GET',
      `/api/system/jobs/failures?name=stats-rollup&cron=${encodeURIComponent(HOURLY)}`,
      { cookie },
    );
    expect(res.status).toBe(200);
    expect(res.body.data.failures.map((f: any) => [f.id, f.error, f.attempt, f.cron])).toEqual([
      ['3', 'manual run failed', 1, HOURLY],
      ['1', 'MongoServerSelectionError: timed out', 2, HOURLY],
    ]);
    expect(res.body.data.olderKept).toBe(1);
    expect(res.body.data.nextRunAt).toBe(new Date(NOW + 10 * 60_000).toISOString());
  });

  it('answers 503 when the queue is unreachable', async () => {
    setBotQueue(fakeQueue({ getFailed: async () => Promise.reject(new Error('ECONNREFUSED')) }));
    const res = await server.req('GET', '/api/system/jobs/failures', { cookie });
    expect(res.status).toBe(503);
  });
});

describe('POST /system/jobs/run', () => {
  it('queues one run with the schedule’s own input and audits it', async () => {
    const add = jest.fn(async () => ({ id: 9 }));
    setBotQueue(
      fakeQueue({
        getRepeatableJobs: async () => [{ name: 'stats-rollup', cron: DAILY }],
        getDelayed: async () => [{ name: 'stats-rollup', data: { mode: 'daily' }, opts: { repeat: { cron: DAILY } } }],
        add,
      }),
    );
    const res = await server.req('POST', '/api/system/jobs/run', {
      body: { name: 'stats-rollup', cron: DAILY },
      cookie,
    });
    expect(res.status).toBe(200);
    expect(add).toHaveBeenCalledWith(
      'stats-rollup',
      { mode: 'daily', schedule: DAILY, ranFromAdmin: true },
      expect.objectContaining({ removeOnFail: 200 }),
    );
    expect(mdb.AdminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'system.job.run',
        targetType: 'system',
        targetLabel: 'Dashboard numbers — daily close',
      }),
    );
  });

  it('refuses a job the bot does not schedule', async () => {
    const add = jest.fn();
    setBotQueue(
      fakeQueue({
        getRepeatableJobs: async () => [{ name: 'daily-digest', cron: '0 * * * *' }],
        getDelayed: async () => [],
        add,
      }),
    );
    const res = await server.req('POST', '/api/system/jobs/run', { body: { name: 'evil', cron: '* * * * *' }, cookie });
    expect(res.status).toBe(404);
    expect(add).not.toHaveBeenCalled();
  });
});
