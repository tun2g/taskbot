import { GroupStatus, ownerApprovalText } from '@tbot/shared';
import { LeanGroup } from 'src/modules/groups/groups.repository';
import { InlineKeyboard, telegram } from 'src/shared/telegram';

/**
 * Posts a group-wide notice where everyone sees it: the main chat (General in a forum — the bot's own approval /
 * pause notices go there too; the "Task events" topic is for task updates). If General is closed to the bot,
 * falls back to the group's events topic when it has one.
 */
export async function notify(
  g: LeanGroup,
  text: string,
  warnings: string[],
  what: string,
  replyMarkup?: InlineKeyboard,
) {
  let r = await telegram.sendMessage(g.telegramGroupId, text, replyMarkup);
  if (!r.ok && g.isForum && g.eventsTopicId && /TOPIC_CLOSED/i.test(r.error)) {
    r = await telegram.sendMessage(g.telegramGroupId, text, replyMarkup, g.eventsTopicId);
  }
  if (!r.ok) warnings.push(`Couldn't post the ${what} message in the group (${r.error}).`);
  return r.ok;
}

export async function leaveChat(chatId: number, warnings: string[]): Promise<boolean> {
  const r = await telegram.leaveChat(chatId);
  if (!r.ok)
    warnings.push(
      `Couldn't make the bot leave the chat (${r.error}). Remove it from the group in Telegram if it is still there.`,
    );
  return r.ok;
}

/** Rewrites the owner's DM approval card with the outcome and removes its buttons. */
export async function updateApprovalCard(g: LeanGroup, status: GroupStatus, reason: string | null, warnings: string[]) {
  if (!g.approvalMessage) return;
  const chat = await telegram.getChat(g.telegramGroupId);
  const link = chat.ok && chat.result.username ? `https://t.me/${chat.result.username}` : null;
  const addedBy = g.addedBy ? (g.addedBy.username ? `@${g.addedBy.username}` : g.addedBy.name) : null;
  const text = ownerApprovalText(
    { groupName: g.groupName, addedBy, memberCount: g.memberCount ?? null, isForum: !!g.isForum, link },
    { status, by: 'admin', reason },
  );
  const r = await telegram.editMessageText(g.approvalMessage.chatId, g.approvalMessage.messageId, text);
  if (!r.ok && !/not modified/i.test(r.error))
    warnings.push(`Couldn't update the approval message in your Telegram DM (${r.error}).`);
}
