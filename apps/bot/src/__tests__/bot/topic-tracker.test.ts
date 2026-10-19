import { topicTrackerMiddleware } from 'src/bot/middlewares/topic-tracker.middleware';
import { groupService } from 'src/database/services/group.service';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { redisService } from 'src/shared/services/redis.service';

const cache = new Map<string, string>();
jest.mock('src/shared/services/redis.service', () => ({
  redisService: {
    get: jest.fn(async (key: string) => cache.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => void cache.set(key, value)),
  },
}));
jest.mock('src/database/services/group.service', () => ({ groupService: { findOrCreateGroup: jest.fn() } }));
jest.mock('src/shared/services/group-messenger.service', () => ({
  groupMessengerService: { trackMessage: jest.fn() },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const group = { _id: 'g1' };
const next = jest.fn().mockResolvedValue(undefined);

function ctx(message: Record<string, unknown>, chat: Record<string, unknown> = {}) {
  return { chat: { id: -100, type: 'supergroup', title: 'Team', is_forum: true, ...chat }, message } as any;
}

describe('topicTrackerMiddleware', () => {
  beforeEach(() => {
    cache.clear();
    (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(group);
  });

  it('records topic names from ordinary topic messages (implicit reply to the topic start)', async () => {
    const message = { message_id: 5, message_thread_id: 9, reply_to_message: { forum_topic_created: { name: 'Task events' } } };
    await topicTrackerMiddleware(ctx(message), next);
    expect(groupMessengerService.trackMessage).toHaveBeenCalledWith(group, message, true);
    expect(next).toHaveBeenCalled();
  });

  it('records names from forum_topic_created and forum_topic_edited', async () => {
    const created = { message_id: 1, message_thread_id: 3, forum_topic_created: { name: 'Bugs' } };
    await topicTrackerMiddleware(ctx(created), next);
    const edited = { message_id: 2, message_thread_id: 3, forum_topic_edited: { name: '📋 Task events' } };
    await topicTrackerMiddleware(ctx(edited), next);
    expect(groupMessengerService.trackMessage).toHaveBeenNthCalledWith(1, group, created, true);
    expect(groupMessengerService.trackMessage).toHaveBeenNthCalledWith(2, group, edited, true);
  });

  it('is cached: the same forum state and topic name hit the database once', async () => {
    const message = { message_id: 5, message_thread_id: 9, reply_to_message: { forum_topic_created: { name: 'Dev' } } };
    await topicTrackerMiddleware(ctx(message), next);
    await topicTrackerMiddleware(ctx({ ...message, message_id: 6 }), next);
    await topicTrackerMiddleware(ctx({ message_id: 7 }), next);
    expect(groupService.findOrCreateGroup).toHaveBeenCalledTimes(1);
    expect(redisService.set).toHaveBeenCalledWith('forum:-100', '1', { EX: expect.any(Number) });
    expect(redisService.set).toHaveBeenCalledWith('topic:-100:9', 'Dev', { EX: expect.any(Number) });
  });

  it('notices when Topics are turned off', async () => {
    await topicTrackerMiddleware(ctx({ message_id: 1 }), next);
    await topicTrackerMiddleware(ctx({ message_id: 2 }, { is_forum: false }), next);
    expect(groupMessengerService.trackMessage).toHaveBeenLastCalledWith(group, { message_id: 2 }, false);
  });

  it('ignores private chats and basic groups, and never blocks the update', async () => {
    await topicTrackerMiddleware(ctx({ message_id: 1 }, { type: 'group' }), next);
    (redisService.get as jest.Mock).mockRejectedValueOnce(new Error('down'));
    (groupService.findOrCreateGroup as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await topicTrackerMiddleware(ctx({ message_id: 2 }), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
