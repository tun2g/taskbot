import { BotContext } from 'src/bot/interface/context';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import {
  AI_UNAVAILABLE_MESSAGE,
  aiCommandService,
  AiReply,
  AiRequestContext,
  buildAiContext,
  CardEditor,
  checkUserAiRateLimit,
  EXPLAIN_WORDING,
  extractTaskNumbers,
} from 'src/shared/services/ai-command.service';
import type { AiOutcome } from 'src/shared/services/ai-command/telegram.renderer';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import {
  groupMessengerService,
  isForumChat,
  topicOf,
  TOPIC_SETUP_HINT,
} from 'src/shared/services/group-messenger.service';
import {
  BufferedMessage,
  displayNameOf,
  extractMentions,
  messageText,
  toBufferedMessage,
} from 'src/shared/services/message-buffer.service';
import {
  checkGroupAiRateLimit,
  createTasksFromInput,
  ReplyProgress,
} from 'src/shared/services/task-creation.service';
import { buildChangeLine, userDisplayName } from 'src/shared/services/task-event-lines';
import { buildAppLink } from 'src/shared/utils/app-links';
import { IEpic } from 'src/database/models/epic.model';
import { IGroup } from 'src/database/models/group.model';
import { epicEventsService } from 'src/shared/services/epic-events.service';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { Message } from 'telegraf/types';

const TYPING_INTERVAL_MS = 4500;

export const AI_USAGE_MESSAGE =
  '<b>🤖 Ask me in plain words</b>\n' +
  '<code>/ai tôi còn task nào?</code> — your open tasks\n' +
  '<code>/ai #12 xong rồi</code> — update a task\n' +
  '<code>/ai giải thích #5</code> — what a task is about\n' +
  '<code>/ai thêm #5 vào epic Login</code> — group tasks in an epic\n' +
  '<code>/ai đổi #12 sang in review, priority cao</code>\n' +
  '<code>/ai tạo task fix login cho @an hạn thứ 6</code>\n' +
  'Reply to a task card: <code>/ai chuyển task này cho @an</code>';

export const UPDATE_USAGE_MESSAGE =
  '<b>✏️ Update a task in plain words</b>\n' +
  'Reply to its card: <code>/update chuyển sang in review, giao cho @an</code>\n' +
  'Or by number: <code>/update #12 hạn thứ 6, priority cao</code>\n' +
  '<code>/update #12 thêm vào mô tả: test cả Android</code>';

export const UPDATE_WHICH_TASK_MESSAGE =
  '🤔 Which task? Reply to its card with /update, or write the number: <code>/update #12 …</code>';

export const AI_PRIVATE_MESSAGE =
  '🤖 /ai works in your team group. To understand a task from here, tap 💡 Explain under it.';

type CommandMessage = Message.TextMessage | Message.CaptionableMessage;

