import {
  CREATE_FROM_REPLY_PREFIX,
  createFromReplyButton,
  handleCreateFromReplyCallback,
} from 'src/bot/create-from-reply';
import { groupService } from 'src/database/services/group.service';
import { userService } from 'src/database/services/user.service';
import { redisService } from 'src/shared/services/redis.service';
import { createTasksFromInput } from 'src/shared/services/task-creation.service';

const store = new Map<string, string>();

jest.mock('src/shared/services/redis.service', () => ({
  redisService: {
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  },
}));
jest.mock('src/shared/services/task-creation.service', () => ({ createTasksFromInput: jest.fn() }));
jest.mock('src/database/services/user.service', () => ({ userService: { findOrCreateUser: jest.fn() } }));
jest.mock('src/database/services/group.service', () => ({ groupService: { findOrCreateGroup: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const CHAT = { id: -1001234567890, type: 'supergroup', title: 'Team' };
const BOT_ID = 999;

function commandCtx(reply?: Record<string, unknown>) {
  return {
    chat: CHAT,
    botInfo: { id: BOT_ID },
    message: { message_id: 50, text: '/tasks', ...(reply ? { reply_to_message: reply } : {}) },
  } as never;
}

function callbackCtx(data: string, keyboard: unknown[][]) {
  return {
    chat: CHAT,
    from: { id: 7 },
    callbackQuery: { data, message: { reply_markup: { inline_keyboard: keyboard } } },
    answerCbQuery: jest.fn().mockResolvedValue(true),
    editMessageReplyMarkup: jest.fn().mockResolvedValue(true),
  };
}

describe('create tasks from a /tasks reply', () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
  });

  it('offers no button when /tasks is not a reply', async () => {
    expect(await createFromReplyButton(commandCtx())).toBeNull();
  });

  it('offers no button for replies to the bot itself or text-less messages', async () => {
    expect(await createFromReplyButton(commandCtx({ message_id: 9, from: { id: BOT_ID }, text: 'card' }))).toBeNull();
    expect(await createFromReplyButton(commandCtx({ message_id: 9, from: { id: 3 }, photo: [] }))).toBeNull();
  });

  it('offers a button and stores the replied message', async () => {
    const button = await createFromReplyButton(
      commandCtx({ message_id: 9, date: 1, from: { id: 3, first_name: 'Lan' }, text: 'meeting: @an fix login' }),
    );
    expect(button).toMatchObject({ text: '📝 Create tasks from that message' });
    expect((button as { callback_data: string }).callback_data.startsWith(`${CREATE_FROM_REPLY_PREFIX}go:`)).toBe(true);
    expect(store.size).toBe(1);
    expect(JSON.parse([...store.values()][0]).message).toMatchObject({ messageId: 9, text: 'meeting: @an fix login' });
  });

  it('creates tasks once, then removes only its own button', async () => {
    const button = (await createFromReplyButton(
      commandCtx({ message_id: 9, date: 1, from: { id: 3, first_name: 'Lan' }, text: 'fix login' }),
    )) as { callback_data: string };
    (userService.findOrCreateUser as jest.Mock).mockResolvedValue({ _id: 'u7' });
    (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue({ _id: 'g1' });
    const board = { text: '📋 Open board', url: 'https://t.me/x' };
    const ctx = callbackCtx(button.callback_data, [[button], [board]]);

    await handleCreateFromReplyCallback(ctx as never);

    expect(createTasksFromInput).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ messages: [expect.objectContaining({ messageId: 9 })], requester: { _id: 'u7' } }),
    );
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({ inline_keyboard: [[board]] });
    expect(redisService.del).toHaveBeenCalled();

    // A second tap (or another member) finds the button already used
    const again = callbackCtx(button.callback_data, [[board]]);
    await handleCreateFromReplyCallback(again as never);
    expect(createTasksFromInput).toHaveBeenCalledTimes(1);
    expect(again.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('expired'), { show_alert: true });
  });

  it('shows an alert when creating fails', async () => {
    const button = (await createFromReplyButton(
      commandCtx({ message_id: 9, date: 1, from: { id: 3, first_name: 'Lan' }, text: 'fix login' }),
    )) as { callback_data: string };
    (userService.findOrCreateUser as jest.Mock).mockRejectedValue(new Error('db down'));
    const ctx = callbackCtx(button.callback_data, [[button]]);

    await handleCreateFromReplyCallback(ctx as never);

    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'), { show_alert: true });
  });
});
