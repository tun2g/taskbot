import { replyWithEvent } from 'src/bot/commands/ai/event';
import { passAiGates } from 'src/bot/commands/ai/gates';
import {
  AI_PRIVATE_MESSAGE,
  AI_USAGE_MESSAGE,
  UPDATE_USAGE_MESSAGE,
  UPDATE_WHICH_TASK_MESSAGE,
} from 'src/bot/commands/ai/messages';
import { CommandMessage, getReplyTarget, keepTyping, sendAiReply } from 'src/bot/commands/ai/reply';
import { sendUnavailable } from 'src/bot/commands/ai/unavailable';
import { BotContext } from 'src/bot/interface/context';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import {
  aiCommandService,
  buildAiContext,
  CardEditor,
  extractTaskNumbers,
} from 'src/shared/services/ai-command.service';
import { AIUnavailableError } from 'src/shared/services/ai/ai.service';
import { BufferedMessage, extractMentions, messageText, toBufferedMessage, displayNameOf } from 'src/shared/services/message-buffer.service';
import { createTasksFromInput } from 'src/shared/services/task-creation.service';

export {
  AI_PRIVATE_MESSAGE,
  AI_USAGE_MESSAGE,
  UPDATE_USAGE_MESSAGE,
  UPDATE_WHICH_TASK_MESSAGE,
} from 'src/bot/commands/ai/messages';

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
        await sendAiReply(ctx, { text: AI_PRIVATE_MESSAGE });
        return;
      }

      const request = (options.request ?? messageText(message).replace(/^\/(ai|update)(@\w+)?/i, '')).trim();
      if (!request) {
        await sendAiReply(ctx, { text: mode === 'update' ? UPDATE_USAGE_MESSAGE : AI_USAGE_MESSAGE });
        return;
      }

      stopTyping = keepTyping(ctx);

      const user = await userService.findOrCreateUser(ctx);
      if (!user) {
        await sendAiReply(ctx, { text: "❌ I couldn't identify you. Please try again in a moment." });
        return;
      }
      const group = await groupService.findOrCreateGroup(chat.id, 'title' in chat ? chat.title : 'Group');
      if (!group) {
        await sendAiReply(ctx, { text: "❌ I couldn't set up this group. Please try again in a moment." });
        return;
      }

      // ── Context ──
      const reply = getReplyTarget(message);
      const replyTask = reply ? await taskService.getTaskByCardMessage(chat.id, reply.message_id) : null;
      const replyText = reply && !replyTask ? messageText(reply as CommandMessage) : '';

      // /update never guesses: the task is the replied card or a number the user wrote
      if (mode === 'update' && !replyTask && extractTaskNumbers(request).length === 0) {
        await sendAiReply(ctx, { text: UPDATE_WHICH_TASK_MESSAGE });
        return;
      }

      if (!(await passAiGates(ctx, chat.id, mode, { request, user, group, replyTask }))) return;

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
        await sendUnavailable(ctx, mode, { request, user, group, replyTask }, context);
        return;
      }

      const outcome = await aiCommandService.execute(context, plan, ctx.telegram as unknown as CardEditor);
      stopTyping();

      if (outcome.kind === 'create' && mode === 'update') {
        await sendAiReply(ctx, { text: 'ℹ️ /update only changes existing tasks — use /new to create one.' });
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
        await createTasksFromInput(ctx, { messages, note, requester: user, group, userAiLimitChecked: true });
        return;
      }

      await replyWithEvent(ctx, group, user, message, outcome, context.createdEpics ?? []);
    } catch (error) {
      logger.error(`Error in /ai command: ${error instanceof Error ? error.stack : error}`);
      try {
        await sendAiReply(ctx, {
          text: '❌ Something went wrong. Check the task on the board or with /list, then try again.',
        });
      } catch (replyError) {
        logger.error(`Could not send /ai error reply: ${replyError}`);
      }
    } finally {
      stopTyping();
    }
  }
}

export const aiCommand = new AiCommand();
