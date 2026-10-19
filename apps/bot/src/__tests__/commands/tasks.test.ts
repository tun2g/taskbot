import { TasksCommand } from 'src/bot/commands/tasks';
import { userService } from 'src/database/services/user.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import mongoose from 'mongoose';
import { User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';

function stats(partial: Record<string, number>) {
  return { backlog: 0, todo: 0, in_progress: 0, in_review: 0, pending: 0, done: 0, cancelled: 0, ...partial };
}

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

    expect(ctx.reply).toHaveBeenCalledWith('⚠️ /tasks can only be used in group chats.');
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
    expect(text).toContain('👀 #9 Bug · Fix login\\_page — @an\\_dev');
    expect(text).toContain('…and 3 more — open the board');
    expect(opts).toEqual(expect.objectContaining({ parse_mode: 'Markdown' }));
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

  it('explains unknown filter words', async () => {
    const ctx = createMockCtx({ message: { text: '/tasks banana' } });

    await command.onTasks(ctx);

    expect(ctx.reply.mock.calls[0][0]).toContain("I don't understand");
  });
});
