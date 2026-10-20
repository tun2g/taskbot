import { bot } from 'src/bot';
import { Group } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { taskService } from 'src/database/services/task.service';
import { buildDigest, DIGEST_HOUR, processDigestJob } from 'src/jobs/digest.job';
import { boardButton } from 'src/shared/utils/app-links';

jest.mock('src/bot', () => ({
  bot: {
    telegram: {
      sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }),
      createForumTopic: jest.fn().mockRejectedValue(new Error('not enough rights')),
    },
  },
}));
jest.mock('src/database/models/group.model', () => ({
  Group: { find: jest.fn(), updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) },
}));
jest.mock('src/database/models/task.model', () => ({
  Task: {
    countDocuments: jest.fn().mockResolvedValue(0),
    find: jest.fn(() => ({ populate: () => ({ sort: () => ({ limit: () => Promise.resolve([]) }) }) })),
  },
}));
jest.mock('src/database/services/task.service', () => ({ taskService: { getTaskStats: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: { set: jest.fn().mockResolvedValue('OK') } }));
jest.mock('src/shared/utils/app-links', () => ({
  boardButton: jest.fn(() => null),
  taskNumberMarkdown: jest.fn((n: number, _g: unknown, t: unknown) => (t ? `[#${n}](https://t.me/tbot?startapp=${t})` : `*#${n}*`)),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

describe('daily digest', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    jest.setSystemTime(new Date(`2026-10-19T${String(DIGEST_HOUR).padStart(2, '0')}:00:00Z`));
  });
  afterAll(() => jest.useRealTimers());

  beforeEach(() => {
    (taskService.getTaskStats as jest.Mock).mockResolvedValue({ todo: 2 });
    (Task.countDocuments as jest.Mock).mockResolvedValue(0);
  });

  const base = { _id: 'g1', telegramGroupId: -100, groupName: 'Team', timezone: 'UTC', knownTopics: [] };

  it('normal group: posted in the chat as before', async () => {
    (Group.find as jest.Mock).mockResolvedValue([{ ...base, isForum: false }]);
    await processDigestJob({} as any);
    const [chat, text, extra] = (bot.telegram.sendMessage as jest.Mock).mock.calls[0];
    expect(chat).toBe(-100);
    expect(text).toContain('Daily summary');
    expect(extra.message_thread_id).toBeUndefined();
    expect(extra.parse_mode).toBe('Markdown');
  });

  it('forum: posted in the "Task events" topic', async () => {
    (Group.find as jest.Mock).mockResolvedValue([{ ...base, isForum: true, eventsTopicId: 500 }]);
    await processDigestJob({} as any);
    expect((bot.telegram.sendMessage as jest.Mock).mock.calls[0][2].message_thread_id).toBe(500);
  });

  it('forum without an events topic: General', async () => {
    (Group.find as jest.Mock).mockResolvedValue([{ ...base, _id: 'g2', isForum: true, eventsTopicId: null }]);
    await processDigestJob({} as any);
    expect((bot.telegram.sendMessage as jest.Mock).mock.calls[0][2].message_thread_id).toBeUndefined();
  });

  describe('overdue lines', () => {
    const overdue = (n: number) => ({
      _id: `t${n}`,
      taskNumber: n,
      title: 'Fix *login*',
      assigneeId: { telegramUserId: 9, username: 'an_dev' },
    });

    beforeEach(() => {
      (Task.countDocuments as jest.Mock).mockImplementation((q: Record<string, unknown>) =>
        Promise.resolve(q.dueDate ? 7 : 0),
      );
      (Task.find as jest.Mock).mockReturnValue({
        populate: () => ({ sort: () => ({ limit: () => Promise.resolve([overdue(3), overdue(4)]) }) }),
      });
    });

    it('task numbers open the task (never inside bold) and "more" points at the board button', async () => {
      (boardButton as jest.Mock).mockReturnValue({ text: '📋 Open board', url: 'https://t.me/tbot?startapp=g1' });
      const digest = await buildDigest({ ...base, isForum: false } as any);
      const lines = digest!.text.split('\n');
      expect(lines).toContain('• [#3](https://t.me/tbot?startapp=t3) Fix \\*login\\* — @an\\_dev');
      expect(lines).toContain('…and 5 more — tap 📋 Open board below');
      expect(digest!.buttons).toEqual([[{ text: '📋 Open board', url: 'https://t.me/tbot?startapp=g1' }]]);
    });

    it('without a board link, "more" suggests /list', async () => {
      (boardButton as jest.Mock).mockReturnValue(null);
      const digest = await buildDigest({ ...base, isForum: false } as any);
      expect(digest!.text).toContain('…and 5 more — see them with /list');
      expect(digest!.buttons).toEqual([]);
    });
  });
});