export class AiCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('ai', (ctx) => this.onAi(ctx));
    this.map.set('update', (ctx) => this.onAi(ctx, 'update'));
    return this.map;
  }

  /**
   * `mode: 'update'` (/update) only changes existing tasks and needs an explicit target.
   * `options.request`: the request text when it isn't a command — a question replied to a task card or
   * an "@bot …" message (bot-message-handler); otherwise it is the text after /ai or /update.
   */
  async onAi(ctx: BotContext, mode: 'ai' | 'update' = 'ai', options: { request?: string } = {}) {
    let stopTyping = () => {};
    try {
      const chat = ctx.chat;
      const message = ctx.message as CommandMessage | undefined;
      if (!chat || !message) return;

      if (chat.type !== 'group' && chat.type !== 'supergroup') {
        await this.send(ctx, { text: AI_PRIVATE_MESSAGE });
        return;
      }

      const request = (options.request ?? messageText(message).replace(/^\/(ai|update)(@\w+)?/i, '')).trim();
      if (!request) {
        await this.send(ctx, { text: mode === 'update' ? UPDATE_USAGE_MESSAGE : AI_USAGE_MESSAGE });
        return;
      }

      stopTyping = this.keepTyping(ctx);

      const user = await userService.findOrCreateUser(ctx);
      if (!user) {
        await this.send(ctx, { text: "❌ I couldn't identify you. Please try again in a moment." });
        return;
      }
      const group = await groupService.findOrCreateGroup(chat.id, 'title' in chat ? chat.title : 'Group');
      if (!group) {
        await this.send(ctx, { text: "❌ I couldn't set up this group. Please try again in a moment." });
        return;
      }

      // ── Context ──
      const reply = this.getReplyTarget(message);
      const replyTask = reply ? await taskService.getTaskByCardMessage(chat.id, reply.message_id) : null;
      const replyText = reply && !replyTask ? messageText(reply as CommandMessage) : '';

      // /update never guesses: the task is the replied card or a number the user wrote
      if (mode === 'update' && !replyTask && extractTaskNumbers(request).length === 0) {
        await this.send(ctx, { text: UPDATE_WHICH_TASK_MESSAGE });
        return;
      }

      // No AI, no AI cost: checked before the rate limits.
      if (!aiService.isConfigured()) {
        await this.sendUnavailable(ctx, mode, { request, user, group, replyTask });
        return;
      }

      const userLimit = await checkUserAiRateLimit(user.telegramUserId, chat.id);
      if (!userLimit.allowed) {
        await this.send(ctx, {
          text: `⏳ Too many /ai requests. Try again in ${userLimit.retryAfterSeconds}s, or use the card buttons.`,
        });
        return;
      }
      if (!(await checkGroupAiRateLimit(chat.id))) {
        await this.send(ctx, {
          text: '⏳ AI is busy in this group — try again in a few minutes. Meanwhile use the card buttons or /list, /done.',
        });
        return;
      }

      const context = await buildAiContext({
        request: mode === 'update' ? `Update this task (do not create new tasks): ${request}` : request,
        requester: user,
        group,
        replyTask,
        replyMessage: replyText ? { from: displayNameOf(reply!.from), text: replyText } : null,
        mentions: extractMentions(message),
      });

      let plan;
      try {
        plan = await aiCommandService.plan(context);
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        logger.warn(`/ai planning failed (${error.reason}): ${error.message}`);
        await this.sendUnavailable(ctx, mode, { request, user, group, replyTask }, context);
        return;
      }

      const outcome = await aiCommandService.execute(context, plan, ctx.telegram as unknown as CardEditor);
      stopTyping();

      if (outcome.kind === 'create' && mode === 'update') {
        await this.send(ctx, { text: 'ℹ️ /update only changes existing tasks — use /new to create one.' });
        return;
      }

      if (outcome.kind === 'create') {
        // The creation pipeline posts the single reply (task card, or summary with ↩️ Undo).
        const messages: BufferedMessage[] = [];
        let note: string | undefined;
        if (outcome.useReply && reply && replyText) {
          messages.push(toBufferedMessage(reply as CommandMessage, chat.id));
          note = request;
        } else {
          messages.push(toBufferedMessage(message, chat.id, request));
        }
        await createTasksFromInput(ctx, { messages, note, requester: user, group });
        return;
      }

      await this.replyWithEvent(ctx, group, user, message, outcome, context.createdEpics ?? []);
    } catch (error) {
      logger.error(`Error in /ai command: ${error instanceof Error ? error.stack : error}`);
      try {
        await this.send(ctx, {
          text: '❌ Something went wrong. Check the task on the board or with /list, then try again.',
        });
      } catch (replyError) {
        logger.error(`Could not send /ai error reply: ${replyError}`);
      }
    } finally {
      stopTyping();
    }
  }

  /**
   * The answer stays in place (it's a conversation). In a forum whose "Task events" topic is
   * elsewhere, changes are ALSO announced there in one line; in normal groups (and when the
   * events topic is this topic) the answer already is the event, so nothing is posted twice.
   */
  private async replyWithEvent(
    ctx: BotContext,
    group: IGroup,
    user: IUser,
    message: CommandMessage,
    outcome: Extract<AiOutcome, { kind: 'reply' }>,
    createdEpics: IEpic[] = [],
  ) {
    let reply = outcome.reply;
    let eventText: string | null = null;
    let announceEpics = false;
    const commandThread = topicOf(message as { is_topic_message?: boolean; message_thread_id?: number });

    if ((outcome.updates?.length || createdEpics.length) && (isForumChat(ctx) || group.isForum)) {
      const eventsThread = await groupMessengerService.eventsTopicFor(ctx, group);
      if (eventsThread === undefined) {
        if (await groupMessengerService.claimSetupHint(group)) reply = { ...reply, text: `${reply.text}\n\n${TOPIC_SETUP_HINT}` };
      } else if (eventsThread !== commandThread) {
        announceEpics = createdEpics.length > 0;
        const lines = (outcome.updates ?? [])
          .map((u) =>
            buildChangeLine(
              userDisplayName(user),
              u.task.taskNumber,
              u.task.title,
              u.fieldChanges,
              '/ai',
              buildAppLink(group._id, u.task._id),
            ),
          )
          .filter((line): line is string => !!line);
        eventText = lines.length ? lines.join('\n') : null;
      }
    }

    await this.send(ctx, reply);

    if (eventText) {
      await groupMessengerService
        .sendEvent(ctx.telegram, group, eventText, {
          extra: { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
          source: { messageId: message.message_id, threadId: commandThread },
          fallbackThreadId: commandThread,
        })
        .catch((error) => logger.warn(`Could not post /ai event line: ${error}`));
    }
    if (announceEpics) {
      // The reply already says "🗂 Created epic …" here; the events topic gets its own line, like task changes.
      for (const epic of createdEpics) {
        await epicEventsService.created(epic, user, '/ai', {
          group,
          telegram: ctx.telegram,
          source: { messageId: message.message_id, threadId: commandThread },
          fallbackThreadId: commandThread,
        });
      }
    }
  }

  /**
   * AI down: "giải thích #5" / "task này làm gì?" on a card still gets the task's own details (description
   * or source message + state); anything else gets the short "AI is unavailable" reply.
   */
  private async sendUnavailable(
    ctx: BotContext,
    mode: 'ai' | 'update',
    input: { request: string; user: IUser; group: IGroup; replyTask: ITask | null },
    context?: AiRequestContext,
  ) {
    if (mode === 'ai' && EXPLAIN_WORDING.test(input.request)) {
      try {
        const c =
          context ??
          (await buildAiContext({ request: input.request, requester: input.user, group: input.group, replyTask: input.replyTask }));
        const fallback = aiCommandService.explainWithoutAi(c);
        if (fallback) {
          await this.send(ctx, fallback);
          return;
        }
      } catch (error) {
        logger.warn(`/ai explain fallback failed: ${error}`);
      }
    }
    await this.send(ctx, { text: AI_UNAVAILABLE_MESSAGE });
  }

  /** Exactly one HTML reply, threaded to the user's /ai message (plain-text retry on a formatting error). */
  private async send(ctx: BotContext, reply: AiReply) {
    const messageId = ctx.message?.message_id;
    const progress = new ReplyProgress(ctx, '');
    await progress.finish(reply.text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {}),
      ...(reply.buttons ? { reply_markup: { inline_keyboard: reply.buttons } } : {}),
    });
  }

  /** "typing…" right away and while the AI thinks (Telegram clears it after ~5s). */
  private keepTyping(ctx: BotContext): () => void {
    const ping = () => void Promise.resolve(ctx.sendChatAction?.('typing')).catch(() => undefined);
    ping();
    const timer = setInterval(ping, TYPING_INTERVAL_MS);
    return () => clearInterval(timer);
  }

  /** The replied-to message, ignoring the implicit reply to a forum topic's first message. */
  private getReplyTarget(message: CommandMessage): Message | null {
    const reply = 'reply_to_message' in message ? message.reply_to_message : undefined;
    if (!reply || 'forum_topic_created' in reply) return null;
    return reply as Message;
  }
}

export const aiCommand = new AiCommand();
