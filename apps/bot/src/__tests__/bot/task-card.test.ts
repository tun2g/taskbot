import mongoose from 'mongoose';
import {
  buildMoreButtons,
  buildStatusPicker,
  buildTaskButtons,
  buildTypePicker,
  describeDue,
  escapeMarkdown,
  formatTaskCard,
} from 'src/bot/task-card.renderer';
import { configService } from 'src/configs/configuration';
import { buildAppLink } from 'src/shared/utils/app-links';

jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { setCallbackData: jest.fn() },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));

const groupId = new mongoose.Types.ObjectId();
const taskId = new mongoose.Types.ObjectId();

function task(overrides: Record<string, unknown> = {}) {
  return {
    _id: taskId,
    groupId,
    taskNumber: 12,
    title: 'Fix v1.2 - login_page',
    type: 'bug',
    status: 'todo',
    priority: 'high',
    createdBy: { telegramUserId: 1, username: 'bob' },
    assigneeId: null,
    ...overrides,
  } as any;
}

const texts = (rows: { text: string }[][]) => rows.map((r) => r.map((b) => b.text));

describe('task card renderer', () => {
  beforeEach(() => {
    configService.botUsername = 'tbot';
    configService.botHasMainWebApp = true;
  });

  it('escapes only legacy Markdown characters', () => {
    expect(escapeMarkdown('v1.2 - a_b *c* `d` [e]!')).toBe('v1.2 - a\\_b \\*c\\* \\`d\\` \\[e]!');
  });

  it('renders type, status, priority, creator; omits empty assignee', () => {
    const card = formatTaskCard(task());
    expect(card.split('\n')[0]).toBe('🐞 *Bug #12* · Fix v1.2 - login\\_page');
    expect(card).toContain('Status: 📝 To do');
    expect(card).toContain('Priority: ⬆️ High');
    expect(card).toContain('Created by: @bob');
    expect(card).not.toContain('Assignee');
    expect(card).not.toContain('Unknown');
  });

  it('shows the first source message with sender and link', () => {
    const card = formatTaskCard(
      task({
        sourceMessages: [{ text: 'login crashes on iOS', fromName: 'An', link: 'https://t.me/c/1/2' }],
      }),
    );
    expect(card).toContain('💬 [From An](https://t.me/c/1/2): “login crashes on iOS”');
  });

  it('due date: today, overdue, and closed tasks', () => {
    const now = new Date();
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    expect(describeDue(task({ dueDate: today }), 'UTC')).toBe('today');
    const past = new Date('2020-01-05T00:00:00Z');
    expect(describeDue(task({ dueDate: past }), 'UTC')).toBe('⚠️ overdue since Jan 5, 2020');
    expect(describeDue(task({ dueDate: past, status: 'cancelled' }), 'UTC')).toBe('Jan 5, 2020');
  });

  it.each([
    ['backlog', '▶ Start'],
    ['todo', '▶ Start'],
    ['in_progress', '👀 Review'],
    ['in_review', '✅ Done'],
    ['pending', '▶ Resume'],
    ['done', '🔄 Reopen'],
    ['cancelled', '🔄 Reopen'],
  ])('primary action for %s is %s', async (status, label) => {
    const rows = await buildTaskButtons(task({ status }));
    expect(texts(rows as any)).toEqual([[label, '👤 Assign', '⋯ More'], ['📱 Open #12']]);
  });

  it('card keyboard opens the task with a url (not web_app) button on its own row', async () => {
    const rows = (await buildTaskButtons(task())) as any[][];
    expect(rows[1]).toEqual([{ text: '📱 Open #12', url: `https://t.me/tbot?startapp=${groupId}_${taskId}` }]);
    expect(rows.flat().some((b) => b.web_app)).toBe(false);
  });

  it('card keyboard has no open row when no app link is configured', async () => {
    configService.botHasMainWebApp = false;
    const saved = configService.webappUrl;
    configService.webappUrl = 'http://localhost:5173';
    const rows = await buildTaskButtons(task());
    configService.webappUrl = saved;
    expect(texts(rows as any)).toEqual([['▶ Start', '👤 Assign', '⋯ More']]);
  });

  it('More keyboard has at most 3 per row', async () => {
    const rows = (await buildMoreButtons(task())) as any[][];
    expect(texts(rows)).toEqual([
      ['🔁 Status', '🏷 Type', '🔼 Priority'],
      ['🗑 Delete', '« Back'],
    ]);
  });

  it('pickers list every option, mark the current one, 2 per row', async () => {
    const types = texts((await buildTypePicker(task())) as any);
    expect(types.flat()).toHaveLength(8); // 7 types + Back
    expect(types.flat()).toContain('✅ Bug');
    expect(types.slice(0, -1).every((r) => r.length <= 2)).toBe(true);
    const statuses = texts((await buildStatusPicker(task({ status: 'in_review' }))) as any).flat();
    expect(statuses).toContain('✅ In review');
    expect(statuses).toContain('🚫 Cancelled');
  });
});

describe('buildAppLink', () => {
  it('uses startapp when a main mini app exists', () => {
    configService.botUsername = 'tbot';
    configService.botHasMainWebApp = true;
    expect(buildAppLink('g', 't')).toBe('https://t.me/tbot?startapp=g_t');
  });

  it('falls back to https WEBAPP_URL, else null', () => {
    configService.botHasMainWebApp = false;
    configService.webappUrl = 'https://app.example.com/';
    expect(buildAppLink('g')).toBe('https://app.example.com/g/tasks');
    configService.webappUrl = 'http://localhost:5173';
    expect(buildAppLink('g', 't')).toBeNull();
  });
});
