import mongoose from 'mongoose';
import {
  AiController,
  UNDO_EXPIRED_MESSAGE,
  UNDO_FORBIDDEN_MESSAGE,
} from 'src/api/controllers/ai.controller';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { aiCommandService } from 'src/shared/services/ai-command.service';
import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import { WEB_AI_UNAVAILABLE_TEXT } from 'src/shared/services/ai-command/web.renderer';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import { AI_USER_DAILY_LIMIT } from 'src/shared/services/ai-quota';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { redisService } from 'src/shared/services/redis.service';
import { checkGroupAiRateLimit, createTasks } from 'src/shared/services/task-creation.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';

jest.mock('src/database/services/subtask.service', () => ({
  subtaskService: {
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    progress: jest.fn().mockResolvedValue(new Map()),
    detachAll: jest.fn().mockResolvedValue([]),
    setEpic: jest.fn().mockResolvedValue(0),
  },
}));
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
jest.mock('src/bot', () => ({ bot: { telegram: { editMessageText: jest.fn().mockResolvedValue(true) } } }));
jest.mock('src/shared/services/redis.service', () => ({
  redisService: { get: jest.fn(), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) },
}));
jest.mock('src/database/services/task.service', () => ({
  taskService: {
    getTaskById: jest.fn(),
    getTaskByNumber: jest.fn(),
    getTasksByGroup: jest.fn(),
    updateTask: jest.fn(),
    assignTask: jest.fn(),
    updateTaskStatus: jest.fn(),
    getTasksByBatch: jest.fn(),
    deleteTasks: jest.fn(),
  },
}));
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { getMembers: jest.fn(), isMember: jest.fn() },
}));
jest.mock('src/database/services/group.service', () => ({ groupService: { findGroupById: jest.fn() } }));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { record: jest.fn(), recordMany: jest.fn() } }));
jest.mock('src/api/telegram-admin', () => ({ isTelegramGroupAdmin: jest.fn() }));
jest.mock('src/shared/services/rate-limit.service', () => ({ rateLimitService: { checkRateLimit: jest.fn() } }));
jest.mock('src/shared/services/ai/ai.service', () => {
  class AIUnavailableError extends Error {
    constructor(
      public reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { AIUnavailableError, aiService: { isConfigured: jest.fn(), generateJson: jest.fn() }, parseJsonLoose: jest.fn() };
});
jest.mock('src/shared/services/ai-command.service', () => {
  const actual = jest.requireActual('src/shared/services/ai-command.service');
  actual.aiCommandService.plan = jest.fn();
  return actual;
});
jest.mock('src/shared/services/task-creation.service', () => ({
  ...jest.requireActual('src/shared/services/task-creation.service'),
  createTasks: jest.fn(),
  checkGroupAiRateLimit: jest.fn(),
}));
jest.mock('src/shared/services/task-sync.service', () => ({
  taskSyncService: {
    postChangeSummary: jest.fn().mockResolvedValue(undefined),
    postCreatedFromApp: jest.fn(),
    markBatchUndone: jest.fn().mockResolvedValue(undefined),
  },
  userDisplayName: (u: any) => (u?.username ? `@${u.username}` : 'Someone'),
}));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: { notifyAssignment: jest.fn(), notifyUnassigned: jest.fn(), notifyStatusChange: jest.fn() },
}));
jest.mock('src/shared/utils/app-links', () => ({
  OPEN_BOARD_LABEL: '📋 Open board',
  appLinkButton: jest.fn(() => null),
  buildAppLink: jest.fn(() => null),
  boardButton: jest.fn(() => null),
  openTaskLabel: (n: number) => `📱 Open #${n}`,
  taskButton: jest.fn(() => null),
  taskNumberHtml: (n: number) => `<b>#${n}</b>`,
  taskNumberMarkdown: (n: number) => `*#${n}*`,
}));
jest.mock('src/bot/task-card.renderer', () => ({
  ...jest.requireActual('src/bot/task-card.renderer'),
  formatTaskCard: jest.fn(() => 'card'),
  buildTaskButtons: jest.fn().mockResolvedValue([]),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1, username: 'me', firstName: 'Me' } as any;
const an = { _id: oid(), telegramUserId: 2, username: 'an', firstName: 'An' } as any;
const group = { _id: oid(), telegramGroupId: -100123, timezone: 'UTC' } as any;

const task = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: oid(),
    groupId: group._id,
    taskNumber: 12,
    title: 'Fix login & logout',
    status: 'todo',
    type: 'bug',
    priority: 'medium',
    assigneeId: null,
    createdBy: me,
    taskCardChatId: -100123,
    taskCardMessageId: 55,
    ...overrides,
  }) as any;

