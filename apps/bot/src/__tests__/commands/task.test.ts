import { TaskCommand, PRIVACY_MODE_MESSAGE, USAGE_MESSAGE } from 'src/bot/commands/task';
import { userService } from 'src/database/services/user.service';
import { groupService } from 'src/database/services/group.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskService } from 'src/database/services/task.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { aiService } from 'src/shared/services/ai/ai.service';
import { messageBufferService } from 'src/shared/services/message-buffer.service';
import { taskExtractionService } from 'src/shared/services/task-extraction.service';
import { notificationService } from 'src/shared/services/notification.service';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import mongoose from 'mongoose';
import { createTasks } from 'src/shared/services/task-creation.service';

jest.mock('src/database/services/epic.service', () => ({
  ...jest.requireActual('src/database/services/epic.service'),
  epicService: {
    listOpen: jest.fn(async () => []),
    listWithProgress: jest.fn(async () => []),
    findByTitle: jest.fn(async () => null),
    findById: jest.fn(async () => null),
    create: jest.fn(),
  },
}));
jest.mock('src/database/services/user.service');
jest.mock('src/database/services/group.service');
jest.mock('src/database/services/task.service');
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { getMembers: jest.fn() },
}));
jest.mock('src/database/services/task-activity.service', () => ({
  taskActivityService: { record: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/services/ai/ai.service', () => ({
  ...jest.requireActual('src/shared/services/ai/ai.service'),
  aiService: { isConfigured: jest.fn(), generateJson: jest.fn() },
}));
jest.mock('src/shared/services/message-buffer.service', () => ({
  ...jest.requireActual('src/shared/services/message-buffer.service'),
  messageBufferService: { getRecent: jest.fn(), getAfter: jest.fn() },
}));
jest.mock('src/shared/services/task-extraction.service', () => ({
  ...jest.requireActual('src/shared/services/task-extraction.service'),
  taskExtractionService: { extract: jest.fn() },
}));
jest.mock('src/shared/services/rate-limit.service', () => ({
  rateLimitService: { checkRateLimit: jest.fn() },
}));
jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { setCallbackData: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('src/shared/utils/app-links', () => ({
  OPEN_BOARD_LABEL: '📋 Open board',
  openTaskLabel: (n: number) => `📱 Open #${n}`,
  buildAppLink: jest.fn(() => 'https://t.me/bot?startapp=g'),
  appLinkButton: jest.fn((text: string) => ({ text, url: 'https://t.me/bot?startapp=g' })),
  boardButton: jest.fn(() => ({ text: '📋 Open board', url: 'https://t.me/bot?startapp=g' })),
  taskButton: jest.fn((task: { taskNumber: number }) => ({ text: `📱 Open #${task.taskNumber}`, url: 'https://t.me/bot?startapp=g' })),
  taskNumberHtml: jest.fn((n: number) => `<b>#${n}</b>`),
  taskNumberMarkdown: jest.fn((n: number) => `*#${n}*`),
}));
jest.mock('src/bot/task-card.renderer', () => ({
  formatTaskCard: jest.fn().mockReturnValue('📋 *#1* Test task'),
  buildTaskButtons: jest.fn().mockResolvedValue([[{ text: '✅ Done', callback_data: 'test' }]]),
}));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: { notifyAssignment: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('src/shared/logger/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

const mockGroupId = new mongoose.Types.ObjectId();
const mockUserId = new mongoose.Types.ObjectId();
const anId = new mongoose.Types.ObjectId();

const mockUser = { _id: mockUserId, telegramUserId: 123, username: 'testuser', firstName: 'Test' };
const memberAn = { _id: anId, telegramUserId: 456, username: 'an', firstName: 'An' };
const mockGroup = { _id: mockGroupId, telegramGroupId: -100123, groupName: 'Test Group', timezone: 'Asia/Ho_Chi_Minh' };

let taskCounter = 0;

function createMockCtx(overrides: Record<string, any> = {}) {
  const { message, ...rest } = overrides;
  return {
    chat: { id: -100123, type: 'supergroup', title: 'Test Group' },
    from: { id: 123, username: 'testuser', first_name: 'Test' },
    botInfo: { can_read_all_group_messages: true },
    message: { message_id: 100, date: 1760000000, from: { id: 123, username: 'testuser' }, text: '/task', ...message },
    reply: jest.fn().mockResolvedValue({ message_id: 999 }),
    sendChatAction: jest.fn().mockResolvedValue(true),
    telegram: { editMessageText: jest.fn(), deleteMessage: jest.fn() },
    ...rest,
  } as any;
}

function aiResult(tasks: any[]) {
  return { source: 'ai', tasks };
}

describe('TaskCommand', () => {
  let command: TaskCommand;

  beforeEach(() => {
    command = new TaskCommand();
    jest.clearAllMocks();
    taskCounter = 0;
    (userService.findOrCreateUser as jest.Mock).mockResolvedValue(mockUser);
    (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(mockGroup);
    (groupMemberService.getMembers as jest.Mock).mockResolvedValue([mockUser, memberAn]);
    (aiService.isConfigured as jest.Mock).mockReturnValue(true);
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true });
    (taskService.createTask as jest.Mock).mockImplementation(async (data: any) => ({
      ...data,
      _id: new mongoose.Types.ObjectId(),
      taskNumber: ++taskCounter,
      status: 'todo',
      type: data.type || 'task',
    }));
    (taskService.updateTask as jest.Mock).mockResolvedValue({});
  });

  it('registers the task command', () => {
    expect(command.register().has('task')).toBe(true);
  });

  it('explains that /task works in groups when used in a private chat', async () => {
    const ctx = createMockCtx({ chat: { id: 123, type: 'private' } });
    await command.onTask(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('/new works in group chats. Send /start'), {});
    expect(taskExtractionService.extract).not.toHaveBeenCalled();
  });

  it('shows usage (all four forms) when there is no input', async () => {
    const ctx = createMockCtx();
    await command.onTask(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(USAGE_MESSAGE, { parse_mode: 'HTML' });
    expect(USAGE_MESSAGE).toContain('/new all');
    expect(USAGE_MESSAGE).toContain('/new 10');
    expect(USAGE_MESSAGE).not.toContain('/task');
  });

  describe('parseMode', () => {
    const msg = (text: string, reply?: any) => ({ message_id: 1, text, ...(reply ? { reply_to_message: reply } : {}) }) as any;

    it.each([
      ['/task Fix login', undefined, { kind: 'text', text: 'Fix login' }],
      ['/task@TBot Fix login', undefined, { kind: 'text', text: 'Fix login' }],
      ['/task 10', undefined, { kind: 'recent', count: 10 }],
      ['/task 500', undefined, { kind: 'recent', count: 50 }],
      ['/task', { message_id: 5, text: 'x' }, { kind: 'reply', note: undefined }],
      ['/task assign to @an', { message_id: 5, text: 'x' }, { kind: 'reply', note: 'assign to @an' }],
      ['/task all', { message_id: 5, text: 'x' }, { kind: 'all' }],
      ['/task ALL', { message_id: 5, text: 'x' }, { kind: 'all' }],
      // New names; /task and /create stay as hidden aliases
      ['/new Fix login', undefined, { kind: 'text', text: 'Fix login' }],
      ['/new@TBot 10', undefined, { kind: 'recent', count: 10 }],
      ['/new all', { message_id: 5, text: 'x' }, { kind: 'all' }],
      ['/new', { message_id: 5, text: 'x' }, { kind: 'reply', note: undefined }],
      ['/create Fix login', undefined, { kind: 'text', text: 'Fix login' }],
    ])('%s (reply=%p)', (text, reply, expected) => {
      expect(command.parseMode(msg(text, reply))).toEqual(expected);
    });

    it('ignores the implicit reply to a forum topic start', () => {
      expect(command.parseMode(msg('/task', { message_id: 2, forum_topic_created: {} }))).toBeNull();
    });

    it('reads commands in photo captions', () => {
      expect(command.parseMode({ message_id: 1, caption: '/task Fix the banner' } as any)).toEqual({
        kind: 'text',
        text: 'Fix the banner',
      });
    });
  });

  it('/task <text>: one extracted task posts a task card and stores its message id', async () => {
    (taskExtractionService.extract as jest.Mock).mockResolvedValue(
      aiResult([{ title: 'Deploy the API server', type: 'task', sourceMessageIds: [100] }]),
    );
    const ctx = createMockCtx({ message: { text: '/task Deploy the API server' } });

    await command.onTask(ctx);

    const input = (taskExtractionService.extract as jest.Mock).mock.calls[0][0];
    expect(input.messages).toEqual([expect.objectContaining({ messageId: 100, text: 'Deploy the API server' })]);
    expect(input.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Deploy the API server',
        groupId: mockGroupId,
        createdBy: mockUserId,
        batchId: expect.any(String),
        taskCardChatId: -100123,
        sourceMessages: [expect.objectContaining({ messageId: 100, link: 'https://t.me/c/123/100' })],
      }),
    );
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', via: 'ai' }));
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith(
      '📋 *#1* Test task',
      expect.objectContaining({ parse_mode: 'Markdown', reply_markup: { inline_keyboard: expect.any(Array) } }),
    );
    expect(taskService.updateTask).toHaveBeenCalledWith(expect.anything(), {
      taskCardMessageId: 999,
      taskCardChatId: -100123,
    });
  });

  it('reply /task <note>: passes the replied message and the note to the AI', async () => {
    (taskExtractionService.extract as jest.Mock).mockResolvedValue(
      aiResult([{ title: 'Fix login bug', type: 'bug', assignee: '@an', sourceMessageIds: [42] }]),
    );
    const ctx = createMockCtx({
      message: {
        text: '/task assign to @an',
        reply_to_message: { message_id: 42, date: 1760000000, text: 'Login is broken on iOS', from: { id: 999, first_name: 'Binh' } },
      },
    });

    await command.onTask(ctx);

    const input = (taskExtractionService.extract as jest.Mock).mock.calls[0][0];
    expect(input.note).toBe('assign to @an');
    expect(input.messages).toEqual([expect.objectContaining({ messageId: 42, fromName: 'Binh' })]);
    expect(taskService.createTask).toHaveBeenCalledWith(expect.objectContaining({ type: 'bug', assigneeId: anId }));
    expect(notificationService.notifyAssignment).toHaveBeenCalledWith(expect.anything(), memberAn, mockUser);
  });

  it('reply /task all: uses the replied message plus later buffered messages', async () => {
    (messageBufferService.getAfter as jest.Mock).mockResolvedValue([
      { messageId: 43, chatId: -100123, text: 'and the logo is blurry', fromUserId: 1, fromName: 'Binh', date: 1760000100 },
    ]);
    (taskExtractionService.extract as jest.Mock).mockResolvedValue(
      aiResult([
        { title: 'Fix login on iOS', type: 'bug', assignee: '@an', sourceMessageIds: [42] },
        { title: 'Replace blurry logo', type: 'task', assignee: 'Hùng', sourceMessageIds: [43] },
      ]),
    );
    const ctx = createMockCtx({
      message: { text: '/task all', reply_to_message: { message_id: 42, date: 1760000000, text: 'Login broken', from: { id: 1 } } },
    });

    await command.onTask(ctx);

    expect(messageBufferService.getAfter).toHaveBeenCalledWith(-100123, 42);
    const input = (taskExtractionService.extract as jest.Mock).mock.calls[0][0];
    expect(input.messages.map((m: any) => m.messageId)).toEqual([42, 43]);

    expect(taskService.createTask).toHaveBeenCalledTimes(2);
    const batchIds = (taskService.createTask as jest.Mock).mock.calls.map((c) => c[0].batchId);
    expect(batchIds[0]).toBe(batchIds[1]);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, extra] = (ctx.reply as jest.Mock).mock.calls[0];
    expect(text).toContain('<b>🤖 Created 2 tasks from <a href="https://t.me/c/123/42">2 messages</a></b>');
    expect(text).toContain('<b>#1</b> 🐞 Fix login on iOS → @an');
    expect(text).toContain('<b>#2</b> 📌 Replace blurry logo\n');
    expect(text).toContain('Couldn\'t find "Hùng" in this group — left unassigned');
    expect(extra.parse_mode).toBe('HTML');
    const row = extra.reply_markup.inline_keyboard[0];
    expect(row[0].callback_data).toMatch(/^batch:undo:[0-9a-f]+$/);
    expect(row[0].callback_data.length).toBeLessThanOrEqual(64);
    expect(row[1]).toEqual(expect.objectContaining({ text: '📋 Open board' }));
    expect(callbackDataStorageService.setCallbackData).toHaveBeenCalledWith(
      expect.any(String),
      'batch_cb',
      expect.objectContaining({ batchId: batchIds[0], requesterTelegramId: 123, count: 2 }),
    );
  });

  it('/task N: reads the last N buffered messages', async () => {
    (messageBufferService.getRecent as jest.Mock).mockResolvedValue([
      { messageId: 1, chatId: -100123, text: 'a', fromUserId: 1, fromName: 'x', date: 1 },
      { messageId: 2, chatId: -100123, text: 'b', fromUserId: 1, fromName: 'x', date: 2 },
    ]);
    (taskExtractionService.extract as jest.Mock).mockResolvedValue(aiResult([]));
    const ctx = createMockCtx({ message: { text: '/task 10' } });

    await command.onTask(ctx);

    expect(messageBufferService.getRecent).toHaveBeenCalledWith(-100123, 10);
    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No action items in those 2 messages'), expect.anything());
  });

  it('/task N with an empty buffer and privacy mode on explains how to fix it', async () => {
    (messageBufferService.getRecent as jest.Mock).mockResolvedValue([]);
    const ctx = createMockCtx({ message: { text: '/task 10' }, botInfo: { can_read_all_group_messages: false } });

    await command.onTask(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(PRIVACY_MODE_MESSAGE, {});
    expect(taskExtractionService.extract).not.toHaveBeenCalled();
  });

  it('AI fallback: still creates the task and says so in the same message', async () => {
    (taskExtractionService.extract as jest.Mock).mockResolvedValue({
      source: 'fallback',
      fallbackReason: 'failed',
      tasks: [{ title: 'Fix the bug', type: 'task', sourceMessageIds: [100] }],
    });
    const ctx = createMockCtx({ message: { text: '/task Fix the bug' } });

    await command.onTask(ctx);

    expect(taskService.createTask).toHaveBeenCalledTimes(1);
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ via: 'bot' }));
    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect((ctx.reply as jest.Mock).mock.calls[0][0]).toContain('AI was unavailable, so I made a basic task. Use the buttons below to edit it.');
  });

  it('rate limited single message: creates a basic task instead of refusing', async () => {
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false });
    const ctx = createMockCtx({ message: { text: '/task Fix the bug @an' } });

    await command.onTask(ctx);

    expect(taskExtractionService.extract).not.toHaveBeenCalled();
    expect(taskService.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Fix the bug', assigneeId: anId }));
  });

  it('rate limited /task N: asks to wait', async () => {
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false });
    (messageBufferService.getRecent as jest.Mock).mockResolvedValue([
      { messageId: 1, chatId: -100123, text: 'a', fromUserId: 1, fromName: 'x', date: 1 },
    ]);
    const ctx = createMockCtx({ message: { text: '/task 5' } });

    await command.onTask(ctx);

    expect(taskService.createTask).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Try again in a few minutes'), expect.anything());
  });

  it('replies with a friendly error when something throws', async () => {
    (taskExtractionService.extract as jest.Mock).mockRejectedValue(new Error('boom'));
    const ctx = createMockCtx({ message: { text: '/task Fix it' } });

    await command.onTask(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('no task was created'), expect.anything());
  });

  it('edits the progress message instead of posting a second one when extraction is slow', async () => {
    jest.useFakeTimers();
    try {
      let resolve: (v: any) => void = () => undefined;
      (taskExtractionService.extract as jest.Mock).mockReturnValue(new Promise((r) => (resolve = r)));
      const ctx = createMockCtx({ message: { text: '/task Fix it' } });
      (ctx.reply as jest.Mock).mockResolvedValueOnce({ message_id: 555 });

      const run = command.onTask(ctx);
      await jest.advanceTimersByTimeAsync(1600);
      expect(ctx.reply).toHaveBeenCalledWith('🤖 Reading the message…');

      resolve(aiResult([{ title: 'Fix it', type: 'task', sourceMessageIds: [100] }]));
      await run;

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      expect(ctx.telegram.editMessageText).toHaveBeenCalledWith(
        -100123,
        555,
        undefined,
        '📋 *#1* Test task',
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
      expect(taskService.updateTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskCardMessageId: 555 }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('createTasks core (origin app): creates without a Telegram source, posts nothing, returns the batch', async () => {
    (taskExtractionService.extract as jest.Mock).mockResolvedValue({
      source: 'fallback',
      fallbackReason: 'failed',
      tasks: [{ title: 'Fix it', type: 'task', assignee: 'Hùng', sourceMessageIds: [0] }],
    });

    const result = await createTasks({
      origin: 'app',
      requester: mockUser as any,
      group: mockGroup as any,
      messages: [{ messageId: 0, chatId: -100123, text: 'Fix it', fromUserId: 123, fromName: '@testuser', date: 1 }],
    });

    expect(taskService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMessages: [], sourceMessage: undefined, taskCardChatId: -100123 }),
    );
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'created', via: 'app' }));
    expect(result).toMatchObject({ status: 'created', batchId: expect.stringMatching(/^[0-9a-f]{16}$/), source: 'fallback' });
    if (result.status !== 'created') throw new Error('expected created');
    expect(result.tasks).toHaveLength(1);
    expect(result.warnings).toEqual([
      '⚠️ AI was unavailable, so I made a basic task. You can edit it on the board.',
      '⚠️ Couldn\'t find "Hùng" in this group — left unassigned. They need to post in the group once first.',
    ]);
  });

  it('createTasks core: names the tasks that could not be saved', async () => {
    (taskExtractionService.extract as jest.Mock).mockResolvedValue({
      source: 'ai',
      tasks: [
        { title: 'Saved one', type: 'task', sourceMessageIds: [0] },
        { title: 'Lost one', type: 'task', sourceMessageIds: [0] },
        { title: 'Lost two', type: 'task', sourceMessageIds: [0] },
      ],
    });
    const created = (taskService.createTask as jest.Mock).getMockImplementation();
    (taskService.createTask as jest.Mock)
      .mockImplementationOnce(created ?? (async (data: any) => ({ _id: new mongoose.Types.ObjectId(), taskNumber: 1, ...data })))
      .mockRejectedValueOnce(new Error('db'))
      .mockRejectedValueOnce(new Error('db'));

    const result = await createTasks({
      origin: 'app',
      requester: mockUser as any,
      group: mockGroup as any,
      messages: [{ messageId: 0, chatId: -100123, text: 'x', fromUserId: 123, fromName: '@testuser', date: 1 }],
    });

    if (result.status !== 'created') throw new Error('expected created');
    expect(result.warnings).toContain('⚠️ Couldn\'t save 2 tasks: “Lost one”, “Lost two”. Please add them again.');
  });

  describe('in a forum (Topics)', () => {
    const forumGroup = () => ({ ...mockGroup, isForum: true, eventsTopicId: 500, knownTopics: [] });
    const forumCtx = (message: Record<string, any>) =>
      createMockCtx({
        chat: { id: -100123, type: 'supergroup', title: 'Test Group', is_forum: true },
        message: { message_thread_id: 7, is_topic_message: true, ...message },
        telegram: {
          editMessageText: jest.fn(),
          deleteMessage: jest.fn(),
          sendMessage: jest.fn().mockResolvedValue({ message_id: 1234, message_thread_id: 500, is_topic_message: true }),
          setMessageReaction: jest.fn().mockResolvedValue(true),
        },
      });

    beforeEach(() => (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(forumGroup()));

    it('reply /task: card goes to "Task events" replying to the source, 👌 on the command, topic-aware links', async () => {
      (taskExtractionService.extract as jest.Mock).mockResolvedValue(
        aiResult([{ title: 'Fix login', type: 'bug', sourceMessageIds: [42] }]),
      );
      const ctx = forumCtx({
        text: '/task',
        reply_to_message: {
          message_id: 42,
          date: 1760000000,
          text: 'Login is broken',
          from: { id: 9, first_name: 'Binh' },
          message_thread_id: 7,
          is_topic_message: true,
        },
      });

      await command.onTask(ctx);

      expect(taskService.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMessages: [expect.objectContaining({ messageId: 42, link: 'https://t.me/c/123/7/42' })],
        }),
      );
      expect(ctx.telegram.sendMessage).toHaveBeenCalledTimes(1);
      expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(
        -100123,
        '📋 *#1* Test task',
        expect.objectContaining({
          parse_mode: 'Markdown',
          message_thread_id: 500,
          reply_parameters: { message_id: 42 },
        }),
      );
      expect(ctx.telegram.setMessageReaction).toHaveBeenCalledWith(-100123, 100, [{ type: 'emoji', emoji: '👌' }]);
      expect(ctx.reply).not.toHaveBeenCalled();
      expect(taskService.updateTask).toHaveBeenCalledWith(expect.anything(), {
        taskCardMessageId: 1234,
        taskCardChatId: -100123,
      });
    });

    it('/task N reads only this topic and the summary replies to the first source message', async () => {
      (messageBufferService.getRecent as jest.Mock).mockResolvedValue([
        { messageId: 30, chatId: -100123, text: 'a', fromUserId: 1, fromName: 'x', date: 1, threadId: 7 },
        { messageId: 31, chatId: -100123, text: 'b', fromUserId: 1, fromName: 'x', date: 2, threadId: 7 },
      ]);
      (taskExtractionService.extract as jest.Mock).mockResolvedValue(
        aiResult([
          { title: 'A', type: 'task', sourceMessageIds: [30] },
          { title: 'B', type: 'task', sourceMessageIds: [31] },
        ]),
      );
      const ctx = forumCtx({ text: '/task 2' });

      await command.onTask(ctx);

      expect(messageBufferService.getRecent).toHaveBeenCalledWith(-100123, 2, { threadId: 7 });
      const [, text, extra] = (ctx.telegram.sendMessage as jest.Mock).mock.calls[0];
      expect(text).toContain('Created 2 tasks');
      // Source in topic 7, events topic 500: a cross-topic reply (no allow_sending_without_reply)
      expect(extra).toEqual(expect.objectContaining({ message_thread_id: 500, reply_parameters: { message_id: 30 } }));
      expect(ctx.telegram.setMessageReaction).toHaveBeenCalled();
      expect(ctx.reply).not.toHaveBeenCalled();
    });

    it('errors stay in the user\'s topic', async () => {
      (messageBufferService.getRecent as jest.Mock).mockResolvedValue([
        { messageId: 30, chatId: -100123, text: 'a', fromUserId: 1, fromName: 'x', date: 1, threadId: 7 },
      ]);
      (taskExtractionService.extract as jest.Mock).mockResolvedValue(aiResult([]));
      const ctx = forumCtx({ text: '/task 1' });

      await command.onTask(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('No action items'), expect.anything());
      expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
      expect(ctx.telegram.setMessageReaction).not.toHaveBeenCalled();
    });
  });
});
