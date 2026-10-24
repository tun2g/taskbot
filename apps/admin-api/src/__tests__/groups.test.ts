/* eslint-disable @typescript-eslint/no-explicit-any */
import * as db from '@tbot/db';
import { GROUP_NOTICES, GroupStatus } from '@tbot/shared';
import { Types } from 'mongoose';
import { createApp } from 'src/app';
import { createSession, SESSION_COOKIE } from 'src/auth/auth.service';
import { wrongStateMessage } from 'src/routes/group-actions';
import { setKv } from 'src/shared/redis';
import { telegram } from 'src/shared/telegram';
import { chain, FakeKv, startServer, TestServer } from './helpers';

jest.mock('@tbot/db', () => require('./helpers').dbMock());
jest.mock('src/shared/telegram', () => require('./helpers').telegramMock());

const mdb = db as unknown as Record<string, any>;
const GID = new Types.ObjectId();
const CHAT = -100123;
let server: TestServer;
let cookie: string;
let group: any;

beforeAll(async () => {
  server = await startServer(createApp());
});
afterAll(() => server.close());

beforeEach(async () => {
  setKv(new FakeKv());
  const { id } = await createSession(1001);
  cookie = `${SESSION_COOKIE}=${id}`;
  group = {
    _id: GID,
    telegramGroupId: CHAT,
    groupName: 'Acme Mobile Team',
    status: GroupStatus.PENDING,
    isForum: false,
    memberCount: 12,
    addedBy: { telegramUserId: 77, name: 'An Nguyen', username: 'an' },
    approvalMessage: { chatId: 1001, messageId: 555 },
    ai: { disabled: false, dailyLimit: null },
    createdAt: new Date('2026-10-01T00:00:00Z'),
  };
  mdb.Group.findById.mockImplementation(() => chain(group));
  mdb.decideGroup.mockImplementation(async (_id: unknown, decision: string, reason: string | null) => {
    const t = db.GROUP_TRANSITIONS[decision as db.GroupDecision];
    if (!(t.from as readonly GroupStatus[]).includes(group.status)) return { ok: false, reason: 'wrong_state', current: group.status };
    const from = group.status;
    group = { ...group, status: t.to, statusReason: reason };
    return { ok: true, group, from };
  });
});

const post = (path: string, body: unknown = {}) => server.req('POST', `/api/groups/${GID}${path}`, { body, cookie });
const audits = () => mdb.AdminAuditLog.create.mock.calls.map((c: any[]) => c[0]);

