import { botMessageHandler, PLAIN_REPLY_HINT, PLAIN_REPLY_HINT_TTL_SECONDS } from 'src/bot/bot-message-handler';
import { aiCommand } from 'src/bot/commands/ai';
import { taskService } from 'src/database/services/task.service';
import { redisService } from 'src/shared/services/redis.service';

jest.mock('src/bot/commands/ai', () => ({ aiCommand: { onAi: jest.fn() } }));
jest.mock('src/database/services/task.service', () => ({ taskService: { getTaskByCardMessage: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: { set: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const BOT = { id: 999, username: 'TBot', is_bot: true, first_name: 'TBot' };
const card = { _id: 't1', taskNumber: 5, title: 'Fix login' };

function ctx(text: string, extra: Record<string, any> = {}, chatType = 'supergroup') {
  return {
    botInfo: BOT,
    chat: { id: -100, type: chatType },
    message: { message_id: 40, text, from: { id: 1, is_bot: false, first_name: 'Tú' }, date: 1, ...extra },
    reply: jest.fn(),
  } as any;
}

const replyToBot = (messageId = 30) => ({ reply_to_message: { message_id: messageId, from: BOT, text: 'card' } });

describe('group messages to the bot', () => {
  beforeEach(() => {
    (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(null);
    (redisService.set as jest.Mock).mockResolvedValue('OK');
  });

  it('a question replied to a task card goes to /ai with the text as the request', async () => {
    (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(card);
    const c = ctx('task này làm gì?', replyToBot());
    await botMessageHandler.process(c);
    expect(taskService.getTaskByCardMessage).toHaveBeenCalledWith(-100, 30);
    expect(aiCommand.onAi).toHaveBeenCalledWith(c, 'ai', { request: 'task này làm gì?' });
    expect(c.reply).not.toHaveBeenCalled();
  });

  it.each(['giải thích giúp mình', 'cái này là gì', 'sao lại cần cái này', 'explain please', 'what does this mean'])(
    '"%s" on a card counts as a question',
    async (text) => {
      (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(card);
      await botMessageHandler.process(ctx(text, replyToBot()));
      expect(aiCommand.onAi).toHaveBeenCalledWith(expect.anything(), 'ai', { request: text });
    },
  );

  it('"@TBot task này làm gì" goes to /ai without the mention', async () => {
    const c = ctx('@TBot task này làm gì');
    await botMessageHandler.process(c);
    expect(aiCommand.onAi).toHaveBeenCalledWith(c, 'ai', { request: 'task này làm gì' });
  });

  it('a mention while replying to someone else keeps the reply (create-from-reply via /ai)', async () => {
    const c = ctx('@tbot tạo task từ tin này', {
      reply_to_message: { message_id: 12, from: { id: 2, first_name: 'An' }, text: 'login lỗi' },
    });
    await botMessageHandler.process(c);
    expect(aiCommand.onAi).toHaveBeenCalledWith(c, 'ai', { request: 'tạo task từ tin này' });
  });

  it('a non-question reply to a card gets the /ai hint once, threaded', async () => {
    (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(card);
    const c = ctx('ok để mình làm', replyToBot());
    await botMessageHandler.process(c);
    expect(aiCommand.onAi).not.toHaveBeenCalled();
    expect(redisService.set).toHaveBeenCalledWith('ai_plain_reply_hint:1', '1', {
      NX: true,
      EX: PLAIN_REPLY_HINT_TTL_SECONDS,
    });
    expect(c.reply).toHaveBeenCalledWith(PLAIN_REPLY_HINT, {
      parse_mode: 'HTML',
      reply_parameters: { message_id: 40, allow_sending_without_reply: true },
    });
  });

  it('a question replied to a bot message that is not a card gets the hint, not /ai', async () => {
    const c = ctx('sao vậy?', replyToBot());
    await botMessageHandler.process(c);
    expect(aiCommand.onAi).not.toHaveBeenCalled();
    expect(c.reply).toHaveBeenCalledWith(PLAIN_REPLY_HINT, expect.any(Object));
  });

  it('stays silent when the user already got the hint today', async () => {
    (redisService.set as jest.Mock).mockResolvedValue(null);
    const c = ctx('cảm ơn', replyToBot());
    await botMessageHandler.process(c);
    expect(c.reply).not.toHaveBeenCalled();
  });

  it('stays silent when Redis is down', async () => {
    (redisService.set as jest.Mock).mockRejectedValue(new Error('down'));
    const c = ctx('cảm ơn', replyToBot());
    await botMessageHandler.process(c);
    expect(c.reply).not.toHaveBeenCalled();
  });

  it('ignores the implicit reply to a forum topic the bot created', async () => {
    const c = ctx('mọi người ơi', {
      is_topic_message: true,
      message_thread_id: 3,
      reply_to_message: { message_id: 3, from: BOT, forum_topic_created: { name: 'Task events' } },
    });
    await botMessageHandler.process(c);
    expect(aiCommand.onAi).not.toHaveBeenCalled();
    expect(c.reply).not.toHaveBeenCalled();
  });

  it('ignores commands, replies to other people and private chats', async () => {
    await botMessageHandler.process(
      ctx('/foo@TBot', { entities: [{ type: 'bot_command', offset: 0, length: 9 }], ...replyToBot() }),
    );
    await botMessageHandler.process(
      ctx('task này làm gì?', { reply_to_message: { message_id: 9, from: { id: 2, first_name: 'An' }, text: 'x' } }),
    );
    await botMessageHandler.process(ctx('task này làm gì?', replyToBot(), 'private'));
    expect(aiCommand.onAi).not.toHaveBeenCalled();
    expect(redisService.set).not.toHaveBeenCalled();
  });
});
