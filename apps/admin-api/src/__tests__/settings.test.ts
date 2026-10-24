/* eslint-disable @typescript-eslint/no-explicit-any */
import * as db from '@tbot/db';
import { createApp } from 'src/app';
import { createSession, SESSION_COOKIE } from 'src/auth/auth.service';
import { setKv } from 'src/shared/redis';
import { chain, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const mdb = db as unknown as Record<string, any>;
let server: TestServer;
let cookie: string;

const valid = {
  dailyCallLimit: 500,
  dailyBudgetUsd: 2.5,
  alertAtPercent: 80,
  userDailyLimit: null,
  pricing: { 'gemini-3.5-flash-lite': { input: 0.1, cachedInput: 0.025, output: 0.4 } },
};

beforeAll(async () => {
  server = await startServer(createApp());
});
afterAll(() => server.close());
beforeEach(async () => {
  setKv(new FakeKv());
  cookie = `${SESSION_COOKIE}=${(await createSession(1001)).id}`;
});

describe('GET /settings/ai', () => {
  it('returns defaults when nothing is stored', async () => {
    const res = await server.req('GET', '/api/settings/ai', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dailyCallLimit: null, dailyBudgetUsd: null, alertAtPercent: 80, userDailyLimit: null, pricing: {} });
    expect(res.body.data.defaults).toMatchObject({ provider: expect.any(String), model: expect.any(String), envDailyCallLimit: 0, userDailyLimit: 100 });
  });

  it('merges stored values', async () => {
    mdb.Setting.findOne.mockReturnValueOnce(chain({ key: 'ai', value: { dailyBudgetUsd: 3 } }));
    const res = await server.req('GET', '/api/settings/ai', { cookie });
    expect(res.body.data.dailyBudgetUsd).toBe(3);
    expect(res.body.data.alertAtPercent).toBe(80);
  });
});

describe('PUT /settings/ai', () => {
  it.each([
    ['negative call limit', { dailyCallLimit: -1 }],
    ['fractional call limit', { dailyCallLimit: 1.5 }],
    ['negative budget', { dailyBudgetUsd: -0.01 }],
    ['alert 0%', { alertAtPercent: 0 }],
    ['alert 101%', { alertAtPercent: 101 }],
    ['budget as text', { dailyBudgetUsd: '5' }],
    ['bad model id', { pricing: { 'gpt 5; drop': { input: 1, output: 1 } } }],
    ['negative price', { pricing: { 'gpt-5': { input: -1, output: 1 } } }],
    ['unknown price field', { pricing: { 'gpt-5': { input: 1, output: 1, extra: 2 } } }],
    ['missing field', { alertAtPercent: undefined }],
  ])('rejects %s', async (_label, patch) => {
    const res = await server.req('PUT', '/api/settings/ai', { body: { ...valid, ...patch }, cookie });
    expect(res.status).toBe(400);
    expect(typeof res.body.message).toBe('string');
    expect(mdb.Setting.updateOne).not.toHaveBeenCalled();
  });

  it('saves valid settings, audits before/after and says when the bot applies them', async () => {
    const res = await server.req('PUT', '/api/settings/ai', { body: { ...valid, defaults: { ignored: true } }, cookie });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ ...valid, appliesWithinSeconds: 30 });
    expect(mdb.Setting.updateOne).toHaveBeenCalledWith({ key: 'ai' }, { $set: { value: valid } }, { upsert: true });
    const audit = mdb.AdminAuditLog.create.mock.calls[0][0];
    expect(audit).toMatchObject({ action: 'settings.ai.update', targetType: 'settings' });
    expect(audit.details.after).toEqual(valid);
  });
});