describe('group decisions', () => {
  it('approve: activates, tells the group, updates the owner DM card, audits', async () => {
    const res = await post('/approve');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: String(GID), status: GroupStatus.ACTIVE, warnings: [] });

    // Same message and [Open board] button as approving from the owner's Telegram DM.
    expect(telegram.sendMessage).toHaveBeenCalledWith(CHAT, GROUP_NOTICES.approved('TaskBot', { forum: false }), {
      inline_keyboard: [[{ text: '📋 Open board', url: `https://t.me/taskbot?startapp=${GID}` }]],
    });
    expect(telegram.editMessageText).toHaveBeenCalledWith(1001, 555, expect.stringContaining('Approved in the admin app'));
    expect(telegram.leaveChat).not.toHaveBeenCalled();
    expect(audits()).toEqual([
      expect.objectContaining({ action: 'group.approve', targetType: 'group', targetId: String(GID), targetLabel: 'Acme Mobile Team' }),
    ]);
    expect(audits()[0].details).toMatchObject({ from: GroupStatus.PENDING, to: GroupStatus.ACTIVE, notifiedGroup: true });
  });

  it('409 with a plain message when the decision does not apply', async () => {
    group.status = GroupStatus.ACTIVE;
    const res = await post('/approve');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Conflict', message: 'This group is already active.', statusCode: 409 });
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(mdb.AdminAuditLog.create).not.toHaveBeenCalled();
  });

  it('404 for an unknown or malformed id', async () => {
    mdb.decideGroup.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    expect((await post('/approve')).status).toBe(404);
    expect((await server.req('POST', '/api/groups/not-an-id/approve', { body: {}, cookie })).status).toBe(404);
  });

  it('reject requires a reason, posts it to the group, then the bot leaves', async () => {
    const missing = await post('/reject', {});
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/reason/i);
    expect(mdb.decideGroup).not.toHaveBeenCalled();

    const res = await post('/reject', { reason: 'Spam <group>' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(GroupStatus.REJECTED);
    expect(telegram.sendMessage).toHaveBeenCalledWith(CHAT, GROUP_NOTICES.rejected('Spam <group>', null), undefined);
    expect(telegram.leaveChat).toHaveBeenCalledWith(CHAT);
    // The notice goes out before the bot leaves.
    const sendOrder = (telegram.sendMessage as jest.Mock).mock.invocationCallOrder[0];
    const leaveOrder = (telegram.leaveChat as jest.Mock).mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(leaveOrder);
    expect(audits()[0]).toMatchObject({ action: 'group.reject', reason: 'Spam <group>' });
  });

  it('suspend requires a reason; unsuspend sends the resume notice', async () => {
    group.status = GroupStatus.ACTIVE;
    expect((await post('/suspend', { reason: '  ' })).status).toBe(400);
    const s = await post('/suspend', { reason: 'Abuse' });
    expect(s.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(CHAT, GROUP_NOTICES.suspended('Abuse', null), undefined);
    // An active group's card was already decided: not edited again.
    expect(telegram.editMessageText).not.toHaveBeenCalled();

    const u = await post('/unsuspend');
    expect(u.status).toBe(200);
    expect(u.body.data.status).toBe(GroupStatus.ACTIVE);
    expect(telegram.sendMessage).toHaveBeenLastCalledWith(CHAT, GROUP_NOTICES.unsuspended, undefined);
    expect(audits().map((a: any) => a.action)).toEqual(['group.suspend', 'group.unsuspend']);
  });

  it('approve without any board link configured: the message goes out without a button', async () => {
    const { boardButton } = jest.requireMock('src/shared/telegram');
    boardButton.mockResolvedValueOnce(null);
    await post('/approve');
    expect(telegram.sendMessage).toHaveBeenCalledWith(CHAT, GROUP_NOTICES.approved('TaskBot', { forum: false }), undefined);
  });

  it('forum groups: the approval says where task updates go, and is posted in General (no topic)', async () => {
    group.isForum = true;
    await post('/approve');
    const [chat, text, , thread] = (telegram.sendMessage as jest.Mock).mock.calls[0];
    expect(chat).toBe(CHAT);
    expect(text).toContain('“Task events” topic');
    expect(thread).toBeUndefined();
  });

  it('General closed to the bot: the notice falls back to the events topic', async () => {
    group.status = GroupStatus.ACTIVE;
    group.isForum = true;
    group.eventsTopicId = 33;
    (telegram.sendMessage as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'Bad Request: TOPIC_CLOSED' });
    const res = await post('/suspend', { reason: 'Abuse' });
    expect(res.body.data.warnings).toEqual([]);
    expect((telegram.sendMessage as jest.Mock).mock.calls[1]).toEqual([CHAT, GROUP_NOTICES.suspended('Abuse', null), undefined, 33]);
  });

  it('OWNER_CONTACT: the rejected and paused notices say how to reach the owner', async () => {
    process.env.OWNER_CONTACT = '@tun2g';
    try {
      await post('/reject', { reason: 'Spam' });
      expect((telegram.sendMessage as jest.Mock).mock.calls[0][1]).toContain("message the bot's owner: @tun2g.");
    } finally {
      delete process.env.OWNER_CONTACT;
    }
  });

  it('notifyGroup: false skips the group message', async () => {
    const res = await post('/approve', { notifyGroup: false });
    expect(res.status).toBe(200);
    expect(telegram.sendMessage).not.toHaveBeenCalled();
    expect(audits()[0].details.notifiedGroup).toBe(false);
  });

  it('Telegram failures become warnings, not errors', async () => {
    (telegram.sendMessage as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'Forbidden: bot was kicked' });
    (telegram.editMessageText as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'message to edit not found' });
    const res = await post('/approve');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(GroupStatus.ACTIVE);
    expect(res.body.data.warnings).toHaveLength(2);
    expect(res.body.data.warnings[0]).toMatch(/Couldn't post/);
  });

  it('leave: goodbye notice, bot leaves, status LEFT with the previous status kept', async () => {
    group.status = GroupStatus.ACTIVE;
    mdb.Group.updateOne.mockImplementation(async (_f: unknown, update: any) => {
      group = { ...group, ...update.$set };
      return { modifiedCount: 1 };
    });
    const res = await post('/leave', { reason: 'Inactive' });
    expect(res.status).toBe(200);
    expect(telegram.sendMessage).toHaveBeenCalledWith(CHAT, GROUP_NOTICES.leaving('Inactive'), undefined);
    expect(telegram.leaveChat).toHaveBeenCalledWith(CHAT);
    const update = mdb.Group.updateOne.mock.calls[0][1].$set;
    expect(update).toMatchObject({ status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.ACTIVE, statusReason: 'Inactive' });
    expect(update.botLeftAt).toBeDefined();
    expect(res.body.data.status).toBe(GroupStatus.LEFT);
    expect(audits()[0]).toMatchObject({ action: 'group.leave', reason: 'Inactive' });

    // Leaving again is a conflict.
    const again = await post('/leave');
    expect(again.status).toBe(409);
  });

  it('wrongStateMessage explains each case', () => {
    expect(wrongStateMessage('approve', GroupStatus.ACTIVE)).toBe('This group is already active.');
    expect(wrongStateMessage('unsuspend', GroupStatus.ACTIVE)).toBe('This group is not suspended.');
    expect(wrongStateMessage('reject', GroupStatus.ACTIVE)).toMatch(/can't reject this group while its status is “Active”/);
    expect(wrongStateMessage('leave', GroupStatus.LEFT)).toMatch(/not in this group/);
  });
});

