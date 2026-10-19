import mongoose from 'mongoose';
import { handleTaskCallback } from 'src/bot/task-callback.handler';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { User } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { notificationService } from 'src/shared/services/notification.service';

jest.mock('src/database/services/task.service');
jest.mock('src/database/services/user.service');
jest.mock('src/database/services/group-member.service', () => ({ groupMemberService: { getMembers: jest.fn() } }));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { record: jest.fn() } }));
jest.mock('src/database/models/group.model', () => ({ Group: { findById: jest.fn().mockResolvedValue(null) } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: {
    notifyAssignment: jest.fn(),
    notifyStatusChange: jest.fn(),
    notifyUnassigned: jest.fn(),
  },
}));
jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { setCallbackData: jest.fn(), getCallbackData: jest.fn() },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const groupId = new mongoose.Types.ObjectId();
const taskId = new mongoose.Types.ObjectId();
const bob = { _id: new mongoose.Types.ObjectId(), telegramUserId: 1, username: 'bob' };
const an = { _id: new mongoose.Types.ObjectId(), telegramUserId: 2, username: 'an_dev' };

function task(overrides: Record<string, unknown> = {}) {
  return {
    _id: taskId,
    groupId,
    taskNumber: 12,
    title: 'Fix login',
    type: 'bug',
    status: 'todo',
    priority: 'medium',
    createdBy: bob,
    assigneeId: null,
    ...overrides,
  } as any;
}

function ctxFor(action: string) {
  return {
    chat: { id: -100, type: 'supergroup' },
    callbackQuery: { data: `task:${action}:k`, from: { id: bob.telegramUserId }, message: { message_id: 77 } },
    answerCbQuery: jest.fn(),
    editMessageText: jest.fn(),
    editMessageReplyMarkup: jest.fn(),
    telegram: { sendMessage: jest.fn(), getChatMember: jest.fn() },
  } as any;
}

describe('task callbacks', () => {
  beforeEach(() => {
    configService.botUsername = 'tbot';
    (userService.findUserByTelegramId as jest.Mock).mockResolvedValue(bob);
  });

  it('delete asks for confirmation first and does not delete', async () => {
    (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'delete' });
    (taskService.getTaskById as jest.Mock).mockResolvedValue(task());
    const ctx = ctxFor('delete');

    await handleTaskCallback(ctx);

    expect(taskService.deleteTask).not.toHaveBeenCalled();
    const [text, opts] = ctx.editMessageText.mock.calls[0];
    expect(text).toContain("*Delete #12 for everyone?*\nThis removes the task from the board and can't be undone.");
    expect(opts.reply_markup.inline_keyboard[0].map((b: any) => b.text)).toEqual(['🗑 Yes, delete', '« Cancel']);
  });

  it('confirmed delete by a non-creator non-admin is refused', async () => {
    (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'delete_confirm' });
    (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ createdBy: an }));
    const ctx = ctxFor('delete_confirm');
    ctx.telegram.getChatMember.mockResolvedValue({ status: 'member' });

    await handleTaskCallback(ctx);

    expect(taskService.deleteTask).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('Only the task creator'), {
      show_alert: true,
    });
  });

  it('confirmed delete edits the card in place and records activity', async () => {
    (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'delete_confirm' });
    (taskService.getTaskById as jest.Mock).mockResolvedValue(task());
    (taskService.deleteTask as jest.Mock).mockResolvedValue(true);
    const ctx = ctxFor('delete_confirm');

    await handleTaskCallback(ctx);

    expect(ctx.editMessageText.mock.calls[0][0]).toContain('🗑 *#12 deleted* by @bob');
    expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted' }));
  });

  it('priority change edits the card with a human toast and no group message', async () => {
    (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({
      taskId,
      action: 'set_priority',
      value: 'urgent',
    });
    (taskService.getTaskById as jest.Mock).mockResolvedValue(task());
    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ priority: 'urgent' }));
    const ctx = ctxFor('set_priority');

    await handleTaskCallback(ctx);

    expect(ctx.answerCbQuery).toHaveBeenCalledWith('Priority: Urgent');
    expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'priority', from: '➡️ Medium', to: '🔴 Urgent' }),
    );
  });

  it('status change passes changedBy, posts one line and DMs the assignee', async () => {
    (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({
      taskId,
      action: 'set_status',
      value: 'in_review',
    });
    (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ status: 'in_progress', assigneeId: an }));
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(task({ status: 'in_review', assigneeId: an }));
    const ctx = ctxFor('set_status');

    await handleTaskCallback(ctx);

    expect(taskService.updateTaskStatus).toHaveBeenCalledWith(taskId, 'in_review', bob._id);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('Status: In review');
    expect(ctx.telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(ctx.telegram.sendMessage.mock.calls[0][1]).toBe('👀 @bob sent for review *#12* · Fix login');
    expect(notificationService.notifyStatusChange).toHaveBeenCalled();
  });

  it('assigning someone who never started the bot adds a hint to the group line', async () => {
    (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({
      taskId,
      action: 'assign_to',
      assigneeUserId: an._id.toString(),
    });
    (taskService.getTaskById as jest.Mock).mockResolvedValue(task());
    (User.findById as jest.Mock).mockResolvedValue(an);
    (taskService.assignTask as jest.Mock).mockResolvedValue(task({ assigneeId: an }));
    (notificationService.notifyAssignment as jest.Mock).mockResolvedValue('not_started');
    const ctx = ctxFor('assign_to');

    await handleTaskCallback(ctx);

    const line = ctx.telegram.sendMessage.mock.calls[0][1] as string;
    expect(line).toContain('@bob assigned *#12* to @an\\_dev');
    expect(line).toContain("hasn't started a private chat with me");
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('Assigned to @an_dev');
  });

  describe('status lines are events', () => {
    const statusSetup = () => {
      (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'status_start' });
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task());
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(task({ status: 'in_progress' }));
    };

    it('normal group: threaded under the card exactly as before', async () => {
      statusSetup();
      (Group.findById as jest.Mock).mockResolvedValue({ _id: groupId, telegramGroupId: -100, isForum: false });
      const ctx = ctxFor('status_start');

      await handleTaskCallback(ctx);

      expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(-100, '🔄 @bob started *#12* · Fix login', {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_parameters: { message_id: 77, allow_sending_without_reply: true },
      });
    });

    it('forum: goes to the "Task events" topic, replying to the card across topics', async () => {
      statusSetup();
      (Group.findById as jest.Mock).mockResolvedValue({
        _id: groupId,
        telegramGroupId: -100,
        isForum: true,
        eventsTopicId: 500,
        knownTopics: [],
      });
      const ctx = ctxFor('status_start');
      ctx.chat.is_forum = true;
      ctx.callbackQuery.message = { message_id: 77, message_thread_id: 7, is_topic_message: true };

      await handleTaskCallback(ctx);

      expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(-100, '🔄 @bob started *#12* · Fix login', {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        message_thread_id: 500,
        reply_parameters: { message_id: 77 },
      });
    });
  });
});
