import { DoneCommand } from 'src/bot/commands/done';
import { userService } from 'src/database/services/user.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import mongoose from 'mongoose';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { notificationService } from 'src/shared/services/notification.service';
import { configService } from 'src/configs/configuration';
import { subtaskService } from 'src/database/services/subtask.service';
import { Group } from 'src/database/models/group.model';

jest.mock('src/database/services/subtask.service', () => ({
  subtaskService: { progress: jest.fn().mockResolvedValue(new Map()) },
}));
jest.mock('src/database/models/group.model', () => ({ Group: { findById: jest.fn().mockResolvedValue(null) } }));
jest.mock('src/database/services/user.service');
jest.mock('src/database/services/group.service');
jest.mock('src/database/services/task.service');
jest.mock('src/database/services/task-activity.service', () => ({
  taskActivityService: { record: jest.fn() },
}));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: { notifyStatusChange: jest.fn().mockResolvedValue('sent') },
}));
jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { setCallbackData: jest.fn() },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/logger/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const mockGroupId = new mongoose.Types.ObjectId();
const mockUserId = new mongoose.Types.ObjectId();
const mockTaskId = new mongoose.Types.ObjectId();

const mockUser = { _id: mockUserId, telegramUserId: 123, username: 'testuser', firstName: 'Test' };
const mockGroup = { _id: mockGroupId, telegramGroupId: -100123, groupName: 'Test Group' };

function createMockCtx(overrides: Record<string, any> = {}) {
  return {
    chat: { id: -100123, type: 'supergroup', title: 'Test Group' },
    message: {
      text: '/done',
      ...overrides.message,
    },
    reply: jest.fn().mockResolvedValue({}),
    telegram: { editMessageText: jest.fn().mockResolvedValue({}) },
    ...overrides,
  } as any;
}

