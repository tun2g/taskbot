import mongoose from 'mongoose';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { AiRequestContext, aiCommandService, DELETE_REFUSAL_MESSAGE, extractTaskNumbers, WHICH_TASK_MESSAGE } from 'src/shared/services/ai-command.service';
import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import {
  CLARIFY_HINT,
  NOT_UNDERSTOOD_MESSAGE,
  renderTelegram,
  telegramMissText,
} from 'src/shared/services/ai-command/telegram.renderer';
import { notificationService } from 'src/shared/services/notification.service';
import { aiService } from 'src/shared/services/ai/ai.service';
import { EXPLAIN_TASK_SYSTEM_PROMPT } from 'src/shared/services/ai-command/explain.prompt';

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
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/services/ai/ai.service', () => ({
  aiService: { isConfigured: jest.fn(), generateJson: jest.fn() },
  AIUnavailableError: class extends Error {},
}));
jest.mock('src/database/services/task.service', () => ({
  taskService: {
    getTaskById: jest.fn(),
    getTaskByNumber: jest.fn(),
    getTasksByGroup: jest.fn(),
    updateTask: jest.fn(),
    assignTask: jest.fn(),
    updateTaskStatus: jest.fn(),
  },
}));
jest.mock('src/database/services/task-activity.service', () => ({
  taskActivityService: { record: jest.fn(), getForTask: jest.fn() },
}));
jest.mock('src/shared/services/notification.service', () => ({
  notificationService: {
    notifyAssignment: jest.fn(),
    notifyUnassigned: jest.fn(),
    notifyStatusChange: jest.fn(),
  },
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
    taskNumberHtml: (n: number) => `<a href="${url}"><b>#${n}</b></a>`,
    taskNumberMarkdown: (n: number) => `[#${n}](${url})`,
  };
});
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
/** #N as the mocked app link renders it. */
const num = (n: number) => `<a href="https://t.me/bot?startapp=g"><b>#${n}</b></a>`;
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
    const text = telegramMissText((ambiguous as any).miss, group._id);
    expect(text).toContain('Which task?');
    expect(text).toContain(`${num(3)} 🐞 Fix login`);
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
    expect(replyText(outcome)).toBe(`✅ ${num(12)} <b>Fix login on iOS</b>\n👤 @an → @ttt`);
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
    expect(replyText(outcome)).toBe(`✅ ${num(12)} <b>Fix login on iOS</b>\n⬆️ High priority\n👀 In review`);
  });

  it('replaces the description and logs it', async () => {
    const t = task({ description: 'Vấn đề: lỗi login' });
    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ _id: t._id, description: 'Vấn đề: lỗi login\n\nGhi chú:\n• test Android' }));

    const outcome = await aiCommandService.execute(
      context({ referencedNumbers: [12], referencedTasks: [t] }),
      plan({ action: 'update_task', taskRef: 12, changes: { description: 'Vấn đề: lỗi login\n\nGhi chú:\n• test Android' } }),
      editor,
    );

    expect(taskService.updateTask).toHaveBeenCalledWith(t._id, {
      description: 'Vấn đề: lỗi login\n\nGhi chú:\n• test Android',
    });
    expect(taskActivityService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'description', via: 'ai' }));
    expect(replyText(outcome)).toContain('📝 Description updated');
  });

  it('clears the description with null and ignores no-op rewrites', async () => {
    const t = task({ description: 'old' });
    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ _id: t._id, description: null }));
    const cleared = await aiCommandService.execute(
      context({ referencedNumbers: [12], referencedTasks: [t] }),
      plan({ action: 'update_task', taskRef: 12, changes: { description: null } }),
      editor,
    );
    expect(replyText(cleared)).toContain('📝 Description cleared');

    jest.clearAllMocks();
    const same = await aiCommandService.execute(
      context({ referencedNumbers: [12], referencedTasks: [t] }),
      plan({ action: 'update_task', taskRef: 12, changes: { description: '  old ' } }),
      editor,
    );
    expect(taskService.updateTask).not.toHaveBeenCalled();
    expect(replyText(same)).not.toContain('Description');
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
    expect(replyText(outcome)).toBe(`🤔 Task nào &lt;vậy&gt;?\n\n<i>${CLARIFY_HINT}</i>`);
    expect(replyText(outcome)).toContain('/ai');
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
    expect(lines[1]).toBe(`${num(12)} 🐞 Fix login on iOS · 🔄 In progress · due today`);
    const visible = lines[2].replace(/<[^>]+>/g, '');
    expect(visible).toMatch(/^#30 📌 x+… · 📝 To do$/);
    expect(visible.length).toBeLessThan(90);
    expect(lines[lines.length - 1]).toBe('…and 2 more');
    expect(text).not.toContain('#9<');
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
    expect(text).toContain(`${num(1)} 🐞 Fix login on iOS · 🔄 In progress · ⚠️ overdue since Sat, Oct 10 · @an`);
    expect(text).not.toContain('#2<');
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

describe('telegram renderer', () => {
  const buttonsOf = (outcome: ReturnType<typeof renderTelegram>) => (outcome.kind === 'reply' ? outcome.reply.buttons : undefined);
  const outcomeOf = (t: ReturnType<typeof task>, overrides: Record<string, unknown> = {}) => ({
    original: t,
    task: t,
    changes: ['✅ Done'],
    notes: [],
    fieldChanges: [],
    failed: false,
    ...overrides,
  });

  it('shows usage examples instead of "Which task?" when nothing was understood', () => {
    const outcome = renderTelegram(context(), { kind: 'sections', sections: [] });
    expect(replyText(outcome)).toBe(NOT_UNDERSTOOD_MESSAGE);
    expect(NOT_UNDERSTOOD_MESSAGE).toContain('/ai');
    expect(NOT_UNDERSTOOD_MESSAGE).not.toContain('Which task');
  });

  it('attaches the board to a missing #N or a search with no match, not to "which"', () => {
    const board = [[expect.objectContaining({ text: '📋 Open board' })]];
    expect(buttonsOf(renderTelegram(context(), { kind: 'which_task', miss: { reason: 'missing', number: 99 } }))).toEqual(board);
    expect(buttonsOf(renderTelegram(context(), { kind: 'which_task', miss: { reason: 'no_match', search: 'x' } }))).toEqual(board);
    expect(buttonsOf(renderTelegram(context(), { kind: 'which_task', miss: { reason: 'which' } }))).toBeUndefined();
  });

  it('opens the one updated task with "📱 Open #N"', () => {
    const t = task();
    const outcome = renderTelegram(context(), { kind: 'sections', sections: [{ type: 'update', update: outcomeOf(t) as any }] });
    expect(buttonsOf(outcome)).toEqual([[expect.objectContaining({ text: '📱 Open #12' })]]);
  });

  it('a failed update links to the task whose card buttons it suggests', () => {
    const t = task();
    const outcome = renderTelegram(context(), {
      kind: 'sections',
      sections: [{ type: 'update', update: outcomeOf(t, { failed: true }) as any }],
    });
    expect(replyText(outcome)).toContain(`❌ ${num(12)} couldn't be fully updated`);
    expect(buttonsOf(outcome)).toEqual([[expect.objectContaining({ text: '📱 Open #12' })]]);
    expect(outcome.kind === 'reply' && outcome.updates).toBeFalsy();
  });

  it('tells the user to answer a question with /ai', () => {
    expect(CLARIFY_HINT).toContain('/ai');
  });
});

describe('explain_task', () => {
  const { AIUnavailableError } = jest.requireMock('src/shared/services/ai/ai.service');
  const generateJson = aiService.generateJson as jest.Mock;

  const explained = (overrides: Record<string, unknown> = {}) =>
    task({
      taskNumber: 5,
      title: 'Fix login timeout',
      description: null,
      priority: 'high',
      createdBy: me,
      createdAt: new Date('2026-10-10T08:00:00Z'),
      dueDate: new Date('2026-10-16T00:00:00Z'),
      sourceMessages: [
        { messageId: 1, chatId: -100, text: 'Login bị timeout sau 30s trên iOS', fromUserId: 3, fromName: 'Tú', link: '' },
        { messageId: 2, chatId: -100, text: '@an xem giúp nhé', fromUserId: 3, fromName: 'Tú', link: '' },
      ],
      ...overrides,
    });

  beforeEach(() => {
    (taskActivityService.getForTask as jest.Mock).mockResolvedValue([
      { action: 'status', from: '📝 To do', to: '🔄 In progress', actor: an, createdAt: new Date('2026-10-12T09:00:00Z') },
    ]);
    generateJson.mockResolvedValue({
      text: '🎯 Sửa lỗi login bị timeout sau 30s trên iOS (Tú báo).\n🏁 Có lẽ xong khi login iOS không còn timeout.\n💬 Chưa có mô tả — hỏi @Tú',
    });
  });

  it('writes the explanation with a second AI call from the full task and renders it', async () => {
    const t = explained();
    const outcome = await aiCommandService.execute(
      context({ request: 'giải thích #5', referencedNumbers: [5], referencedTasks: [t] }),
      plan({ action: 'explain_task', taskRef: 5 }),
      editor,
    );

    expect(generateJson).toHaveBeenCalledTimes(1);
    const [request] = generateJson.mock.calls[0];
    expect(request.system).toBe(EXPLAIN_TASK_SYSTEM_PROMPT);
    expect(request.user).toContain('Request: giải thích #5');
    expect(request.user).toContain('answer in Vietnamese');
    expect(request.user).toContain('Task #5: "Fix login timeout"');
    expect(request.user).toContain('Priority: High');
    expect(request.user).toContain('Assignee: @an');
    expect(request.user).toContain('Created by: @me on 2026-10-10');
    expect(request.user).toContain('Due date: 2026-10-16');
    expect(request.user).toContain('Asked by: me');
    // Source author → creator → assignee, never the requester (@me created it).
    expect(request.user).toContain('Who could answer (best first): Tú, an');
    expect(request.user).toContain('- Tú: Login bị timeout sau 30s trên iOS');
    expect(request.user).toContain('- 2026-10-12 @an: status 📝 To do → 🔄 In progress');

    expect(replyText(outcome)).toBe(
      [
        `💡 ${num(5)} <b>Fix login timeout</b>`,
        '🎯 Sửa lỗi login bị timeout sau 30s trên iOS (Tú báo).',
        '🏁 Có lẽ xong khi login iOS không còn timeout.',
        '💬 Chưa có mô tả — hỏi Tú',
        '',
        '🐞 Bug · 🔄 In progress · ⬆️ High',
        '👤 @an · ⚠️ overdue since Fri, Oct 16',
      ].join('\n'),
    );
    expect(outcome.kind === 'reply' && outcome.reply.buttons).toEqual([[expect.objectContaining({ text: '📱 Open #5' })]]);
    expect(outcome.kind === 'reply' && outcome.updates).toBeFalsy();
    // Read-only.
    expect(taskService.updateTask).not.toHaveBeenCalled();
    expect(taskService.updateTaskStatus).not.toHaveBeenCalled();
    expect(taskActivityService.record).not.toHaveBeenCalled();
  });

  it('uses the legacy single sourceMessage and the replied card', async () => {
    const t = explained({
      sourceMessages: [],
      sourceMessage: { messageId: 1, chatId: -100, text: 'cần đổi màu nút <Login>', fromUserId: 3, fromName: 'Tú', link: '' },
    });
    await aiCommandService.execute(
      context({ request: 'task này làm gì', replyTask: t }),
      plan({ action: 'explain_task', taskRef: 'reply' }),
      editor,
    );
    expect(generateJson.mock.calls[0][0].user).toContain('- Tú: cần đổi màu nút <Login>');
  });

  it('the replied card is on screen: no state lines and no Open button', async () => {
    const t = explained();
    const outcome = await aiCommandService.execute(
      context({ request: 'task này làm gì', replyTask: t }),
      plan({ action: 'explain_task', taskRef: 'reply' }),
      editor,
    );
    const text = replyText(outcome);
    expect(text.startsWith(`💡 ${num(5)} <b>Fix login timeout</b>\n🎯`)).toBe(true);
    expect(text).not.toContain('👤');
    expect(outcome.kind === 'reply' && outcome.reply.buttons).toBeUndefined();
  });

  it('explains the tasks it found and notes the missing one instead of aborting', async () => {
    const t = explained();
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);
    const outcome = await aiCommandService.execute(
      context({ request: 'giải thích #5 và #55', referencedNumbers: [5, 55], referencedTasks: [t] }),
      plan({ action: 'explain_task', taskRef: 5 }, { action: 'explain_task', taskRef: 55 }),
      editor,
    );
    const text = replyText(outcome);
    expect(text).toContain(`💡 ${num(5)}`);
    expect(text.endsWith('\n\n❌ No task #55.')).toBe(true);
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it('escapes the AI text for Telegram', async () => {
    generateJson.mockResolvedValue({ text: '🎯 Fix <script> & co' });
    const t = explained();
    const text = replyText(
      await aiCommandService.execute(
        context({ referencedNumbers: [5], referencedTasks: [t] }),
        plan({ action: 'explain_task', taskRef: 5 }),
        editor,
      ),
    );
    expect(text).toContain('🎯 Fix &lt;script&gt; &amp; co');
  });

  it('reports an unknown task number without calling the AI again', async () => {
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);
    const outcome = await aiCommandService.execute(
      context({ request: 'giải thích #99', referencedNumbers: [99] }),
      plan({ action: 'explain_task', taskRef: 99 }),
      editor,
    );
    expect(replyText(outcome)).toBe("❌ There's no task #99 in this group. Check the number with /list.");
    expect(outcome.kind === 'reply' && outcome.reply.buttons).toEqual([[expect.objectContaining({ text: '📋 Open board' })]]);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('asks which task when "this task" is used without a replied card', async () => {
    const outcome = await aiCommandService.execute(context(), plan({ action: 'explain_task', taskRef: 'reply' }), editor);
    expect(replyText(outcome)).toBe(WHICH_TASK_MESSAGE);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('falls back to the task details when the AI is unavailable', async () => {
    generateJson.mockRejectedValue(new AIUnavailableError('failed', 'down'));
    const t = explained({ description: 'Repro: <iPhone 12>, iOS 17' });
    const text = replyText(
      await aiCommandService.execute(
        context({ referencedNumbers: [5], referencedTasks: [t] }),
        plan({ action: 'explain_task', taskRef: 5 }),
        editor,
      ),
    );
    expect(text).toContain('<i>🤖 AI can’t explain it right now — here’s what the task says:</i>');
    expect(text).toContain('📝 Repro: &lt;iPhone 12&gt;, iOS 17');
    expect(text).toContain('👤 @an · ⚠️ overdue since Fri, Oct 16');
  });

  it('does not count toward the mutation cap', async () => {
    const tasks = Array.from({ length: 5 }, (_, i) => task({ taskNumber: i + 1, status: 'done' }));
    const actions = [
      ...tasks.map((t) => ({ action: 'update_task', taskRef: t.taskNumber, changes: { status: 'done' } })),
      { action: 'explain_task', taskRef: 1 },
    ];
    const outcome = await aiCommandService.execute(
      context({ referencedNumbers: [1, 2, 3, 4, 5], referencedTasks: tasks }),
      plan(...actions),
      editor,
    );
    expect(replyText(outcome)).not.toContain('at most 5 tasks');
    expect(replyText(outcome)).toContain(`💡 ${num(1)}`);
  });

  it('explains after applying a change in the same request, and drops a duplicate "answer"', async () => {
    const t = explained({ assigneeId: null });
    const assigned = explained({ _id: t._id, assigneeId: ttt });
    (taskService.assignTask as jest.Mock).mockResolvedValue(assigned);
    const outcome = await aiCommandService.execute(
      context({ request: 'tóm tắt #5 rồi giao cho @ttt', referencedNumbers: [5], referencedTasks: [t] }),
      plan(
        { action: 'update_task', taskRef: 5, changes: { assignee: '@ttt' } },
        { action: 'explain_task', taskRef: 5 },
        { action: 'answer', text: 'Task #5 là sửa lỗi login' },
      ),
      editor,
    );
    const text = replyText(outcome);
    expect(text.indexOf('✅')).toBeLessThan(text.indexOf('💡'));
    expect(text).toContain('👤 @ttt · ⚠️ overdue since Fri, Oct 16');
    expect(text).not.toContain('🤖 Task #5');
    // One "Open" button for the one task on screen.
    expect(outcome.kind === 'reply' && outcome.reply.buttons).toEqual([[expect.objectContaining({ text: '📱 Open #5' })]]);
    expect(outcome.kind === 'reply' && outcome.updates).toHaveLength(1);
  });

  it('explains at most 3 tasks, one Open button each in one row', async () => {
    const tasks = Array.from({ length: 4 }, (_, i) => explained({ _id: oid(), taskNumber: i + 1 }));
    const outcome = await aiCommandService.execute(
      context({ referencedNumbers: [1, 2, 3, 4], referencedTasks: tasks }),
      plan(...tasks.map((t) => ({ action: 'explain_task', taskRef: t.taskNumber }))),
      editor,
    );
    expect(generateJson).toHaveBeenCalledTimes(3);
    expect(replyText(outcome).endsWith('ℹ️ Explained 3 of 4 — ask about #4 separately.')).toBe(true);
    const buttons = outcome.kind === 'reply' ? outcome.reply.buttons : undefined;
    expect(buttons).toHaveLength(1);
    expect(buttons![0].map((b) => b.text)).toEqual(['📱 Open #1', '📱 Open #2', '📱 Open #3']);
  });

  describe('without the planner', () => {
    it('AI down: "giải thích #5" answers from the task, quoting the source message when there is no description', () => {
      const t = explained();
      const reply = aiCommandService.explainWithoutAi(
        context({ request: 'giải thích #5', referencedNumbers: [5], referencedTasks: [t] }),
      );
      expect(reply!.text).toBe(
        [
          `💡 ${num(5)} <b>Fix login timeout</b>`,
          '<i>🤖 AI can’t explain it right now — here’s what the task says:</i>',
          '💬 Tú: “Login bị timeout sau 30s trên iOS”',
          '',
          '🐞 Bug · 🔄 In progress · ⬆️ High',
          '👤 @an · ⚠️ overdue since Fri, Oct 16',
        ].join('\n'),
      );
      expect(reply!.buttons).toEqual([[{ text: '📱 Open #5', url: 'https://t.me/bot?startapp=g' }]]);
    });

    it('AI down: cuts a long source quote to ~100 characters', () => {
      const long = `Login ${'rất '.repeat(60)}chậm`;
      const t = explained({ sourceMessages: [{ text: long, fromName: 'Tú' }] });
      const reply = aiCommandService.explainWithoutAi(
        context({ request: 'what is #5', referencedNumbers: [5], referencedTasks: [t] }),
      );
      const quote = reply!.text.split('\n')[2];
      expect(quote.startsWith('💬 Tú: “Login rất')).toBe(true);
      expect(quote.endsWith('…”')).toBe(true);
      expect(quote.length).toBeLessThanOrEqual(110);
    });

    it('AI down: a question on the card itself ("task này làm gì?") answers without repeating the card', () => {
      const t = explained({ description: 'Tăng timeout lên 60s' });
      const reply = aiCommandService.explainWithoutAi(context({ request: 'task này làm gì?', replyTask: t }));
      expect(reply!.text).toContain('📝 Tăng timeout lên 60s');
      expect(reply!.text).not.toContain('👤');
      expect(reply!.buttons).toBeUndefined();
    });

    it('AI down: nothing to say for other requests, several numbers or an unknown number', () => {
      const t = explained();
      expect(aiCommandService.explainWithoutAi(context({ request: '#5 xong rồi', referencedNumbers: [5], referencedTasks: [t] }))).toBeNull();
      expect(
        aiCommandService.explainWithoutAi(
          context({ request: 'giải thích #5 và #6', referencedNumbers: [5, 6], referencedTasks: [t] }),
        ),
      ).toBeNull();
      expect(aiCommandService.explainWithoutAi(context({ request: 'giải thích #9', referencedNumbers: [9] }))).toBeNull();
    });

    it('explainTaskById: one AI call, no planner; in a DM with state and Open button', async () => {
      const t = explained();
      (taskService.getTaskById as jest.Mock).mockResolvedValue(t);
      const reply = await aiCommandService.explainTaskById(t._id.toString(), me, group);
      expect(generateJson).toHaveBeenCalledTimes(1);
      expect(generateJson.mock.calls[0][0].system).toBe(EXPLAIN_TASK_SYSTEM_PROMPT);
      expect(reply!.text).toContain(`💡 ${num(5)} <b>Fix login timeout</b>\n🎯 Sửa lỗi login`);
      expect(reply!.text).toContain('👤 @an · ⚠️ overdue since Fri, Oct 16');
      expect(reply!.buttons).toEqual([[{ text: '📱 Open #5', url: 'https://t.me/bot?startapp=g' }]]);
    });

    it('explainTaskById: under the card, no state lines and no Open button', async () => {
      const t = explained();
      (taskService.getTaskById as jest.Mock).mockResolvedValue(t);
      const reply = await aiCommandService.explainTaskById(t._id.toString(), me, group, { onCard: true });
      expect(reply!.text).not.toContain('👤');
      expect(reply!.buttons).toBeUndefined();
    });

    it('explainTaskById: null for a task of another group', async () => {
      (taskService.getTaskById as jest.Mock).mockResolvedValue(explained({ groupId: oid() }));
      expect(await aiCommandService.explainTaskById('x', me, group)).toBeNull();
      expect(generateJson).not.toHaveBeenCalled();
    });
  });

  it('refuses explain mixed with create like any other mixed request', async () => {
    const outcome = await aiCommandService.execute(
      context({ referencedNumbers: [5] }),
      plan({ action: 'create_tasks', useReply: false }, { action: 'explain_task', taskRef: 5 }),
      editor,
    );
    expect(replyText(outcome)).toContain('One thing at a time');
  });
});
