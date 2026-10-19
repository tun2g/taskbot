import { Group } from 'src/database/models/group.model';
import {
  buildMessageLink,
  GroupMessengerService,
  isEventsTopicName,
  normalizeTopicName,
  TOPIC_SETUP_HINT,
} from 'src/shared/services/group-messenger.service';

jest.mock('src/database/models/group.model', () => ({
  Group: { updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }) },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const CHAT = -1001234567890;

function forum(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'g1',
    telegramGroupId: CHAT,
    isForum: true,
    eventsTopicId: null,
    knownTopics: [] as { id: number; name: string }[],
    topicSetupHintAt: null,
    ...overrides,
  } as any;
}

function telegram(overrides: Record<string, jest.Mock> = {}) {
  return {
    sendMessage: jest.fn().mockImplementation(async (_chat: number, text: string, extra: any) => ({
      message_id: 900,
      text,
      ...(extra?.message_thread_id ? { message_thread_id: extra.message_thread_id, is_topic_message: true } : {}),
    })),
    createForumTopic: jest.fn().mockResolvedValue({ message_thread_id: 77, name: 'Task events', icon_color: 0x6fb9f0 }),
    setMessageReaction: jest.fn().mockResolvedValue(true),
    deleteMessage: jest.fn().mockResolvedValue(true),
    ...overrides,
  } as any;
}

describe('topic names', () => {
  it.each(['📋 TASK-events', 'task events ', 'Task Events', 'task_events', '  Task   events ✅'])('"%s" counts', (name) => {
    expect(isEventsTopicName(name)).toBe(true);
  });

  it.each(['Tasks', 'Task event', 'Events', 'Task events archive'])('"%s" does not', (name) => {
    expect(isEventsTopicName(name)).toBe(false);
  });

  it('normalises case, emoji and separators', () => {
    expect(normalizeTopicName('📋 TASK-events ')).toBe('task events');
  });
});

describe('buildMessageLink', () => {
  it('links a supergroup message without a topic', () => {
    expect(buildMessageLink(CHAT, 42)).toBe('https://t.me/c/1234567890/42');
  });

  it('links into the topic when there is one', () => {
    expect(buildMessageLink(CHAT, 42, 7)).toBe('https://t.me/c/1234567890/7/42');
  });

  it('has no link for basic groups', () => {
    expect(buildMessageLink(-12345, 42)).toBeNull();
  });
});

