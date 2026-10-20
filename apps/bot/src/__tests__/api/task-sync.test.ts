import { bot } from 'src/bot';
import { Task } from 'src/database/models/task.model';
import { User } from 'src/database/models/user.model';
import { groupService } from 'src/database/services/group.service';
import {
  buildChangeLine,
  buildDeleteLine,
  shortTitle,
  TaskSyncService,
} from 'src/shared/services/task-sync.service';

jest.mock('src/bot', () => ({
  bot: {
    telegram: {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 99 }),
      editMessageText: jest.fn().mockResolvedValue(true),
      deleteMessage: jest.fn().mockResolvedValue(true),
    },
  },
}));
jest.mock('src/bot/task-card.renderer', () => ({
  formatTaskCard: jest.fn().mockReturnValue('CARD'),
  groupTimezone: jest.fn(() => 'UTC'),
  buildTaskButtons: jest.fn().mockResolvedValue([]),
}));
jest.mock('src/database/models/task.model', () => ({ Task: { findById: jest.fn(), findByIdAndUpdate: jest.fn() } }));
jest.mock('src/database/models/user.model', () => ({ User: { findById: jest.fn() } }));
jest.mock('src/database/services/group.service');
jest.mock('src/database/models/group.model', () => ({ Group: { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

describe('group lines', () => {
  it('status change', () => {
    expect(
      buildChangeLine('@an', 12, 'Fix login', [{ field: 'status', from: '📝 To do', to: '🔄 In progress' }]),
    ).toBe('📝 @an moved <b>#12</b> Fix login to 🔄 In progress (via app)');
  });

  it('assignment and unassignment', () => {
    expect(buildChangeLine('@an', 12, 'Fix login', [{ field: 'assignee', from: null, to: '@binh' }])).toBe(
      '📝 @an assigned <b>#12</b> Fix login to @binh (via app)',
    );
    expect(buildChangeLine('@an', 12, 'Fix login', [{ field: 'assignee', from: '@binh', to: null }])).toBe(
      '📝 @an unassigned @binh from <b>#12</b> Fix login (via app)',
    );
  });

  it('rename', () => {
    expect(buildChangeLine('@an', 12, 'New name', [{ field: 'title', from: 'Old', to: 'New name' }])).toBe(
      '📝 @an renamed <b>#12</b> to New name (via app)',
    );
  });

  it('combines several announced changes into one line', () => {
    expect(
      buildChangeLine('@an', 12, 'Fix login', [
        { field: 'status', from: '📝 To do', to: '✅ Done' },
        { field: 'assignee', from: null, to: '@binh' },
        { field: 'priority', from: '➡️ Medium', to: '⬆️ High' },
      ]),
    ).toBe('📝 @an updated <b>#12</b> Fix login: moved it to ✅ Done, assigned it to @binh (via app)');
  });

  it('links the task number when a link is given', () => {
    expect(
      buildChangeLine('@an', 12, 'Fix login', [{ field: 'status', from: null, to: '✅ Done' }], '/ai', 'https://t.me/b?startapp=g_t'),
    ).toBe('📝 @an moved <a href="https://t.me/b?startapp=g_t"><b>#12</b></a> Fix login to ✅ Done (via /ai)');
  });

  it('stays silent for priority / type / description / due date only', () => {
    expect(
      buildChangeLine('@an', 12, 'Fix login', [
        { field: 'priority', from: '➡️ Medium', to: '⬆️ High' },
        { field: 'type', from: '📌 Task', to: '🐞 Bug' },
        { field: 'description', from: null, to: 'x' },
        { field: 'due_date', from: null, to: '2026-10-20' },
      ]),
    ).toBeNull();
  });

  it('escapes HTML and shortens long titles', () => {
    const title = '<b>' + 'x'.repeat(100);
    const line = buildDeleteLine('Tom & Jerry', 3, title)!;
    expect(line).toContain('Tom &amp; Jerry');
    expect(line).toContain('&lt;b&gt;');
    expect(line).not.toContain('<b>x');
    expect(Array.from(shortTitle(title)).length).toBe(60);
    expect(shortTitle(title).endsWith('…')).toBe(true);
    expect(line).toMatch(/^🗑 Tom &amp; Jerry deleted <b>#3<\/b> .*… \(via app\)$/);
  });
});

describe('TaskSyncService', () => {
  const service = new TaskSyncService();
  const mockFind = (task: any) =>
    (Task.findById as jest.Mock).mockReturnValue({ populate: jest.fn().mockResolvedValue(task) });

  beforeEach(() => jest.clearAllMocks());

  it('edits the existing card', async () => {
    mockFind({ _id: 't1', taskCardChatId: -1, taskCardMessageId: 5 });
    await service.syncTaskCard({ _id: 't1' } as any);
    expect(bot.telegram.editMessageText).toHaveBeenCalledWith(-1, 5, undefined, 'CARD', expect.anything());
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('posts a new card only for tasks just created from the app', async () => {
    mockFind({ _id: 't1', taskCardChatId: -1, taskCardMessageId: null });
    await service.syncTaskCard({ _id: 't1' } as any, { created: true });
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(-1, 'CARD', expect.anything());
    expect(Task.findByIdAndUpdate).toHaveBeenCalledWith('t1', { $set: { taskCardMessageId: 99 } });
  });

  it('never spawns a card when updating an AI batch task without one', async () => {
    mockFind({ _id: 't1', batchId: 'b1', taskCardChatId: -1, taskCardMessageId: null });
    await service.syncTaskCard({ _id: 't1' } as any);
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
    expect(bot.telegram.editMessageText).not.toHaveBeenCalled();
  });

  it('posts the change line to the group chat (falling back to the group id)', async () => {
    (User.findById as jest.Mock).mockResolvedValue({ username: 'an' });
    (groupService.findGroupById as jest.Mock).mockResolvedValue({ telegramGroupId: -77 });
    await service.postChangeSummary({ _id: 't1', groupId: 'g1', taskNumber: 12, title: 'Fix login' } as any, 'u1', [
      { field: 'status', from: '📝 To do', to: '🔄 In progress' },
    ]);
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      -77,
      '📝 @an moved <b>#12</b> Fix login to 🔄 In progress (via app)',
      { parse_mode: 'HTML' },
    );
  });

  it('adds an "Open #N" button when the app link is available', async () => {
    const links = jest.requireActual('src/shared/utils/app-links');
    const spy = jest.spyOn(links, 'taskButton').mockReturnValue({ text: '📱 Open #12', url: 'https://t.me/b?startapp=g1_t1' });
    (User.findById as jest.Mock).mockResolvedValue({ username: 'an' });
    (groupService.findGroupById as jest.Mock).mockResolvedValue({ telegramGroupId: -77 });
    await service.postChangeSummary({ _id: 't1', groupId: 'g1', taskNumber: 12, title: 'Fix login' } as any, 'u1', [
      { field: 'assignee', from: null, to: '@binh' },
    ]);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ _id: 't1', groupId: 'g1', taskNumber: 12 }));
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(-77, expect.any(String), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '📱 Open #12', url: 'https://t.me/b?startapp=g1_t1' }]] },
    });
    spy.mockRestore();
  });

  it('does not post for silent changes', async () => {
    (User.findById as jest.Mock).mockResolvedValue({ username: 'an' });
    await service.postChangeSummary({ _id: 't1', taskCardChatId: -1, taskNumber: 12, title: 'x' } as any, 'u1', [
      { field: 'priority', from: 'a', to: 'b' },
    ]);
    expect(bot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('on delete removes the card and announces it', async () => {
    (User.findById as jest.Mock).mockResolvedValue({ username: 'an' });
    (bot.telegram.deleteMessage as jest.Mock).mockRejectedValueOnce(new Error('message to delete not found'));
    await service.onTaskDeleted(
      { _id: 't1', taskCardChatId: -1, taskCardMessageId: 5, taskNumber: 12, title: 'Fix login' } as any,
      'u1',
    );
    expect(bot.telegram.deleteMessage).toHaveBeenCalledWith(-1, 5);
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(-1, '🗑 @an deleted <b>#12</b> Fix login (via app)', {
      parse_mode: 'HTML',
    });
  });

  describe('in a forum: app events go to "Task events" (no command topic, so General as the fallback)', () => {
    const forumGroup = (overrides: Record<string, unknown> = {}) =>
      ({ _id: 'g1', telegramGroupId: -1, isForum: true, eventsTopicId: 500, knownTopics: [], ...overrides }) as any;

    it('a new card from the app', async () => {
      mockFind({ _id: 't1', groupId: 'g1', taskCardChatId: -1, taskCardMessageId: null });
      (groupService.findGroupById as jest.Mock).mockResolvedValue(forumGroup());
      await service.syncTaskCard({ _id: 't1' } as any, { created: true });
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(-1, 'CARD', expect.objectContaining({ message_thread_id: 500 }));
      expect(Task.findByIdAndUpdate).toHaveBeenCalledWith('t1', { $set: { taskCardMessageId: 99 } });
    });

    it('change lines', async () => {
      (User.findById as jest.Mock).mockResolvedValue({ username: 'an' });
      (groupService.findGroupById as jest.Mock).mockResolvedValue(forumGroup());
      await service.postChangeSummary({ _id: 't1', groupId: 'g1', taskNumber: 12, title: 'Fix login' } as any, 'u1', [
        { field: 'status', from: '📝 To do', to: '✅ Done' },
      ]);
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(-1, expect.stringContaining('moved <b>#12</b>'), {
        parse_mode: 'HTML',
        message_thread_id: 500,
      });
    });

    it('delete lines', async () => {
      (User.findById as jest.Mock).mockResolvedValue({ username: 'an' });
      (groupService.findGroupById as jest.Mock).mockResolvedValue(forumGroup());
      await service.onTaskDeleted(
        { _id: 't1', groupId: 'g1', taskCardChatId: -1, taskCardMessageId: 5, taskNumber: 12, title: 'Fix login' } as any,
        'u1',
      );
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(-1, expect.stringContaining('deleted'), {
        parse_mode: 'HTML',
        message_thread_id: 500,
      });
    });

    it('web-chat created tasks (card), without any reaction or command topic', async () => {
      const task = { _id: 't9', taskNumber: 3, title: 'X' } as any;
      const post = await service.postCreatedFromApp(forumGroup(), { username: 'me' } as any, [{ task, assignee: null }]);
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        -1,
        expect.stringContaining('(via app)'),
        expect.objectContaining({ parse_mode: 'Markdown', message_thread_id: 500 }),
      );
      expect(post).toEqual({ chatId: -1, messageId: 99 });
    });

    it('no events topic and no rights: General', async () => {
      (bot.telegram as any).createForumTopic = jest.fn().mockRejectedValue(new Error('not enough rights'));
      const task = { _id: 't9', taskNumber: 3, title: 'X' } as any;
      const other = { _id: 't8', taskNumber: 4, title: 'Y' } as any;
      await service.postCreatedFromApp(forumGroup({ _id: 'g2', eventsTopicId: null }), { username: 'me' } as any, [
        { task, assignee: null },
        { task: other, assignee: null },
      ]);
      const extra = (bot.telegram.sendMessage as jest.Mock).mock.calls[0][2];
      expect(extra.message_thread_id).toBeUndefined();
      expect((bot.telegram as any).createForumTopic).toHaveBeenCalled();
    });
  });
});
