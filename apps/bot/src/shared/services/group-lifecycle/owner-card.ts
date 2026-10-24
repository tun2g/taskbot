import { ownerApprovalText } from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { Group, IGroup } from 'src/database/models/group.model';
import logger from 'src/shared/logger/logger';
import type { Telegram } from 'telegraf';
import { approvalInfo, approvalKeyboard } from './approval';

/** DMs the owner the Approve / Reject card and remembers it so it can be edited after the decision. */
export async function sendOwnerCard(
  telegram: Telegram,
  group: IGroup,
  extra: { history?: string | null; username?: string } = {},
): Promise<void> {
  const ownerId = configService.botOwnerTelegramId;
  if (!ownerId) return;
  try {
    const sent = await telegram.sendMessage(ownerId, ownerApprovalText(approvalInfo(group, extra)), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: approvalKeyboard(group._id),
    });
    await Group.updateOne({ _id: group._id }, { $set: { approvalMessage: { chatId: ownerId, messageId: sent.message_id } } });
  } catch (error) {
    // Usually: the owner never opened a private chat with the bot. The admin app still lists pending groups.
    logger.warn(
      `[GroupLifecycle] Could not DM the bot owner (${ownerId}) about "${group.groupName}" — open a private chat with the bot and tap Start. ${error}`,
    );
  }
}

/** Edits the owner's card to its final state (no buttons). Best effort: the card may be gone. */
export async function closeOwnerCard(telegram: Telegram, group: IGroup, by: 'telegram' | 'admin'): Promise<void> {
  const card = group.approvalMessage;
  if (!card) return;
  try {
    await telegram.editMessageText(card.chatId, card.messageId, undefined, ownerApprovalText(approvalInfo(group), { status: group.status, by, reason: group.statusReason }), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (!String(error).includes('message is not modified')) logger.warn(`[GroupLifecycle] Could not update the owner card: ${error}`);
  }
}
