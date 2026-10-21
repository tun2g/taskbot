import mongoose from 'mongoose';
import { SubCommand, SUB_USAGE } from 'src/bot/commands/sub';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { TaskMutationError, taskMutationService } from 'src/shared/services/task-mutation.service';

jest.mock('src/database/services/user.service');
jest.mock('src/database/services/group.service');
jest.mock('src/database/services/task.service', () => ({
  taskService: { getTaskByNumber: jest.fn(), getTaskByCardMessage: jest.fn() },
}));
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { getMembers: jest.fn() },
}));
jest.mock('src/shared/services/group-messenger.service', () => ({
  groupMessengerService: { sendCommandEvent: jest.fn().mockResolvedValue({}) },
}));
jest.mock('src/shared/services/task-mutation.service', () => {
  class TaskMutationError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { TaskMutationError, taskMutationService: { createTask: jest.fn() } };
});
jest.mock('src/shared/utils/app-links', () => ({
  taskButton: jest.fn(() => ({ text: '📱 Open #42', url: 'https://t.me/x' })),
  taskNumberMarkdown: (n: number) => `*#${n}*`,
}));
jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { setCallbackData: jest.fn() },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const me = { _id: new mongoose.Types.ObjectId(), telegramUserId: 1, username: 'me' };
const an = { _id: new mongoose.Types.ObjectId(), telegramUserId: 2, username: 'an_dev' };
const group = { _id: new mongoose.Types.ObjectId(), telegramGroupId: -100, groupName: 'Team' };
const parent = { _id: new mongoose.Types.ObjectId(), groupId: group._id, taskNumber: 42, title: 'Fix login' };

let nextNumber = 45;
function created(title: string, assignee: unknown = null) {
  return { task: { _id: new mongoose.Types.ObjectId(), groupId: group._id, taskNumber: nextNumber++, title }, assignee };
}

function ctx(text: string, extra: Record<string, unknown> = {}) {
  return {
    chat: { id: -100, type: 'supergroup', title: 'Team' },
    message: { text, message_id: 9, ...extra },
    reply: jest.fn().mockResolvedValue({}),
  } as any;
}

function posted(): string {
  return (groupMessengerService.sendCommandEvent as jest.Mock).mock.calls[0][2];
}

describe('/sub', () => {
  const command = new SubCommand();

  beforeEach(() => {
    jest.clearAllMocks();
    nextNumber = 45;
    (userService.findOrCreateUser as jest.Mock).mockResolvedValue(me);
    (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(group);
    (groupMemberService.getMembers as jest.Mock).mockResolvedValue([me, an]);
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(parent);
    (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(null);
  });

  it('registers /sub and /subtask', () => {
    expect([...command.register().keys()]).toEqual(['sub', 'subtask']);
  });

  it('/sub 42 Title @an → one subtask under #42, assigned, as a bot change without its own card', async () => {
    (taskMutationService.createTask as jest.Mock).mockResolvedValue(created('Write tests', an));
    await command.onSub(ctx('/sub 42 Write tests @an_dev'));

    expect(taskService.getTaskByNumber).toHaveBeenCalledWith(group._id, 42);
    expect(taskMutationService.createTask).toHaveBeenCalledWith(
      group,
      me,
      { title: 'Write tests', parentTaskId: String(parent._id), assigneeId: String(an._id) },
      { channel: { activity: 'bot' }, announce: 'none', batchId: expect.stringMatching(/^[0-9a-f]{16}$/) },
    );
    expect(posted()).toBe('🧩 @me added a subtask to *#42* · Fix login\n• *#45* Write tests — @an\\_dev');
    const extra = (groupMessengerService.sendCommandEvent as jest.Mock).mock.calls[0][3].extra;
    expect(extra.reply_markup.inline_keyboard).toEqual([
      [
        { text: '↩️ Undo', callback_data: expect.stringMatching(/^batch:undo:[0-9a-f]{12}$/) },
        { text: '📱 Open #42', url: 'https://t.me/x' },
      ],
    ]);
  });

  it('reply to a card with several lines → one message for the batch; unknown @name is left unassigned', async () => {
    (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(parent);
    (taskMutationService.createTask as jest.Mock)
      .mockResolvedValueOnce(created('Write tests'))
      .mockResolvedValueOnce(created('Update docs'));

    await command.onSub(ctx('/sub Write tests @ghost\nUpdate docs', { reply_to_message: { message_id: 5 } }));

    expect(taskService.getTaskByCardMessage).toHaveBeenCalledWith(-100, 5);
    expect(taskMutationService.createTask).toHaveBeenCalledTimes(2);
    expect((taskMutationService.createTask as jest.Mock).mock.calls[0][2]).not.toHaveProperty('assigneeId');
    expect(groupMessengerService.sendCommandEvent).toHaveBeenCalledTimes(1);
    const text = posted();
    expect(text).toContain('added 2 subtasks to *#42*');
    expect(text).toContain('• *#45* Write tests\n• *#46* Update docs');
    expect(text).toContain("I don't know @ghost here yet, so #45 is unassigned");
  });

  it('shows the rule as a plain sentence when the parent is itself a subtask', async () => {
    (taskMutationService.createTask as jest.Mock).mockRejectedValue(
      new TaskMutationError('invalid_parent', '#42 is already a subtask of #40, and subtasks can\'t have their own subtasks.'),
    );
    const c = ctx('/sub 42 Write tests');
    await command.onSub(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringMatching(/^❌ #42 is already a subtask of #40/), expect.anything());
    expect(groupMessengerService.sendCommandEvent).not.toHaveBeenCalled();
  });

  it('keeps what was created when a later one breaks a rule', async () => {
    (taskMutationService.createTask as jest.Mock)
      .mockResolvedValueOnce(created('A'))
      .mockRejectedValueOnce(new TaskMutationError('invalid_parent', '#42 already has 50 subtasks.'));
    await command.onSub(ctx('/sub 42\nA\nB\nC'));
    expect(taskMutationService.createTask).toHaveBeenCalledTimes(2);
    expect(posted()).toContain('⚠️ Stopped after 1: #42 already has 50 subtasks.');
  });

  it('unknown task number and missing parent get clear replies', async () => {
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);
    const missing = ctx('/sub 99 Write tests');
    await command.onSub(missing);
    expect(missing.reply).toHaveBeenCalledWith(expect.stringContaining('Task #99 not found'));

    const noParent = ctx('/sub Write tests');
    await command.onSub(noParent);
    expect(noParent.reply).toHaveBeenCalledWith(SUB_USAGE, { parse_mode: 'Markdown' });

    const notCard = ctx('/sub Write tests', { reply_to_message: { message_id: 5 } });
    await command.onSub(notCard);
    expect(notCard.reply).toHaveBeenCalledWith(expect.stringContaining("isn't a task card"), { parse_mode: 'Markdown' });
    expect(taskMutationService.createTask).not.toHaveBeenCalled();
  });

  it('bare /sub shows the usage', async () => {
    const c = ctx('/sub');
    await command.onSub(c);
    expect(c.reply).toHaveBeenCalledWith(SUB_USAGE, { parse_mode: 'Markdown' });
  });
});
