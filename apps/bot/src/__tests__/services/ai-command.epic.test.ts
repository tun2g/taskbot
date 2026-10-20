import mongoose from 'mongoose';
import { EpicTitleTakenError, epicService } from 'src/database/services/epic.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import { AiRequestContext, aiCommandService, buildEpicMiss, toPromptTask } from 'src/shared/services/ai-command.service';
import { buildExplainPrompt } from 'src/shared/services/ai-command/explain.prompt';
import { epicProgressLine, taskStateLines } from 'src/shared/services/ai-command/format';
import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import { AI_COMMAND_SYSTEM_PROMPT, buildAiCommandPrompt } from 'src/shared/services/ai-command/prompt';
import { renderWeb } from 'src/shared/services/ai-command/web.renderer';
import { EPIC_COLOR_EMOJI, EpicColor } from '@tbot/shared';

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
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

/** Expected text written with the blue/green/… dots, mapped to the current EPIC_COLOR_EMOJI palette. */
const DOTS: Record<string, string> = { '🔵': 'blue', '🟢': 'green', '🟠': 'orange', '🔴': 'red', '⚪': 'gray' };
const e = (text: string) => text.replace(/🔵|🟢|🟠|🔴|⚪/gu, (d) => EPIC_COLOR_EMOJI[DOTS[d] as EpicColor]);

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1, username: 'me', firstName: 'Me' } as any;
const group = { _id: oid(), timezone: 'UTC' } as any;
const epicDoc = (title: string, color = 'blue', extra: Record<string, unknown> = {}) =>
  ({ _id: oid(), groupId: group._id, title, color, status: 'open', ...extra }) as any;
