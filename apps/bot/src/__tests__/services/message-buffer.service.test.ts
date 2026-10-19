import { messageBufferMiddleware } from 'src/bot/middlewares/message-buffer.middleware';
import { messageBufferService, toBufferedMessage } from 'src/shared/services/message-buffer.service';
import { redisService } from 'src/shared/services/redis.service';

jest.mock('src/shared/services/redis.service', () => ({
  redisService: {
    lPush: jest.fn().mockResolvedValue(1),
    lTrim: jest.fn().mockResolvedValue('OK'),
    expire: jest.fn().mockResolvedValue(true),
    lRange: jest.fn(),
  },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

function ctxWith(message: Record<string, unknown>, chatType = 'supergroup') {
  return {
    chat: { id: -100123, type: chatType },
    message: { message_id: 7, date: 1760000000, from: { id: 1, username: 'an', is_bot: false }, ...message },
  } as any;
}

describe('messageBufferMiddleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('records group text with mentions and trims to 200 / 48h', async () => {
    const next = jest.fn();
    const text = 'Fix login Hùng';
    await messageBufferMiddleware(
      ctxWith({ text, entities: [{ type: 'text_mention', offset: 10, length: 4, user: { id: 55 } }] }),
      next,
    );
    expect(redisService.lPush).toHaveBeenCalledWith('msgbuf:-100123', expect.any(String));
    const stored = JSON.parse((redisService.lPush as jest.Mock).mock.calls[0][1]);
    expect(stored).toEqual(
      expect.objectContaining({ messageId: 7, text, fromName: '@an', mentions: [{ text: 'Hùng', telegramUserId: 55 }] }),
    );
    expect(redisService.lTrim).toHaveBeenCalledWith('msgbuf:-100123', 0, 199);
    expect(redisService.expire).toHaveBeenCalledWith('msgbuf:-100123', 172800);
    expect(next).toHaveBeenCalled();
  });

  it('records photo captions', async () => {
    await messageBufferMiddleware(ctxWith({ caption: 'Banner is cut off' }), jest.fn());
    expect(redisService.lPush).toHaveBeenCalled();
  });

  it.each([
    ['commands', { text: '/task 10', entities: [{ type: 'bot_command', offset: 0, length: 5 }] }, 'supergroup'],
    ['bot messages', { text: 'hi', from: { id: 2, is_bot: true } }, 'supergroup'],
    ['private chats', { text: 'hi' }, 'private'],
    ['empty messages', { sticker: {} }, 'group'],
  ])('skips %s', async (_label, message, chatType) => {
    await messageBufferMiddleware(ctxWith(message, chatType), jest.fn());
    expect(redisService.lPush).not.toHaveBeenCalled();
  });

  it('never throws and always calls next', async () => {
    (redisService.lPush as jest.Mock).mockRejectedValueOnce(new Error('redis down'));
    const next = jest.fn();
    await expect(messageBufferMiddleware(ctxWith({ text: 'hello' }), next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe('messageBufferService reads', () => {
  const stored = [3, 2, 1].map((id) =>
    JSON.stringify(toBufferedMessage({ message_id: id, text: `m${id}`, date: id } as any, -100123)),
  );

  beforeEach(() => (redisService.lRange as jest.Mock).mockResolvedValue([...stored, 'corrupt']));

  it('returns the last N oldest-first', async () => {
    expect((await messageBufferService.getRecent(-100123, 2)).map((m) => m.messageId)).toEqual([2, 3]);
  });

  it('returns messages after an id', async () => {
    expect((await messageBufferService.getAfter(-100123, 1)).map((m) => m.messageId)).toEqual([2, 3]);
  });
});

describe('forum topics in the buffer', () => {
  it('records the topic of topic messages only', () => {
    expect(toBufferedMessage({ message_id: 1, text: 'a', message_thread_id: 9, is_topic_message: true } as any, -1).threadId).toBe(9);
    // Reply threads in groups without Topics also carry message_thread_id: not a topic
    expect(toBufferedMessage({ message_id: 2, text: 'b', message_thread_id: 1 } as any, -1).threadId).toBeUndefined();
  });

  it('reads one topic (General = no topic)', async () => {
    const msgs = [
      { message_id: 1, text: 'general' },
      { message_id: 2, text: 'dev', message_thread_id: 9, is_topic_message: true },
      { message_id: 3, text: 'design', message_thread_id: 4, is_topic_message: true },
      { message_id: 4, text: 'dev 2', message_thread_id: 9, is_topic_message: true },
    ].map((m) => JSON.stringify(toBufferedMessage({ date: 1, ...m } as any, -100123)));
    (redisService.lRange as jest.Mock).mockResolvedValue(msgs);

    expect((await messageBufferService.getRecent(-100123, 10, { threadId: 9 })).map((m) => m.messageId)).toEqual([2, 4]);
    expect((await messageBufferService.getRecent(-100123, 10, { threadId: undefined })).map((m) => m.messageId)).toEqual([1]);
    expect((await messageBufferService.getAfter(-100123, 2, { threadId: 9 })).map((m) => m.messageId)).toEqual([4]);
    expect((await messageBufferService.getRecent(-100123, 10)).map((m) => m.messageId)).toEqual([1, 2, 3, 4]);
  });
});
