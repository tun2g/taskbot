import { TasksCommand } from 'src/bot/commands/tasks';
import { userService } from 'src/database/services/user.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import mongoose from 'mongoose';
import { User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { configService } from 'src/configs/configuration';

function stats(partial: Record<string, number>) {
  return { backlog: 0, todo: 0, in_progress: 0, in_review: 0, pending: 0, done: 0, cancelled: 0, ...partial };
}

jest.mock('src/database/services/subtask.service', () => ({
  subtaskService: { progress: jest.fn().mockResolvedValue(new Map()) },
}));
jest.mock('src/database/services/user.service');
jest.mock('src/database/services/group.service');
jest.mock('src/database/services/task.service');
jest.mock('src/database/models/user.model', () => ({
  User: { findOne: jest.fn() },
}));
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { isMember: jest.fn() },
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

const mockUser = { _id: mockUserId, telegramUserId: 123, username: 'testuser', firstName: 'Test' };
const mockGroup = { _id: mockGroupId, telegramGroupId: -100123, groupName: 'Test Group' };

function createMockCtx(overrides: Record<string, any> = {}) {
  return {
    chat: { id: -100123, type: 'supergroup', title: 'Test Group' },
    message: { text: '/tasks', ...overrides.message },
    reply: jest.fn().mockResolvedValue({}),
    ...overrides,
  } as any;
}

describe('TasksCommand', () => {
  let command: TasksCommand;

  beforeEach(() => {
    command = new TasksCommand();
    jest.clearAllMocks();
    (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
    (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(mockGroup);
  });

  it('should register the tasks command', () => {
    const map = command.register();
    expect(map.has('tasks')).toBe(true);
  });

  it('should reject non-group chats', async () => {
    const ctx = createMockCtx({ chat: { id: 123, type: 'private' } });

    await command.onTasks(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/list works in group chats. Send /start'), {});
  });

  it('should show no-tasks message when empty', async () => {
    const ctx = createMockCtx();
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({}));

    await command.onTasks(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No tasks in this group yet'), expect.any(Object));
  });

  it('bare /tasks shows category totals and the open tasks, newest first', async () => {
    const ctx = createMockCtx();
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(
      stats({ backlog: 1, todo: 4, in_progress: 2, in_review: 1, done: 9, cancelled: 1 }),
    );
    (taskService.getTasksByGroup as jest.Mock).mockImplementation(async (_g, f) => {
      if (f.status === 'todo') {
        return {
          tasks: [{ taskNumber: 3, title: 'Old todo', status: 'todo', type: 'task', createdAt: new Date('2026-01-01') }],
          total: 4,
        };
      }
      if (f.status === 'in_review') {
        return {
          tasks: [
            {
              taskNumber: 9,
              title: 'Fix login_page',
              status: 'in_review',
              type: 'bug',
              createdAt: new Date('2026-02-01'),
              assigneeId: { telegramUserId: 5, username: 'an_dev' },
            },
          ],
          total: 1,
        };
      }
      return { tasks: [], total: 0 };
    });

    await command.onTasks(ctx);

    const [text, opts] = ctx.reply.mock.calls[0];
    // categories: to do = backlog+todo, in progress = in_progress+in_review+pending, done = done+cancelled
    expect(text).toContain('5 to do · 3 in progress · 10 done');
    expect(text.indexOf('#9')).toBeLessThan(text.indexOf('#3'));
    expect(text).toContain('👀 <b>#9</b> Bug · Fix login_page — @an_dev');
    expect(text).toContain('📋 <b>Tasks</b> · Test Group');
    // no board button without an app link, so no "open the board" either
    expect(text).toContain('…and 3 more — narrow it down');
    expect(text).not.toMatch(/[*`\\]/);
    expect(opts).toEqual(expect.objectContaining({ parse_mode: 'HTML', link_preview_options: { is_disabled: true } }));
    // open = every non-closed status
    const queried = (taskService.getTasksByGroup as jest.Mock).mock.calls.map((c) => c[1].status).sort();
    expect(queried).toEqual(['backlog', 'in_progress', 'in_review', 'pending', 'todo']);
  });

  it('should filter by status when /tasks todo', async () => {
    const ctx = createMockCtx({ message: { text: '/tasks todo' } });
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({ todo: 2 }));
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({
      tasks: [{ taskNumber: 1, title: 'Task 1', status: 'todo', createdAt: new Date() }],
      total: 1,
    });

    await command.onTasks(ctx);

    expect(taskService.getTasksByGroup).toHaveBeenCalledTimes(1);
    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(mockGroupId, expect.objectContaining({ status: 'todo' }));
  });

  it('should filter by "mine" showing user open tasks', async () => {
    const ctx = createMockCtx({ message: { text: '/tasks mine' } });
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({ todo: 1 }));
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });

    await command.onTasks(ctx);

    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(
      mockGroupId,
      expect.objectContaining({ assigneeId: mockUserId }),
    );
    expect(ctx.reply.mock.calls[0][0]).toContain('Your open tasks');
  });

  it.each(['/mytasks', '/mytasks@TBot', '/list mine'])('%s shows the caller\'s open tasks', async (text) => {
    const ctx = createMockCtx({ message: { text } });
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({ todo: 1 }));
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });

    await command.onTasks(ctx);

    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(
      mockGroupId,
      expect.objectContaining({ assigneeId: mockUserId }),
    );
    expect(ctx.reply.mock.calls[0][0]).toContain('Your open tasks');
  });

  it('/mytasks combines with other filters', async () => {
    const ctx = createMockCtx({ message: { text: '/mytasks bug' } });
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({ todo: 1 }));
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });

    await command.onTasks(ctx);

    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(
      mockGroupId,
      expect.objectContaining({ assigneeId: mockUserId, type: 'bug' }),
    );
  });

  it('supports review and type words together', async () => {
    const ctx = createMockCtx({ message: { text: '/tasks review improvements' } });
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({ in_review: 1 }));
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });

    await command.onTasks(ctx);

    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(
      mockGroupId,
      expect.objectContaining({ status: 'in_review', type: 'improvement' }),
    );
  });

  it('should filter by "done" status', async () => {
    const ctx = createMockCtx({ message: { text: '/tasks done' } });
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({ done: 3 }));
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({
      tasks: [{ taskNumber: 1, title: 'Done task', status: 'done', createdAt: new Date() }],
      total: 1,
    });

    await command.onTasks(ctx);

    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(mockGroupId, expect.objectContaining({ status: 'done' }));
  });

  it('replies with a hint for an unknown @username instead of showing everything', async () => {
    const ctx = createMockCtx({ message: { text: '/tasks @ghost' } });
    (User.findOne as jest.Mock).mockResolvedValue(null);

    await command.onTasks(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      "I don't know @ghost in this group yet — they need to send a message here first.",
      expect.any(Object),
    );
    expect(taskService.getTasksByGroup).not.toHaveBeenCalled();
  });

  it('filters by a known @username who is a member', async () => {
    const ctx = createMockCtx({ message: { text: '/tasks @An' } });
    const target = { _id: new mongoose.Types.ObjectId(), telegramUserId: 7, username: 'an' };
    (User.findOne as jest.Mock).mockResolvedValue(target);
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
    (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({ todo: 1 }));
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });

    await command.onTasks(ctx);

    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(
      mockGroupId,
      expect.objectContaining({ assigneeId: target._id }),
    );
  });

  describe('with an app link', () => {
    const saved = { botUsername: configService.botUsername, botHasMainWebApp: configService.botHasMainWebApp };
    beforeEach(() => {
      configService.botUsername = 'tbot';
      configService.botHasMainWebApp = true;
    });
    afterEach(() => Object.assign(configService, saved));

    it('links each #N to its task, escapes titles as HTML and shows the board button', async () => {
      const ctx = createMockCtx();
      const taskId = new mongoose.Types.ObjectId();
      (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({ todo: 20 }));
      (taskService.getTasksByGroup as jest.Mock).mockImplementation(async (_g, f) =>
        f.status === 'todo'
          ? {
              tasks: [{ _id: taskId, taskNumber: 4, title: 'A <b> & c', status: 'todo', createdAt: new Date() }],
              total: 20,
            }
          : { tasks: [], total: 0 },
      );

      await command.onTasks(ctx);

      const [text, opts] = ctx.reply.mock.calls[0];
      expect(text).toContain(`<a href="https://t.me/tbot?startapp=${mockGroupId}_${taskId}"><b>#4</b></a> Task · A &lt;b&gt; &amp; c`);
      expect(text).toContain('…and 19 more — open the board');
      expect(opts.reply_markup.inline_keyboard).toEqual([
        [{ text: '📋 Open board', url: `https://t.me/tbot?startapp=${mockGroupId}` }],
      ]);
    });

    it('empty group still offers the board', async () => {
      const ctx = createMockCtx();
      (taskService.getTaskStats as jest.Mock).mockResolvedValue(stats({}));

      await command.onTasks(ctx);

      const [text, opts] = ctx.reply.mock.calls[0];
      expect(text).toContain('No tasks in this group yet');
      expect(opts).toEqual(
        expect.objectContaining({
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[expect.objectContaining({ text: '📋 Open board' })]] },
        }),
      );
    });
  });

  it('explains unknown filter words', async () => {
    const ctx = createMockCtx({ message: { text: '/tasks banana' } });

    await command.onTasks(ctx);

    expect(ctx.reply.mock.calls[0][0]).toContain("I don't understand");
  });
});
