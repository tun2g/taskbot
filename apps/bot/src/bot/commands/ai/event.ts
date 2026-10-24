import { BotContext } from 'src/bot/interface/context';
import { CommandMessage, sendAiReply } from 'src/bot/commands/ai/reply';
import { IEpic } from 'src/database/models/epic.model';
import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import type { AiOutcome } from 'src/shared/services/ai-command/telegram.renderer';
import { epicEventsService } from 'src/shared/services/epic-events.service';
import {
  groupMessengerService,
  isForumChat,
  topicOf,
  TOPIC_SETUP_HINT,
} from 'src/shared/services/group-messenger.service';
import { buildChangeLine, userDisplayName } from 'src/shared/services/task-event-lines';
import { buildAppLink } from 'src/shared/utils/app-links';

/**
 * The answer stays in place (it's a conversation). In a forum whose "Task events" topic is
 * elsewhere, changes are ALSO announced there in one line; in normal groups (and when the
 * events topic is this topic) the answer already is the event, so nothing is posted twice.
 */
export async function replyWithEvent(
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

  await sendAiReply(ctx, reply);

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
