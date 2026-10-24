/* eslint-disable @typescript-eslint/no-explicit-any */
import * as db from '@tbot/db';
import { GroupStatus } from '@tbot/shared';
import { Types } from 'mongoose';
import { createApp } from 'src/app';
import { createSession, SESSION_COOKIE } from 'src/modules/auth/auth.service';
import { auditChanges, auditSummary } from 'src/shared/audit';
import { setKv } from 'src/shared/redis';
import { telegram } from 'src/shared/telegram';
import { chain, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const mdb = db as unknown as Record<string, any>;
const GID = new Types.ObjectId();
let server: TestServer;
let cookie: string;
let group: any;

const MODELS = ['AdminAuditLog', 'AiCall', 'ApiToken', 'Epic', 'Group', 'GroupMember', 'Task', 'TaskActivity', 'UsageEvent', 'User'];

beforeAll(async () => {
  server = await startServer(createApp());
});
afterAll(() => server.close());

beforeEach(async () => {
  jest.clearAllMocks();
  // Reset implementations other tests set (defaults: empty results).
  for (const m of MODELS) {
    mdb[m].find.mockImplementation(() => chain([]));
    mdb[m].aggregate.mockImplementation(async () => []);
    mdb[m].countDocuments.mockImplementation(async () => 0);
    mdb[m].updateOne.mockImplementation(async () => ({ modifiedCount: 1 }));
  }
  setKv(new FakeKv());
  cookie = `${SESSION_COOKIE}=${(await createSession(1001)).id}`;
  group = {
    _id: GID,
    telegramGroupId: -100123,
    groupName: 'Crypto Signals',
    status: GroupStatus.REJECTED,
    statusReason: 'Not a work group.',
    ai: { disabled: false, dailyLimit: null },
    createdAt: new Date('2026-10-01T00:00:00Z'),
  };
  mdb.Group.findById.mockImplementation(() => chain(group));
});

const get = (path: string) => server.req('GET', `/api/groups/${GID}${path}`, { cookie });
const audits = () => mdb.AdminAuditLog.create.mock.calls.map((c: any[]) => c[0]);

describe('reconsider a rejected group', () => {
  it('clears the rejection so a re-add asks for approval again; nothing is sent to Telegram; audited', async () => {
    mdb.Group.updateOne.mockImplementation(async (_f: unknown, update: any) => {
      group = { ...group, ...update.$set };
      return { modifiedCount: 1 };
    });
    const res = await server.req('POST', `/api/groups/${GID}/reconsider`, { body: {}, cookie });
    expect(res.status).toBe(200);
    const [filter, update] = mdb.Group.updateOne.mock.calls[0];
    // Only from REJECTED (a re-add racing us is never overwritten).
    expect(filter).toEqual({ _id: GID, status: GroupStatus.REJECTED });
    expect(update.$set).toMatchObject({ status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.PENDING, statusReason: null });
    expect(res.body.data).toMatchObject({ status: GroupStatus.LEFT, statusReason: null, warnings: [] });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(telegram.leaveChat).not.toHaveBeenCalled();
    expect(audits()[0]).toMatchObject({ action: 'group.reconsider', targetLabel: 'Crypto Signals' });
    expect(audits()[0].details).toMatchObject({ clearedReason: 'Not a work group.', nextAdd: GroupStatus.PENDING });
  });

  it('409 for a group that is not rejected', async () => {
    group.status = GroupStatus.ACTIVE;
    mdb.Group.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    const res = await server.req('POST', `/api/groups/${GID}/reconsider`, { body: {}, cookie });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Only rejected groups can be reconsidered/);
    expect(mdb.AdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('reads well in the audit log', () => {
    expect(auditSummary('group.reconsider', 'Crypto Signals')).toBe('Cleared the rejection of group “Crypto Signals”');
    expect(auditChanges('group.reconsider', { clearedReason: 'Spam' })).toEqual([
      'If the bot is added again, the group waits for your approval like a new one',
      'Cleared reason: “Spam”',
    ]);
  });

  it('a pending group asking again after a reconsider says so', async () => {
    group.status = GroupStatus.PENDING;
    mdb.AdminAuditLog.find.mockImplementation(() =>
      chain([{ targetId: String(GID), action: 'group.reconsider', reason: null, createdAt: new Date('2026-10-20T00:00:00Z') }]),
    );
    const res = await get('?range=7d');
    expect(res.body.data.previousDecision).toEqual({ action: 'reconsidered', at: '2026-10-20T00:00:00.000Z', reason: null });
    mdb.AdminAuditLog.find.mockImplementation(() => chain([]));
  });
});

describe('moved to a supergroup', () => {
  it('resolves the new chat id to the group that continues it', async () => {
    const NEW = new Types.ObjectId();
    group = { ...group, status: GroupStatus.MIGRATED, migratedToChatId: -100999 };
    mdb.Group.find.mockImplementation((q: any) =>
      chain(q?.telegramGroupId ? [{ _id: NEW, telegramGroupId: -100999, groupName: 'Design Guild', status: GroupStatus.ACTIVE }] : []),
    );
    const res = await get('?range=7d');
    expect(res.status).toBe(200);
    expect(res.body.data.migratedTo).toEqual({ id: String(NEW), name: 'Design Guild', status: GroupStatus.ACTIVE });
    expect(mdb.Group.find.mock.calls.find((c: any[]) => c[0]?.telegramGroupId)[0]).toEqual({ telegramGroupId: { $in: [-100999] } });
  });

  it('null when the new group no longer exists; other statuses carry no migratedTo', async () => {
    group = { ...group, status: GroupStatus.MIGRATED, migratedToChatId: -100999 };
    expect((await get('')).body.data.migratedTo).toBeNull();
    group = { ...group, status: GroupStatus.ACTIVE, migratedToChatId: null };
    expect((await get('')).body.data).not.toHaveProperty('migratedTo');
  });
});

describe('group detail extras', () => {
  it('unpriced AI calls, refusals and what a re-add restores', async () => {
    group = { ...group, status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.ACTIVE };
    mdb.AiCall.aggregate.mockImplementation(async (pipeline: any[]) => {
      const by = pipeline[1]?.$group?._id;
      if (by === '$groupId') return [{ _id: GID, calls: 5, failed: 1, refused: 0, inputTokens: 1, outputTokens: 1, costUsd: 0, unpriced: 5 }];
      if (by === '$feature') return [{ _id: 'planner', calls: 5, failed: 1, refused: 3, inputTokens: 1, outputTokens: 1, costUsd: 0, unpriced: 5 }];
      return [];
    });
    const res = await get('?range=7d');
    expect(res.body.data).toMatchObject({ aiCalls30d: 5, aiCostUsd30d: 0, aiUnpriced30d: 5, aiRefused: 3, statusBeforeLeft: GroupStatus.ACTIVE });
  });
});

describe('GET /groups/:id/members — paginated, searchable, sortable', () => {
  const people = Array.from({ length: 30 }, (_, i) => ({ userId: new Types.ObjectId(), telegramUserId: 1000 + i, joinedAt: new Date(Date.UTC(2026, 0, 1 + i)) }));

  beforeEach(() => {
    mdb.GroupMember.find.mockImplementation(() => chain(people));
    // Person i made i requests in the range.
    mdb.UsageEvent.aggregate.mockImplementation(async (pipeline: any[]) =>
      pipeline[1].$group.n ? people.map((p, i) => ({ _id: p.userId, n: i })) : [],
    );
    mdb.User.find.mockImplementation((q: any) =>
      chain(
        q.$or
          ? [{ _id: people[3].userId }]
          : people
              .filter((p) => q._id.$in.some((id: Types.ObjectId) => String(id) === String(p.userId)))
              .map((p) => ({ _id: p.userId, telegramUserId: p.telegramUserId, firstName: `Person ${p.telegramUserId}` })),
      ),
    );
  });

  it('no silent cap: total counts everyone, pages slice after sorting', async () => {
    const res = await get('/members?limit=10&page=2');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 2, limit: 10, total: 30, hasMore: true });
    // Default sort = most requests first: page 2 holds persons 19..10.
    expect(res.body.data.map((m: any) => m.events)).toEqual([19, 18, 17, 16, 15, 14, 13, 12, 11, 10]);
    expect(res.body.data[0].person.name).toBe('Person 1019');
    // Only the page's people are loaded.
    const loaded = mdb.User.find.mock.calls.at(-1)[0]._id.$in;
    expect(loaded).toHaveLength(10);
    // The member query has no limit.
    expect(mdb.GroupMember.find.mock.results[0].value.limit).not.toHaveBeenCalled();
  });

  it('sort=joined orders by join date, newest first', async () => {
    const res = await get('/members?sort=joined&limit=3');
    expect(res.body.data.map((m: any) => m.person.telegramUserId)).toEqual([1029, 1028, 1027]);
  });

  it('q filters by name / @username before paging', async () => {
    const res = await get('/members?q=@person');
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].person.telegramUserId).toBe(1003);
    const search = mdb.User.find.mock.calls[0][0];
    expect(search.$or[2].username.test('person')).toBe(true);
  });

  it('404 for an unknown group', async () => {
    mdb.Group.findById.mockImplementation(() => chain(null));
    expect((await get('/members')).status).toBe(404);
  });
});