const plan = (...actions: unknown[]) => aiPlanSchema.parse({ actions });

function call(body: Record<string, unknown>, user = me) {
  const req: any = { params: { groupId: group._id.toString() }, body, user, group };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { req, res };
}

async function chat(body: Record<string, unknown>) {
  const { req, res } = call(body);
  await new AiController().chat(req, res);
  return res;
}

const dataOf = (res: any) => res.json.mock.calls[0][0].data;

function expectPlain(text: string) {
  expect(text).not.toMatch(/[<>]|&amp;|&lt;|&gt;/);
}

beforeEach(() => {
  jest.clearAllMocks();
  (aiService.isConfigured as jest.Mock).mockReturnValue(true);
  (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0 });
  (checkGroupAiRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1, retryAfterSeconds: 0 });
  (groupMemberService.getMembers as jest.Mock).mockResolvedValue([me, an]);
  (groupMemberService.isMember as jest.Mock).mockResolvedValue(true);
  (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);
});

describe('POST /api/groups/:groupId/ai', () => {
  it('rejects an empty or too long message and a bad taskId with 400', async () => {
    for (const body of [{ message: '   ' }, { message: 'x'.repeat(2001) }, { message: 'hi', taskId: 'nope' }]) {
      const res = await chat(body);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    const tooMany = Array.from({ length: 21 }, () => ({ role: 'user', content: 'x' }));
    expect((await chat({ message: 'hi', history: tooMany })).status).toHaveBeenCalledWith(400);
    expect(aiCommandService.plan).not.toHaveBeenCalled();
  });

  it('updated: changes the task, posts "(via app)" to the group, refreshes the card, plain text', async () => {
    const t = task();
    const updated = task({ _id: t._id, assigneeId: an });
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(t);
    (taskService.assignTask as jest.Mock).mockResolvedValue(updated);
    (aiCommandService.plan as jest.Mock).mockResolvedValue(
      plan({ action: 'update_task', taskRef: 12, changes: { assignee: '@an' } }),
    );

    const res = await chat({ message: 'giao #12 cho @an' });
    const data = dataOf(res);

    expect(data.kind).toBe('updated');
    expect(data.text).toBe('✅ #12 Fix login & logout\n👤 Unassigned → @an');
    expectPlain(data.text);
    expect(data.changed).toEqual([{ task: updated, changes: ['👤 Unassigned → @an'] }]);
    expect(data.suggestions).toEqual(['Set due date for #12', 'What are my open tasks?', "What's overdue?"]);
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'assignee', via: 'ai' }));
    expect(taskSyncService.postChangeSummary).toHaveBeenCalledWith(updated, me._id, [
      { field: 'assignee', from: null, to: '@an' },
    ]);
    const { bot } = jest.requireMock('src/bot');
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(-100123, 55, undefined, 'card', expect.any(Object));
  });

  it('query: returns tasks, a plain header and deterministic suggestions', async () => {
    const tasks = [task({ taskNumber: 12 }), task({ taskNumber: 9, assigneeId: me })];
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks, total: 2 });
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'query', kind: 'open' }));

    const data = dataOf(await chat({ message: 'what is open?' }));

    expect(data.kind).toBe('query');
    expect(data.text).toBe('📋 Open tasks · 2');
    expect(data.tasks.map((t: any) => t.taskNumber)).toEqual([12, 9]);
    expect(data.totalMatches).toBeUndefined();
    expect(data.suggestions).toEqual(['Assign #12 to me', "What's overdue?", 'What are my open tasks?']);
  });

  it('query: caps the tasks and reports totalMatches', async () => {
    const tasks = Array.from({ length: 25 }, (_, i) => task({ taskNumber: i + 1 }));
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks, total: 25 });
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'query', kind: 'open' }));
    const data = dataOf(await chat({ message: 'open tasks' }));
    expect(data.tasks).toHaveLength(20);
    expect(data.totalMatches).toBe(25);
  });

  it('created: runs the /task core as the app, posts once to the group and returns the undo window', async () => {
    const created = [
      { task: task({ taskNumber: 14, title: 'Fix login', assigneeId: an, dueDate: null }), assignee: an },
      { task: task({ taskNumber: 15, title: 'Logo', assigneeId: null }), assignee: null },
    ];
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'create_tasks', useReply: false }));
    (createTasks as jest.Mock).mockResolvedValue({
      status: 'created',
      created,
      tasks: created.map((c) => c.task),
      warnings: ['⚠️ Couldn\'t find "Hùng" in this group — left unassigned.'],
      batchId: 'abcdef0123456789',
      source: 'ai',
    });
    (taskSyncService.postCreatedFromApp as jest.Mock).mockResolvedValue({ chatId: -100123, messageId: 900 });

    const before = Date.now();
    const data = dataOf(await chat({ message: 'tạo task fix login cho @an và đổi logo' }));

    expect(createTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'app',
        requester: me,
        group,
        messages: [expect.objectContaining({ text: 'tạo task fix login cho @an và đổi logo' })],
      }),
    );
    expect(taskSyncService.postCreatedFromApp).toHaveBeenCalledWith(group, me, created);
    expect(redisService.set).toHaveBeenCalledWith(
      'app_batch_post:abcdef0123456789',
      JSON.stringify({ chatId: -100123, messageId: 900 }),
      { EX: 900 },
    );
    expect(data).toMatchObject({
      kind: 'created',
      text: '🤖 Created 2 tasks: #14, #15',
      batchId: 'abcdef0123456789',
      warnings: ['⚠️ Couldn\'t find "Hùng" in this group — left unassigned.'],
      suggestions: ['Đặt hạn cho #14', 'Tôi còn task nào?'],
    });
    const until = new Date(data.undoUntil).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 10 * 60 * 1000);
  });

  it('clarify: shows the AI question, changes nothing, no suggestions', async () => {
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'clarify', question: 'Task nào vậy?' }));
    const data = dataOf(await chat({ message: 'xong rồi' }));
    expect(data).toEqual({ kind: 'clarify', text: '🤔 Task nào vậy?', suggestions: [] });
    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('refused: delete and bulk are refused with plain text', async () => {
    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'delete_task', taskRef: 5 }));
    let data = dataOf(await chat({ message: 'xoá #5' }));
    expect(data.kind).toBe('refused');
    expectPlain(data.text);
    expect(data.text).toContain('delete');

    (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'bulk' }));
    data = dataOf(await chat({ message: 'close all of @an tasks' }));
    expect(data.kind).toBe('refused');
    expect(data.text).toContain('at most 5 tasks');
    expect(taskService.deleteTasks).not.toHaveBeenCalled();
  });

  it('unavailable: AI not configured or failing → 200 with the fallback text', async () => {
    (aiService.isConfigured as jest.Mock).mockReturnValue(false);
    let res = await chat({ message: 'hi' });
    expect(res.status).not.toHaveBeenCalled();
    expect(dataOf(res)).toEqual({ kind: 'unavailable', text: WEB_AI_UNAVAILABLE_TEXT, suggestions: [] });

    (aiService.isConfigured as jest.Mock).mockReturnValue(true);
    (aiCommandService.plan as jest.Mock).mockRejectedValue(new AIUnavailableError('invalid', 'bad json'));
    res = await chat({ message: 'hi' });
    expect(dataOf(res)).toEqual({ kind: 'unavailable', text: WEB_AI_UNAVAILABLE_TEXT, suggestions: [] });
  });

  it('group AI limit → 200 unavailable (not 429)', async () => {
    (checkGroupAiRateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 240, scope: 'minute' });
    const res = await chat({ message: 'hi' });
    expect(res.status).not.toHaveBeenCalled();
    expect(dataOf(res).kind).toBe('unavailable');
    expect(dataOf(res).text).toContain('try again in 4 min');
  });

  it('per-user limit → 429 with a plain message (shared with Telegram /ai)', async () => {
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const res = await chat({ message: 'hi' });
    expect(rateLimitService.checkRateLimit).toHaveBeenCalledWith(1, 'ai_command:-100123', 6, 60);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Too Many Requests',
      message: 'Too many AI requests in a row — try again in 30s.',
      statusCode: 429,
    });
    expect(aiCommandService.plan).not.toHaveBeenCalled();
  });

  it('daily per-user AI quota (across all groups) → 429 with a human wait time', async () => {
    (rateLimitService.checkRateLimit as jest.Mock).mockImplementation(async (_id, action) =>
      String(action).startsWith('ai_user_daily:')
        ? { allowed: false, remaining: 0, retryAfterSeconds: 5 * 3600 }
        : { allowed: true, remaining: 5, retryAfterSeconds: 0 },
    );
    const res = await chat({ message: 'hi' });
    expect(rateLimitService.checkRateLimit).toHaveBeenCalledWith(1, expect.stringMatching(/^ai_user_daily:\d{4}-\d{2}-\d{2}$/), AI_USER_DAILY_LIMIT, expect.any(Number));
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json.mock.calls[0][0].message).toMatch(/^You've used all your AI requests for today \(\d+\)\. They come back (tomorrow )?at \d\d:\d\d \(in \d+(h|s| min)\)\.$/);
    expect(aiCommandService.plan).not.toHaveBeenCalled();
  });

  describe('taskId context', () => {
    it('uses the open task as "this task"', async () => {
      const t = task({ status: 'in_progress' });
      (taskService.getTaskById as jest.Mock).mockResolvedValue(t);
      (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(task({ _id: t._id, status: 'done' }));
      (aiCommandService.plan as jest.Mock).mockResolvedValue(
        plan({ action: 'update_task', taskRef: 'reply', changes: { status: 'done' } }),
      );

      const data = dataOf(await chat({ message: 'task này xong rồi', taskId: t._id.toString() }));

      const context = (aiCommandService.plan as jest.Mock).mock.calls[0][0];
      expect(context).toMatchObject({ replyTask: t, channel: 'web', mentions: [] });
      expect(taskService.updateTaskStatus).toHaveBeenCalledWith(t._id, 'done', me._id);
      expect(data.kind).toBe('updated');
    });

    it('404s for a task of another group', async () => {
      (taskService.getTaskById as jest.Mock).mockResolvedValue(task({ groupId: oid() }));
      const res = await chat({ message: 'xong', taskId: oid().toString() });
      expect(res.status).toHaveBeenCalledWith(404);
      expect(aiCommandService.plan).not.toHaveBeenCalled();
    });
  });

  describe('history follow-ups', () => {
    it('resolves "it" to the single task of the previous answer', async () => {
      const t = task({ taskNumber: 12 });
      const updated = task({ _id: t._id, assigneeId: an });
      (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(t);
      (taskService.assignTask as jest.Mock).mockResolvedValue(updated);
      (aiCommandService.plan as jest.Mock).mockResolvedValue(
        plan({ action: 'update_task', taskRef: 'previous', changes: { assignee: '@an' } }),
      );
      const history = [
        { role: 'user', content: 'tôi còn task nào?' },
        { role: 'assistant', content: '📋 Your open tasks · 1\n#12 🐞 Fix login' },
      ];

      const data = dataOf(await chat({ message: 'giao nó cho @an', history }));

      const context = (aiCommandService.plan as jest.Mock).mock.calls[0][0];
      expect(context.previousNumbers).toEqual([12]);
      expect(context.previousTask).toBe(t);
      expect(context.history).toEqual(history);
      expect(taskService.assignTask).toHaveBeenCalledWith(t._id, an._id);
      expect(data.kind).toBe('updated');
    });

    it('also accepts the number of that single task, but not a number from a multi-task answer', async () => {
      const t = task({ taskNumber: 12 });
      (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(t);
      (taskService.assignTask as jest.Mock).mockResolvedValue(task({ _id: t._id, assigneeId: an }));
      (aiCommandService.plan as jest.Mock).mockResolvedValue(
        plan({ action: 'update_task', taskRef: 12, changes: { assignee: '@an' } }),
      );
      let data = dataOf(
        await chat({ message: 'giao nó cho @an', history: [{ role: 'assistant', content: '✅ #12 Fix login' }] }),
      );
      expect(data.kind).toBe('updated');

      jest.clearAllMocks();
      (aiCommandService.plan as jest.Mock).mockResolvedValue(
        plan({ action: 'update_task', taskRef: 12, changes: { assignee: '@an' } }),
      );
      data = dataOf(
        await chat({ message: 'giao nó cho @an', history: [{ role: 'assistant', content: 'Created 2 tasks: #12, #13' }] }),
      );
      expect(data.kind).toBe('clarify');
      expect(taskService.assignTask).not.toHaveBeenCalled();
    });

    it('clarifies when the previous answer had several tasks', async () => {
      (aiCommandService.plan as jest.Mock).mockResolvedValue(
        plan({ action: 'update_task', taskRef: 'previous', changes: { assignee: '@an' } }),
      );
      const history = [{ role: 'assistant', content: '🤖 Created 2 tasks: #14, #15' }];

      const data = dataOf(await chat({ message: 'giao nó cho @an', history }));

      expect(taskService.getTaskByNumber).not.toHaveBeenCalled();
      expect(data.kind).toBe('clarify');
      expect(data.text).toBe('🤔 Which one? The last answer had 2 tasks.\nWrite its #number.');
      expect(taskService.assignTask).not.toHaveBeenCalled();
    });

    it('sends only the last 8 turns to the planner', async () => {
      (aiCommandService.plan as jest.Mock).mockResolvedValue(plan({ action: 'answer', text: 'ok' }));
      const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `t${i}` }));
      await chat({ message: 'hi', history });
      const context = (aiCommandService.plan as jest.Mock).mock.calls[0][0];
      expect(context.history.map((t: any) => t.content)).toEqual(['t4', 't5', 't6', 't7', 't8', 't9', 't10', 't11']);
    });
  });
});

