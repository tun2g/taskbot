import mongoose from 'mongoose';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { AiRequestContext, aiCommandService, DELETE_REFUSAL_MESSAGE, extractTaskNumbers, WHICH_TASK_MESSAGE } from 'src/shared/services/ai-command.service';
import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import { telegramMissText } from 'src/shared/services/ai-command/telegram.renderer';
import { notificationService } from 'src/shared/services/notification.service';

jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
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
  },
}));
jest.mock('src/database/services/task-activity.service', () => ({ taskActivityService: { record: jest.fn() } }));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: {
    notifyAssignment: jest.fn(),
    notifyUnassigned: jest.fn(),
    notifyStatusChange: jest.fn(),
  },
}));
jest.mock('src/shared/utils/app-links', () => ({
  appLinkButton: jest.fn((text: string) => ({ text, url: 'https://t.me/bot?startapp=g' })),
}));
jest.mock('src/bot/task-card.renderer', () => ({
  ...jest.requireActual('src/bot/task-card.renderer'),
  formatTaskCard: jest.fn(() => 'card'),
  buildTaskButtons: jest.fn().mockResolvedValue([[{ text: 'x', callback_data: 'y' }]]),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1, username: 'me', firstName: 'Me' } as any;
const an = { _id: oid(), telegramUserId: 2, username: 'an', firstName: 'An' } as any;
const ttt = { _id: oid(), telegramUserId: 3, username: 'ttt', firstName: 'Tú' } as any;
const group = { _id: oid(), timezone: 'UTC' } as any;

const task = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: oid(),
    groupId: group._id,
    taskNumber: 12,
    title: 'Fix login on iOS',
    status: 'in_progress',
    type: 'bug',
    priority: 'medium',
    assigneeId: an,
    taskCardChatId: -100,
    taskCardMessageId: 55,
    ...overrides,
  }) as any;

function context(overrides: Partial<AiRequestContext> = {}): AiRequestContext {
  return {
    request: '',
    requester: me,
    group,
    members: [me, an, ttt],
    replyTask: null,
    replyMessage: null,
    referencedTasks: [],
    referencedNumbers: [],
    mentions: [],
    timezone: 'UTC',
    today: '2026-10-19',
    ...overrides,
  };
}

const plan = (...actions: unknown[]) => aiPlanSchema.parse({ actions });
const editor = { editMessageText: jest.fn().mockResolvedValue(true) };

function replyText(outcome: Awaited<ReturnType<typeof aiCommandService.execute>>): string {
  if (outcome.kind !== 'reply') throw new Error('expected a reply');
  return outcome.reply.text;
}

beforeEach(() => {
  jest.clearAllMocks();
  editor.editMessageText.mockResolvedValue(true);
});

describe('extractTaskNumbers', () => {
  it('finds #N and "task N"', () => {
    expect(extractTaskNumbers('đổi #12 và task 7, không phải 2024')).toEqual([12, 7]);
  });
});

describe('target resolution', () => {
  it('uses the replied task card', async () => {
    const t = task();
    expect(await aiCommandService.resolveTarget(context({ replyTask: t }), 'reply')).toEqual({ task: t });
  });

  it('asks which task when "reply" is used without a replied card', async () => {
    expect(await aiCommandService.resolveTarget(context(), 'reply')).toEqual({ miss: { reason: 'which' } });
  });

  it('accepts a #N the user wrote', async () => {
    const t = task();
    const result = await aiCommandService.resolveTarget(context({ referencedNumbers: [12], referencedTasks: [t] }), 12);
    expect(result).toEqual({ task: t });
  });

  it('refuses a task number the user never wrote (no guessing)', async () => {
    const result = await aiCommandService.resolveTarget(context(), 12);
    expect(result).toEqual({ miss: { reason: 'which' } });
    expect(taskService.getTaskByNumber).not.toHaveBeenCalled();
  });

  it('reports a missing #N', async () => {
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);
    const result = await aiCommandService.resolveTarget(context({ referencedNumbers: [99] }), 99);
    expect(result).toEqual({ miss: { reason: 'missing', number: 99 } });
    expect(telegramMissText({ reason: 'missing', number: 99 })).toContain('no task #99');
  });

  it('uses a single search match and clarifies when ambiguous', async () => {
    const a = task({ taskNumber: 3, title: 'Fix login' });
    const b = task({ taskNumber: 4, title: 'Login page copy' });
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValueOnce({ tasks: [a], total: 1 });
    expect(await aiCommandService.resolveTarget(context(), { search: 'login' })).toEqual({ task: a });

    (taskService.getTasksByGroup as jest.Mock).mockResolvedValueOnce({ tasks: [a, b], total: 2 });
    const ambiguous = await aiCommandService.resolveTarget(context(), { search: 'login' });
    expect(ambiguous).toEqual({ miss: { reason: 'ambiguous', candidates: [a, b] } });
    const text = telegramMissText((ambiguous as any).miss);
    expect(text).toContain('Which task?');
    expect(text).toContain('#3');
  });

  it('never mutates when any target is unclear', async () => {
    const outcome = await aiCommandService.execute(
      context(),
      plan({ action: 'update_task', taskRef: 'reply', changes: { status: 'done' } }),
      editor,
    );
    expect(replyText(outcome)).toBe(WHICH_TASK_MESSAGE);
    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });
});