describe('GET /groups/:id/tasks — read-only list behind the task counts', () => {
  const T1 = new Types.ObjectId();
  const PARENT = new Types.ObjectId();
  const EPIC = new Types.ObjectId();
  const U = new Types.ObjectId();

  beforeEach(() => {
    mdb.Task.find.mockImplementation((q: any) =>
      chain(
        q._id
          ? [{ _id: PARENT, taskNumber: 7 }]
          : [
              {
                _id: T1,
                taskNumber: 12,
                title: 'Fix login',
                status: 'todo',
                assigneeId: U,
                dueDate: new Date('2026-01-01T00:00:00Z'),
                createdAt: new Date('2025-12-20T00:00:00Z'),
                parentTaskId: PARENT,
                epicId: EPIC,
                description: 'never sent',
              },
            ],
      ),
    );
    mdb.Task.countDocuments.mockImplementation(async (q: any) => (q.status?.$in ? 4 : q.dueDate ? 1 : q.status ? 2 : 6));
    mdb.Epic.find.mockImplementation(() => chain([{ _id: EPIC, title: 'Onboarding' }]));
    mdb.TaskActivity.find.mockImplementation(() => chain([{ taskId: T1, via: 'mcp' }]));
    mdb.User.find.mockImplementation(() => chain([{ _id: U, telegramUserId: 5, firstName: 'Linh', username: 'linh' }]));
  });

  it('open tasks by default, with counts per filter and plain fields only', async () => {
    const res = await get('/tasks');
    expect(res.status).toBe(200);
    const match = mdb.Task.find.mock.calls[0][0];
    expect(match.groupId).toEqual(GID);
    expect(match.status.$nin).toEqual(expect.arrayContaining(['done', 'cancelled']));
    expect(res.body.counts).toEqual({ open: 2, overdue: 1, done: 4, all: 6 });
    expect(res.body.meta).toEqual({ page: 1, limit: 25, total: 2, hasMore: false });
    expect(res.body.data).toEqual([
      {
        id: String(T1),
        number: 12,
        title: 'Fix login',
        status: 'todo',
        parentNumber: 7,
        epic: { id: String(EPIC), title: 'Onboarding' },
        assignee: { id: String(U), telegramUserId: 5, name: 'Linh', username: 'linh' },
        dueDate: '2026-01-01T00:00:00.000Z',
        overdue: true,
        createdAt: '2025-12-20T00:00:00.000Z',
        completedAt: null,
        createdVia: 'mcp',
      },
    ]);
    // Only these fields are read from the tasks — never descriptions or source messages.
    expect(mdb.Task.find.mock.results[0].value.select).toHaveBeenCalledWith(
      'taskNumber title status assigneeId dueDate createdAt completedAt parentTaskId epicId',
    );
  });

  it('createdIn narrows to tasks created in the period; overdue sorts by due date', async () => {
    const res = await get('/tasks?filter=overdue&createdIn=7d&page=2&limit=5');
    expect(res.status).toBe(200);
    const match = mdb.Task.find.mock.calls[0][0];
    expect(match.createdAt.$gte).toBeInstanceOf(Date);
    expect(match.dueDate.$lt).toBeInstanceOf(Date);
    const q = mdb.Task.find.mock.results[0].value;
    expect(q.sort).toHaveBeenCalledWith({ dueDate: 1, _id: 1 });
    expect(q.skip).toHaveBeenCalledWith(5);
    expect(q.limit).toHaveBeenCalledWith(5);
    expect(res.body.meta.total).toBe(1);
  });

  it('q searches the title or #number', async () => {
    await get('/tasks?q=%2312');
    expect(mdb.Task.find.mock.calls[0][0].$or).toEqual([{ title: /12/i }, { taskNumber: 12 }]);
  });
});