const login = epicDoc('Login', 'blue');
const payments = epicDoc('Payments', 'green');

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
    request: 'thêm #5 vào epic Login',
    requester: me,
    group,
    members: [me],
    replyTask: null,
    replyMessage: null,
    referencedTasks: [],
    referencedNumbers: [],
    mentions: [],
    timezone: 'UTC',
    today: '2026-10-19',
    openEpics: [
      { _id: String(login._id), title: 'Login', color: 'blue' },
      { _id: String(payments._id), title: 'Payments', color: 'green' },
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

beforeEach(() => {
  jest.clearAllMocks();
  (epicService.findByTitle as jest.Mock).mockImplementation(async (_g: unknown, title: string) =>
    [login, payments].find((e) => e.title.toLowerCase() === title.trim().toLowerCase()) ?? null,
  );
  (epicService.listOpen as jest.Mock).mockResolvedValue([login, payments]);
});

describe('plan schema', () => {
  it('parses epic changes, newEpic, create_epic and epic queries', () => {
    const p = plan(
      { action: 'update_task', taskRef: 5, changes: { epic: 'Login' } },
      { action: 'update_task', taskRef: 6, changes: { epic: null } },
      { action: 'update_task', taskRef: 7, changes: { epic: 'Payments' }, newEpic: true },
      { action: 'create_epic', title: ' Login ' },
      { action: 'query', kind: 'epic', epic: 'Login' },
      { action: 'query', kind: 'epics' },
    );
    expect(p.actions[0]).toMatchObject({ changes: { epic: 'Login' } });
    expect(p.actions[1]).toMatchObject({ changes: { epic: null } });
    expect(p.actions[2]).toMatchObject({ newEpic: true });
    expect(p.actions[3]).toEqual({ action: 'create_epic', title: 'Login' });
    expect(p.actions[5]).toMatchObject({ kind: 'epics' });
  });
});

describe('update_task changes.epic', () => {
  it('puts the task in an existing epic: one update, activity, group change line, card refresh', async () => {
    const t = task();
    const updated = task({ _id: t._id, epicId: login });
    (taskService.updateTask as jest.Mock).mockResolvedValue(updated);
    const c = context({ referencedNumbers: [5], referencedTasks: [t] });

    const outcome = await telegram(c, plan({ action: 'update_task', taskRef: 5, changes: { epic: 'login' } }));

    expect(taskService.updateTask).toHaveBeenCalledWith(t._id, { epicId: login._id });
    expect(taskActivityService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'epic', from: null, to: 'Login', via: 'ai' }),
    );
    expect(outcome.updates?.[0].fieldChanges).toEqual([
      { field: 'epic', from: null, to: 'Login', fromIcon: null, toIcon: e('🔵') },
    ]);
    expect(editor.editMessageText).toHaveBeenCalled();
    expect(outcome.reply.text).toBe(e('✅ <b>#5</b> <b>Fix login on iOS</b>\nEpic → 🔵 Login'));
    expect(epicService.create).not.toHaveBeenCalled();
  });

  it('unknown epic: changes nothing, lists open epics and the exact create command', async () => {
    const t = task();
    const c = context({ request: 'thêm #5 vào epic Logn', referencedNumbers: [5], referencedTasks: [t] });

    const outcome = await telegram(c, plan({ action: 'update_task', taskRef: 5, changes: { epic: 'Logn' } }));

    expect(taskService.updateTask).not.toHaveBeenCalled();
    expect(epicService.create).not.toHaveBeenCalled();
    expect(taskActivityService.record).not.toHaveBeenCalled();
    expect(outcome.updates).toBeUndefined();
    expect(outcome.reply.text).toBe(
      [
        'ℹ️ <b>#5</b> <b>Fix login on iOS</b>',
        '⚠️ There\'s no epic “Logn” yet.',
        e('Open epics: 🔵 Login · 🟢 Payments'),
        '➕ Create it: <code>/ai tạo epic Logn</code>',
      ].join('\n'),
    );
  });

  it('creates the epic only when the user explicitly asked for a new one', async () => {
    const t = task();
    const created = epicDoc('Onboarding', 'orange');
    (epicService.create as jest.Mock).mockResolvedValue(created);
    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ _id: t._id, epicId: created }));
    const c = context({ referencedNumbers: [5], referencedTasks: [t] });

    const outcome = await telegram(
      c,
      plan({ action: 'update_task', taskRef: 5, changes: { epic: 'Onboarding' }, newEpic: true }),
    );

    expect(epicService.create).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: group._id, createdBy: me._id, title: 'Onboarding' }),
    );
    expect(taskService.updateTask).toHaveBeenCalledWith(t._id, { epicId: created._id });
    expect(outcome.reply.text).toContain(e('Epic → 🟠 Onboarding (new)'));    // The caller announces it in the group.
    expect(c.createdEpics).toEqual([created]);
  });

  it('moves between epics and removes from an epic', async () => {
    const t = task({ epicId: payments });
    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ _id: t._id, epicId: login }));
    const c = context({ referencedNumbers: [5], referencedTasks: [t] });
    let outcome = await telegram(c, plan({ action: 'update_task', taskRef: 5, changes: { epic: 'Login' } }));
    expect(outcome.reply.text).toContain(e('Epic: 🟢 Payments → 🔵 Login'));

    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ _id: t._id, epicId: null }));
    outcome = await telegram(c, plan({ action: 'update_task', taskRef: 5, changes: { epic: null } }));
    expect(taskService.updateTask).toHaveBeenLastCalledWith(t._id, { epicId: null });
    expect(outcome.reply.text).toContain(e('Epic removed (was 🟢 Payments)'));
    expect(taskActivityService.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'epic', from: 'Payments', to: null }),
    );
  });

  it('says so when the task is already in that epic', async () => {
    const t = task({ epicId: login });
    const c = context({ referencedNumbers: [5], referencedTasks: [t] });
    const outcome = await telegram(c, plan({ action: 'update_task', taskRef: 5, changes: { epic: 'Login' } }));
    expect(taskService.updateTask).not.toHaveBeenCalled();
    expect(outcome.reply.text).toContain(e('ℹ️ Already in epic 🔵 Login.'));
  });

  it('suggests the closest epics first and caps the list at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ _id: String(i), title: `Epic ${i}`, color: 'gray' }));
    const miss = buildEpicMiss('login', [...many, { _id: 'x', title: 'Login page', color: 'blue' }]);
    expect(miss.suggestions[0].title).toBe('Login page');
    expect(miss.suggestions).toHaveLength(8);
    expect(miss.more).toBe(5);
  });
});

