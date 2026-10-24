/* eslint-disable @typescript-eslint/no-explicit-any */
import * as db from '@tbot/db';
import { createApp } from 'src/app';
import { createSession, SESSION_COOKIE } from 'src/modules/auth/auth.service';
import { setBotQueue } from 'src/modules/system/system.service';
import { setKv } from 'src/shared/redis';
import { chain, fakeQueue, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const mdb = db as unknown as Record<string, any>;
let server: TestServer;
let cookie: string;

beforeAll(async () => {
  server = await startServer(createApp());
  setBotQueue(fakeQueue());
});
afterAll(() => server.close());
beforeEach(async () => {
  setKv(new FakeKv());
  cookie = `${SESSION_COOKIE}=${(await createSession(1001)).id}`;
});

describe('read endpoints on an empty database', () => {
  it.each([
    '/api/overview?range=7d',
    '/api/groups?status=pending,active&q=acme&sort=aiCost',
    '/api/groups?sort=lastActivity',
    '/api/users?sort=events&q=@an',
    '/api/ai/usage?range=30d&groupBy=day',
    '/api/ai/usage?groupBy=group',
    '/api/ai/calls?status=failed',
    '/api/mcp?range=90d',
    '/api/audit-log',
  ])('GET %s → 200 with { data }', async (path) => {
    const res = await server.req('GET', path, { cookie });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });

  it('overview has the full contract shape', async () => {
    mdb.Group.aggregate.mockResolvedValueOnce([{ _id: 'pending', n: 2 }]);
    const res = await server.req('GET', '/api/overview?range=7d', { cookie });
    const o = res.body.data;
    expect(o.range).toBe('7d');
    expect(o.daily).toHaveLength(7);
    expect(o.groupsByStatus.pending).toBe(2);
    expect(o.kpis).toMatchObject({ dau: 0, wau: 0, mau: 0, activeGroups: { value: 0, previous: 0 } });
    expect(o.aiToday).toEqual({ costUsd: 0, calls: 0, blocked: 0, budgetUsd: null, callLimit: null });
  });

  it('ai/usage by day fills every day of the range', async () => {
    const res = await server.req('GET', '/api/ai/usage?range=7d&groupBy=day', { cookie });
    expect(res.body.data.rows).toHaveLength(7);
    expect(res.body.data.totals.calls).toBe(0);
  });

  it('ai/calls maps aiModel to model and paginates', async () => {
    mdb.AiCall.countDocuments.mockResolvedValueOnce(1);
    mdb.AiCall.find.mockReturnValueOnce(
      chain([{ _id: '0123456789abcdef01234567', createdAt: new Date(), feature: 'planner', provider: 'gemini', aiModel: 'gemini-x', status: 'ok' }]),
    );
    const res = await server.req('GET', '/api/ai/calls', { cookie });
    expect(res.body.data[0]).toMatchObject({ model: 'gemini-x', attempt: 1, priced: true, group: null, person: null });
    expect(res.body.meta).toEqual({ page: 1, limit: 50, total: 1, hasMore: false });
  });

  it('rejects bad id filters with 400', async () => {
    expect((await server.req('GET', '/api/ai/usage?groupId=nope', { cookie })).status).toBe(400);
  });

  it('system status reports Mongo down, Redis up and queue counts', async () => {
    setBotQueue({
      getJobCounts: async () => ({ waiting: 1, active: 0, failed: 2, delayed: 3, completed: 4 }),
      getRepeatableJobs: async () => [{ name: 'daily-digest', cron: '0 * * * *' }],
      getCompleted: async () => [],
      getFailed: async () => [],
    } as any);
    const res = await server.req('GET', '/api/system', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.data.mongo.ok).toBe(false);
    expect(res.body.data.redis.ok).toBe(true);
    expect(res.body.data.queue).toEqual({ waiting: 1, active: 0, failed: 2, delayed: 3, completed: 4, failedLast24h: 0, oldestWaitingSeconds: null });
    expect(res.body.data.jobs).toEqual([
      { name: 'daily-digest', cron: '0 * * * *', lastRunAt: null, lastError: null, key: 'daily-digest|0 * * * *', lastSuccessAt: null, failuresLast24h: 0, nextRunAt: null },
    ]);
    expect(res.body.data.versions.adminApi).toBe('0.1.0');
  });

  it('unknown API path → 404 JSON', async () => {
    const res = await server.req('GET', '/api/nope', { cookie });
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });

  it('health needs no session', async () => {
    const res = await server.req('GET', '/api/health');
    expect(res.status).toBe(200);
  });
});
