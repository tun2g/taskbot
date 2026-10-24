import mongoose from 'mongoose';
import { handleBatchCallback } from 'src/bot/ai-batch-callback.handler';
import { taskService } from 'src/database/services/task.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { redisService } from 'src/shared/services/redis.service';

jest.mock('src/database/services/subtask.service', () => ({
  subtaskService: { detachAll: jest.fn().mockResolvedValue([]), list: jest.fn().mockResolvedValue([]) },
}));
jest.mock('src/shared/services/task-creation.service', () => ({
  BATCH_CALLBACK_PREFIX: 'batch_cb',
  BATCH_UNDO_WINDOW_MS: 10 * 60 * 1000,
}));
jest.mock('src/database/services/task.service', () => ({
  taskService: { getTasksByBatch: jest.fn(), deleteTasks: jest.fn() },
}));
jest.mock('src/database/services/task-activity.service', () => ({
  taskActivityService: { record: jest.fn(), recordMany: jest.fn() },
}));
jest.mock('src/database/services/user.service', () => ({
  userService: { findUserByTelegramId: jest.fn().mockResolvedValue({ _id: 'u1' }) },
}));
jest.mock('src/shared/services/redis.service', () => ({
  redisService: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));
jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { delCallbackData: jest.fn() },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('src/shared/utils/app-links', () => ({
  boardButton: jest.fn(() => ({ text: '📋 Open board', url: 'https://t.me/bot?startapp=g' })),
}));

const groupId = new mongoose.Types.ObjectId();
const tasks = [
  { _id: new mongoose.Types.ObjectId(), groupId, taskNumber: 3, type: 'bug', title: 'A' },
  { _id: new mongoose.Types.ObjectId(), groupId, taskNumber: 4, type: 'task', title: 'B <c>' },
];

function batch(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    batchId: 'b1',
    groupId: groupId.toString(),
    chatId: -100123,
    requesterTelegramId: 123,
    requesterName: '@req',
    count: 2,
    createdAt: Date.now(),
    ...overrides,
  });
}

function createCtx(fromId = 123, data = 'batch:undo:k1', adminStatus = 'member') {
  return {
    callbackQuery: {
      data,
      from: { id: fromId, username: fromId === 123 ? 'req' : 'other' },
      message: {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '↩️ Undo', callback_data: 'batch:undo:k1' },
              { text: '📱 Open board', url: 'https://x' },
            ],
          ],
        },
      },
    },
    telegram: { getChatMember: jest.fn().mockResolvedValue({ status: adminStatus }) },
    answerCbQuery: jest.fn().mockResolvedValue(true),
    editMessageText: jest.fn().mockResolvedValue(true),
    editMessageReplyMarkup: jest.fn().mockResolvedValue(true),
  } as any;
}

describe('handleBatchCallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (redisService.set as jest.Mock).mockResolvedValue('OK');
    (taskService.getTasksByBatch as jest.Mock).mockResolvedValue(tasks);
    (taskService.deleteTasks as jest.Mock).mockResolvedValue(2);
  });

  it('lets the requester undo within 10 minutes', async () => {
    (redisService.get as jest.Mock).mockResolvedValue(batch());
    const ctx = createCtx();

    await handleBatchCallback(ctx);

    expect(taskService.getTasksByBatch).toHaveBeenCalledWith('b1');
    expect(taskService.deleteTasks).toHaveBeenCalledWith(tasks.map((t) => t._id));
    // One write for the whole batch, an entry per task.
    expect(taskActivityService.recordMany).toHaveBeenCalledTimes(1);
    const entries = (taskActivityService.recordMany as jest.Mock).mock.calls[0][0];
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(expect.objectContaining({ action: 'deleted', from: 'A' }));
    // The list stays (struck through) with the board button, instead of a dead-end line.
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      '↩️ <b>Undone by @req</b> · 2 tasks removed\n\n<s>#3 🐞 A</s>\n<s>#4 📌 B &lt;c&gt;</s>',
      expect.objectContaining({
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '📋 Open board', url: 'https://t.me/bot?startapp=g' }]] },
      }),
    );
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('Undone');
  });

  it('says the tasks were already deleted when there is nothing left to undo', async () => {
    (redisService.get as jest.Mock).mockResolvedValue(batch());
    (taskService.getTasksByBatch as jest.Mock).mockResolvedValue([]);
    const ctx = createCtx();

    await handleBatchCallback(ctx);

    expect(taskService.deleteTasks).not.toHaveBeenCalled();
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      '↩️ <b>Undo by @req</b> · nothing to remove — these tasks were already deleted.',
      expect.objectContaining({ reply_markup: { inline_keyboard: [[expect.objectContaining({ text: '📋 Open board' })]] } }),
    );
  });

  it('lets a group admin undo', async () => {
    (redisService.get as jest.Mock).mockResolvedValue(batch());
    const ctx = createCtx(777, 'batch:undo:k1', 'administrator');

    await handleBatchCallback(ctx);

    expect(ctx.telegram.getChatMember).toHaveBeenCalledWith(-100123, 777);
    expect(taskService.deleteTasks).toHaveBeenCalled();
  });

  it('refuses other members with an alert and keeps the message', async () => {
    (redisService.get as jest.Mock).mockResolvedValue(batch());
    const ctx = createCtx(777);

    await handleBatchCallback(ctx);

    expect(taskService.deleteTasks).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('Only @req or a group admin can undo this.', { show_alert: true });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it('refuses after 10 minutes and removes only the Undo button', async () => {
    (redisService.get as jest.Mock).mockResolvedValue(batch({ createdAt: Date.now() - 11 * 60 * 1000 }));
    const ctx = createCtx();

    await handleBatchCallback(ctx);

    expect(taskService.deleteTasks).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('10 minutes'), { show_alert: true });
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
      inline_keyboard: [[{ text: '📱 Open board', url: 'https://x' }]],
    });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it('treats missing batch data as expired', async () => {
    (redisService.get as jest.Mock).mockResolvedValue(null);
    const ctx = createCtx();
    await handleBatchCallback(ctx);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('10 minutes'), { show_alert: true });
  });

  it('ignores a double tap while an undo is running', async () => {
    (redisService.get as jest.Mock).mockResolvedValue(batch());
    (redisService.set as jest.Mock).mockResolvedValue(null);
    const ctx = createCtx();
    await handleBatchCallback(ctx);
    expect(taskService.deleteTasks).not.toHaveBeenCalled();
  });

  it('answers batch:noop silently', async () => {
    const ctx = createCtx(123, 'batch:noop');
    await handleBatchCallback(ctx);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith();
  });
});