describe('DoneCommand', () => {
  let command: DoneCommand;

  beforeEach(() => {
    command = new DoneCommand();
    jest.clearAllMocks();
    (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
    (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(mockGroup);
  });

  it('should register the done command', () => {
    const map = command.register();
    expect(map.has('done')).toBe(true);
  });

  it('should reject non-group chats', async () => {
    const ctx = createMockCtx({ chat: { id: 123, type: 'private' } });

    await command.onDone(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/done works in group chats. Send /start'), {});
  });

  it('offers "Add to group" in a private chat when the bot username is known', async () => {
    const saved = configService.botUsername;
    configService.botUsername = 'tbot';
    const ctx = createMockCtx({ chat: { id: 123, type: 'private' } });

    await command.onDone(ctx);

    configService.botUsername = saved;
    expect(ctx.reply).toHaveBeenCalledWith(expect.any(String), {
      reply_markup: { inline_keyboard: [[{ text: '➕ Add to group', url: 'https://t.me/tbot?startgroup=true' }]] },
    });
  });

  describe('with an app link', () => {
    const saved = { ...configService };
    beforeEach(() => {
      configService.botUsername = 'tbot';
      configService.botHasMainWebApp = true;
    });
    afterEach(() => {
      configService.botUsername = saved.botUsername;
      configService.botHasMainWebApp = saved.botHasMainWebApp;
    });

    it('the "finished" event and "already done" reply carry an "Open #N" button', async () => {
      const mockTask = { _id: mockTaskId, groupId: mockGroupId, taskNumber: 5, title: 'Fix bug', status: 'todo' };
      (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(mockTask);
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue({ ...mockTask, status: 'done' });
      const ctx = createMockCtx({ message: { text: '/done 5' } });

      await command.onDone(ctx);

      const open = { text: '📱 Open #5', url: `https://t.me/tbot?startapp=${mockGroupId}_${mockTaskId}` };
      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('finished *#5*'), {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[open]] },
      });

      (taskService.getTaskByNumber as jest.Mock).mockResolvedValue({ ...mockTask, status: 'done' });
      const again = createMockCtx({ message: { text: '/done 5' } });
      await command.onDone(again);
      expect(again.reply).toHaveBeenCalledWith('ℹ️ Task #5 is already done.', {
        reply_markup: { inline_keyboard: [[open]] },
      });
    });
  });

  it('should mark task as done by number with #', async () => {
    const ctx = createMockCtx({ message: { text: '/done #5' } });

    const mockTask = { _id: mockTaskId, taskNumber: 5, title: 'Fix bug', status: 'todo' };
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(mockTask);
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue({ ...mockTask, status: 'done' });
    (userService.getDisplayName as jest.Mock).mockReturnValue('Test');

    await command.onDone(ctx);

    expect(taskService.getTaskByNumber).toHaveBeenCalledWith(mockGroupId, 5);
    expect(taskService.updateTaskStatus).toHaveBeenCalledWith(mockTaskId, 'done', mockUserId);
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'status', to: '✅ Done', via: 'bot' }),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('#5'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
  });

  describe('a parent with open subtasks', () => {
    const parent = { _id: mockTaskId, groupId: mockGroupId, taskNumber: 42, title: 'Login', status: 'in_progress' };
    beforeEach(() => {
      (subtaskService.progress as jest.Mock).mockResolvedValue(
        new Map([[String(mockTaskId), { total: 3, done: 1, cancelled: 0 }]]),
      );
    });
    afterEach(() => (subtaskService.progress as jest.Mock).mockResolvedValue(new Map()));

    it('/done asks first instead of closing', async () => {
      const ctx = createMockCtx({ message: { text: '/done 42' } });
      (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(parent);

      await command.onDone(ctx);

      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
      const [text, extra] = ctx.reply.mock.calls[0];
      expect(text).toBe('⚠️ *#42 still has 2 open subtasks.* Close it anyway?');
      expect(extra.reply_markup.inline_keyboard[0][0]).toEqual(
        expect.objectContaining({ text: '✅ Yes, close #42' }),
      );
    });

    it('"Yes, close" closes it and turns the question into the finished line', async () => {
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue({ ...parent, status: 'done' });
      const cbCtx = {
        answerCbQuery: jest.fn(),
        editMessageText: jest.fn().mockResolvedValue({}),
        editMessageReplyMarkup: jest.fn().mockResolvedValue({}),
        telegram: { editMessageText: jest.fn() },
      } as any;

      await command.confirmClose(cbCtx, parent as any, mockUser as any);

      expect(taskService.updateTaskStatus).toHaveBeenCalledWith(mockTaskId, 'done', mockUserId);
      expect(cbCtx.answerCbQuery).toHaveBeenCalledWith('#42: Done');
      expect(cbCtx.editMessageText.mock.calls[0][0]).toBe('✅ @testuser finished *#42* · Login');
      expect(Group.findById).toHaveBeenCalled();
    });
  });

  it('should mark task as done by number without #', async () => {
    const ctx = createMockCtx({ message: { text: '/done 3' } });

    const mockTask = { _id: mockTaskId, taskNumber: 3, title: 'Deploy', status: 'in_progress' };
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(mockTask);
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue({ ...mockTask, status: 'done' });
    (userService.getDisplayName as jest.Mock).mockReturnValue('Test');

    await command.onDone(ctx);

    expect(taskService.getTaskByNumber).toHaveBeenCalledWith(mockGroupId, 3);
    expect(taskService.updateTaskStatus).toHaveBeenCalled();
  });

  it('should show error when task not found', async () => {
    const ctx = createMockCtx({ message: { text: '/done #99' } });

    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);

    await command.onDone(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Task #99 not found in this group.'));
  });

  it('should show message when task already done', async () => {
    const ctx = createMockCtx({ message: { text: '/done #1' } });

    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue({
      _id: mockTaskId, taskNumber: 1, title: 'Done task', status: 'done',
    });

    await command.onDone(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('ℹ️ Task #1 is already done.', {});
    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('should show usage when no args provided', async () => {
    const ctx = createMockCtx({ message: { text: '/done' } });

    await command.onDone(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Usage'),
      expect.objectContaining({ parse_mode: 'Markdown' })
    );
  });

  it('should show error for invalid task number format', async () => {
    const ctx = createMockCtx({ message: { text: '/done abc' } });

    await command.onDone(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid task number'),
      expect.any(Object)
    );
  });
  it('escapes markdown in the title and refreshes the task card', async () => {
    const ctx = createMockCtx({ message: { text: '/done 7' } });
    const mockTask = {
      _id: mockTaskId,
      groupId: mockGroupId,
      taskNumber: 7,
      title: 'Fix v1.2 - login_page *now*',
      status: 'in_review',
      type: 'bug',
      priority: 'high',
    };
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(mockTask);
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue({
      ...mockTask,
      status: 'done',
      taskCardChatId: -100123,
      taskCardMessageId: 55,
    });

    await command.onDone(ctx);

    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text).toContain('Fix v1.2 - login\\_page \\*now\\*');
    expect(text).not.toContain('v1\\.2');
    expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(
      -100123,
      55,
      undefined,
      expect.stringContaining('#7'),
      expect.objectContaining({ parse_mode: 'Markdown' }),
    );
  });

  it('DMs the assignee when someone else finishes the task', async () => {
    const ctx = createMockCtx({ message: { text: '/done 8' } });
    const assignee = { _id: new mongoose.Types.ObjectId(), telegramUserId: 999, username: 'an' };
    const mockTask = { _id: mockTaskId, groupId: mockGroupId, taskNumber: 8, title: 'Ship', status: 'todo' };
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(mockTask);
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue({ ...mockTask, status: 'done', assigneeId: assignee });

    await command.onDone(ctx);

    expect(notificationService.notifyStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ taskNumber: 8 }),
      mockUser,
      assignee,
    );
  });

  describe('in a forum', () => {
    const forumGroup = { ...mockGroup, isForum: true, eventsTopicId: 500, knownTopics: [] };

    it('posts the line in "Task events" replying to /done, with 👌 on the command', async () => {
      (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue({ ...forumGroup });
      const mockTask = { _id: mockTaskId, taskNumber: 5, title: 'Fix bug', status: 'todo' };
      (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(mockTask);
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue({ ...mockTask, status: 'done' });
      const ctx = createMockCtx({
        chat: { id: -100123, type: 'supergroup', title: 'Test Group', is_forum: true },
        message: { message_id: 60, text: '/done 5', message_thread_id: 7, is_topic_message: true },
        telegram: {
          editMessageText: jest.fn().mockResolvedValue({}),
          sendMessage: jest.fn().mockResolvedValue({ message_id: 61 }),
          setMessageReaction: jest.fn().mockResolvedValue(true),
        },
      });

      await command.onDone(ctx);

      expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(
        -100123,
        expect.stringContaining('finished *#5*'),
        { parse_mode: 'Markdown', message_thread_id: 500, reply_parameters: { message_id: 60 } },
      );
      expect(ctx.telegram.setMessageReaction).toHaveBeenCalledWith(-100123, 60, [{ type: 'emoji', emoji: '👌' }]);
      expect(ctx.reply).not.toHaveBeenCalled();
    });
  });
});