describe('GET /groups/:id/epics', () => {
  it('lists epics with their task counts, paginated', async () => {
    const E = new Types.ObjectId();
    mdb.Epic.countDocuments.mockResolvedValueOnce(1);
    mdb.Epic.find.mockImplementation(() => chain([{ _id: E, title: 'Onboarding', status: 'open', createdAt: new Date('2026-10-01T00:00:00Z') }]));
    mdb.Task.aggregate.mockImplementation(async () => [{ _id: E, tasks: 5, open: 2 }]);
    const res = await get('/epics?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 10, total: 1, hasMore: false });
    expect(res.body.data).toEqual([{ id: String(E), title: 'Onboarding', status: 'open', tasks: 5, openTasks: 2, createdAt: '2026-10-01T00:00:00.000Z' }]);
  });
});

describe('groups list — AI cost follows the period', () => {
  it('?activeIn= uses the period AI totals (with unpriced calls)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mdb.Task.aggregate.mockImplementation(async (pipeline: any[]) =>
      pipeline[1]?.$group?._id?.g === '$groupId' ? [{ _id: { day: today, g: GID }, n: 2 }] : [],
    );
    mdb.Group.countDocuments.mockResolvedValueOnce(1);
    mdb.Group.find.mockImplementation((q: any) => chain(q?._id ? [{ ...group, status: GroupStatus.ACTIVE }] : []));
    mdb.AiCall.aggregate.mockImplementation(async (pipeline: any[]) =>
      pipeline[1]?.$group?._id === '$groupId' ? [{ _id: GID, calls: 4, failed: 0, refused: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 4 }] : [],
    );
    const res = await server.req('GET', '/api/groups?activeIn=7d', { cookie });
    expect(res.status).toBe(200);
    expect(res.body.data[0].inPeriod).toMatchObject({ tasksCreated: 2, aiCalls: 4, aiCostUsd: 0, aiUnpriced: 4 });
  });
});
