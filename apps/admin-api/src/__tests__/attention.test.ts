/* eslint-disable @typescript-eslint/no-explicit-any */
import * as db from '@tbot/db';
import { GroupStatus } from '@tbot/shared';
import { createApp } from 'src/app';
import { createSession, SESSION_COOKIE } from 'src/auth/auth.service';
import { setBotQueue } from 'src/routes/system.routes';
import { setKv } from 'src/shared/redis';
import { AttentionInput, buildAttention, findSpikes, unusualRate } from 'src/stats/attention';
import { chain, fakeQueue, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const mdb = db as unknown as Record<string, any>;
const G1 = '0123456789abcdef01234567';
const acme = { id: G1, name: 'Acme', status: GroupStatus.ACTIVE };

/** A quiet, healthy day: nothing to act on. */
function calm(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    ai: { providerCalls: 200, failed: 4, invalid: 2, quota: 0, disabled: 0 },
    aiNorm: { calls: 1400, failed: 42 },
    callLimit: 500,
    rateLimited: { total: 3, mcp: 0, topGroup: null },
    pending: { count: 0, oldest: null },
    jobs: [{ name: 'due-reminder', cron: '5 * * * *', lastRunAt: '2026-10-24T10:05:00Z', lastError: null }],
    spikes: [],
    mcp: { calls: 40, failed: 1 },
    mcpNorm: { calls: 300, failed: 6 },
    ...over,
  };
}

describe('buildAttention rules', () => {
  it('is empty on a normal day', () => {
    expect(buildAttention(calm())).toEqual([]);
  });

  it('flags an AI failure rate well above the 7-day norm, and links to the failed calls', () => {
    const [item] = buildAttention(calm({ ai: { providerCalls: 100, failed: 15, invalid: 5, quota: 0, disabled: 0 } }));
    expect(item).toMatchObject({ kind: 'ai_failures', severity: 'warn', link: '/ai?range=7d&status=failed' });
    expect(item!.title).toBe('20% of AI calls didn’t work today');
    expect(item!.detail).toContain('usually 3%');
  });

  it('does not flag a high rate that is normal for this bot, or too few calls to judge', () => {
    expect(buildAttention(calm({ ai: { providerCalls: 100, failed: 12, invalid: 0, quota: 0, disabled: 0 }, aiNorm: { calls: 700, failed: 70 } }))).toEqual([]);
    expect(buildAttention(calm({ ai: { providerCalls: 5, failed: 4, invalid: 0, quota: 0, disabled: 0 } }))).toEqual([]);
  });

  it('a 30%+ failure rate is danger', () => {
    expect(buildAttention(calm({ ai: { providerCalls: 50, failed: 20, invalid: 0, quota: 0, disabled: 0 } }))[0]!.severity).toBe('danger');
  });

  it('daily limit used up = AI stopped for everyone (danger), linking to the refused requests', () => {
    const [item] = buildAttention(calm({ ai: { providerCalls: 500, failed: 4, invalid: 0, quota: 37, disabled: 0 } }));
    expect(item).toMatchObject({ kind: 'refused', severity: 'danger', link: '/ai?range=7d&status=quota' });
    expect(item!.title).toContain('until midnight UTC');
    expect(item!.detail).toContain('37 AI requests refused');
  });

  it('owner-disabled AI refusals are not an anomaly; rate limiting is from 20 requests', () => {
    expect(buildAttention(calm({ ai: { providerCalls: 200, failed: 4, invalid: 0, quota: 0, disabled: 80 } }))).toEqual([]);
    const [item] = buildAttention(calm({ rateLimited: { total: 25, mcp: 20, topGroup: { group: acme, count: 25 } } }));
    expect(item).toMatchObject({ kind: 'refused', severity: 'warn', link: '/mcp?range=7d' });
    expect(item!.detail).toContain('most in “Acme”');
    const [chat] = buildAttention(calm({ rateLimited: { total: 25, mcp: 0, topGroup: { group: acme, count: 25 } } }));
    expect(chat!.link).toBe(`/groups/${G1}`);
  });

  it('pending groups waiting over a day', () => {
    const [one] = buildAttention(calm({ pending: { count: 1, oldest: { name: 'Book Club', hours: 30 } } }));
    expect(one).toMatchObject({ kind: 'pending_groups', link: '/groups?status=pending' });
    expect(one!.title).toBe('“Book Club” has waited 30 hours for your approval');
    const [many] = buildAttention(calm({ pending: { count: 3, oldest: { name: 'Book Club', hours: 80 } } }));
    expect(many!.title).toBe('3 groups have waited over a day for your approval');
  });

  it('failed background jobs use the job’s plain name, and come first (danger)', () => {
    const items = buildAttention(
      calm({
        pending: { count: 1, oldest: { name: 'Book Club', hours: 30 } },
        jobs: [{ name: 'due-reminder', cron: '5 * * * *', lastRunAt: 'x', lastError: 'Mongo timeout' }],
      }),
    );
    expect(items[0]).toMatchObject({ kind: 'failed_jobs', severity: 'danger', link: '/system' });
    expect(items[0]!.title).toBe('“Due-date reminders” failed on its last run');
    expect(items[0]!.detail).toContain('Mongo timeout');
    expect(items[1]!.kind).toBe('pending_groups');
  });

  it('an unreachable queue is reported', () => {
    expect(buildAttention(calm({ jobs: null }))[0]).toMatchObject({ kind: 'failed_jobs', severity: 'danger' });
  });

  it('AI spikes link to that group’s AI calls; MCP error rate links to MCP', () => {
    const items = buildAttention(calm({ spikes: [{ group: acme, calls: 120, average: 20 }], mcp: { calls: 50, failed: 8 } }));
    expect(items.map((i) => i.kind)).toEqual(['ai_spike', 'mcp_errors']);
    expect(items[0]!.link).toBe(`/ai?range=7d&groupId=${G1}`);
    expect(items[0]!.detail).toContain('usually about 20 a day');
    expect(items[1]!.link).toBe('/mcp?range=7d');
  });
});

