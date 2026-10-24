import { bot } from 'src/bot';
import { ITask } from 'src/database/models/task.model';
import { groupService } from 'src/database/services/group.service';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { Message } from 'telegraf/types';

export type SendExtra = NonNullable<Parameters<typeof bot.telegram.sendMessage>[2]>;

/**
 * Posts an app/web event to the task's group: through the group messenger (forums: the
 * "Task events" topic, else General — there's no command topic to fall back to). Falls back
 * to a plain message in the card's chat if the group can't be loaded. Throws if nothing can be sent.
 */
export async function postTaskEvent(
  groupId: ITask['groupId'] | undefined,
  cardChatId: number | undefined,
  text: string,
  extra: SendExtra,
): Promise<Message.TextMessage> {
  const group = groupId ? await groupService.findGroupById(groupId) : null;
  if (group && (!cardChatId || group.telegramGroupId === cardChatId)) {
    return groupMessengerService.sendEvent(bot.telegram, group, text, { extra });
  }
  const chatId = cardChatId ?? group?.telegramGroupId;
  if (!chatId) throw new Error('No chat to post the task event in');
  return bot.telegram.sendMessage(chatId, text, extra);
}