describe('updates', () => {
  it('changes the assignee, records activity, notifies both people and refreshes the card', async () => {
    const t = task();
    const updated = task({ _id: t._id, assigneeId: ttt });
    (taskService.assignTask as jest.Mock).mockResolvedValue(updated);

    const outcome = await aiCommandService.execute(
      context({ replyTask: t }),
      plan({ action: 'update_task', taskRef: 'reply', changes: { assignee: '@ttt' } }),
      editor,
    );

    expect(taskService.assignTask).toHaveBeenCalledWith(t._id, ttt._id);
    expect(replyText(outcome)).toBe('✅ <b>#12 Fix login on iOS</b>\n👤 @an → @ttt');
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'assignee', from: '@an', to: '@ttt', via: 'ai', actor: me._id }),
    );
    expect(notificationService.notifyAssignment).toHaveBeenCalledWith(updated, ttt, me);
    expect(notificationService.notifyUnassigned).toHaveBeenCalledWith(updated, an, me);
    expect(editor.editMessageText).toHaveBeenCalledWith(-100, 55, undefined, 'card', expect.objectContaining({ parse_mode: 'Markdown' }));
  });

  it('does not change the assignee for an unknown person', async () => {
    const t = task();
    const outcome = await aiCommandService.execute(
      context({ replyTask: t }),
      plan({ action: 'update_task', taskRef: 'reply', changes: { assignee: '@ghost' } }),
      editor,
    );
    expect(taskService.assignTask).not.toHaveBeenCalled();
    expect(replyText(outcome)).toContain("Couldn't find @ghost in this group — they need to send a message here first.");
    expect(notificationService.notifyAssignment).not.toHaveBeenCalled();
  });

  it('changes status with changedBy, logs labels and notifies the assignee', async () => {
    const t = task();
    const updated = task({ _id: t._id, status: 'in_review', priority: 'high' });
    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ _id: t._id, priority: 'high' }));
    (taskService.updateTaskStatus as jest.Mock).mockResolvedValue(updated);

    const outcome = await aiCommandService.execute(
      context({ referencedNumbers: [12], referencedTasks: [t] }),
      plan({ action: 'update_task', taskRef: 12, changes: { status: 'in_review', priority: 'high' } }),
      editor,
    );

    expect(taskService.updateTask).toHaveBeenCalledWith(t._id, { priority: 'high' });
    expect(taskService.updateTaskStatus).toHaveBeenCalledWith(t._id, 'in_review', me._id);
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'status', from: '🔄 In progress', to: '👀 In review', via: 'ai' }),
    );
    expect(notificationService.notifyStatusChange).toHaveBeenCalledWith(updated, me, an);
    expect(replyText(outcome)).toBe('✅ <b>#12 Fix login on iOS</b>\n⬆️ High priority\n👀 In review');
  });

  it('says so when nothing needs changing', async () => {
    const t = task({ status: 'done' });
    const outcome = await aiCommandService.execute(
      context({ referencedNumbers: [12], referencedTasks: [t] }),
      plan({ action: 'update_task', taskRef: 12, changes: { status: 'done' } }),
      editor,
    );
    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
    expect(replyText(outcome)).toContain('ℹ️ Already ✅ Done.');
  });
});