describe('GroupMessengerService', () => {
  let service: GroupMessengerService;

  beforeEach(() => {
    service = new GroupMessengerService();
    (Group.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });
  });

  describe('resolveEventsThread', () => {
    it('is undefined for normal groups and never creates topics', async () => {
      const tg = telegram();
      expect(await service.resolveEventsThread(tg, forum({ isForum: false }))).toBeUndefined();
      expect(tg.createForumTopic).not.toHaveBeenCalled();
    });

    it('uses the configured topic', async () => {
      const tg = telegram();
      expect(await service.resolveEventsThread(tg, forum({ eventsTopicId: 12 }))).toBe(12);
      expect(tg.createForumTopic).not.toHaveBeenCalled();
    });

    it('adopts a known topic whose name matches', async () => {
      const group = forum({ knownTopics: [{ id: 3, name: 'General chat' }, { id: 9, name: '📋 TASK-events' }] });
      expect(await service.resolveEventsThread(telegram(), group)).toBe(9);
      expect(group.eventsTopicId).toBe(9);
      expect(Group.updateOne).toHaveBeenCalledWith({ _id: 'g1' }, { $set: { eventsTopicId: 9 } });
    });

    it('creates "Task events" once even when several events race', async () => {
      let resolve!: (v: unknown) => void;
      const tg = telegram({ createForumTopic: jest.fn(() => new Promise((r) => (resolve = r))) });
      const a = forum();
      const b = forum(); // a second copy of the same group document
      const pending = Promise.all([service.resolveEventsThread(tg, a), service.resolveEventsThread(tg, b)]);
      await new Promise((r) => setImmediate(r));
      resolve({ message_thread_id: 77, name: 'Task events', icon_color: 0x6fb9f0 });
      expect(await pending).toEqual([77, 77]);
      expect(tg.createForumTopic).toHaveBeenCalledTimes(1);
      expect(tg.createForumTopic).toHaveBeenCalledWith(CHAT, 'Task events', { icon_color: 0x6fb9f0 });
      expect(a.eventsTopicId).toBe(77);
    });

    it('is undefined without "Manage topics" and does not retry right away', async () => {
      const tg = telegram({
        createForumTopic: jest.fn().mockRejectedValue(new Error('400: Bad Request: not enough rights to create a topic')),
      });
      const group = forum();
      expect(await service.resolveEventsThread(tg, group)).toBeUndefined();
      expect(await service.resolveEventsThread(tg, group)).toBeUndefined();
      expect(tg.createForumTopic).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendEvent', () => {
    it('normal group: plain message, same-topic reply allowed without the source', async () => {
      const tg = telegram();
      await service.sendEvent(tg, forum({ isForum: false }), 'hi', {
        extra: { parse_mode: 'HTML' },
        source: { messageId: 5 },
      });
      expect(tg.sendMessage).toHaveBeenCalledTimes(1);
      expect(tg.sendMessage).toHaveBeenCalledWith(CHAT, 'hi', {
        parse_mode: 'HTML',
        reply_parameters: { message_id: 5, allow_sending_without_reply: true },
      });
    });

    it('forum: replies across topics into the events topic', async () => {
      const tg = telegram();
      const sent = await service.sendEvent(tg, forum({ eventsTopicId: 12 }), 'card', {
        source: { messageId: 5, threadId: 3 },
        fallbackThreadId: 3,
      });
      expect(tg.sendMessage).toHaveBeenCalledWith(CHAT, 'card', {
        message_thread_id: 12,
        reply_parameters: { message_id: 5 },
      });
      expect(sent.message_thread_id).toBe(12);
    });

    it.each([
      ['HTML', '\n\n💬 <a href="https://t.me/c/1234567890/3/5">Original message</a>'],
      ['Markdown', '\n\n💬 [Original message](https://t.me/c/1234567890/3/5)'],
      [undefined, '\n\n💬 Original message: https://t.me/c/1234567890/3/5'],
    ])('falls back to a link when the reply is refused (%s)', async (parseMode, suffix) => {
      const tg = telegram();
      tg.sendMessage.mockRejectedValueOnce(new Error('400: Bad Request: message to be replied not found'));
      await service.sendEvent(tg, forum({ eventsTopicId: 12 }), 'card', {
        source: { messageId: 5, threadId: 3 },
        extra: parseMode ? { parse_mode: parseMode as any } : {},
      });
      expect(tg.sendMessage).toHaveBeenCalledTimes(2);
      const [, text, extra] = tg.sendMessage.mock.calls[1];
      expect(text).toBe(`card${suffix}`);
      expect(extra.message_thread_id).toBe(12);
      expect(extra.reply_parameters).toBeUndefined();
    });

    it('skips the link when the caller says so', async () => {
      const tg = telegram();
      tg.sendMessage.mockRejectedValueOnce(new Error('400: Bad Request: message to be replied not found'));
      await service.sendEvent(tg, forum({ eventsTopicId: 12 }), 'card', {
        source: { messageId: 5, threadId: 3, linkFallback: false },
      });
      expect(tg.sendMessage.mock.calls[1][1]).toBe('card');
    });

    it('moves a reply that Telegram put in the source topic', async () => {
      const tg = telegram();
      tg.sendMessage.mockResolvedValueOnce({ message_id: 800, message_thread_id: 3, is_topic_message: true });
      await service.sendEvent(tg, forum({ eventsTopicId: 12 }), 'card', { source: { messageId: 5, threadId: 3 } });
      expect(tg.deleteMessage).toHaveBeenCalledWith(CHAT, 800);
      expect(tg.sendMessage.mock.calls[1][2]).toEqual({ message_thread_id: 12 });
      expect(tg.sendMessage.mock.calls[1][1]).toContain('https://t.me/c/1234567890/3/5');
    });

    it('deleted events topic: forgets it, makes a new one and resends', async () => {
      const tg = telegram();
      tg.sendMessage.mockRejectedValueOnce(new Error('400: Bad Request: message thread not found'));
      const group = forum({ eventsTopicId: 12, knownTopics: [{ id: 12, name: 'Task events' }] });
      await service.sendEvent(tg, group, 'line', { source: { messageId: 5, threadId: 3 }, fallbackThreadId: 3 });
      expect(Group.updateOne).toHaveBeenCalledWith(
        { _id: 'g1' },
        { $set: { eventsTopicId: null }, $pull: { knownTopics: { id: 12 } } },
      );
      expect(tg.createForumTopic).toHaveBeenCalledTimes(1);
      expect(tg.sendMessage).toHaveBeenLastCalledWith(CHAT, 'line', {
        message_thread_id: 77,
        reply_parameters: { message_id: 5 },
      });
      expect(group.eventsTopicId).toBe(77);
    });

    it('TOPIC_DELETED is handled like a missing thread', async () => {
      const tg = telegram({ createForumTopic: jest.fn().mockRejectedValue(new Error('not enough rights')) });
      tg.sendMessage.mockRejectedValueOnce(new Error('400: Bad Request: TOPIC_DELETED'));
      const group = forum({ eventsTopicId: 12 });
      await service.sendEvent(tg, group, 'line', { fallbackThreadId: 3 });
      expect(group.eventsTopicId).toBeNull();
      expect(tg.sendMessage).toHaveBeenLastCalledWith(CHAT, 'line', { message_thread_id: 3 });
    });

    it('closed events topic: keeps the setting, posts this event in General', async () => {
      const tg = telegram();
      tg.sendMessage.mockRejectedValueOnce(new Error('400: Bad Request: TOPIC_CLOSED'));
      const group = forum({ eventsTopicId: 12 });
      await service.sendEvent(tg, group, 'line');
      expect(group.eventsTopicId).toBe(12);
      expect(tg.sendMessage).toHaveBeenLastCalledWith(CHAT, 'line', {});
    });

    it('no events topic and no fallback: General', async () => {
      const tg = telegram({ createForumTopic: jest.fn().mockRejectedValue(new Error('not enough rights')) });
      await service.sendEvent(tg, forum(), 'digest');
      expect(tg.sendMessage).toHaveBeenCalledWith(CHAT, 'digest', {});
    });

    it('retries as plain text when formatting is rejected', async () => {
      const tg = telegram();
      tg.sendMessage.mockRejectedValueOnce(new Error("400: Bad Request: can't parse entities"));
      await service.sendEvent(tg, forum({ isForum: false }), '*bad', { extra: { parse_mode: 'Markdown' } });
      expect(tg.sendMessage).toHaveBeenLastCalledWith(CHAT, '*bad', {});
    });
  });

  describe('sendCommandEvent', () => {
    const ctxIn = (threadId: number | undefined, isForum = true, tg = telegram()) =>
      ({
        chat: { id: CHAT, type: 'supergroup', is_forum: isForum },
        message: { message_id: 50, ...(threadId ? { message_thread_id: threadId, is_topic_message: true } : {}) },
        telegram: tg,
        reply: jest.fn().mockResolvedValue({ message_id: 51 }),
      }) as any;

    it('normal group: a plain reply, exactly as before', async () => {
      const ctx = ctxIn(undefined, false);
      const result = await service.sendCommandEvent(ctx, forum({ isForum: false }), 'done', {
        extra: { parse_mode: 'Markdown' },
      });
      expect(ctx.reply).toHaveBeenCalledWith('done', { parse_mode: 'Markdown' });
      expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
      expect(ctx.telegram.setMessageReaction).not.toHaveBeenCalled();
      expect(result.elsewhere).toBe(false);
    });

    it('forum: event in the events topic replying to the command, 👌 on the command', async () => {
      const ctx = ctxIn(3);
      const result = await service.sendCommandEvent(ctx, forum({ eventsTopicId: 12 }), 'done');
      expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(CHAT, 'done', {
        message_thread_id: 12,
        reply_parameters: { message_id: 50 },
      });
      expect(ctx.telegram.setMessageReaction).toHaveBeenCalledWith(CHAT, 50, [{ type: 'emoji', emoji: '👌' }]);
      expect(ctx.reply).not.toHaveBeenCalled();
      expect(result.elsewhere).toBe(true);
    });

    it('falls back to 👍 and ignores reaction failures', async () => {
      const tg = telegram({ setMessageReaction: jest.fn().mockRejectedValue(new Error('REACTION_INVALID')) });
      const ctx = ctxIn(3, true, tg);
      await expect(service.sendCommandEvent(ctx, forum({ eventsTopicId: 12 }), 'done')).resolves.toBeTruthy();
      expect(tg.setMessageReaction).toHaveBeenNthCalledWith(2, CHAT, 50, [{ type: 'emoji', emoji: '👍' }]);
    });

    it('command typed in the events topic: posts there, no reaction', async () => {
      const ctx = ctxIn(12);
      const result = await service.sendCommandEvent(ctx, forum({ eventsTopicId: 12 }), 'done');
      expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(CHAT, 'done', {
        message_thread_id: 12,
        reply_parameters: { message_id: 50, allow_sending_without_reply: true },
      });
      expect(ctx.telegram.setMessageReaction).not.toHaveBeenCalled();
      expect(result.elsewhere).toBe(false);
    });

    it('no events topic: posts in the command topic with a weekly admin tip', async () => {
      const tg = telegram({ createForumTopic: jest.fn().mockRejectedValue(new Error('not enough rights')) });
      const group = forum();
      await service.sendCommandEvent(ctxIn(3, true, tg), group, 'done');
      expect(tg.sendMessage).toHaveBeenLastCalledWith(CHAT, `done\n\n${TOPIC_SETUP_HINT}`, {
        message_thread_id: 3,
        reply_parameters: { message_id: 50, allow_sending_without_reply: true },
      });
      expect(tg.setMessageReaction).not.toHaveBeenCalled();

      // Second time within 7 days: no tip
      await service.sendCommandEvent(ctxIn(3, true, tg), group, 'again');
      expect(tg.sendMessage).toHaveBeenLastCalledWith(CHAT, 'again', expect.anything());
    });

    it('no tip when another worker already showed it', async () => {
      (Group.updateOne as jest.Mock).mockResolvedValueOnce({ modifiedCount: 0 });
      const tg = telegram({ createForumTopic: jest.fn().mockRejectedValue(new Error('not enough rights')) });
      await service.sendCommandEvent(ctxIn(3, true, tg), forum(), 'done');
      expect(tg.sendMessage).toHaveBeenLastCalledWith(CHAT, 'done', expect.anything());
    });
  });

  describe('trackMessage', () => {
    it('records the forum flag and topic names', async () => {
      const group = forum({ isForum: false });
      await service.trackMessage(
        group,
        { message_thread_id: 9, reply_to_message: { forum_topic_created: { name: 'Task events' } } },
        true,
      );
      expect(Group.updateOne).toHaveBeenCalledWith(
        { _id: 'g1' },
        { $set: { isForum: true, knownTopics: [{ id: 9, name: 'Task events' }] } },
      );
      expect(group.knownTopics).toEqual([{ id: 9, name: 'Task events' }]);
    });

    it('does nothing when nothing changed', async () => {
      await service.trackMessage(forum({ knownTopics: [{ id: 9, name: 'X' }] }), { message_thread_id: 9 }, true);
      expect(Group.updateOne).not.toHaveBeenCalled();
    });
  });
});
