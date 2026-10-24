import { GROUP_NOTICES, GroupStatus } from '@tbot/shared';
import { ApiToken } from 'src/database/models/api-token.model';
import { Epic } from 'src/database/models/epic.model';
import { GroupMember } from 'src/database/models/group-member.model';
import { Group, IGroup } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import logger from 'src/shared/logger/logger';
import type { Telegram } from 'telegraf';
import { post } from './helpers';

/**
 * The new chat's empty, auto-created doc: move what little it has (members, tokens) into the old doc and drop it.
 * Also cleans up its approval card and, when the group was approved all along, says so in the new chat.
 */
async function mergeEmptyDoc(telegram: Telegram, oldDoc: IGroup, newDoc: IGroup, newChatId: number): Promise<void> {
  const members = await GroupMember.find({ groupId: newDoc._id });
  for (const m of members) {
    await GroupMember.updateOne(
      { groupId: oldDoc._id, userId: m.userId },
      { $setOnInsert: { groupId: oldDoc._id, userId: m.userId, telegramUserId: m.telegramUserId, joinedAt: m.joinedAt ?? new Date() } },
      { upsert: true },
    );
  }
  await GroupMember.deleteMany({ groupId: newDoc._id });
  await ApiToken.updateMany({ groupId: newDoc._id }, { $set: { groupId: oldDoc._id } });
  await Group.deleteOne({ _id: newDoc._id });
  // Its approval card (if one went out) now points at nothing.
  if (newDoc.approvalMessage) {
    await telegram.deleteMessage(newDoc.approvalMessage.chatId, newDoc.approvalMessage.messageId).catch(() => undefined);
  }
  // Its "waiting for approval" note went out in the new chat, but the group was approved all along.
  if (newDoc.status === GroupStatus.PENDING && newDoc.addedAt && oldDoc.status === GroupStatus.ACTIVE) {
    await post(telegram, newChatId, GROUP_NOTICES.migratedStillActive);
  }
}

/**
 * Telegram upgraded a basic group to a supergroup (new chat id). The group doc moves to the new id so its tasks
 * follow. If the new chat already got its own (empty) doc — an update arrived there first — that doc is merged in
 * and dropped. Idempotent: both the old chat's `migrate_to_chat_id` and the new chat's `migrate_from_chat_id` call it.
 */
export async function migrateChat(telegram: Telegram, oldChatId: number, newChatId: number, isForum = false): Promise<void> {
  const oldDoc = await Group.findOne({ telegramGroupId: oldChatId });
  if (!oldDoc || oldDoc.status === GroupStatus.MIGRATED) return;
  const newDoc = await Group.findOne({ telegramGroupId: newChatId });

  if (newDoc) {
    const [tasks, epics] = await Promise.all([
      Task.countDocuments({ groupId: newDoc._id }),
      Epic.countDocuments({ groupId: newDoc._id }),
    ]);
    if (tasks + epics > 0) {
      // Both chats have content (shouldn't happen: the new doc can't be used while pending). Keep both, never
      // drop data; the old doc points at the new chat so the admin app can tell.
      await Group.updateOne(
        { _id: oldDoc._id },
        { $set: { status: GroupStatus.MIGRATED, migratedToChatId: newChatId, statusChangedAt: new Date() } },
      );
      logger.warn(`[GroupLifecycle] ${oldChatId} → ${newChatId}: both groups have tasks; kept both, old one marked migrated`);
      return;
    }
    // Empty doc auto-created for the new chat: move what little it has (members, tokens) and drop it.
    await mergeEmptyDoc(telegram, oldDoc, newDoc, newChatId);
  }

  await Group.updateOne(
    { _id: oldDoc._id },
    { $set: { telegramGroupId: newChatId, isForum, migratedToChatId: null, lastActivityAt: new Date() } },
  );
  // Cards posted in the old chat can't be edited from the new one; forget them so the next change posts a fresh card.
  await Task.updateMany(
    { groupId: oldDoc._id, taskCardChatId: oldChatId },
    { $set: { taskCardChatId: null, taskCardMessageId: null } },
  );
  logger.info(`[GroupLifecycle] Moved group "${oldDoc.groupName}" from ${oldChatId} to supergroup ${newChatId}`);
}