describe('delete', () => {
  beforeEach(() => {
    group.status = GroupStatus.ACTIVE;
    mdb.deleteGroupData.mockResolvedValue({ tasks: 40, epics: 2, members: 9, activities: 300, tokens: 1 });
    mdb.countGroupData.mockResolvedValue({ tasks: 40, epics: 2, members: 9, activities: 300, tokens: 1 });
  });

  it('preview lists what would be removed', async () => {
    const res = await server.req('GET', `/api/groups/${GID}/delete-preview`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      group: { id: String(GID), name: 'Acme Mobile Team', status: GroupStatus.ACTIVE },
      tasks: 40,
      epics: 2,
      members: 9,
      activities: 300,
      tokens: 1,
    });
  });

  it('requires the exact group name', async () => {
    for (const confirmName of ['acme mobile team', 'Acme Mobile Team ', 'Acme']) {
      const res = await server.req('DELETE', `/api/groups/${GID}`, { body: { confirmName }, cookie });
      expect(res.status).toBe(400);
    }
    expect((await server.req('DELETE', `/api/groups/${GID}`, { body: {}, cookie })).status).toBe(400);
    expect(mdb.deleteGroupData).not.toHaveBeenCalled();
    expect(telegram.leaveChat).not.toHaveBeenCalled();
  });

  it('leaves the chat, deletes the data and audits the counts', async () => {
    const res = await server.req('DELETE', `/api/groups/${GID}`, { body: { confirmName: 'Acme Mobile Team' }, cookie });
    expect(res.status).toBe(200);
    expect(res.body.data.deleted.tasks).toBe(40);
    expect(telegram.leaveChat).toHaveBeenCalledWith(CHAT);
    expect(mdb.deleteGroupData).toHaveBeenCalled();
    const leaveOrder = (telegram.leaveChat as jest.Mock).mock.invocationCallOrder[0];
    expect(leaveOrder).toBeLessThan(mdb.deleteGroupData.mock.invocationCallOrder[0]);
    expect(audits()[0]).toMatchObject({ action: 'group.delete', targetLabel: 'Acme Mobile Team', details: expect.objectContaining({ tasks: 40, activities: 300 }) });
  });
});

describe('AI overrides', () => {
  it('validates and applies, reporting when the bot picks it up', async () => {
    expect((await server.req('PATCH', `/api/groups/${GID}/ai`, { body: {}, cookie })).status).toBe(400);
    expect((await server.req('PATCH', `/api/groups/${GID}/ai`, { body: { dailyLimit: -1 }, cookie })).status).toBe(400);
    expect((await server.req('PATCH', `/api/groups/${GID}/ai`, { body: { dailyLimit: 1.5 }, cookie })).status).toBe(400);
    const res = await server.req('PATCH', `/api/groups/${GID}/ai`, { body: { disabled: true, dailyLimit: null }, cookie });
    expect(res.status).toBe(200);
    expect(res.body.data.appliesWithinSeconds).toBe(30);
    expect(mdb.Group.updateOne).toHaveBeenCalledWith({ _id: GID }, { $set: { 'ai.disabled': true, 'ai.dailyLimit': null } });
    expect(audits()[0].action).toBe('group.ai');
  });
});

/** Every key anywhere in a JSON value. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe('privacy', () => {
  it('group detail carries numbers and names only — no task or message text', async () => {
    mdb.Task.aggregate.mockResolvedValue([{ _id: GID, tasks: 3, open: 1, n: 3 }]);
    mdb.GroupMember.find.mockReturnValue(chain([{ userId: new Types.ObjectId(), telegramUserId: 77, joinedAt: new Date() }]));
    mdb.UsageEvent.aggregate.mockResolvedValue([]);
    const res = await server.req('GET', `/api/groups/${GID}?range=7d`, { cookie });
    expect(res.status).toBe(200);
    const keys = allKeys(res.body.data);
    for (const forbidden of ['title', 'description', 'text', 'sourceMessage', 'sourceMessages', 'message', 'from', 'to']) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(res.body.data.daily).toHaveLength(7);
    // People are paged separately (GET /groups/:id/members).
    expect(res.body.data.members).toBeUndefined();
    expect(res.body.data.counts).toEqual({ epics: 0, activities: 0, activeTokens: 0 });
    // Task queries only ever aggregate (no find() that could load titles).
    expect(mdb.Task.find).not.toHaveBeenCalled();
  });
});
