import mongoose from 'mongoose';
import { bot } from 'src/bot';
import { Group } from 'src/database/models/group.model';
import { User } from 'src/database/models/user.model';
import { dmTaskKeyboard, notificationService } from 'src/shared/services/notification.service';
import { taskButton } from 'src/shared/utils/app-links';

jest.mock('src/bot', () => ({ bot: { telegram: { sendMessage: jest.fn() } } }));
jest.mock('src/database/models/group.model', () => ({ Group: { findById: jest.fn() } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({
  redisService: { get: jest.fn().mockResolvedValue(null), set: jest.fn() },
}));
jest.mock('src/shared/utils/app-links', () => ({
  ...jest.requireActual('src/shared/utils/app-links'),
  taskButton: jest.fn(),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const taskId = new mongoose.Types.ObjectId();
const bob = { _id: new mongoose.Types.ObjectId(), telegramUserId: 1, username: 'bob' } as any;
const an = { _id: new mongoose.Types.ObjectId(), telegramUserId: 2, username: 'an_dev' } as any;
const openButton = { text: '📱 Open #12', url: 'https://t.me/tbot?startapp=g_t' };

function task(overrides: Record<string, unknown> = {}) {
  return {
    _id: taskId,
    groupId: new mongoose.Types.ObjectId(),
    taskNumber: 12,
    title: 'Fix login',
    type: 'bug',
    status: 'todo',
    priority: 'medium',
    createdBy: bob,
    assigneeId: an,
    ...overrides,
  } as any;
}

function sent() {
  const [chat, text, extra] = (bot.telegram.sendMessage as jest.Mock).mock.calls[0];
  return { chat, text: text as string, rows: extra.reply_markup?.inline_keyboard as any[][] | undefined };
}

describe('notification DMs', () => {
  beforeEach(() => {
    (Group.findById as jest.Mock).mockResolvedValue({ groupName: 'Team_A', timezone: 'UTC' });
    (taskButton as jest.Mock).mockReturnValue(openButton);
  });

  describe('dmTaskKeyboard', () => {
    it('offers the next status step next to the open button', () => {
      expect(dmTaskKeyboard(task())).toEqual([
        [{ text: '▶ Start', callback_data: `tdm:in_progress:${taskId}` }, openButton],
      ]);
      expect(dmTaskKeyboard(task({ status: 'in_review' }))[0][0]).toEqual({
        text: '✅ Done',
        callback_data: `tdm:done:${taskId}`,
      });
    });

    it('shows a state button for a closed task, and fits the 64-byte limit', () => {
      const [row] = dmTaskKeyboard(task({ status: 'done' }));
      expect(row[0]).toEqual({ text: '✅ Marked done', callback_data: `tdm:noop:${taskId}` });
      expect(Buffer.byteLength(`tdm:in_progress:${taskId}`)).toBeLessThanOrEqual(64);
    });

    it('works without any open button', () => {
      (taskButton as jest.Mock).mockReturnValue(null);
      expect(dmTaskKeyboard(task())).toEqual([[{ text: '▶ Start', callback_data: `tdm:in_progress:${taskId}` }]]);
    });
  });

  it('assignment DM has the quick action and the open button', async () => {
    await notificationService.notifyAssignment(task(), an, bob);
    const { chat, text, rows } = sent();
    expect(chat).toBe(2);
    expect(text).toContain('*You were assigned #12*');
    expect(text).toContain('By @bob in Team\\_A');
    expect(rows).toEqual([[{ text: '▶ Start', callback_data: `tdm:in_progress:${taskId}` }, openButton]]);
  });

  it('status DM uses the shared status word (pending, not "on hold") and the open button only', async () => {
    await notificationService.notifyStatusChange(task({ status: 'pending' }), bob, an);
    const { text, rows } = sent();
    expect(text.split('\n')[0]).toBe('⏸ *#12 is now pending*');
    expect(rows).toEqual([[openButton]]);
  });

  it('falls back to "View card" (whatever taskButton gives) and sends no keyboard when there is none', async () => {
    (taskButton as jest.Mock).mockReturnValue(null);
    await notificationService.notifyUnassigned(task(), an, bob);
    expect(sent().rows).toBeUndefined();
  });

  it('assignee reminder: "By @creator in Group" line and the quick action', async () => {
    (User.findById as jest.Mock).mockResolvedValue(bob);
    await notificationService.notifyDueReminder(task({ createdBy: bob._id }), an, 'assignee');
    const { text, rows } = sent();
    expect(text).not.toContain('Group:');
    expect(text).toContain('By @bob in Team\\_A');
    expect(text).toContain("You're the assignee.");
    expect(rows?.[0][0]).toEqual({ text: '▶ Start', callback_data: `tdm:in_progress:${taskId}` });
  });

  it('assignee reminder without a known creator just names the group', async () => {
    await notificationService.notifyDueReminder(task({ createdBy: null }), an, 'assignee');
    expect(sent().text).toContain('\nIn Team\\_A\n');
  });

  it('creator reminder for an unassigned task offers an Assign button', async () => {
    await notificationService.notifyDueReminder(task({ assigneeId: null }), bob, 'creator');
    const { text, rows } = sent();
    expect(text).toContain('You created it in Team\\_A and nobody is assigned yet. Tap “👤 Assign #12” to pick someone.');
    expect(rows).toEqual([[{ text: '👤 Assign #12', url: openButton.url }]]);
  });

  it('creator reminder without an app link uses the card jump link', async () => {
    (taskButton as jest.Mock).mockReturnValue({ text: '💬 View card', url: 'https://t.me/c/100/77' });
    await notificationService.notifyDueReminder(task({ assigneeId: null }), bob, 'creator');
    expect(sent().rows).toEqual([[{ text: '👤 Assign on card', url: 'https://t.me/c/100/77' }]]);
  });

  it('creator reminder with no link at all points to the card', async () => {
    (taskButton as jest.Mock).mockReturnValue(null);
    await notificationService.notifyDueReminder(task({ assigneeId: null }), bob, 'creator');
    const { text, rows } = sent();
    expect(text).toContain('Use 👤 Assign on its card in the group.');
    expect(rows).toBeUndefined();
  });
});