describe('create_epic', () => {
  it('creates it with an auto color and links to the board', async () => {
    (epicService.create as jest.Mock).mockResolvedValue(epicDoc('Onboarding', 'orange'));
    const outcome = await telegram(context({ request: 'tạo epic Onboarding' }), plan({ action: 'create_epic', title: 'Onboarding' }));
    expect(epicService.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Onboarding', description: null, groupId: group._id }),
    );
    expect(outcome.reply.text).toBe(
      e('✅ Epic <b>🟠 Onboarding</b> created\n➕ Add tasks: <code>/ai thêm #N vào epic Onboarding</code>'),
    );
    expect(outcome.reply.buttons).toEqual([[{ text: '📋 Open board', url: 'https://t.me/bot?startapp=g' }]]);
  });

  it('a duplicate title is a friendly note, not an error', async () => {
    const c = context();
    const outcome = await telegram(c, plan({ action: 'create_epic', title: 'login' }));
    expect(epicService.create).not.toHaveBeenCalled();
    expect(c.createdEpics ?? []).toEqual([]);
    expect(outcome.reply.text).toContain(e('ℹ️ Epic <b>🔵 Login</b> already exists.'));
  });

  it('handles a create race (title taken meanwhile)', async () => {
    (epicService.findByTitle as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(login);
    (epicService.create as jest.Mock).mockRejectedValue(new EpicTitleTakenError('Login'));
    const outcome = await telegram(context(), plan({ action: 'create_epic', title: 'Login' }));
    expect(outcome.reply.text).toContain('already exists');
  });

  it('creates the epic before the update in the same request', async () => {
    const t = task();
    const created = epicDoc('Onboarding', 'orange');
    (epicService.create as jest.Mock).mockImplementation(async () => {
      (epicService.findByTitle as jest.Mock).mockResolvedValue(created);
      return created;
    });
    (epicService.findByTitle as jest.Mock).mockResolvedValueOnce(null);
    (taskService.updateTask as jest.Mock).mockResolvedValue(task({ _id: t._id, epicId: created }));
    const c = context({ referencedNumbers: [5], referencedTasks: [t] });
    const outcome = await telegram(
      c,
      plan(
        { action: 'update_task', taskRef: 5, changes: { epic: 'Onboarding' } },
        { action: 'create_epic', title: 'Onboarding' },
      ),
    );
    expect(outcome.reply.text.split('\n\n')[0]).toContain('created');
    expect(outcome.reply.text).toContain(e('Epic → 🟠 Onboarding'));
    expect(outcome.reply.buttons?.[0]).toHaveLength(2);
  });
});

describe('epic queries', () => {
  it('filters a list by epic', async () => {
    const t = task({ epicId: login });
    (taskService.getTasksByGroup as jest.Mock).mockResolvedValue({ tasks: [t] });
    const outcome = await telegram(context(), plan({ action: 'query', kind: 'epic', epic: 'Login' }));
    expect(taskService.getTasksByGroup).toHaveBeenCalledWith(group._id, expect.objectContaining({ epicId: login._id }));
    expect(outcome.reply.text.split('\n')[0]).toBe(e('<b>📋 Open tasks in 🔵 Login · 1</b>'));
  });

  it('unknown epic in a query lists the open epics', async () => {
    const outcome = await telegram(context(), plan({ action: 'query', kind: 'epic', epic: 'Search' }));
    expect(taskService.getTasksByGroup).not.toHaveBeenCalled();
    expect(outcome.reply.text).toContain('⚠️ There\'s no epic “Search” yet.');
    expect(outcome.reply.text).toContain('<code>/ai tạo epic Search</code>');
  });

  it('epics overview: open first, "3/7 done", at most 10', async () => {
    const rows = [
      { ...epicDoc('Old', 'red', { status: 'done' }), progress: { total: 5, done: 5, inProgress: 0 } },
      { ...login, progress: { total: 7, done: 3, inProgress: 2 } },
      { ...payments, progress: { total: 0, done: 0, inProgress: 0 } },
      ...Array.from({ length: 9 }, (_, i) => ({ ...epicDoc(`E${i}`), progress: { total: 1, done: 0, inProgress: 0 } })),
    ];
    (epicService.listWithProgress as jest.Mock).mockResolvedValue(rows);
    const outcome = await telegram(context({ request: 'tiến độ các epic' }), plan({ action: 'query', kind: 'epics' }));
    const lines = outcome.reply.text.split('\n');
    expect(lines[0]).toBe('<b>🗂 Epics · 12</b>');
    expect(lines[1]).toBe(e('🔵 Login — 3/7 done'));
    expect(lines[2]).toBe(e('🟢 Payments — no tasks yet'));
    expect(lines).toHaveLength(12);
    expect(lines[11]).toBe('…and 2 more');
    expect(outcome.reply.text).not.toContain('Old');
  });

  it('web: plain epics overview with a follow-up suggestion', async () => {
    (epicService.listWithProgress as jest.Mock).mockResolvedValue([{ ...login, progress: { total: 7, done: 3, inProgress: 2 } }]);
    const c = context({ request: 'tiến độ các epic', channel: 'web' });
    const result = await aiCommandService.run(c, plan({ action: 'query', kind: 'epics' }), editor);
    if (result.kind === 'create') throw new Error('unexpected');
    const response = renderWeb(c, result);
    expect(response.text).toBe(e('🗂 Epics · 1\n🔵 Login — 3/7 done'));
    expect(response.suggestions?.[0]).toBe('Epic Login còn gì?');
  });

  it('web: unknown epic suggests the create message', async () => {
    const t = task();
    const c = context({ channel: 'web', request: 'thêm #5 vào epic Search', referencedNumbers: [5], referencedTasks: [t] });
    const result = await aiCommandService.run(
      c,
      plan({ action: 'update_task', taskRef: 5, changes: { epic: 'Search' } }),
      editor,
    );
    if (result.kind === 'create') throw new Error('unexpected');
    const response = renderWeb(c, result);
    expect(response.text).toContain('➕ Create it: “Tạo epic Search”');
    expect(response.suggestions?.[0]).toBe('Tạo epic Search');
  });
});

describe('epic context in prompts', () => {
  it('lists open epics and each task’s epic for the planner', () => {
    const prompt = buildAiCommandPrompt({
      request: 'thêm #5 vào epic login',
      requester: me,
      members: [me],
      timezone: 'UTC',
      today: '2026-10-19',
      referencedTasks: [toPromptTask(task({ epicId: login }))],
      epics: ['Login', 'Payments'],
    });
    expect(prompt).toContain('Open epics:\n- "Login"\n- "Payments"');
    expect(prompt).toContain('epic "Login"');
    expect(AI_COMMAND_SYSTEM_PROMPT).toContain('"action":"create_epic"');
  });

  it('caps the planner epic list at 30', () => {
    const prompt = buildAiCommandPrompt({
      request: 'x',
      requester: me,
      members: [],
      timezone: 'UTC',
      today: '2026-10-19',
      epics: Array.from({ length: 35 }, (_, i) => `E${i}`),
    });
    expect(prompt).toContain('…and 5 more');
    expect(prompt).not.toContain('"E30"');
  });

  it('explain: the epic is in the prompt and the state lines', () => {
    const lines = taskStateLines(task({ epicId: login }), null, '2026-10-19');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(e('Epic: 🔵 Login'));
    expect(taskStateLines(task(), null, '2026-10-19')).toHaveLength(2);
    const prompt = buildExplainPrompt({
      request: 'giải thích #5',
      lang: 'vi',
      today: '2026-10-19',
      timezone: 'UTC',
      task: {
        taskNumber: 5,
        title: 'Fix login',
        description: null,
        type: 'Bug',
        status: 'To do',
        priority: 'Medium',
        assignee: null,
        creator: null,
        createdAt: null,
        dueDate: null,
        closed: false,
        epic: 'Login',
      },
      askedBy: 'me',
      whoToAsk: [],
      sources: [],
      activity: [],
    });
    expect(prompt).toContain('Epic: "Login"');
  });

  it('progress line marks closed epics', () => {
    expect(epicProgressLine({ title: 'Old', color: 'red', status: 'done', total: 5, done: 5 })).toBe(e('🔴 Old — 5/5 done ✅'));
  });
});
