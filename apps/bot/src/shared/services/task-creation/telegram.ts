import { BotContext } from 'src/bot/interface/context';
import logger from 'src/shared/logger/logger';
import { isForumChat } from 'src/shared/services/group-messenger.service';
import { createTasks } from 'src/shared/services/task-creation/core';
import { replyCreated } from 'src/shared/services/task-creation/reply-created';
import { PROGRESS_DELAY_MS, ReplyProgress } from 'src/shared/services/task-creation/reply-progress';
import { CreateTasksInput } from 'src/shared/services/task-creation/types';

/**
 * Telegram /task and /ai: runs the core and posts exactly one reply in the chat — the task card for
 * 1 task, or a summary with ↩️ Undo for 2+ (progress message edited in place). Never throws.
 */
export async function createTasksFromInput(ctx: BotContext, input: CreateTasksInput): Promise<void> {
  const { messages } = input;
  const chatId = ctx.chat!.id;

  void Promise.resolve(ctx.sendChatAction?.('typing')).catch(() => undefined);
  // Forums: the result is an event for the "Task events" topic, so no progress message in the user's topic.
  const forum = isForumChat(ctx) || !!input.group.isForum;
  const progress = new ReplyProgress(
    ctx,
    messages.length === 1 ? '🤖 Reading the message…' : `🤖 Reading ${messages.length} messages…`,
    forum ? null : PROGRESS_DELAY_MS,
  );

  try {
    const result = await createTasks({ ...input, origin: 'telegram', chatId });
    switch (result.status) {
      case 'rate_limited':
        await progress.finish(`⏳ ${result.message} Or reply to a single message with /new to make one basic task now.`);
        return;
      case 'no_items':
        await progress.finish(
          `🤷 No action items in ${messages.length === 1 ? 'that message' : `those ${messages.length} messages`}. ` +
            'Reply to a specific message with /new to create one anyway.',
        );
        return;
      case 'save_failed':
        await progress.finish("❌ I couldn't save the task. Please try again in a moment.");
        return;
      default:
        await replyCreated(ctx, progress, input, result);
    }
  } catch (error) {
    logger.error(`Task creation pipeline failed: ${error instanceof Error ? error.stack : error}`);
    try {
      await progress.finish('❌ Something went wrong and no task was created. Please try again in a moment.');
    } catch (replyError) {
      logger.error(`Could not send task creation error reply: ${replyError}`);
    }
  }
}
