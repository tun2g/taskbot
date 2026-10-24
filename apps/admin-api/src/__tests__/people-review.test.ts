/* eslint-disable @typescript-eslint/no-explicit-any */
import * as db from '@tbot/db';
import { createApp } from 'src/app';
import { createSession, SESSION_COOKIE } from 'src/modules/auth/auth.service';
import { auditChanges } from 'src/shared/audit';
import { setKv } from 'src/shared/redis';
import { aggregate } from './fake-aggregate';
import { chain, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const mdb = db as unknown as Record<string, any>;
let server: TestServer;
let cookie: string;
let kv: FakeKv;

const U1 = 'aaaaaaaaaaaaaaaaaaaaaaa1';
const U2 = 'aaaaaaaaaaaaaaaaaaaaaaa2';
const G1 = 'bbbbbbbbbbbbbbbbbbbbbbb1';
const G2 = 'bbbbbbbbbbbbbbbbbbbbbbb2';
const T1 = 'ccccccccccccccccccccccc1';
const ago = (h: number) => new Date(Date.now() - h * 3_600_000);

const user = { _id: U1, telegramUserId: 7001, firstName: 'Linh', lastName: 'Nguyen', username: 'linh', ai: { disabled: false, dailyLimit: 10 }, createdAt: ago(900) };
const call = (h: number, extra: Record<string, unknown>) => ({
  createdAt: ago(h),
  userId: U1,
  groupId: G1,
  feature: 'planner',
  aiModel: 'm',
  status: 'ok',
  inputTokens: 100,
  outputTokens: 50,
  costUsd: 0.01,
  priced: true,
  ...extra,
});
// G1 (member), G2 (left the group, still has activity), and calls / actions not tied to any group.
const aiCalls = [
  call(1, {}),
  call(2, { feature: 'explain', costUsd: 0.02 }),
  call(3, { groupId: G2, status: 'failed', costUsd: 0.005 }),
  call(4, { groupId: null, feature: 'breakdown', costUsd: 0.03 }),
  call(5, { groupId: null, priced: false, costUsd: 0, aiModel: 'unpriced' }),
  call(6, { status: 'quota', inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  call(7, { userId: U2, costUsd: 0.5 }),
  call(24 * 40, { costUsd: 9 }), // outside 30 days
];
const events = [
  ...Array.from({ length: 5 }, (_, i) => ({ createdAt: ago(i + 1), userId: U1, groupId: G1, kind: 'command', name: 'task' })),
  ...Array.from({ length: 2 }, (_, i) => ({ createdAt: ago(i + 1), userId: U1, groupId: G2, kind: 'callback', name: 'task:done' })),
  ...Array.from({ length: 3 }, (_, i) => ({ createdAt: ago(i + 1), userId: U1, groupId: null, kind: 'api', name: 'tasks' })),
  { createdAt: ago(1), userId: U1, groupId: G1, kind: 'rate_limited', name: 'ai_user_daily' },
  { createdAt: ago(1), userId: U1, groupId: G1, kind: 'rate_limited', name: 'ai_daily_budget' }, // counted by its ai_call
  { createdAt: ago(2), userId: U2, groupId: G2, kind: 'rate_limited', name: 'ai_group_daily' },
];

beforeAll(async () => {
  server = await startServer(createApp());
});
afterAll(() => server.close());
beforeEach(async () => {
  jest.clearAllMocks();
  kv = new FakeKv();
  setKv(kv);
  cookie = `${SESSION_COOKIE}=${(await createSession(1001)).id}`;
  mdb.AiCall.aggregate.mockImplementation(async (p: any[]) => aggregate(aiCalls, p));
  mdb.UsageEvent.aggregate.mockImplementation(async (p: any[]) => aggregate(events, p));
  mdb.User.findById.mockImplementation(() => chain(user));
  mdb.User.find.mockImplementation(() => chain([user, { _id: U2, telegramUserId: 7002, firstName: 'Minh' }]));
  mdb.Group.find.mockImplementation(() => chain([{ _id: G1, groupName: 'Acme', status: 'active' }, { _id: G2, groupName: 'Old', status: 'active' }]));
  mdb.GroupMember.find.mockImplementation(() => chain([{ groupId: G1, joinedAt: ago(800) }]));
});

const sum = (rows: any[], k: string) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 1e6) / 1e6;

describe('one set of range totals for a person', () => {
  it('KPIs, feature rows and group rows (with "No group") all add up to the same totals', async () => {
    const { body } = await server.req('GET', `/api/users/${U1}?range=30d`, { cookie });
    const d = body.data;
    // Activity counts every usage event, refused requests included (2 rate_limited events here).
    expect(d.totals).toEqual({ events: 12, aiCalls: 5, aiFailed: 1, aiCostUsd: 0.065, aiUnpriced: 1, aiRefused: 2 });
    expect(sum(d.aiByFeature, 'calls')).toBe(d.totals.aiCalls);
    expect(sum(d.aiByFeature, 'costUsd')).toBe(d.totals.aiCostUsd);
    expect(sum(d.groupList, 'aiCalls')).toBe(d.totals.aiCalls);
    expect(sum(d.groupList, 'aiCostUsd')).toBe(d.totals.aiCostUsd);
    expect(sum(d.groupList, 'events')).toBe(d.totals.events);
    expect(d.groupList.map((g: any) => [g.group?.name ?? null, g.member])).toEqual([
      ['Acme', true],
      ['Old', false],
      [null, false],
    ]);
  });

  it('the People list row shows the same totals as the person page', async () => {
    mdb.User.find.mockImplementation(() => chain([user]));
    const list = await server.req('GET', '/api/users?range=30d', { cookie });
    const detail = await server.req('GET', `/api/users/${U1}?range=30d`, { cookie });
    expect(list.body.data[0].totals).toEqual(detail.body.data.totals);
  });

  it("today's own limit: used from the bot's limiter, refused from the records", async () => {
    const day = new Date().toISOString().slice(0, 10);
    await kv.setEx(`ratelimit:ai_user_daily:${day}:7001`, 3600, '12');
    const { body } = await server.req('GET', `/api/users/${U1}`, { cookie });
    expect(body.data.aiToday).toEqual({ used: 10, refused: 2, limit: 10, limitSource: 'override' });
  });
});

describe('AI usage rows reconcile with the totals', () => {
  it('group rows (including "No group") sum to the totals; refusals include the limiters', async () => {
    const { body } = await server.req('GET', '/api/ai/usage?range=30d&groupBy=group', { cookie });
    const d = body.data;
    expect(sum(d.rows, 'calls')).toBe(d.totals.calls);
    expect(sum(d.rows, 'costUsd')).toBe(d.totals.costUsd);
    expect(d.rows.find((r: any) => r.key === 'none')).toMatchObject({ calls: 2, label: expect.stringMatching(/^No group/) });
    expect(d.totals.refused).toBe(3);
    expect(d.refusedByReason).toEqual([
      { reason: 'person_limit', count: 1 },
      { reason: 'group_limit', count: 1 },
      { reason: 'bot_limit', count: 1 },
    ]);
  });

  it('feature rows of one person equal that person\'s KPI', async () => {
    const usage = await server.req('GET', `/api/ai/usage?range=30d&groupBy=feature&userId=${U1}`, { cookie });
    const detail = await server.req('GET', `/api/users/${U1}?range=30d`, { cookie });
    expect(usage.body.data.totals.calls).toBe(detail.body.data.totals.aiCalls);
    expect(usage.body.data.totals.costUsd).toBe(detail.body.data.totals.aiCostUsd);
  });

  it('GET /ai/refused lists who was refused, most first, paginated', async () => {
    const { body } = await server.req('GET', '/api/ai/refused?by=person&limit=1', { cookie });
    expect(body.meta).toMatchObject({ page: 1, limit: 1, total: 2, hasMore: true });
    expect(body.data[0]).toMatchObject({ person: { id: U1 }, count: 2, byReason: { person_limit: 1, bot_limit: 1 } });
    const groups = await server.req('GET', '/api/ai/refused?by=group', { cookie });
    expect(groups.body.data.map((r: any) => [r.group?.id, r.count])).toEqual([
      [G1, 2],
      [G2, 1],
    ]);
  });
});

describe('MCP tokens', () => {
  const token = { _id: T1, name: 'Claude Desktop', prefix: 'tbot_ab12', userId: U1, groupId: G1, lastUsedAt: null, createdAt: ago(48), expiresAt: null, revokedAt: null };

  it('GET /mcp/tokens is paginated and filters by status and person', async () => {
    mdb.ApiToken.countDocuments.mockResolvedValueOnce(45);
    mdb.ApiToken.find.mockReturnValueOnce(chain([token]));
    const res = await server.req('GET', `/api/mcp/tokens?status=active&userId=${U1}&page=2&limit=20`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 2, limit: 20, total: 45, hasMore: true });
    expect(res.body.data[0]).toMatchObject({ id: T1, status: 'active', group: { id: G1 }, person: { id: U1 } });
    const filter = mdb.ApiToken.countDocuments.mock.calls[0][0];
    expect(String(filter.$and[1].userId)).toBe(U1);
    expect((await server.req('GET', '/api/mcp/tokens?status=bogus', { cookie })).status).toBe(400);
  });

  it('POST /tokens/:id/revoke revokes only that token and audits it', async () => {
    mdb.ApiToken.findById.mockReturnValueOnce(chain(token));
    mdb.AdminAuditLog.create.mockResolvedValueOnce({ _id: 'audit1' });
    const res = await server.req('POST', `/api/tokens/${T1}/revoke`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ token: { id: T1, status: 'revoked' }, auditId: 'audit1' });
    expect(String(mdb.ApiToken.updateOne.mock.calls[0][0]._id)).toBe(T1);
    expect(mdb.ApiToken.updateMany).not.toHaveBeenCalled();
    expect(mdb.AdminAuditLog.create.mock.calls[0][0]).toMatchObject({ action: 'token.revoke', targetId: U1, details: { prefix: 'tbot_ab12', groupName: 'Acme' } });
  });

  it('revoking twice is a 409; an unknown token a 404', async () => {
    mdb.ApiToken.findById.mockReturnValueOnce(chain({ ...token, revokedAt: ago(1) }));
    expect((await server.req('POST', `/api/tokens/${T1}/revoke`, { cookie })).status).toBe(409);
    mdb.ApiToken.findById.mockReturnValueOnce(chain(null));
    expect((await server.req('POST', `/api/tokens/${T1}/revoke`, { cookie })).status).toBe(404);
  });

  it('the audit list says which token and that the others keep working', () => {
    expect(auditChanges('token.revoke', { name: 'Cursor', prefix: 'tbot_x', groupName: null })).toEqual([
      '“Cursor” (tbot_x…) revoked — it worked in all their groups; their other tokens keep working',
    ]);
  });
});

