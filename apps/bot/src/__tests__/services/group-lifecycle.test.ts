import { GroupStatus } from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { ApiToken } from 'src/database/models/api-token.model';
import { Epic } from 'src/database/models/epic.model';
import { GroupMember } from 'src/database/models/group-member.model';
import { Group } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { redisService } from 'src/shared/services/redis.service';
import {
  approvalHistory,
  groupLifecycleService,
  NEW_SUPERGROUP_ANNOUNCE_DELAY_MS,
  statusOnAdd,
} from 'src/shared/services/group-lifecycle.service';

jest.mock('src/configs/configuration', () => ({ configService: { botOwnerTelegramId: 42, timezone: 'UTC' } }));
jest.mock('src/database/models/group.model', () => ({
  Group: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  },
}));
jest.mock('src/database/models/task.model', () => ({
  Task: { countDocuments: jest.fn().mockResolvedValue(0), updateMany: jest.fn().mockResolvedValue({}) },
}));
jest.mock('src/database/models/epic.model', () => ({ Epic: { countDocuments: jest.fn().mockResolvedValue(0) } }));
jest.mock('src/database/models/group-member.model', () => ({
  GroupMember: { find: jest.fn().mockResolvedValue([]), updateOne: jest.fn(), deleteMany: jest.fn() },
}));
jest.mock('src/database/models/api-token.model', () => ({ ApiToken: { updateMany: jest.fn() } }));
const claimed = new Set<string>();
jest.mock('src/shared/services/redis.service', () => ({
  redisService: {
    set: jest.fn(async (key: string, _v: string, opts?: { NX?: boolean }) => {
      if (opts?.NX && claimed.has(key)) return null;
      claimed.add(key);
      return 'OK';
    }),
  },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const chat = { id: -100, title: 'Team', is_forum: false };
const adder = { id: 7, is_bot: false, first_name: 'An', last_name: 'Nguyen', username: 'an' } as any;

function telegram() {
  return {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 900 }),
    editMessageText: jest.fn().mockResolvedValue(true),
    deleteMessage: jest.fn().mockResolvedValue(true),
    getChatMembersCount: jest.fn().mockResolvedValue(12),
  } as any;
}

/** findOneAndUpdate echoes the $set onto the existing doc, like Mongo would. */
function existing(doc: Record<string, unknown> | null) {
  (Group.findOne as jest.Mock).mockResolvedValue(doc);
  (Group.findOneAndUpdate as jest.Mock).mockImplementation(async (_q, update) => ({
    _id: 'g1',
    groupName: 'Team',
    telegramGroupId: -100,
    ...(doc ?? {}),
    ...(update.$set ?? update),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  claimed.clear();
  (configService as any).botOwnerTelegramId = 42;
});

describe('statusOnAdd — re-add rules', () => {
  it.each([
    ['new group', null, GroupStatus.PENDING],
    ['removed while active → active again', { status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.ACTIVE }, GroupStatus.ACTIVE],
    ['removed while suspended → still suspended', { status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.SUSPENDED }, GroupStatus.SUSPENDED],
    ['removed while pending → asks again', { status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.PENDING }, GroupStatus.PENDING],
    ['rejected → asks again', { status: GroupStatus.REJECTED }, GroupStatus.PENDING],
    ['already active → unchanged', { status: GroupStatus.ACTIVE }, GroupStatus.ACTIVE],
  ])('%s', (_label, doc, expected) => {
    expect(statusOnAdd(doc as any, false)).toBe(expected);
  });

  it('without an owner id new groups are approved, but a rejection is never overridden', () => {
    expect(statusOnAdd(null, true)).toBe(GroupStatus.ACTIVE);
    expect(statusOnAdd({ status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.PENDING } as any, true)).toBe(GroupStatus.ACTIVE);
    expect(statusOnAdd({ status: GroupStatus.REJECTED } as any, true)).toBe(GroupStatus.PENDING);
  });
});

describe('onBotAdded', () => {
  it('new group: PENDING, one note in the group, an Approve / Reject card for the owner', async () => {
    existing(null);
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, chat, adder, 'TaskBot');

    const set = (Group.findOneAndUpdate as jest.Mock).mock.calls[0][1].$set;
    expect(set).toEqual(
      expect.objectContaining({
        status: GroupStatus.PENDING,
        addedBy: { telegramUserId: 7, name: 'An Nguyen', username: 'an' },
        memberCount: 12,
        addedAt: expect.any(Date),
      }),
    );
    expect(tg.sendMessage).toHaveBeenCalledTimes(2);
    const [groupChat, notice] = tg.sendMessage.mock.calls[0];
    expect(groupChat).toBe(-100);
    expect(notice).toContain('not your group admins');

    const [ownerChat, card, extra] = tg.sendMessage.mock.calls[1];
    expect(ownerChat).toBe(42);
    expect(card).toContain('New group wants to use the bot');
    expect(card).toContain('Added by: @an');
    expect(card).toContain('Members: 12');
    expect(extra.reply_markup.inline_keyboard).toEqual([
      [
        { text: '✅ Approve', callback_data: 'gapp:ok:g1' },
        { text: '🚫 Reject', callback_data: 'gapp:no:g1' },
      ],
    ]);
    expect(Group.updateOne).toHaveBeenCalledWith({ _id: 'g1' }, { $set: { approvalMessage: { chatId: 42, messageId: 900 } } });
  });

  it('posts the request only once when the add event and the first message race', async () => {
    existing(null);
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, chat, adder, 'TaskBot');
    await groupLifecycleService.onBotAdded(tg, chat, adder, 'TaskBot');
    expect(tg.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('a previously rejected group asks again, with the history on the card', async () => {
    existing({
      _id: 'g1',
      status: GroupStatus.REJECTED,
      statusReason: 'spam',
      statusChangedAt: new Date('2026-10-20T10:00:00Z'),
      addedAt: new Date('2026-10-19T10:00:00Z'),
    });
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, chat, adder, 'TaskBot');
    const set = (Group.findOneAndUpdate as jest.Mock).mock.calls[0][1].$set;
    expect(set.status).toBe(GroupStatus.PENDING);
    expect(set.statusReason).toBeNull();
    expect(tg.sendMessage.mock.calls[1][1]).toContain('History: Rejected on 2026-10-20: spam');
  });

  it('re-added after being removed while approved: restores ACTIVE, says it is back, no owner card', async () => {
    existing({ _id: 'g1', status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.ACTIVE, addedAt: new Date() });
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, chat, adder, 'TaskBot');
    const set = (Group.findOneAndUpdate as jest.Mock).mock.calls[0][1].$set;
    expect(set).toEqual(expect.objectContaining({ status: GroupStatus.ACTIVE, statusBeforeLeft: null, botLeftAt: null }));
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    expect(tg.sendMessage.mock.calls[0][1]).toContain('The bot is back');
  });

  it('no owner id: approved right away, nothing posted, nobody DMed', async () => {
    (configService as any).botOwnerTelegramId = null;
    existing(null);
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, chat, adder, 'TaskBot');
    const set = (Group.findOneAndUpdate as jest.Mock).mock.calls[0][1].$set;
    expect(set).toEqual(expect.objectContaining({ status: GroupStatus.ACTIVE, approvedAt: expect.any(Date) }));
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it('owner never started the bot: the group is still pending and the failure is only logged', async () => {
    existing(null);
    const tg = telegram();
    tg.sendMessage.mockResolvedValueOnce({ message_id: 1 }).mockRejectedValueOnce(new Error('403: bot can\'t initiate conversation'));
    await expect(groupLifecycleService.onBotAdded(tg, chat, adder, 'TaskBot')).resolves.toEqual(
      expect.objectContaining({ status: GroupStatus.PENDING }),
    );
    expect(Group.updateOne).not.toHaveBeenCalled();
  });
});

describe('a never-seen supergroup (maybe an upgraded group whose migrate message is still on its way)', () => {
  const supergroup = { id: -1001, title: 'Team', type: 'supergroup' as const, is_forum: false };
  let scheduled: { fn: () => Promise<void>; ms: number }[];
  const original = groupLifecycleService.schedule;

  beforeEach(() => {
    scheduled = [];
    groupLifecycleService.schedule = (fn, ms) => void scheduled.push({ fn, ms });
  });
  afterAll(() => {
    groupLifecycleService.schedule = original;
  });

  it('waits a few seconds before the note and the owner card, then announces once', async () => {
    existing(null);
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, supergroup, adder, 'TaskBot');

    expect(tg.sendMessage).not.toHaveBeenCalled();
    // addedAt stays empty until the announcement (keeps the gate quiet, lets a lost timer be retried).
    expect((Group.findOneAndUpdate as jest.Mock).mock.calls[0][1].$set.addedAt).toBeUndefined();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].ms).toBe(NEW_SUPERGROUP_ANNOUNCE_DELAY_MS);

    await scheduled[0].fn();
    expect((Group.findOneAndUpdate as jest.Mock).mock.calls[1][0]).toEqual({ telegramGroupId: -1001, status: GroupStatus.PENDING, addedAt: null });
    expect(tg.sendMessage).toHaveBeenCalledTimes(2);
    expect(tg.sendMessage.mock.calls[0][1]).toContain('not your group admins');
    expect(tg.sendMessage.mock.calls[1][0]).toBe(42);
  });

  it('more updates while waiting: still one timer', async () => {
    existing(null);
    await groupLifecycleService.onBotAdded(telegram(), supergroup, null, 'TaskBot');
    existing({ _id: 'g1', status: GroupStatus.PENDING, addedAt: null });
    await groupLifecycleService.onBotAdded(telegram(), supergroup, null, 'TaskBot');
    expect(scheduled).toHaveLength(1);
  });

  it('the upgrade race: the migrate message lands meanwhile → no stray note, no owner card, no correction', async () => {
    existing(null);
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, supergroup, null, 'TaskBot');

    // migrate_from_chat_id arrives: the empty new doc (never announced) is merged into the approved old group.
    const oldDoc = { _id: 'old', telegramGroupId: -100, groupName: 'Team', status: GroupStatus.ACTIVE };
    const newDoc = { _id: 'g1', telegramGroupId: -1001, status: GroupStatus.PENDING, addedAt: null };
    (Group.findOne as jest.Mock).mockImplementation(async (q) => (q.telegramGroupId === -100 ? oldDoc : newDoc));
    await groupLifecycleService.migrateChat(tg, -100, -1001);
    expect(Group.deleteOne).toHaveBeenCalledWith({ _id: 'g1' });

    // The timer fires: the chat now belongs to the approved group, so there is nothing to announce.
    (Group.findOneAndUpdate as jest.Mock).mockResolvedValue(null);
    await scheduled[0].fn();
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it('decided before the timer fired (e.g. approved in the admin app): nothing posted', async () => {
    existing(null);
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, supergroup, adder, 'TaskBot');
    (Group.findOneAndUpdate as jest.Mock).mockResolvedValue(null);
    await scheduled[0].fn();
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  it('basic groups and re-adds are announced right away (no upgrade possible / already known)', async () => {
    existing(null);
    const tg = telegram();
    await groupLifecycleService.onBotAdded(tg, { ...chat, type: 'group' }, adder, 'TaskBot');
    expect(scheduled).toHaveLength(0);
    expect(tg.sendMessage).toHaveBeenCalledTimes(2);

    claimed.clear();
    existing({ _id: 'g1', status: GroupStatus.REJECTED, addedAt: new Date() });
    const again = telegram();
    await groupLifecycleService.onBotAdded(again, supergroup, adder, 'TaskBot');
    expect(scheduled).toHaveLength(0);
    expect(again.sendMessage).toHaveBeenCalledTimes(2);
  });
});

describe('approvalHistory', () => {
  it('describes a request that was removed before a decision', () => {
    expect(
      approvalHistory({
        status: GroupStatus.LEFT,
        statusBeforeLeft: GroupStatus.PENDING,
        addedAt: new Date('2026-10-01T00:00:00Z'),
        botLeftAt: new Date('2026-10-02T00:00:00Z'),
      } as any),
    ).toBe('Added on 2026-10-01, removed on 2026-10-02 before you decided');
    expect(approvalHistory({ status: GroupStatus.ACTIVE } as any)).toBeNull();
  });
});

describe('onBotRemoved', () => {
  it('kicked from an active group → LEFT, remembering it was active', async () => {
    (Group.findOne as jest.Mock).mockResolvedValue({ _id: 'g1', status: GroupStatus.ACTIVE, groupName: 'Team' });
    (Group.findOneAndUpdate as jest.Mock).mockResolvedValue({ _id: 'g1', status: GroupStatus.LEFT });
    await groupLifecycleService.onBotRemoved(telegram(), -100);
    expect((Group.findOneAndUpdate as jest.Mock).mock.calls[0][1].$set).toEqual(
      expect.objectContaining({ status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.ACTIVE, botLeftAt: expect.any(Date) }),
    );
  });

  it('leaving after a rejection keeps REJECTED (the decision stays visible)', async () => {
    (Group.findOne as jest.Mock).mockResolvedValue({ _id: 'g1', status: GroupStatus.REJECTED, groupName: 'Team' });
    (Group.findOneAndUpdate as jest.Mock).mockResolvedValue({ _id: 'g1', status: GroupStatus.REJECTED });
    await groupLifecycleService.onBotRemoved(telegram(), -100);
    expect((Group.findOneAndUpdate as jest.Mock).mock.calls[0][1].$set).toEqual({ botLeftAt: expect.any(Date) });
  });

  it('removed while pending: the owner card is closed (no live buttons)', async () => {
    const card = { chatId: 42, messageId: 900 };
    (Group.findOne as jest.Mock).mockResolvedValue({ _id: 'g1', status: GroupStatus.PENDING, groupName: 'Team' });
    (Group.findOneAndUpdate as jest.Mock).mockResolvedValue({ _id: 'g1', status: GroupStatus.LEFT, groupName: 'Team', approvalMessage: card });
    const tg = telegram();
    await groupLifecycleService.onBotRemoved(tg, -100);
    const [chatId, messageId, , text, extra] = tg.editMessageText.mock.calls[0];
    expect([chatId, messageId]).toEqual([42, 900]);
    expect(text).toContain('Now: Bot removed');
    expect(extra.reply_markup).toBeUndefined();
  });
});

describe('migrateChat (basic group → supergroup)', () => {
  const oldDoc = { _id: 'old', telegramGroupId: -100, groupName: 'Team', status: GroupStatus.ACTIVE };

  it('moves the group to the new chat id and forgets cards posted in the old chat', async () => {
    (Group.findOne as jest.Mock).mockImplementation(async (q) => (q.telegramGroupId === -100 ? oldDoc : null));
    await groupLifecycleService.migrateChat(telegram(), -100, -1001, true);
    expect(Group.updateOne).toHaveBeenCalledWith(
      { _id: 'old' },
      { $set: expect.objectContaining({ telegramGroupId: -1001, isForum: true }) },
    );
    expect(Task.updateMany).toHaveBeenCalledWith(
      { groupId: 'old', taskCardChatId: -100 },
      { $set: { taskCardChatId: null, taskCardMessageId: null } },
    );
    expect(Group.deleteOne).not.toHaveBeenCalled();
  });

  it('an empty doc auto-created for the new chat is merged into the old one and dropped', async () => {
    const newDoc = { _id: 'new', telegramGroupId: -1001, status: GroupStatus.PENDING, approvalMessage: { chatId: 42, messageId: 5 } };
    (Group.findOne as jest.Mock).mockImplementation(async (q) => (q.telegramGroupId === -100 ? oldDoc : newDoc));
    (GroupMember.find as jest.Mock).mockResolvedValue([{ userId: 'u1', telegramUserId: 7, joinedAt: new Date() }]);
    const tg = telegram();
    await groupLifecycleService.migrateChat(tg, -100, -1001);

    expect(GroupMember.updateOne).toHaveBeenCalledWith(
      { groupId: 'old', userId: 'u1' },
      { $setOnInsert: expect.objectContaining({ groupId: 'old', userId: 'u1', telegramUserId: 7 }) },
      { upsert: true },
    );
    expect(ApiToken.updateMany).toHaveBeenCalledWith({ groupId: 'new' }, { $set: { groupId: 'old' } });
    expect(Group.deleteOne).toHaveBeenCalledWith({ _id: 'new' });
    expect(tg.deleteMessage).toHaveBeenCalledWith(42, 5);
    expect(Group.updateOne).toHaveBeenCalledWith({ _id: 'old' }, { $set: expect.objectContaining({ telegramGroupId: -1001 }) });
  });

  it('the new chat already heard "waiting for approval": an approved group gets a one-line correction', async () => {
    const newDoc = { _id: 'new', telegramGroupId: -1001, status: GroupStatus.PENDING, addedAt: new Date() };
    (Group.findOne as jest.Mock).mockImplementation(async (q) => (q.telegramGroupId === -100 ? oldDoc : newDoc));
    (GroupMember.find as jest.Mock).mockResolvedValue([]);
    const tg = telegram();
    await groupLifecycleService.migrateChat(tg, -100, -1001);
    expect(tg.sendMessage).toHaveBeenCalledTimes(1);
    expect(tg.sendMessage).toHaveBeenCalledWith(-1001, expect.stringContaining('Never mind the note above'), expect.anything());
  });

  it('never drops a new doc that has tasks: both kept, the old one marked migrated', async () => {
    const newDoc = { _id: 'new', telegramGroupId: -1001, status: GroupStatus.ACTIVE };
    (Group.findOne as jest.Mock).mockImplementation(async (q) => (q.telegramGroupId === -100 ? oldDoc : newDoc));
    (Task.countDocuments as jest.Mock).mockResolvedValueOnce(3);
    await groupLifecycleService.migrateChat(telegram(), -100, -1001);
    expect(Group.deleteOne).not.toHaveBeenCalled();
    expect(Group.updateOne).toHaveBeenCalledWith(
      { _id: 'old' },
      { $set: expect.objectContaining({ status: GroupStatus.MIGRATED, migratedToChatId: -1001 }) },
    );
    expect(Epic.countDocuments).toHaveBeenCalled();
  });

  it('is idempotent: nothing to do once the old id is gone', async () => {
    (Group.findOne as jest.Mock).mockResolvedValue(null);
    await groupLifecycleService.migrateChat(telegram(), -100, -1001);
    expect(Group.updateOne).not.toHaveBeenCalled();
  });
});
