import { GroupStatus } from '@tbot/shared';
import { groupGateMiddleware } from 'src/bot/middlewares/group-gate.middleware';
import { groupLifecycleMiddleware } from 'src/bot/middlewares/group-lifecycle.middleware';
import { groupService } from 'src/database/services/group.service';
import { groupLifecycleService } from 'src/shared/services/group-lifecycle.service';
import { redisService } from 'src/shared/services/redis.service';

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
jest.mock('src/database/services/group.service', () => ({ groupService: { findGroupByTelegramId: jest.fn() } }));
jest.mock('src/shared/services/group-lifecycle.service', () => ({
  groupLifecycleService: {
    onBotAdded: jest.fn(async () => ({ _id: 'g1', status: 'pending' })),
    onBotRemoved: jest.fn(),
    migrateChat: jest.fn(),
  },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const botInfo = { id: 999, username: 'TaskBot', first_name: 'TaskBot' };
const next = jest.fn().mockResolvedValue(undefined);

function command(text = '/tasks', chat: Record<string, unknown> = {}) {
  return {
    chat: { id: -100, type: 'supergroup', title: 'Team', ...chat },
    from: { id: 7, is_bot: false, first_name: 'An' },
    botInfo,
    state: {},
    message: { message_id: 5, text, entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : [] },
    update: {},
    telegram: {},
    reply: jest.fn().mockResolvedValue({}),
    answerCbQuery: jest.fn().mockResolvedValue(true),
  } as any;
}

function withGroup(status: GroupStatus, statusReason: string | null = null, extra: Record<string, unknown> = {}) {
  (groupService.findGroupByTelegramId as jest.Mock).mockResolvedValue({ _id: 'g1', status, statusReason, addedAt: new Date(), ...extra });
}

beforeEach(() => {
  jest.clearAllMocks();
  claimed.clear();
});

describe('groupGateMiddleware', () => {
  it('active groups pass through', async () => {
    withGroup(GroupStatus.ACTIVE);
    const ctx = command();
    await groupGateMiddleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('private chats always pass (e.g. /mcp, /start)', async () => {
    const ctx = command('/mcp', { id: 7, type: 'private' });
    await groupGateMiddleware(ctx, next);
    expect(next).toHaveBeenCalled();
    expect(groupService.findGroupByTelegramId).not.toHaveBeenCalled();
  });

  it('pending: a command is swallowed with one "waiting for approval" reply', async () => {
    withGroup(GroupStatus.PENDING);
    const ctx = command();
    await groupGateMiddleware(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("waiting for the bot owner's approval. Messages sent now aren't saved"),
      expect.objectContaining({ parse_mode: 'HTML', reply_parameters: expect.objectContaining({ message_id: 5 }) }),
    );
  });

  it('the reply goes out at most once per group per 6 hours', async () => {
    withGroup(GroupStatus.PENDING);
    const first = command('/task fix login');
    const second = command('/tasks');
    await groupGateMiddleware(first, next);
    await groupGateMiddleware(second, next);
    expect(first.reply).toHaveBeenCalledTimes(1);
    expect(second.reply).not.toHaveBeenCalled();
    expect(redisService.set).toHaveBeenCalledWith('group:gate-notice:-100', '1', { NX: true, EX: 6 * 60 * 60 });
    expect(next).not.toHaveBeenCalled();
  });

  it('pending but not announced yet (new supergroup, maybe an upgrade in progress): swallowed silently', async () => {
    withGroup(GroupStatus.PENDING, null, { addedAt: null });
    const ctx = command();
    await groupGateMiddleware(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('suspended: the reply includes the owner reason', async () => {
    withGroup(GroupStatus.SUSPENDED, 'Unpaid invoice');
    const ctx = command(`hey @TaskBot what's due?`);
    await groupGateMiddleware(ctx, next);
    expect(ctx.reply.mock.calls[0][0]).toContain('paused in this group by its owner');
    expect(ctx.reply.mock.calls[0][0]).toContain('Reason: Unpaid invoice');
  });

  it('plain chatter and commands for other bots are swallowed silently', async () => {
    withGroup(GroupStatus.PENDING);
    const chatter = command('lunch?');
    const otherBot = command('/start@OtherBot');
    await groupGateMiddleware(chatter, next);
    await groupGateMiddleware(otherBot, next);
    expect(chatter.reply).not.toHaveBeenCalled();
    expect(otherBot.reply).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('buttons get a toast instead of a message', async () => {
    withGroup(GroupStatus.SUSPENDED, 'Unpaid');
    const ctx = { ...command(), message: undefined, callbackQuery: { id: '1', data: 'task:x' } };
    await groupGateMiddleware(ctx, next);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith("⏸ The bot owner paused the bot in this group. Tasks are kept but can't be changed for now. Reason: Unpaid", { show_alert: true });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejected / removed groups stay silent', async () => {
    withGroup(GroupStatus.REJECTED);
    const ctx = command();
    await groupGateMiddleware(ctx, next);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('uses the group the lifecycle middleware already loaded', async () => {
    const ctx = command();
    ctx.state.group = { _id: 'g1', status: GroupStatus.ACTIVE };
    await groupGateMiddleware(ctx, next);
    expect(groupService.findGroupByTelegramId).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});

describe('groupLifecycleMiddleware', () => {
  function memberUpdate(oldStatus: string, newStatus: string) {
    const ctx = command();
    ctx.message = undefined;
    ctx.update = {
      my_chat_member: {
        from: { id: 7, is_bot: false, first_name: 'An' },
        old_chat_member: { status: oldStatus, user: botInfo },
        new_chat_member: { status: newStatus, user: botInfo },
      },
    };
    return ctx;
  }

  it('bot added (my_chat_member) → onBotAdded with who added it', async () => {
    const ctx = memberUpdate('left', 'member');
    await groupLifecycleMiddleware(ctx, next);
    expect(groupLifecycleService.onBotAdded).toHaveBeenCalledWith(ctx.telegram, ctx.chat, expect.objectContaining({ id: 7 }), 'TaskBot');
    expect(ctx.state.group).toEqual({ _id: 'g1', status: 'pending' });
    expect(next).toHaveBeenCalled();
  });

  it('bot kicked → onBotRemoved, and the chain stops', async () => {
    const ctx = memberUpdate('administrator', 'kicked');
    await groupLifecycleMiddleware(ctx, next);
    expect(groupLifecycleService.onBotRemoved).toHaveBeenCalledWith(ctx.telegram, -100);
    expect(next).not.toHaveBeenCalled();
  });

  it('promotion (member → admin) is not an add', async () => {
    const ctx = memberUpdate('member', 'administrator');
    await groupLifecycleMiddleware(ctx, next);
    expect(groupLifecycleService.onBotAdded).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('a group never seen before (add event missed) is treated as an add', async () => {
    (groupService.findGroupByTelegramId as jest.Mock).mockResolvedValue(null);
    const ctx = command('hello');
    await groupLifecycleMiddleware(ctx, next);
    expect(groupLifecycleService.onBotAdded).toHaveBeenCalledWith(ctx.telegram, ctx.chat, null, 'TaskBot');
    expect(next).toHaveBeenCalled();
  });

  it('known active groups only record activity', async () => {
    (groupService.findGroupByTelegramId as jest.Mock).mockResolvedValue({ _id: 'g1', status: GroupStatus.ACTIVE });
    const ctx = command('hello');
    await groupLifecycleMiddleware(ctx, next);
    expect(groupLifecycleService.onBotAdded).not.toHaveBeenCalled();
    expect(ctx.state.group).toEqual({ _id: 'g1', status: GroupStatus.ACTIVE });
  });

  it('a late message from a just-rejected group does not re-open the request', async () => {
    (groupService.findGroupByTelegramId as jest.Mock).mockResolvedValue({ _id: 'g1', status: GroupStatus.REJECTED });
    await groupLifecycleMiddleware(command('hello'), next);
    expect(groupLifecycleService.onBotAdded).not.toHaveBeenCalled();
  });

  it('migrate_to_chat_id / migrate_from_chat_id move the group and stop the chain', async () => {
    const fromOld = command('x');
    fromOld.update = { message: { message_id: 1, migrate_to_chat_id: -1001 } };
    await groupLifecycleMiddleware(fromOld, next);
    const inNew = command('x', { id: -1001, is_forum: true });
    inNew.update = { message: { message_id: 1, migrate_from_chat_id: -100 } };
    await groupLifecycleMiddleware(inNew, next);

    expect(groupLifecycleService.migrateChat).toHaveBeenNthCalledWith(1, fromOld.telegram, -100, -1001);
    expect(groupLifecycleService.migrateChat).toHaveBeenNthCalledWith(2, inNew.telegram, -100, -1001, true);
    expect(groupLifecycleService.onBotAdded).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
