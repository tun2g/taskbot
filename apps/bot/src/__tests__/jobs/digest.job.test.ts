import { bot } from 'src/bot';
import { Group } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import { taskService } from 'src/database/services/task.service';
import { DIGEST_HOUR, processDigestJob } from 'src/jobs/digest.job';

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
jest.mock('src/shared/utils/app-links', () => ({ appLinkButton: jest.fn(() => null) }));
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
});