describe('spike and rate helpers', () => {
  it('findSpikes uses the bot’s rule: > 5× the 7-day daily average and > 30 calls', () => {
    const today = new Map([
      ['a', 120],
      ['b', 70],
      ['c', 25],
    ]);
    expect(findSpikes(today, new Map([['a', 140], ['b', 140]]))).toEqual([{ groupId: 'a', calls: 120, average: 20 }]);
  });

  it('unusualRate without a norm only needs the 10% floor', () => {
    expect(unusualRate(20, 2, { calls: 0, failed: 0 })).toEqual({ rate: 0.1, normRate: null });
    expect(unusualRate(20, 1, { calls: 0, failed: 0 })).toBeNull();
  });
});

describe('GET /overview → attention', () => {
  let server: TestServer;
  let cookie: string;
  beforeAll(async () => {
    server = await startServer(createApp());
  });
  afterAll(() => server.close());
  beforeEach(async () => {
    setKv(new FakeKv());
    cookie = `${SESSION_COOKIE}=${(await createSession(1001)).id}`;
  });
  afterEach(() => {
    mdb.AiCall.aggregate.mockImplementation(async () => []);
    mdb.Group.find.mockImplementation(() => chain([]));
    mdb.Group.countDocuments.mockImplementation(async () => 0);
  });

  it('is an empty list on a quiet day', async () => {
    setBotQueue(fakeQueue());
    const res = await server.req('GET', '/api/overview?range=7d', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.data.attention).toEqual([]);
  });

  it('reports a failing job, failed AI calls and a group waiting for approval', async () => {
    setBotQueue(
      fakeQueue({
        getRepeatableJobs: async () => [{ name: 'daily-digest', cron: '0 * * * *' }],
        getFailed: async () => [{ name: 'daily-digest', finishedOn: Date.now() - 1000, failedReason: 'Telegram 429', opts: { repeat: { cron: '0 * * * *' } } }],
      }),
    );
    mdb.AiCall.aggregate.mockImplementation(async (pipeline: any[]) => {
      const id = pipeline[1]?.$group?._id;
      if (id && id.g === '$groupId' && id.s === '$status') {
        return [
          { _id: { g: null, s: 'ok' }, n: 30 },
          { _id: { g: null, s: 'failed' }, n: 20 },
        ];
      }
      return [];
    });
    mdb.Group.countDocuments.mockImplementation(async (q: any) => (q?.status === 'pending' ? 1 : 0));
    mdb.Group.find.mockImplementation((q: any) =>
      chain(q?.status === 'pending' && q.addedAt ? [{ groupName: 'Book Club', addedAt: new Date(Date.now() - 30 * 3_600_000) }] : []),
    );
    const res = await server.req('GET', '/api/overview?range=7d', { cookie });
    const kinds = res.body.data.attention.map((a: any) => a.kind);
    expect(kinds).toEqual(['failed_jobs', 'ai_failures', 'pending_groups']);
    expect(res.body.data.attention[0].title).toBe('“Morning digest” failed on its last run');
    expect(res.body.data.attention[1].title).toBe('40% of AI calls didn’t work today');
  });
});

describe('drill-downs added for MCP and people', () => {
  let server: TestServer;
  let cookie: string;
  beforeAll(async () => {
    server = await startServer(createApp());
  });
  afterAll(() => server.close());
  beforeEach(async () => {
    jest.clearAllMocks();
    setKv(new FakeKv());
    cookie = `${SESSION_COOKIE}=${(await createSession(1001)).id}`;
  });

  it('/mcp?tool=&client= narrows every call number to that tool and client', async () => {
    const res = await server.req('GET', '/api/mcp?range=7d&tool=list_tasks&client=Unknown%20client', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.data.filter).toEqual({ tool: 'list_tasks', client: 'Unknown client' });
    const matches = mdb.UsageEvent.aggregate.mock.calls.map((c: any[]) => c[0][0].$match);
    const toolMatches = matches.filter((m: any) => m.kind === 'mcp_tool');
    expect(toolMatches.length).toBeGreaterThan(0);
    expect(toolMatches.every((m: any) => m.name === 'list_tasks' && m.client === null)).toBe(true);
    expect(res.body.data).toMatchObject({ byGroup: [], rateLimitedBy: [], tokens: [] });
  });

  it('/users?hasTokens=1 keeps only people with an active MCP token', async () => {
    mdb.ApiToken.distinct.mockResolvedValueOnce([G1]);
    const res = await server.req('GET', '/api/users?hasTokens=1&sort=tokens', { cookie });
    expect(res.status).toBe(200);
    expect(mdb.User.countDocuments.mock.calls[0][0]._id.$in.map(String)).toEqual([G1]);
  });
});