describe('POST /api/batches/:batchId/undo', () => {
  const batchId = 'abcdef0123456789';
  const batchTasks = (overrides: Record<string, unknown> = {}) => [
    task({ taskNumber: 14, batchId, createdAt: new Date(), ...overrides }),
    task({ taskNumber: 15, batchId, createdAt: new Date(), ...overrides }),
  ];

  async function undo(user = me) {
    const req: any = { params: { batchId }, body: {}, user };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await new AiController().undo(req, res);
    return res;
  }

  beforeEach(() => {
    (taskService.deleteTasks as jest.Mock).mockResolvedValue(2);
    (groupService.findGroupById as jest.Mock).mockResolvedValue(group);
    (isTelegramGroupAdmin as jest.Mock).mockResolvedValue(false);
  });

  it('lets the requester undo within 10 minutes and marks the group post', async () => {
    const tasks = batchTasks();
    (taskService.getTasksByBatch as jest.Mock).mockResolvedValue(tasks);
    (redisService.get as jest.Mock).mockResolvedValue(JSON.stringify({ chatId: -100123, messageId: 900 }));

    const res = await undo();

    expect(res.json).toHaveBeenCalledWith({ data: { removed: 2 } });
    expect(taskService.deleteTasks).toHaveBeenCalledWith(tasks.map((t) => t._id));
    expect(taskActivityService.recordMany).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ action: 'deleted', via: 'app' })]),
    );
    expect(taskSyncService.markBatchUndone).toHaveBeenCalledWith({ chatId: -100123, messageId: 900 }, '@me', 2, tasks, expect.anything());
    expect(redisService.del).toHaveBeenCalledWith(`app_batch_post:${batchId}`);
  });

  it('lets a group admin undo', async () => {
    (taskService.getTasksByBatch as jest.Mock).mockResolvedValue(batchTasks());
    (isTelegramGroupAdmin as jest.Mock).mockResolvedValue(true);
    const res = await undo(an);
    expect(isTelegramGroupAdmin).toHaveBeenCalledWith(-100123, 2);
    expect(res.json).toHaveBeenCalledWith({ data: { removed: 2 } });
  });

  it('refuses other members with 403', async () => {
    (taskService.getTasksByBatch as jest.Mock).mockResolvedValue(batchTasks());
    const res = await undo(an);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: UNDO_FORBIDDEN_MESSAGE }));
    expect(taskService.deleteTasks).not.toHaveBeenCalled();
  });

  it('refuses after 10 minutes with 403', async () => {
    (taskService.getTasksByBatch as jest.Mock).mockResolvedValue(
      batchTasks({ createdAt: new Date(Date.now() - 11 * 60 * 1000) }),
    );
    const res = await undo();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: UNDO_EXPIRED_MESSAGE }));
    expect(taskService.deleteTasks).not.toHaveBeenCalled();
  });

  it('refuses non-members and unknown batches', async () => {
    (taskService.getTasksByBatch as jest.Mock).mockResolvedValue(batchTasks());
    (groupMemberService.isMember as jest.Mock).mockResolvedValue(false);
    expect((await undo()).status).toHaveBeenCalledWith(403);

    (taskService.getTasksByBatch as jest.Mock).mockResolvedValue([]);
    expect((await undo()).status).toHaveBeenCalledWith(404);
    expect(taskService.deleteTasks).not.toHaveBeenCalled();
  });
});
