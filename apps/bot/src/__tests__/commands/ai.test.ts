import mongoose from 'mongoose';
import { AI_PRIVATE_MESSAGE, AiCommand, UPDATE_WHICH_TASK_MESSAGE } from 'src/bot/commands/ai';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import { AI_UNAVAILABLE_MESSAGE, aiCommandService } from 'src/shared/services/ai-command.service';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { checkGroupAiRateLimit, createTasksFromInput } from 'src/shared/services/task-creation.service';

jest.mock('src/database/services/epic.service', () => ({
  ...jest.requireActual('src/database/services/epic.service'),
  epicService: {
    listOpen: jest.fn(async () => []),
    listWithProgress: jest.fn(async () => []),
    findByTitle: jest.fn(async () => null),
    findById: jest.fn(async () => null),
    create: jest.fn(),
  },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/database/services/user.service');
jest.mock('src/database/services/group.service');
jest.mock('src/database/services/group-member.service');
jest.mock('src/database/services/task.service');
jest.mock('src/shared/services/rate-limit.service');
jest.mock('src/shared/services/ai/ai.service', () => {
  class AIUnavailableError extends Error {
    constructor(
      public reason: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { AIUnavailableError, aiService: { isConfigured: jest.fn(), generateJson: jest.fn() } };
});
jest.mock('src/shared/services/task-creation.service', () => {
  class ReplyProgress {
    constructor(private ctx: any) {}
    finish(text: string, extra: any) {
      return this.ctx.reply(text, extra);
    }
  }
  return { ReplyProgress, checkGroupAiRateLimit: jest.fn(), createTasksFromInput: jest.fn() };
});
jest.mock('src/shared/services/ai-command.service', () => ({
  ...jest.requireActual('src/shared/services/ai-command.service'),
  aiCommandService: { plan: jest.fn(), execute: jest.fn(), explainWithoutAi: jest.fn(() => null) },
}));
jest.mock('src/shared/services/notification.service', () => ({ notificationService: {} }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const user = { _id: new mongoose.Types.ObjectId(), telegramUserId: 1, username: 'me' };
const group = { _id: new mongoose.Types.ObjectId(), timezone: 'UTC' };

function ctx(text: string, extra: Record<string, any> = {}) {
  return {
    chat: { id: -100123, type: 'supergroup', title: 'Team' },
    message: { message_id: 77, text, from: { id: 1, username: 'me' }, date: 1760000000, ...extra },
    reply: jest.fn().mockResolvedValue({ message_id: 78 }),
    sendChatAction: jest.fn().mockResolvedValue(true),
    telegram: { editMessageText: jest.fn() },
  } as any;
}

describe('AiCommand', () => {
  let command: AiCommand;

  beforeEach(() => {
    command = new AiCommand();
    jest.clearAllMocks();
    (aiService.isConfigured as jest.Mock).mockReturnValue(true);
    (userService.findOrCreateUser as jest.Mock).mockResolvedValue(user);
    (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(group);
    (groupMemberService.getMembers as jest.Mock).mockResolvedValue([user]);
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 5, retryAfterSeconds: 0 });
    (checkGroupAiRateLimit as jest.Mock).mockResolvedValue(true);
    (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(null);
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(null);
  });

  it('registers /ai and /update', () => {
    const map = command.register();
    expect(map.has('ai')).toBe(true);
    expect(map.has('update')).toBe(true);
  });

  describe('/update', () => {
    it('shows its own usage when empty', async () => {
      const c = ctx('/update');
      await command.onAi(c, 'update');
      expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('Update a task in plain words'), expect.any(Object));
      expect(aiCommandService.plan).not.toHaveBeenCalled();
    });

    it('asks which task when there is no card reply and no #number', async () => {
      const c = ctx('/update chuyển sang in review');
      await command.onAi(c, 'update');
      expect(c.reply).toHaveBeenCalledWith(UPDATE_WHICH_TASK_MESSAGE, expect.any(Object));
      expect(aiCommandService.plan).not.toHaveBeenCalled();
    });

    it('plans an update for "#12" and tells the AI not to create tasks', async () => {
      (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
      (aiCommandService.execute as jest.Mock).mockResolvedValue({ kind: 'reply', reply: { text: '✅ #12' } });
      const c = ctx('/update@TBot #12 hạn thứ 6');
      await command.onAi(c, 'update');
      const context = (aiCommandService.plan as jest.Mock).mock.calls[0][0];
      expect(context.request).toBe('Update this task (do not create new tasks): #12 hạn thứ 6');
      expect(context.referencedNumbers).toEqual([12]);
    });

    it('works when replying to a task card', async () => {
      (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue({ _id: 't1', taskNumber: 3, title: 'X', status: 'todo' });
      (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
      (aiCommandService.execute as jest.Mock).mockResolvedValue({ kind: 'reply', reply: { text: '✅ #3' } });
      const c = ctx('/update giao cho @an', { reply_to_message: { message_id: 5, text: 'card' } });
      await command.onAi(c, 'update');
      expect(aiCommandService.plan).toHaveBeenCalled();
    });

    it('never creates tasks, even if the AI plans it', async () => {
      (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
      (aiCommandService.execute as jest.Mock).mockResolvedValue({ kind: 'create', useReply: false });
      const c = ctx('/update #12 tạo thêm task test');
      await command.onAi(c, 'update');
      expect(createTasksFromInput).not.toHaveBeenCalled();
      expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('use /new'), expect.any(Object));
    });
  });

  it('explains it works in groups when used privately', async () => {
    const c = ctx('/ai hi');
    c.chat = { id: 1, type: 'private' };
    await command.onAi(c);
    expect(c.reply).toHaveBeenCalledWith(AI_PRIVATE_MESSAGE, expect.objectContaining({ parse_mode: 'HTML' }));
  });

  it('shows usage for an empty request', async () => {
    const c = ctx('/ai');
    await command.onAi(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('Ask me in plain words'), expect.any(Object));
    expect(aiCommandService.plan).not.toHaveBeenCalled();
  });

  it('falls back when AI is not configured', async () => {
    (aiService.isConfigured as jest.Mock).mockReturnValue(false);
    const c = ctx('/ai tôi còn task nào?');
    await command.onAi(c);
    expect(c.sendChatAction).toHaveBeenCalledWith('typing');
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(c.reply).toHaveBeenCalledWith(AI_UNAVAILABLE_MESSAGE, expect.any(Object));
  });

  it('falls back when the AI fails', async () => {
    (aiCommandService.plan as jest.Mock).mockRejectedValue(new AIUnavailableError('invalid', 'bad json'));
    const c = ctx('/ai tôi còn task nào?');
    await command.onAi(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(c.reply).toHaveBeenCalledWith(AI_UNAVAILABLE_MESSAGE, expect.any(Object));
  });

  describe('AI down, explain wording', () => {
    const fallback = { text: '💡 #5 <b>Fix login</b>\n<i>🤖 AI can’t explain it right now — here’s what the task says:</i>' };
    const five = { _id: 't5', taskNumber: 5, title: 'Fix login', status: 'todo' };

    beforeEach(() => {
      (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(five);
      (aiCommandService.explainWithoutAi as jest.Mock).mockReturnValue(fallback);
    });

    it('planner fails: "giải thích #5" still answers from the task', async () => {
      (aiCommandService.plan as jest.Mock).mockRejectedValue(new AIUnavailableError('failed', 'down'));
      const c = ctx('/ai giải thích #5');
      await command.onAi(c);
      const context = (aiCommandService.explainWithoutAi as jest.Mock).mock.calls[0][0];
      expect(context).toMatchObject({ request: 'giải thích #5', referencedNumbers: [5], referencedTasks: [five] });
      expect(c.reply).toHaveBeenCalledTimes(1);
      expect(c.reply).toHaveBeenCalledWith(fallback.text, expect.objectContaining({ parse_mode: 'HTML' }));
    });

    it('AI not configured: same fallback, without spending the rate limit', async () => {
      (aiService.isConfigured as jest.Mock).mockReturnValue(false);
      const c = ctx('/ai #5 là gì');
      await command.onAi(c);
      expect(c.reply).toHaveBeenCalledWith(fallback.text, expect.any(Object));
      expect(rateLimitService.checkRateLimit).not.toHaveBeenCalled();
      expect(aiCommandService.plan).not.toHaveBeenCalled();
    });

    it('other requests just say AI is unavailable', async () => {
      (aiCommandService.plan as jest.Mock).mockRejectedValue(new AIUnavailableError('failed', 'down'));
      const c = ctx('/ai #5 xong rồi');
      await command.onAi(c);
      expect(aiCommandService.explainWithoutAi).not.toHaveBeenCalled();
      expect(c.reply).toHaveBeenCalledWith(AI_UNAVAILABLE_MESSAGE, expect.any(Object));
    });
  });

  it('takes the request from options when routed from a plain message (reply to a card)', async () => {
    const card = { _id: 't1', taskNumber: 12, title: 'Fix', status: 'todo' };
    (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(card);
    (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
    (aiCommandService.execute as jest.Mock).mockResolvedValue({ kind: 'reply', reply: { text: '💡 #12' } });
    const c = ctx('task này làm gì?', { reply_to_message: { message_id: 5, text: 'card' } });
    await command.onAi(c, 'ai', { request: 'task này làm gì?' });
    const context = (aiCommandService.plan as jest.Mock).mock.calls[0][0];
    expect(context).toMatchObject({ request: 'task này làm gì?', replyTask: card });
    expect(c.reply).toHaveBeenCalledWith(
      '💡 #12',
      expect.objectContaining({ reply_parameters: { message_id: 77, allow_sending_without_reply: true } }),
    );
  });

  it('is rate limited per user', async () => {
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 30 });
    const c = ctx('/ai tôi còn task nào?');
    await command.onAi(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('Try again in 30s'), expect.any(Object));
    expect(aiCommandService.plan).not.toHaveBeenCalled();
  });

  it('builds context from the replied card and #N, then sends one threaded HTML reply', async () => {
    const card = { _id: 't1', taskNumber: 12, title: 'Fix', status: 'todo' };
    const other = { _id: 't2', taskNumber: 7, title: 'Other', status: 'todo' };
    (taskService.getTaskByCardMessage as jest.Mock).mockResolvedValue(card);
    (taskService.getTaskByNumber as jest.Mock).mockResolvedValue(other);
    (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
    (aiCommandService.execute as jest.Mock).mockResolvedValue({
      kind: 'reply',
      reply: { text: '✅ <b>#12 Fix</b>', buttons: [[{ text: 'b', url: 'https://x' }]] },
    });

    const c = ctx('/ai chuyển task này cho @an, và #7 xong', { reply_to_message: { message_id: 5, text: 'card' } });
    await command.onAi(c);

    const context = (aiCommandService.plan as jest.Mock).mock.calls[0][0];
    expect(context).toMatchObject({
      request: 'chuyển task này cho @an, và #7 xong',
      replyTask: card,
      replyMessage: null,
      referencedNumbers: [7],
      referencedTasks: [other],
    });
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(c.reply).toHaveBeenCalledWith(
      '✅ <b>#12 Fix</b>',
      expect.objectContaining({
        parse_mode: 'HTML',
        reply_parameters: { message_id: 77, allow_sending_without_reply: true },
        reply_markup: { inline_keyboard: [[{ text: 'b', url: 'https://x' }]] },
      }),
    );
  });

  it('delegates create_tasks to the creation pipeline with the replied message as material', async () => {
    (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
    (aiCommandService.execute as jest.Mock).mockResolvedValue({ kind: 'create', useReply: true });
    const c = ctx('/ai tạo task cho @an', {
      reply_to_message: { message_id: 5, text: 'login bị lỗi trên iOS', from: { id: 2, username: 'an' }, date: 1 },
    });

    await command.onAi(c);

    expect(createTasksFromInput).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        messages: [expect.objectContaining({ messageId: 5, text: 'login bị lỗi trên iOS' })],
        note: 'tạo task cho @an',
        requester: user,
        group,
      }),
    );
    expect(c.reply).not.toHaveBeenCalled();
  });

  it('uses the request text as material when nothing is replied', async () => {
    (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
    (aiCommandService.execute as jest.Mock).mockResolvedValue({ kind: 'create', useReply: false });
    const c = ctx('/ai tạo task fix login cho @an hạn thứ 6');
    await command.onAi(c);
    expect(createTasksFromInput).toHaveBeenCalledWith(
      c,
      expect.objectContaining({ messages: [expect.objectContaining({ messageId: 77, text: 'tạo task fix login cho @an hạn thứ 6' })] }),
    );
  });

  it('never fails silently', async () => {
    (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
    (aiCommandService.execute as jest.Mock).mockRejectedValue(new Error('db down'));
    const c = ctx('/ai #12 xong rồi');
    await command.onAi(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('Something went wrong'), expect.any(Object));
  });

  describe('changes are events', () => {
    const update = {
      task: { taskNumber: 12, title: 'Fix login' },
      fieldChanges: [{ field: 'status', from: '📝 To do', to: '✅ Done' }],
      changes: ['✅ Done'],
    };
    const outcome = { kind: 'reply', reply: { text: '✅ <b>#12 Fix login</b>\n✅ Done' }, updates: [update] };
    const forumCtx = (threadId: number) => {
      const c = ctx('/ai #12 xong rồi', { message_thread_id: threadId, is_topic_message: true });
      c.chat.is_forum = true;
      c.telegram = {
        editMessageText: jest.fn(),
        sendMessage: jest.fn().mockResolvedValue({ message_id: 90 }),
        setMessageReaction: jest.fn(),
      };
      return c;
    };

    beforeEach(() => {
      (aiCommandService.plan as jest.Mock).mockResolvedValue({ actions: [] });
      (aiCommandService.execute as jest.Mock).mockResolvedValue(outcome);
    });

    it('normal group: the confirmation is the only message', async () => {
      const c = ctx('/ai #12 xong rồi');
      c.telegram.sendMessage = jest.fn();
      await command.onAi(c);
      expect(c.reply).toHaveBeenCalledTimes(1);
      expect(c.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('forum: answer in place + one line in "Task events" replying to the /ai message', async () => {
      (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue({
        ...group,
        telegramGroupId: -100123,
        isForum: true,
        eventsTopicId: 500,
        knownTopics: [],
      });
      const c = forumCtx(7);
      await command.onAi(c);
      expect(c.reply).toHaveBeenCalledWith(outcome.reply.text, expect.objectContaining({ parse_mode: 'HTML' }));
      expect(c.telegram.sendMessage).toHaveBeenCalledWith(
        -100123,
        '📝 @me moved <b>#12</b> Fix login to ✅ Done (via /ai)',
        {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          message_thread_id: 500,
          reply_parameters: { message_id: 77 },
        },
      );
      expect(c.telegram.setMessageReaction).not.toHaveBeenCalled();
    });

    it('forum, typed in the events topic: no second message', async () => {
      (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue({
        ...group,
        telegramGroupId: -100123,
        isForum: true,
        eventsTopicId: 500,
        knownTopics: [],
      });
      const c = forumCtx(500);
      await command.onAi(c);
      expect(c.reply).toHaveBeenCalledTimes(1);
      expect(c.telegram.sendMessage).not.toHaveBeenCalled();
    });
  });
});
