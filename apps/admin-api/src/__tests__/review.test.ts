/* eslint-disable @typescript-eslint/no-explicit-any */
import * as db from '@tbot/db';
import { createApp } from 'src/app';
import { createSession, SESSION_COOKIE } from 'src/auth/auth.service';
import { setBotQueue } from 'src/routes/system.routes';
import { activeSince } from 'src/routes/users.routes';
import { auditChanges } from 'src/shared/audit';
import { setKv } from 'src/shared/redis';
import { chain, fakeQueue, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const mdb = db as unknown as Record<string, any>;
let server: TestServer;
let cookie: string;
const G1 = '0123456789abcdef01234567';
const G2 = '0123456789abcdef01234568';

beforeAll(async () => {
  server = await startServer(createApp());
  setBotQueue(fakeQueue());
});
afterAll(() => server.close());
beforeEach(async () => {
  jest.clearAllMocks();
  setKv(new FakeKv());
  cookie = `${SESSION_COOKIE}=${(await createSession(1001)).id}`;
});

describe('auditChanges — readable "what changed" lines', () => {
  it('describes AI override changes', () => {
    expect(auditChanges('group.ai', { before: { disabled: false, dailyLimit: null }, after: { disabled: true, dailyLimit: 50 } })).toEqual([
      'AI turned off',
      'Daily AI limit: default → 50',
    ]);
  });

  it('describes settings changes, including prices', () => {
    const lines = auditChanges('settings.ai.update', {
      before: { dailyCallLimit: 500, dailyBudgetUsd: null, alertAtPercent: 80, userDailyLimit: null, pricing: { a: { input: 1, output: 2 } } },
      after: { dailyCallLimit: 200, dailyBudgetUsd: 5, alertAtPercent: 80, userDailyLimit: null, pricing: { b: { input: 1, output: 2 } } },
    });
    expect(lines).toEqual(['Daily budget: none → $5.00', 'Daily call limit: 500 → 200', 'Price removed for a', 'Price added for b']);
  });

  it('describes a delete and Telegram problems', () => {
    expect(auditChanges('group.delete', { tasks: 12, epics: 1, members: 3, activities: 0, tokens: 2, warnings: ['Bot still in chat'] })).toEqual([
      'Removed 12 tasks, 1 epic, 3 member links and 0 activity entries; revoked 2 MCP tokens',
      'Bot still in chat',
    ]);
    expect(auditChanges('group.reject', { notifiedGroup: false, botLeft: false })).toEqual([
      'The group was not told in Telegram',
      'The bot could not leave the chat',
    ]);
    expect(auditChanges('auth.login', null)).toEqual([]);
  });
});

describe('activeSince — DAU / WAU / MAU windows', () => {
  const now = new Date('2026-10-24T15:00:00Z');
  it.each([
    ['today', '2026-10-24T00:00:00.000Z'],
    ['7d', '2026-10-18T00:00:00.000Z'],
    ['30d', '2026-09-25T00:00:00.000Z'],
  ])('%s starts at %s', (v, iso) => expect(activeSince(v, now)?.toISOString()).toBe(iso));
  it('ignores anything else', () => expect(activeSince('1y', now)).toBeNull());
});

describe('history keeps deleted groups', () => {
  it('an AI call whose group was deleted shows a "Deleted group" ref, not "no group"', async () => {
    mdb.AiCall.countDocuments.mockResolvedValueOnce(1);
    mdb.AiCall.find.mockReturnValueOnce(
      chain([{ _id: G2, createdAt: new Date(), feature: 'planner', provider: 'gemini', aiModel: 'm', status: 'ok', groupId: G1 }]),
    );
    const res = await server.req('GET', '/api/ai/calls', { cookie });
    expect(res.body.data[0].group).toMatchObject({ id: G1, name: 'Deleted group', deleted: true });
  });

  it('the audit log marks entries whose group no longer exists and lists the changes', async () => {
    mdb.AdminAuditLog.countDocuments.mockResolvedValueOnce(1);
    mdb.AdminAuditLog.find.mockReturnValueOnce(
      chain([
        {
          _id: G2,
          createdAt: new Date(),
          action: 'group.ai',
          targetType: 'group',
          targetId: G1,
          targetLabel: 'Acme',
          details: { before: { disabled: false, dailyLimit: null }, after: { disabled: true, dailyLimit: null } },
        },
      ]),
    );
    const res = await server.req('GET', '/api/audit-log', { cookie });
    expect(res.body.data[0]).toMatchObject({ targetMissing: true, changes: ['AI turned off'] });
  });
});

describe('overview numbers', () => {
  it('today’s calls exclude requests refused by the daily limit', async () => {
    mdb.AiCall.aggregate.mockImplementation(async (pipeline: any[]) => {
      const group = pipeline[1]?.$group;
      if (group && group._id === null && group.blocked) return [{ cost: 1.5, calls: 500, blocked: 112 }];
      return [];
    });
    const res = await server.req('GET', '/api/overview?range=7d', { cookie });
    expect(res.body.data.aiToday).toMatchObject({ costUsd: 1.5, calls: 500, blocked: 112 });
    mdb.AiCall.aggregate.mockImplementation(async () => []);
  });

  it('active groups only count groups that still exist (so the number matches the list)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mdb.UsageEvent.aggregate.mockImplementation(async (pipeline: any[]) => {
      const id = pipeline[1]?.$group?._id;
      if (id && id.kind && id.g === '$groupId') {
        return [
          { _id: { day: today, g: G1, kind: 'command', channel: 'telegram' }, n: 3 },
          { _id: { day: today, g: G2, kind: 'command', channel: 'telegram' }, n: 2 },
        ];
      }
      return [];
    });
    mdb.Group.find.mockImplementation(() => chain([{ _id: G1 }]));
    const res = await server.req('GET', '/api/overview?range=7d', { cookie });
    expect(res.body.data.kpis.activeGroups.value).toBe(1);
    mdb.UsageEvent.aggregate.mockImplementation(async () => []);
    mdb.Group.find.mockImplementation(() => chain([]));
  });
});

