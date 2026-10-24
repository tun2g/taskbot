import mongoose from 'mongoose';
import { handleTaskCallback } from 'src/bot/task-callback.handler';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { User } from 'src/database/models/user.model';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { dmTaskKeyboard, notificationService } from 'src/shared/services/notification.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';
import { aiCommandService, checkUserAiRateLimit } from 'src/shared/services/ai-command.service';
import { checkGroupAiRateLimit } from 'src/shared/services/task-creation.service';
import { subtaskService } from 'src/database/services/subtask.service';

jest.mock('src/database/services/subtask.service', () => ({
  subtaskService: { progress: jest.fn().mockResolvedValue(new Map()), list: jest.fn().mockResolvedValue([]) },
}));
jest.mock('src/database/services/task.service');
jest.mock('src/database/services/user.service');
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { getMembers: jest.fn(), isMember: jest.fn() },
}));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { record: jest.fn() } }));
jest.mock('src/database/models/group.model', () => ({ Group: { findById: jest.fn().mockResolvedValue(null) } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: {
    notifyAssignment: jest.fn(),
    notifyStatusChange: jest.fn(),
    notifyUnassigned: jest.fn(),
  },
  DM_TASK_CALLBACK_PREFIX: 'tdm:',
  DM_EXPLAIN_ACTION: 'explain',
  DM_CLOSE_ACTION: 'close',
  dmTaskKeyboard: jest.fn(() => [[{ text: '👀 Review', callback_data: 'tdm:in_review:x' }]]),
}));
jest.mock('src/shared/services/ai-command.service', () => ({
  AI_UNAVAILABLE_MESSAGE: '🤖 AI is unavailable right now',
  aiCommandService: { explainTaskById: jest.fn() },
  checkUserAiRateLimit: jest.fn(),
}));
jest.mock('src/shared/services/task-creation.service', () => ({ checkGroupAiRateLimit: jest.fn() }));
jest.mock('src/shared/services/task-sync.service', () => ({ taskSyncService: { syncTaskCard: jest.fn() } }));
jest.mock('src/shared/utils/app-links', () => ({
  ...jest.requireActual('src/shared/utils/app-links'),
  taskButton: jest.fn((t: { taskNumber: number }) => ({ text: `📱 Open #${t.taskNumber}`, url: 'https://t.me/tbot?startapp=x' })),
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
const openButton = { reply_markup: { inline_keyboard: [[{ text: '📱 Open #12', url: 'https://t.me/tbot?startapp=x' }]] } };

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
    expect(line).toContain('@bob assigned *#12* · Fix login to @an\\_dev');
    expect(ctx.telegram.sendMessage.mock.calls[0][2]).toMatchObject(openButton);
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
        ...openButton,
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
        ...openButton,
      });
    });
  });

  it('unassign line names the task title', async () => {
    (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'unassign' });
    (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ assigneeId: an }));
    (taskService.assignTask as jest.Mock).mockResolvedValue(task());
    const ctx = ctxFor('unassign');

    await handleTaskCallback(ctx);

    expect(ctx.telegram.sendMessage.mock.calls[0][1]).toBe('🚫 @bob unassigned @an\\_dev from *#12* · Fix login');
  });

  describe('DM quick actions', () => {
    const group = { _id: groupId, telegramGroupId: -100, isForum: false, knownTopics: [] };

    function dmCtx(data: string) {
      return {
        chat: { id: bob.telegramUserId, type: 'private' },
        callbackQuery: { data, from: { id: bob.telegramUserId }, message: { message_id: 5 } },
        answerCbQuery: jest.fn(),
        editMessageText: jest.fn(),
        editMessageReplyMarkup: jest.fn(),
        telegram: { sendMessage: jest.fn(), getChatMember: jest.fn().mockResolvedValue({ status: 'member' }) },
      } as any;
    }

    beforeEach(() => {
      (Group.findById as jest.Mock).mockResolvedValue(group);
    });

    it('applies the step, edits only the DM buttons, refreshes the card and posts the line in the group', async () => {
      const before = task({ assigneeId: bob, taskCardChatId: -100, taskCardMessageId: 77 });
      const after = task({ status: 'in_progress', assigneeId: bob, taskCardChatId: -100, taskCardMessageId: 77 });
      (taskService.getTaskById as jest.Mock).mockResolvedValue(before);
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(after);
      const ctx = dmCtx(`tdm:in_progress:${taskId}`);

      await handleTaskCallback(ctx);

      expect(callbackDataStorageService.getCallbackData).not.toHaveBeenCalled();
      expect(ctx.telegram.getChatMember).toHaveBeenCalledWith(-100, bob.telegramUserId);
      expect(taskService.updateTaskStatus).toHaveBeenCalledWith(taskId, 'in_progress', bob._id);
      expect(taskActivityService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'status', from: '📝 To do', to: '🔄 In progress' }),
      );
      expect(ctx.editMessageText).not.toHaveBeenCalled();
      expect(dmTaskKeyboard).toHaveBeenCalledWith(after);
      expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith({
        inline_keyboard: [[{ text: '👀 Review', callback_data: 'tdm:in_review:x' }]],
      });
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('#12: In progress');
      expect(taskSyncService.syncTaskCard).toHaveBeenCalledWith(after);

      expect(ctx.telegram.sendMessage).toHaveBeenCalledTimes(1);
      const [chat, text, extra] = ctx.telegram.sendMessage.mock.calls[0];
      expect(chat).toBe(-100);
      expect(text).toBe('🔄 @bob started *#12* · Fix login');
      expect(extra).toMatchObject({ reply_parameters: { message_id: 77 }, ...openButton });
      // Bob is the assignee and made the change himself: no DM about it.
      expect(notificationService.notifyStatusChange).not.toHaveBeenCalled();
    });

    it('refuses someone who left the group', async () => {
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ assigneeId: bob }));
      const ctx = dmCtx(`tdm:in_progress:${taskId}`);
      ctx.telegram.getChatMember.mockResolvedValue({ status: 'left' });

      await handleTaskCallback(ctx);

      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("not in its group"), { show_alert: true });
    });

    it('a paused group: DM buttons explain instead of changing the task (they skip the group gate)', async () => {
      (Group.findById as jest.Mock).mockResolvedValue({ ...group, groupName: 'Team Alpha', status: 'suspended', statusReason: 'Unpaid' });
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ assigneeId: bob }));
      const ctx = dmCtx(`tdm:in_progress:${taskId}`);

      await handleTaskCallback(ctx);

      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith(
        "⏸ The bot owner paused the bot in “Team Alpha”. Tasks are kept but can't be changed for now. Reason: Unpaid",
        { show_alert: true },
      );
    });

    it('does not apply a stale step when the task moved meanwhile', async () => {
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ status: 'in_review', assigneeId: bob }));
      const ctx = dmCtx(`tdm:in_progress:${taskId}`);

      await handleTaskCallback(ctx);

      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
      expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('#12 is in review now — buttons updated');
      expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
    });
  });
  describe('💡 Explain', () => {
    const group = { _id: groupId, telegramGroupId: -100, isForum: false, knownTopics: [] };
    const explanation = { text: '💡 #12 <b>Fix login</b>\n🎯 Sửa lỗi login', buttons: [[{ text: '📱 Open #12', url: 'https://x' }]] };

    beforeEach(() => {
      (Group.findById as jest.Mock).mockResolvedValue(group);
      (checkUserAiRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0 });
      (checkGroupAiRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
      (aiCommandService.explainTaskById as jest.Mock).mockResolvedValue(explanation);
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task());
    });

    it('from the card (⋯ More): restores the card buttons and replies under the card', async () => {
      (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'explain' });
      const ctx = ctxFor('explain');

      await handleTaskCallback(ctx);

      expect(ctx.editMessageText.mock.calls[0][1].reply_markup.inline_keyboard[0].map((b: any) => b.text)).toEqual([
        '▶ Start',
        '👤 Assign',
        '⋯ More',
      ]);
      expect(ctx.telegram.getChatMember).not.toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('💡 Explaining #12…');
      expect(aiCommandService.explainTaskById).toHaveBeenCalledWith(taskId.toString(), bob, group, { onCard: true });
      expect(ctx.telegram.sendMessage).toHaveBeenCalledTimes(1);
      expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(-100, explanation.text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_parameters: { message_id: 77, allow_sending_without_reply: true },
        reply_markup: { inline_keyboard: explanation.buttons },
      });
    });

    it('is rate limited like /ai', async () => {
      (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'explain' });
      (checkUserAiRateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 40 });
      const ctx = ctxFor('explain');

      await handleTaskCallback(ctx);

      expect(aiCommandService.explainTaskById).not.toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('try again in 40s'), { show_alert: true });
      expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it("the group's 10-minute AI limit says exactly how long to wait", async () => {
      (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'explain' });
      (checkGroupAiRateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 420, scope: 'minute' });
      const ctx = ctxFor('explain');

      await handleTaskCallback(ctx);

      expect(aiCommandService.explainTaskById).not.toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('try again in 7 min'), { show_alert: true });
    });

    function dmCtx() {
      return {
        chat: { id: bob.telegramUserId, type: 'private' },
        callbackQuery: { data: `tdm:explain:${taskId}`, from: { id: bob.telegramUserId }, message: { message_id: 5 } },
        answerCbQuery: jest.fn(),
        editMessageText: jest.fn(),
        editMessageReplyMarkup: jest.fn(),
        sendChatAction: jest.fn().mockResolvedValue(true),
        telegram: { sendMessage: jest.fn(), getChatMember: jest.fn().mockResolvedValue({ status: 'member' }) },
      } as any;
    }

    it('from a DM: checks membership and sends a new DM (not a reply, DM buttons untouched)', async () => {
      const ctx = dmCtx();

      await handleTaskCallback(ctx);

      expect(ctx.telegram.getChatMember).toHaveBeenCalledWith(-100, bob.telegramUserId);
      expect(checkUserAiRateLimit).toHaveBeenCalledWith(bob.telegramUserId, -100, bob);
      expect(aiCommandService.explainTaskById).toHaveBeenCalledWith(taskId.toString(), bob, group, { onCard: false });
      expect(ctx.editMessageReplyMarkup).not.toHaveBeenCalled();
      expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(bob.telegramUserId, explanation.text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: explanation.buttons },
      });
    });

    it('from a DM: refuses someone who left the group', async () => {
      const ctx = dmCtx();
      ctx.telegram.getChatMember.mockResolvedValue({ status: 'left' });

      await handleTaskCallback(ctx);

      expect(aiCommandService.explainTaskById).not.toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining('not in its group'), { show_alert: true });
    });

    it('from a DM: a group waiting for approval gets no AI', async () => {
      (Group.findById as jest.Mock).mockResolvedValue({ ...group, groupName: 'Team Alpha', status: 'pending' });
      const ctx = dmCtx();

      await handleTaskCallback(ctx);

      expect(aiCommandService.explainTaskById).not.toHaveBeenCalled();
      expect(ctx.answerCbQuery).toHaveBeenCalledWith(expect.stringContaining("“Team Alpha” is waiting for the bot owner's approval"), { show_alert: true });
    });
  });

  describe('subtasks', () => {
    const progressOf = (p: { total: number; done: number; cancelled: number }) => new Map([[String(taskId), p]]);
    afterEach(() => (subtaskService.progress as jest.Mock).mockResolvedValue(new Map()));

    it('closing a parent with open subtasks asks first, without changing anything', async () => {
      (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'set_status', value: 'done' });
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ status: 'in_review' }));
      (subtaskService.progress as jest.Mock).mockResolvedValue(progressOf({ total: 3, done: 1, cancelled: 0 }));
      const ctx = ctxFor('set_status');

      await handleTaskCallback(ctx);

      expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
      const [text, opts] = ctx.editMessageText.mock.calls[0];
      expect(text).toContain('⚠️ *#12 still has 2 open subtasks.* Close it anyway?');
      expect(opts.reply_markup.inline_keyboard[0].map((b: any) => b.text)).toEqual(['✅ Yes, close #12', '« Back']);
      expect(callbackDataStorageService.setCallbackData).toHaveBeenCalledWith(
        expect.any(String),
        'task_cb',
        expect.objectContaining({ action: 'set_status', value: 'done', force: true }),
      );
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('2 subtasks are still open');
    });

    it('"Yes, close" (force) closes it', async () => {
      (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({
        taskId,
        action: 'set_status',
        value: 'done',
        force: true,
      });
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ status: 'in_review' }));
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(task({ status: 'done' }));
      (subtaskService.progress as jest.Mock).mockResolvedValue(progressOf({ total: 3, done: 1, cancelled: 0 }));

      await handleTaskCallback(ctxFor('set_status'));

      expect(taskService.updateTaskStatus).toHaveBeenCalledWith(taskId, 'done', bob._id);
    });

    it("a subtask's status line names its parent", async () => {
      const parent = { _id: new mongoose.Types.ObjectId(), taskNumber: 10, title: 'Login', status: 'todo' };
      (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'set_status', value: 'done' });
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ status: 'in_review', parentTaskId: parent }));
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(task({ status: 'done', parentTaskId: parent }));
      const ctx = ctxFor('set_status');

      await handleTaskCallback(ctx);

      expect(ctx.telegram.sendMessage.mock.calls[0][1]).toBe('✅ @bob finished *#12* · Fix login (↳ #10)');
    });

    it('⋯ More → 🧩 Subtasks lists them under the card with « Back', async () => {
      (callbackDataStorageService.getCallbackData as jest.Mock).mockResolvedValue({ taskId, action: 'subtasks' });
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task());
      (subtaskService.list as jest.Mock).mockResolvedValue([
        { taskNumber: 13, title: 'Write tests', status: 'in_progress', assigneeId: an },
      ]);
      (subtaskService.progress as jest.Mock).mockResolvedValue(progressOf({ total: 1, done: 0, cancelled: 0 }));
      const ctx = ctxFor('subtasks');

      await handleTaskCallback(ctx);

      const [text, opts] = ctx.editMessageText.mock.calls[0];
      expect(text).toContain('🧩 *Subtasks* · 0/1 done\n🔄 #13 Write tests — @an\\_dev');
      expect(opts.reply_markup.inline_keyboard).toEqual([[expect.objectContaining({ text: '« Back' })]]);
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('1 subtask');
    });

    it('DM "✅ Done #N" (close) closes from any status', async () => {
      const group = { _id: groupId, telegramGroupId: -100, isForum: false, knownTopics: [] };
      (Group.findById as jest.Mock).mockResolvedValue(group);
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ status: 'in_progress', assigneeId: bob }));
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(task({ status: 'done', assigneeId: bob }));
      const ctx = {
        chat: { id: bob.telegramUserId, type: 'private' },
        callbackQuery: { data: `tdm:close:${taskId}`, from: { id: bob.telegramUserId }, message: { message_id: 5 } },
        answerCbQuery: jest.fn(),
        editMessageText: jest.fn(),
        editMessageReplyMarkup: jest.fn(),
        telegram: { sendMessage: jest.fn(), getChatMember: jest.fn().mockResolvedValue({ status: 'member' }) },
      } as any;

      await handleTaskCallback(ctx);

      expect(taskService.updateTaskStatus).toHaveBeenCalledWith(taskId, 'done', bob._id);
      expect(ctx.answerCbQuery).toHaveBeenCalledWith('#12: Done');
      (Group.findById as jest.Mock).mockResolvedValue(null);
    });
  });
});
