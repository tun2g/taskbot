import mongoose from 'mongoose';
import { AiRequestContext } from 'src/shared/services/ai-command.service';
import { aiPlanSchema } from 'src/shared/services/ai-command/plan.schema';
import { buildAiCommandPrompt } from 'src/shared/services/ai-command/prompt';
import { AiResult, UpdateOutcome } from 'src/shared/services/ai-command/result';
import { renderTelegram } from 'src/shared/services/ai-command/telegram.renderer';
import { detectLang, renderWeb, renderWebCreated } from 'src/shared/services/ai-command/web.renderer';
import { TaskSyncService } from 'src/shared/services/task-sync.service';

jest.mock('src/bot', () => ({
  bot: { telegram: { sendMessage: jest.fn().mockResolvedValue({ message_id: 321 }), editMessageText: jest.fn() } },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/services/ai/ai.service', () => ({
  aiService: { isConfigured: jest.fn(), generateJson: jest.fn() },
  AIUnavailableError: class extends Error {},
  parseJsonLoose: jest.fn(),
}));
jest.mock('src/database/models/task.model', () => ({ Task: { findById: jest.fn(), findByIdAndUpdate: jest.fn() } }));
jest.mock('src/shared/utils/app-links', () => ({
  appLinkButton: jest.fn((text: string) => ({ text, url: 'https://t.me/bot?startapp=g' })),
}));
jest.mock('src/bot/task-card.renderer', () => ({
  ...jest.requireActual('src/bot/task-card.renderer'),
  formatTaskCard: jest.fn(() => 'CARD'),
  buildTaskButtons: jest.fn().mockResolvedValue([[{ text: '▶ Start', callback_data: 'x' }]]),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const oid = () => new mongoose.Types.ObjectId();
const me = { _id: oid(), telegramUserId: 1, username: 'me' } as any;
const an = { _id: oid(), telegramUserId: 2, username: 'an' } as any;
const group = { _id: oid(), telegramGroupId: -100123, timezone: 'UTC' } as any;
const task = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: oid(),
    groupId: group._id,
    taskNumber: 12,
    title: 'Fix <login> & logout',
    status: 'todo',
    type: 'bug',
    assigneeId: null,
    ...overrides,
  }) as any;

function context(overrides: Partial<AiRequestContext> = {}): AiRequestContext {
  return {
    request: 'what is open?',
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
    channel: 'web',
    ...overrides,
  };
}

const update = (overrides: Partial<UpdateOutcome> = {}): UpdateOutcome => ({
  original: task(),
  task: task({ assigneeId: an }),
  changes: ['👤 Unassigned → @an', '✏️ Renamed (was “A & B”)'],
  notes: ['⚠️ Couldn\'t find <ghost> in this group — they need to send a message in the group first.'],
  fieldChanges: [],
  failed: false,
  ...overrides,
});

/** No HTML produced by the renderer: no tags, no entities. User text is kept verbatim. */
function expectNoMarkup(text: string, userText: string[] = []) {
  let stripped = text;
  for (const t of userText) stripped = stripped.split(t).join('');
  expect(stripped).not.toMatch(/[<>]/);
  expect(text).not.toMatch(/&(amp|lt|gt|quot);/);
  expect(text).not.toMatch(/<\/?b>|\*\*/);
}

describe('web renderer (plain text)', () => {
  const results: AiResult[] = [
    { kind: 'clarify', question: 'Task nào?' },
    { kind: 'which_task', miss: { reason: 'which' } },
    { kind: 'which_task', miss: { reason: 'missing', number: 9 } },
    { kind: 'which_task', miss: { reason: 'no_match', search: 'a & b' } },
    { kind: 'which_task', miss: { reason: 'ambiguous', candidates: [task(), task({ taskNumber: 13 })] } },
    { kind: 'which_task', miss: { reason: 'previous_ambiguous', numbers: [1, 2] } },
    { kind: 'refused', reason: 'delete' },
    { kind: 'refused', reason: 'bulk' },
    { kind: 'refused', reason: 'mixed_create' },
    { kind: 'sections', sections: [{ type: 'update', update: update() }] },
    { kind: 'sections', sections: [{ type: 'update', update: update({ failed: true }) }] },
    {
      kind: 'sections',
      sections: [
        {
          type: 'query',
          query: {
            kind: 'list',
            queryKind: 'open',
            mine: false,
            title: 'Open tasks matching “a & b”',
            icon: '🔎',
            tasks: [task()],
            showStatus: true,
            showAssignee: true,
            emptyText: 'No matches.',
          },
        },
        { type: 'query', query: { kind: 'unknown_person', person: '@ghost' } },
        { type: 'answer', text: 'Mình có thể giúp & tạo task' },
      ],
    },
  ];

  it.each(results.map((r, i) => [i, r]))('result %i has no HTML', (_i, result) => {
    const data = renderWeb(context(), result as any);
    expectNoMarkup(data.text, ['<login>', '<ghost>']);
    for (const line of data.text.split('\n')) expect(line.length).toBeLessThanOrEqual(110);
    for (const s of data.suggestions ?? []) expectNoMarkup(s);
  });

  it('Telegram still escapes the same results', () => {
    const outcome = renderTelegram(context({ channel: undefined }), {
      kind: 'sections',
      sections: [{ type: 'update', update: update() }],
    });
    expect(outcome.kind === 'reply' && outcome.reply.text).toBe(
      '✅ <b>#12 Fix &lt;login&gt; &amp; logout</b>\n👤 Unassigned → @an\n✏️ Renamed (was “A &amp; B”)\n' +
        '⚠️ Couldn\'t find &lt;ghost&gt; in this group — they need to send a message in the group first.',
    );
  });

  it('spells out a single listed task so a follow-up can refer to it', () => {
    const data = renderWeb(context(), {
      kind: 'sections',
      sections: [
        {
          type: 'query',
          query: {
            kind: 'list',
            queryKind: 'mine',
            mine: true,
            title: 'Your open tasks',
            icon: '📋',
            tasks: [task({ title: 'Fix login', assigneeId: me })],
            showStatus: true,
            showAssignee: false,
            emptyText: 'Nothing here. 🎉',
          },
        },
      ],
    });
    expect(data.kind).toBe('query');
    expect(data.text).toBe('📋 Your open tasks · 1\n#12 🐞 Fix login');
    expect(data.suggestions).toEqual(['Mark #12 done', "What's overdue?", 'What is still open?']);
  });

  it('created: one task, Vietnamese suggestions, undo window', () => {
    const until = new Date('2026-10-19T10:10:00Z');
    const data = renderWebCreated(
      context({ request: 'tạo task fix login' }),
      [{ task: task({ taskNumber: 14, title: 'Fix login' }), assignee: null }],
      [],
      'abcdef0123456789',
      until,
    );
    expect(data).toEqual({
      kind: 'created',
      text: '✅ Created #14 Fix login',
      tasks: [expect.objectContaining({ taskNumber: 14 })],
      batchId: 'abcdef0123456789',
      undoUntil: '2026-10-19T10:10:00.000Z',
      suggestions: ['Đặt hạn cho #14', 'Giao #14 cho tôi', 'Tôi còn task nào?'],
    });
  });

  it('detects Vietnamese from diacritics', () => {
    expect(detectLang('tôi còn task nào?')).toBe('vi');
    expect(detectLang('what is open?')).toBe('en');
  });
});

describe('history in the planner prompt', () => {
  it('adds the conversation and the single task of the previous answer', () => {
    const text = buildAiCommandPrompt({
      request: 'giao nó cho @an',
      requester: { username: 'me' },
      members: [],
      timezone: 'UTC',
      today: '2026-10-19',
      history: [
        { role: 'user', content: 'tôi còn task nào?' },
        { role: 'assistant', content: '📋 Your open tasks · 1\n#12 🐞 Fix login' },
      ],
      previousTask: { taskNumber: 12, title: 'Fix login', status: 'todo' },
      previousNumbers: [12],
      channel: 'web',
    });
    expect(text).toContain('Conversation so far (oldest first):\nUser: tôi còn task nào?\nAssistant: 📋 Your open tasks · 1 #12 🐞 Fix login');
    expect(text).toContain('Task in the previous answer: #12 "Fix login"');
  });

  it('marks "it" as ambiguous after several tasks, and omits history for Telegram', () => {
    const base = { request: 'x', requester: {}, members: [], timezone: 'UTC', today: '2026-10-19' };
    expect(
      buildAiCommandPrompt({ ...base, history: [{ role: 'assistant', content: '#1 #2' }], previousNumbers: [1, 2] }),
    ).toContain('several tasks (#1, #2)');
    expect(buildAiCommandPrompt(base)).not.toContain('Conversation');
  });

  it('accepts taskRef "previous"', () => {
    const plan = aiPlanSchema.parse({ actions: [{ action: 'update_task', taskRef: 'Previous', changes: { status: 'done' } }] });
    expect(plan.actions[0]).toMatchObject({ taskRef: 'previous' });
  });
});

describe('group posts for app-created tasks', () => {
  const { bot } = jest.requireMock('src/bot');
  const { Task } = jest.requireMock('src/database/models/task.model');

  beforeEach(() => jest.clearAllMocks());

  it('1 task: posts its card marked (via app) and stores the card message id', async () => {
    const t = task();
    const post = await new TaskSyncService().postCreatedFromApp(group, me, [{ task: t, assignee: null }]);
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      -100123,
      'CARD\n\n_(via app)_',
      expect.objectContaining({ parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[expect.any(Object)]] } }),
    );
    expect(Task.findByIdAndUpdate).toHaveBeenCalledWith(t._id, {
      $set: { taskCardMessageId: 321, taskCardChatId: -100123 },
    });
    expect(post).toEqual({ chatId: -100123, messageId: 321 });
  });

  it('2+ tasks: one summary (via app) without an Undo button', async () => {
    await new TaskSyncService().postCreatedFromApp(group, me, [
      { task: task({ taskNumber: 14, title: 'A & B' }), assignee: an },
      { task: task({ taskNumber: 15, title: 'C' }), assignee: null },
    ]);
    const [, text, extra] = bot.telegram.sendMessage.mock.calls[0];
    expect(text).toBe('<b>🤖 @me created 2 tasks (via app)</b>\n\n#14 🐞 A &amp; B → @an\n#15 🐞 C');
    const buttons = extra.reply_markup.inline_keyboard.flat();
    expect(buttons).toEqual([expect.objectContaining({ text: '📱 Open board' })]);
    expect(JSON.stringify(extra)).not.toContain('batch:undo');
  });

  it('marks the post as undone', async () => {
    await new TaskSyncService().markBatchUndone({ chatId: -100123, messageId: 321 }, '@me', 2);
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(
      -100123,
      321,
      undefined,
      '↩️ Undone by @me (via app) · 2 tasks removed',
    );
  });
});
