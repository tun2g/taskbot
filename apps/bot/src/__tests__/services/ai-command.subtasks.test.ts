import mongoose from 'mongoose';
import { epicService } from 'src/database/services/epic.service';
import { taskService } from 'src/database/services/task.service';
import { AiRequestContext, aiCommandService } from 'src/shared/services/ai-command.service';
import { subtaskService } from 'src/database/services/subtask.service';
import { aiService } from 'src/shared/services/ai/ai.service';
import { BREAKDOWN_SYSTEM_PROMPT } from 'src/shared/services/ai-command/breakdown.prompt';
import { EXPLAIN_TASK_SYSTEM_PROMPT } from 'src/shared/services/ai-command/explain.prompt';
import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import { AI_COMMAND_SYSTEM_PROMPT } from 'src/shared/services/ai-command/prompt';
import { renderWeb } from 'src/shared/services/ai-command/web.renderer';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { TaskMutationError, taskMutationService } from 'src/shared/services/task-mutation.service';

jest.mock('src/database/services/subtask.service', () => ({
  subtaskService: {
    list: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    progress: jest.fn().mockResolvedValue(new Map()),
    detachAll: jest.fn().mockResolvedValue([]),
    setEpic: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('src/database/services/epic.service', () => {
  class EpicTitleTakenError extends Error {}
  return {
    EpicTitleTakenError,
    normalizeEpicTitle: (t: string) => t.replace(/\s+/g, ' ').trim(),
    epicService: {
      listOpen: jest.fn(),
      listWithProgress: jest.fn(),
      findByTitle: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    },
  };
});
jest.mock('src/shared/services/redis.service', () => ({
  redisService: { set: jest.fn().mockResolvedValue('OK'), get: jest.fn(), del: jest.fn().mockResolvedValue(1) },
}));
jest.mock('src/shared/services/ai/ai.service', () => ({
  aiService: { isConfigured: jest.fn(), generateJson: jest.fn() },
  AIUnavailableError: class extends Error {},
}));
jest.mock('src/database/services/task.service', () => ({
  taskService: {
    getTaskByNumber: jest.fn(),
    getTasksByGroup: jest.fn(),
    updateTask: jest.fn(),
    assignTask: jest.fn(),
    updateTaskStatus: jest.fn(),
    getTaskById: jest.fn(),
  },
}));
jest.mock('src/database/services/task-activity.service', () => ({
  taskActivityService: { record: jest.fn(), getForTask: jest.fn() },
}));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: { notifyAssignment: jest.fn(), notifyUnassigned: jest.fn(), notifyStatusChange: jest.fn() },
}));
jest.mock('src/shared/utils/app-links', () => {
  const url = 'https://t.me/bot?startapp=g';
  return {
    OPEN_BOARD_LABEL: '📋 Open board',
    appLinkButton: jest.fn((text: string) => ({ text, url })),
    buildAppLink: jest.fn(() => url),
    boardButton: jest.fn(() => ({ text: '📋 Open board', url })),
    openTaskLabel: (n: number) => `📱 Open #${n}`,
    taskButton: jest.fn((t: { taskNumber: number }) => ({ text: `📱 Open #${t.taskNumber}`, url })),
    taskNumberHtml: (n: number) => `<b>#${n}</b>`,
    taskNumberMarkdown: (n: number) => `*#${n}*`,
  };
});
jest.mock('src/bot/task-card.renderer', () => ({
  ...jest.requireActual('src/bot/task-card.renderer'),
  formatTaskCard: jest.fn(() => 'card'),
  buildTaskButtons: jest.fn().mockResolvedValue([]),
}));
jest.mock('src/shared/services/task-mutation.service', () => ({
  ...jest.requireActual('src/shared/services/task-mutation/common'),
  taskMutationService: { createTask: jest.fn(), updateTask: jest.fn() },
}));
jest.mock('src/shared/services/task-sync.service', () => ({ taskSyncService: { syncTaskCard: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { setCallbackData: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));


const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1, username: 'me', firstName: 'Me' } as any;
const an = { _id: oid(), telegramUserId: 2, username: 'an', firstName: 'An' } as any;
const group = { _id: oid(), timezone: 'UTC' } as any;
const epicDoc = (title: string, color = 'blue', extra: Record<string, unknown> = {}) =>
  ({ _id: oid(), groupId: group._id, title, color, status: 'open', ...extra }) as any;
const login = epicDoc('Login', 'blue');

const task = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: oid(),
    groupId: group._id,
    taskNumber: 5,
    title: 'Fix login on iOS',
    status: 'todo',
    type: 'bug',
    priority: 'medium',
    assigneeId: null,
    epicId: null,
    taskCardChatId: -100,
    taskCardMessageId: 55,
    ...overrides,
  }) as any;

function context(overrides: Partial<AiRequestContext> = {}): AiRequestContext {
  return {
    request: 'chia #42 thành subtask',
    requester: me,
    group,
    members: [me, an],
    replyTask: null,
    replyMessage: null,
    referencedTasks: [],
    referencedNumbers: [],
    mentions: [],
    timezone: 'UTC',
    today: '2026-10-19',
    openEpics: [
      { _id: String(login._id), title: 'Login', color: 'blue' },
    ],
    ...overrides,
  };
}

const plan = (...actions: unknown[]) => aiPlanSchema.parse({ actions });
const editor = { editMessageText: jest.fn().mockResolvedValue(true) };

async function telegram(c: AiRequestContext, p: ReturnType<typeof plan>) {
  const outcome = await aiCommandService.execute(c, p, editor);
  if (outcome.kind !== 'reply') throw new Error('expected a reply');
  return outcome;
}

const parent = task({ taskNumber: 42, title: 'Checkout v2', type: 'feature', description: 'New checkout with Apple Pay', epicId: login });
let n = 42;

beforeEach(() => {
  jest.clearAllMocks();
  n = 42;
  (epicService.listOpen as jest.Mock).mockResolvedValue([login]);
  (epicService.findByTitle as jest.Mock).mockImplementation(async (_g: unknown, t: string) =>
    t.trim().toLowerCase() === 'login' ? login : null,
  );
  (subtaskService.list as jest.Mock).mockResolvedValue([]);
  (taskService.getTaskByNumber as jest.Mock).mockImplementation(async (_g: unknown, num: number) =>
    num === 42 ? parent : num === 45 ? task({ taskNumber: 45, title: 'API' }) : null,
  );
  (taskMutationService.createTask as jest.Mock).mockImplementation(async (_g: unknown, _a: unknown, f: any) => ({
    task: task({ taskNumber: ++n, title: f.title, parentTaskId: parent._id, dueDate: f.dueDate ? new Date(`${f.dueDate}T00:00:00Z`) : null }),
    assignee: f.assigneeId ? an : null,
  }));
});

const ctx42 = (request: string, extra: Partial<AiRequestContext> = {}) =>
  context({ request, referencedTasks: [parent], referencedNumbers: [42], ...extra });

describe('create_subtasks', () => {
  it('the planner knows the action and the parent change', () => {
    expect(AI_COMMAND_SYSTEM_PROMPT).toContain('"action":"create_subtasks"');
    expect(AI_COMMAND_SYSTEM_PROMPT).toContain('"parent":42');
    const p = plan({ action: 'update_task', taskRef: 45, changes: { parent: '#42' } });
    expect(p.actions[0]).toMatchObject({ changes: { parent: 42 } });
  });

  it('creates the listed subtasks under #42 with assignee and due date, one batch with ↩️ Undo', async () => {
    const out = await telegram(
      ctx42('chia #42 thành subtask: thiết kế API, viết UI cho @an thứ 6'),
      plan({
        action: 'create_subtasks',
        taskRef: 42,
        items: [{ title: 'Thiết kế API' }, { title: 'Viết UI', assignee: '@an', dueDate: '2026-10-23' }],
      }),
    );
    const calls = (taskMutationService.createTask as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toEqual({ title: 'Thiết kế API', parentTaskId: String(parent._id) });
    expect(calls[1][2]).toEqual({ title: 'Viết UI', parentTaskId: String(parent._id), assigneeId: String(an._id), dueDate: '2026-10-23' });
    const batchIds = new Set(calls.map((c) => c[3].batchId));
    expect(batchIds.size).toBe(1);
    expect(calls[0][3]).toMatchObject({ announce: 'none', channel: { activity: 'ai' } });

    expect(out.reply.text).toContain('🧩 <b>#42</b> <b>Checkout v2</b> · 2 subtasks added');
    expect(out.reply.text).toContain('<b>#44</b> 🐞 Viết UI → @an · 📅 Fri, Oct 23');
    expect(out.reply.text).not.toContain('Suggested by AI');
    expect(out.reply.buttons?.[0][0].text).toBe('↩️ Undo');
    expect((out.reply.buttons?.[0][0] as any).callback_data).toMatch(/^batch:undo:/);
    expect(out.reply.buttons?.[0][1].text).toBe('📱 Open #42');
    expect(callbackDataStorageService.setCallbackData).toHaveBeenCalledWith(
      expect.any(String),
      'batch_cb',
      expect.objectContaining({ batchId: [...batchIds][0], count: 2, requesterTelegramId: 1 }),
    );
  });

  it('without items the AI proposes a breakdown as a preview — nothing is created until ✅ Add all', async () => {
    (aiService.generateJson as jest.Mock).mockResolvedValueOnce({
      subtasks: [{ title: 'Thiết kế màn checkout' }, { title: 'Tích hợp Apple Pay' }],
    });
    const out = await telegram(ctx42('tách nhỏ #42 giúp mình'), plan({ action: 'create_subtasks', taskRef: 42 }));
    const [request] = (aiService.generateJson as jest.Mock).mock.calls[0];
    expect(request.system).toBe(BREAKDOWN_SYSTEM_PROMPT);
    expect(request.system).not.toContain('clarify scope, then do it');
    expect(request.user).toContain('Task #42: "Checkout v2"');
    expect(request.user).toContain('New checkout with Apple Pay');
    expect(request.user).toContain('write the titles in Vietnamese');
    expect(taskMutationService.createTask).not.toHaveBeenCalled();
    expect(out.reply.text).toContain('AI suggests 2 subtasks');
    expect(out.reply.text).toContain('1. Thiết kế màn checkout');
    expect(out.reply.text).toContain('2. Tích hợp Apple Pay');
    const buttons = out.reply.buttons?.[0] ?? [];
    expect(buttons.map((b) => b.text)).toEqual(['✅ Add all', '✖ Cancel']);
    expect((buttons[0] as { callback_data: string }).callback_data).toMatch(/^subprev:add:[0-9a-f]{12}$/);
  });

  it('assigns a requested split to the named people in order and asks for that many', async () => {
    (aiService.generateJson as jest.Mock).mockResolvedValueOnce({
      subtasks: [{ title: 'API' }, { title: 'UI' }],
    });
    const out = await telegram(
      ctx42('chia #42 thành 3 subtask cho @an @binh @me'),
      plan({ action: 'create_subtasks', taskRef: 42, assignees: ['@an', '@me', '@ghost'], count: 3 }),
    );
    const [request] = (aiService.generateJson as jest.Mock).mock.calls[0];
    expect(request.user).toContain('Wanted: exactly 3 subtasks.');
    expect(out.reply.text).toContain('1. API → @an');
    expect(out.reply.text).toContain('2. UI → @me');
    expect(out.reply.text).toContain("Couldn't find @ghost");
  });

  it('asks the user to list items when the task is too vague to split', async () => {
    (aiService.generateJson as jest.Mock).mockResolvedValueOnce({ subtasks: [] });
    const out = await telegram(ctx42('tách nhỏ #42'), plan({ action: 'create_subtasks', taskRef: 42 }));
    expect(out.reply.text).toContain('#42 is too vague for me to split');
    expect(out.reply.text).toContain('chia #42 thành subtask:');
    expect(taskMutationService.createTask).not.toHaveBeenCalled();
  });

  it('says how to list them when the AI cannot propose', async () => {
    const { AIUnavailableError } = jest.requireMock('src/shared/services/ai/ai.service');
    (aiService.generateJson as jest.Mock).mockRejectedValueOnce(Object.assign(new AIUnavailableError('down'), { reason: 'error' }));
    const out = await telegram(ctx42('break #42 down'), plan({ action: 'create_subtasks', taskRef: 42 }));
    expect(out.reply.text).toContain("⚠️ AI can't suggest subtasks right now");
    expect(taskMutationService.createTask).not.toHaveBeenCalled();
  });

  it('refuses a subtask as parent (one level) without creating anything', async () => {
    const sub = task({ taskNumber: 45, title: 'API', parentTaskId: { _id: parent._id, taskNumber: 42, title: 'Checkout v2' } });
    const out = await telegram(
      context({ request: 'chia #45', referencedTasks: [sub], referencedNumbers: [45] }),
      plan({ action: 'create_subtasks', taskRef: 45, items: [{ title: 'X' }] }),
    );
    expect(out.reply.text).toContain('#45 is already a subtask of #42');
    expect(out.reply.buttons?.[0].map((b) => b.text)).toEqual(['📱 Open #45']);
    expect(taskMutationService.createTask).not.toHaveBeenCalled();
  });

  it('skips items that repeat an existing subtask and warns about unknown people', async () => {
    (subtaskService.list as jest.Mock).mockResolvedValue([task({ taskNumber: 43, title: 'Thiết kế API' })]);
    const out = await telegram(
      ctx42('thêm subtask cho #42'),
      plan({ action: 'create_subtasks', taskRef: 42, items: [{ title: 'thiết kế  api' }, { title: 'Test', assignee: '@ghost' }] }),
    );
    expect((taskMutationService.createTask as jest.Mock).mock.calls.map((c) => c[2].title)).toEqual(['Test']);
    expect(out.reply.text).toContain('Skipped “thiết kế api” — #43 already covers it.');
    expect(out.reply.text).toContain('@ghost');
  });

  it('is not mixed with other changes in one request', async () => {
    const result = await aiCommandService.run(
      ctx42('chia #42 và #42 xong'),
      plan({ action: 'create_subtasks', taskRef: 42 }, { action: 'update_task', taskRef: 42, changes: { status: 'done' } }),
      editor,
    );
    expect(result).toEqual({ kind: 'refused', reason: 'mixed_create' });
  });

  it('web: a created reply with the subtasks as chips and undo', async () => {
    const c = ctx42('chia #42 thành subtask: API, UI', { channel: 'web' });
    const result = await aiCommandService.run(
      c,
      plan({ action: 'create_subtasks', taskRef: 42, items: [{ title: 'API' }, { title: 'UI' }] }),
      editor,
    );
    if (result.kind !== 'sections') throw new Error('expected sections');
    const web = renderWeb(c, result);
    expect(web.kind).toBe('created');
    expect(web.text.split('\n')[0]).toBe('🧩 #42 Checkout v2 · 2 subtasks added');
    expect(web.tasks).toHaveLength(2);
    expect(web.batchId).toMatch(/^[0-9a-f]{16}$/);
    expect(web.suggestions).toContain('Giao #43 cho tôi');
    // No Telegram undo data for the web.
    expect(callbackDataStorageService.setCallbackData).not.toHaveBeenCalled();
  });
});

describe('update_task parent', () => {
  it('makes #45 a subtask of #42 through the mutation service', async () => {
    const t45 = task({ taskNumber: 45, title: 'API' });
    (taskMutationService.updateTask as jest.Mock).mockResolvedValue({
      task: { ...t45, parentTaskId: parent._id, epicId: login._id },
      changes: [
        { field: 'parent', from: null, to: '#42 Checkout v2' },
        { field: 'epic', from: null, to: 'Login', toIcon: '🔵' },
      ],
    });
    const out = await telegram(
      context({ request: 'cho #45 làm subtask của #42', referencedTasks: [t45, parent], referencedNumbers: [45, 42] }),
      plan({ action: 'update_task', taskRef: 45, changes: { parent: 42 } }),
    );
    expect(taskMutationService.updateTask).toHaveBeenCalledWith(t45, me, { parentTaskId: String(parent._id) }, { activity: 'ai' });
    expect(out.reply.text).toContain('↳ Subtask of #42 Checkout v2');
    expect(out.reply.text).toContain('Epic → 🔵 Login (same as its parent)');
  });

  it('turns the rule message into a note', async () => {
    const t45 = task({ taskNumber: 45, title: 'API' });
    (taskMutationService.updateTask as jest.Mock).mockRejectedValue(
      new TaskMutationError('invalid_parent', '#45 has 2 subtasks of its own, so it can\'t become a subtask. Move or detach them first.'),
    );
    const out = await telegram(
      context({ request: 'cho #45 vào #42', referencedTasks: [t45, parent], referencedNumbers: [45, 42] }),
      plan({ action: 'update_task', taskRef: 45, changes: { parent: 42 } }),
    );
    expect(out.reply.text).toContain('ℹ️ <b>#45</b>');
    expect(out.reply.text).toContain('⚠️ #45 has 2 subtasks of its own');
  });

  it('a parent number the user did not write is never used', async () => {
    const t45 = task({ taskNumber: 45, title: 'API' });
    const out = await telegram(
      context({ request: 'cho #45 làm subtask', referencedTasks: [t45], referencedNumbers: [45] }),
      plan({ action: 'update_task', taskRef: 45, changes: { parent: 42 } }),
    );
    expect(taskMutationService.updateTask).not.toHaveBeenCalled();
    expect(out.reply.text).toContain("There's no task #42 to put it under.");
  });

  it("a subtask's epic is left alone with a pointer to the parent", async () => {
    const sub = task({ taskNumber: 45, title: 'API', parentTaskId: { _id: parent._id, taskNumber: 42, title: 'Checkout v2' } });
    const out = await telegram(
      context({ request: 'thêm #45 vào epic Login', referencedTasks: [sub], referencedNumbers: [45] }),
      plan({ action: 'update_task', taskRef: 45, changes: { epic: 'Login' } }),
    );
    expect(taskService.updateTask).not.toHaveBeenCalled();
    expect(out.reply.text).toContain("is a subtask, so it stays in its parent's epic. Change the epic on #42 instead.");
  });

  it("a parent's subtasks follow it into the new epic", async () => {
    const plain = task({ taskNumber: 42, title: 'Checkout v2' });
    (taskService.updateTask as jest.Mock).mockResolvedValue({ ...plain, epicId: login });
    (subtaskService.setEpic as jest.Mock).mockResolvedValueOnce(2);
    (subtaskService.list as jest.Mock).mockResolvedValue([task({ taskNumber: 43 }), task({ taskNumber: 44 })]);
    await telegram(
      context({ request: 'thêm #42 vào epic Login', referencedTasks: [plain], referencedNumbers: [42] }),
      plan({ action: 'update_task', taskRef: 42, changes: { epic: 'Login' } }),
    );
    expect(String((subtaskService.setEpic as jest.Mock).mock.calls[0][1])).toBe(String(login._id));
  });
});

describe('explain with subtasks', () => {
  it('tells the explainer the parent and what is left', async () => {
    (taskActivityServiceMock().getForTask as jest.Mock).mockResolvedValue([]);
    (subtaskService.list as jest.Mock).mockResolvedValue([
      task({ taskNumber: 43, title: 'API', status: 'done' }),
      task({ taskNumber: 44, title: 'UI', status: 'todo' }),
    ]);
    (aiService.generateJson as jest.Mock).mockResolvedValueOnce({ text: '🎯 Checkout mới' });
    const out = await telegram(ctx42('giải thích #42'), plan({ action: 'explain_task', taskRef: 42 }));
    const [request] = (aiService.generateJson as jest.Mock).mock.calls[0];
    expect(request.system).toBe(EXPLAIN_TASK_SYSTEM_PROMPT);
    expect(request.user).toContain('Subtasks: 1/2 done; still open: "UI"');
    expect(out.reply.text).toContain('🧩 Subtasks: 1/2 done');
  });
});

function taskActivityServiceMock() {
  return jest.requireMock('src/database/services/task-activity.service').taskActivityService;
}