describe('drill-down filters', () => {
  it('/users?activeIn=today filters to people with usage today', async () => {
    mdb.UsageEvent.distinct.mockResolvedValueOnce([G1]);
    const res = await server.req('GET', '/api/users?activeIn=today', { cookie });
    expect(res.status).toBe(200);
    const filter = mdb.User.countDocuments.mock.calls[0][0];
    expect(filter._id.$in.map(String)).toEqual([G1]);
  });

  it('/groups?activeIn=7d keeps only groups active in the period and returns their period numbers', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mdb.Task.aggregate.mockImplementation(async (pipeline: any[]) => {
      const id = pipeline[1]?.$group?._id;
      if (id && id.g === '$groupId' && pipeline[0].$match.createdAt) return [{ _id: { day: today, g: G1 }, n: 4 }];
      return [];
    });
    mdb.Group.countDocuments.mockResolvedValueOnce(1);
    mdb.Group.find.mockImplementation((q: any) =>
      chain(q?._id ? [{ _id: G1, groupName: 'Acme', status: 'active', telegramGroupId: -1, createdAt: new Date() }] : []),
    );
    const res = await server.req('GET', '/api/groups?activeIn=7d&sort=tasks', { cookie });
    expect(res.status).toBe(200);
    expect(mdb.Group.countDocuments.mock.calls[0][0]._id.$in.map(String)).toEqual([G1]);
    expect(res.body.data[0].inPeriod).toEqual({ events: 0, tasksCreated: 4, aiCalls: 0, aiCostUsd: 0 });
    mdb.Task.aggregate.mockImplementation(async () => []);
    mdb.Group.find.mockImplementation(() => chain([]));
  });

  it('a pending group carries the previous rejection from the audit log', async () => {
    mdb.Group.countDocuments.mockResolvedValueOnce(1);
    mdb.Group.find.mockReturnValueOnce(chain([{ _id: G1, groupName: 'Acme', status: 'pending', telegramGroupId: -1, createdAt: new Date() }]));
    const at = new Date('2026-10-20T10:00:00Z');
    mdb.AdminAuditLog.find.mockReturnValueOnce(chain([{ targetId: G1, action: 'group.reject', reason: 'spam', createdAt: at }]));
    const res = await server.req('GET', '/api/groups?status=pending&sort=added', { cookie });
    expect(res.body.data[0].previousDecision).toEqual({ action: 'rejected', at: at.toISOString(), reason: 'spam' });
  });
});