describe('AI override with a reason', () => {
  it('stores the reason with the override and returns the audit entry', async () => {
    mdb.AdminAuditLog.create.mockResolvedValueOnce({ _id: 'audit2' });
    const res = await server.req('PATCH', `/api/users/${U1}/ai`, { cookie, body: { disabled: true, reason: ' Over budget ' } });
    expect(res.status).toBe(200);
    expect(res.body.data.auditId).toBe('audit2');
    expect(mdb.User.updateOne.mock.calls[0][1].$set).toEqual({ 'ai.disabled': true, 'ai.reason': 'Over budget' });
  });

  it('going back to the defaults clears the reason; a limit of 0 is refused (turn AI off instead)', async () => {
    mdb.User.findById.mockImplementation(() => chain({ ...user, ai: { disabled: true, dailyLimit: null, reason: 'x' } }));
    await server.req('PATCH', `/api/users/${U1}/ai`, { cookie, body: { disabled: false } });
    expect(mdb.User.updateOne.mock.calls[0][1].$set).toEqual({ 'ai.disabled': false, 'ai.reason': null });
    const zero = await server.req('PATCH', `/api/users/${U1}/ai`, { cookie, body: { dailyLimit: 0 } });
    expect(zero.status).toBe(400);
    expect(zero.body.message).toMatch(/turn it off instead/);
  });
});