describe('refusals', () => {
  it('refuses to delete', async () => {
    const outcome = await aiCommandService.execute(context(), plan({ action: 'delete_task', taskRef: 5 }), editor);
    expect(replyText(outcome)).toBe(DELETE_REFUSAL_MESSAGE);
  });

  it('refuses more than 5 mutations and links the board', async () => {
    const actions = Array.from({ length: 6 }, (_, i) => ({
      action: 'update_task',
      taskRef: i + 1,
      changes: { status: 'done' },
    }));
    const outcome = await aiCommandService.execute(context(), plan(...actions), editor);
    expect(outcome.kind === 'reply' && outcome.reply.text).toContain('at most 5 tasks');
    expect(outcome.kind === 'reply' && outcome.reply.buttons).toEqual([[expect.objectContaining({ text: '📋 Open board' })]]);
    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('refuses bulk requests', async () => {
    const outcome = await aiCommandService.execute(context(), plan({ action: 'bulk' }), editor);
    expect(replyText(outcome)).toContain('bulk changes');
  });

  it('shows a clarify question without changing anything', async () => {
    const outcome = await aiCommandService.execute(
      context(),
      plan({ action: 'clarify', question: 'Task nào <vậy>?' }, { action: 'update_task', taskRef: 1, changes: { status: 'done' } }),
      editor,
    );
    expect(replyText(outcome)).toBe('🤔 Task nào &lt;vậy&gt;?');
    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('hands create_tasks to the creation pipeline', async () => {
    const outcome = await aiCommandService.execute(context(), plan({ action: 'create_tasks', useReply: true }), editor);
    expect(outcome).toEqual({ kind: 'create', useReply: true });
  });
});

describe('queries', () => {
  it('formats "my open tasks" with header, lines and overflow', async () => {
    const tasks = [
      task({ taskNumber: 12, dueDate: new Date('2026-10-19T00:00:00Z'), assigneeId: me }),
      task({ taskNumber: 9, status: 'done', assigneeId: me }),
      ...Array.from({ length: 11 }, (_, i) =>
        task({ taskNumber: 20 + i, title: 'x'.repeat(80), status: 'todo', type: 'task', assigneeId: me }),
      ),
    ];
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks, total: tasks.length });

    const outcome = await aiCommandService.execute(context(), plan({ action: 'query', kind: 'mine' }), editor);
    const text = replyText(outcome);
    const lines = text.split('\n');

    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(group._id, expect.objectContaining({ assigneeId: me._id }));
    expect(lines[0]).toBe('<b>📋 Your open tasks · 12</b>');
    expect(lines[1]).toBe('#12 🐞 Fix login on iOS · 🔄 In progress · due today');
    expect(lines[2]).toMatch(/^#30 📌 x+… · 📝 To do$/);
    expect(lines[2].length).toBeLessThan(90);
    expect(lines[lines.length - 1]).toBe('…and 2 more');
    expect(text).not.toContain('#9 ');
    expect(outcome.kind === 'reply' && outcome.reply.buttons).toBeDefined();
  });

  it('lists overdue tasks only', async () => {
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({
      tasks: [
        task({ taskNumber: 1, dueDate: new Date('2026-10-10T00:00:00Z') }),
        task({ taskNumber: 2, dueDate: new Date('2026-10-19T00:00:00Z') }),
      ],
      total: 2,
    });
    const text = replyText(await aiCommandService.execute(context(), plan({ action: 'query', kind: 'overdue' }), editor));
    expect(text).toContain('<b>⚠️ Overdue tasks · 1</b>');
    expect(text).toContain('#1 🐞 Fix login on iOS · 🔄 In progress · ⚠️ overdue (Sat, Oct 10) · @an');
    expect(text).not.toContain('#2 ');
  });

  it('reports an unknown person instead of listing everything', async () => {
    const text = replyText(
      await aiCommandService.execute(context(), plan({ action: 'query', kind: 'person', person: '@ghost' }), editor),
    );
    expect(text).toContain("Couldn't find @ghost in this group");
    expect(taskService.getTasksByGroup).not.toHaveBeenCalled();
  });

  it('shows a friendly empty state', async () => {
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [], total: 0 });
    const text = replyText(await aiCommandService.execute(context(), plan({ action: 'query', kind: 'mine' }), editor));
    expect(text).toBe('<b>📋 Your open tasks · 0</b>\nNothing here. 🎉');
  });
});
