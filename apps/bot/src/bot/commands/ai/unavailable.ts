import { BotContext } from 'src/bot/interface/context';
import { sendAiReply } from 'src/bot/commands/ai/reply';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import {
  AI_UNAVAILABLE_MESSAGE,
  aiCommandService,
  AiRequestContext,
  buildAiContext,
  EXPLAIN_WORDING,
} from 'src/shared/services/ai-command.service';

export type UnavailableInput = { request: string; user: IUser; group: IGroup; replyTask: ITask | null };

/**
 * AI down: "giải thích #5" / "task này làm gì?" on a card still gets the task's own details (description
 * or source message + state); anything else gets the short "AI is unavailable" reply.
 */
export async function sendUnavailable(
  ctx: BotContext,
  mode: 'ai' | 'update',
  input: UnavailableInput,
  context?: AiRequestContext,
  text: string = AI_UNAVAILABLE_MESSAGE,
) {
  if (mode === 'ai' && EXPLAIN_WORDING.test(input.request)) {
    try {
      const c =
        context ??
        (await buildAiContext({ request: input.request, requester: input.user, group: input.group, replyTask: input.replyTask }));
      const fallback = aiCommandService.explainWithoutAi(c);
      if (fallback) {
        await sendAiReply(ctx, fallback);
        return;
      }
    } catch (error) {
      logger.warn(`/ai explain fallback failed: ${error}`);
    }
  }
  await sendAiReply(ctx, { text });
}
