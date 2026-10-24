import { GROUP_NOTICES, GroupStatus, OwnerApprovalInfo, ownerApprovalText } from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { ApiToken } from 'src/database/models/api-token.model';
import { Epic } from 'src/database/models/epic.model';
import { GroupMember } from 'src/database/models/group-member.model';
import { Group, IGroup } from 'src/database/models/group.model';
import { Task } from 'src/database/models/task.model';
import logger from 'src/shared/logger/logger';
import { NoticeTarget, sendGroupNotice } from 'src/shared/services/group-messenger.service';
import { redisService } from 'src/shared/services/redis.service';
import { adminLink } from 'src/shared/utils/app-links';
import type { Telegram } from 'telegraf';
import type { Chat, InlineKeyboardMarkup, User as TelegramUser } from 'telegraf/types';

/** Owner DM buttons: `gapp:ok:<groupId>` / `gapp:no:<groupId>` (30 bytes, well under Telegram's 64). */
export const GROUP_APPROVAL_PREFIX = 'gapp:';
export const APPROVE_DATA = `${GROUP_APPROVAL_PREFIX}ok:`;
export const REJECT_DATA = `${GROUP_APPROVAL_PREFIX}no:`;
/** `gapp:nr:<groupId>:<reason key>` — the reject step's reason buttons (key `-` = no reason). */
export const REJECT_WITH_REASON_DATA = `${GROUP_APPROVAL_PREFIX}nr:`;
/** `gapp:bk:<groupId>` — back from the reason step to Approve / Reject. */
export const BACK_DATA = `${GROUP_APPROVAL_PREFIX}bk:`;

/** One approval request per chat per minute — my_chat_member and the first message can arrive together. */
const REQUEST_CLAIM_SECONDS = 60;

type GroupChat = Chat.GroupChat | Chat.SupergroupChat;

export type ApprovalChat = Pick<GroupChat, 'id' | 'title'> & { type?: GroupChat['type']; is_forum?: boolean; username?: string };

/**
 * A supergroup the bot has never seen may be a basic group Telegram just upgraded: its first updates can arrive
 * before the `migrate_from_chat_id` message that links it to the old (maybe approved) group. Its "waiting for
 * approval" note and owner card wait this long, so a migration merges the new chat first and nothing goes out.
 */
export const NEW_SUPERGROUP_ANNOUNCE_DELAY_MS = 5000;

/** False when there is no owner to ask (BOT_OWNER_TELEGRAM_ID unset): new groups are approved right away. */
export function approvalRequired(): boolean {
  return configService.botOwnerTelegramId !== null;
}

export function approvalKeyboard(groupId: unknown): InlineKeyboardMarkup {
  const admin = adminLink(`/groups/${groupId}`);
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `${APPROVE_DATA}${groupId}` },
        { text: '🚫 Reject', callback_data: `${REJECT_DATA}${groupId}` },
      ],
      ...(admin ? [[{ text: '🛠 Details in admin app', url: admin }]] : []),
    ],
  };
}

/** Reject asks why first: the reason is posted in the group before the bot leaves. */
export function rejectReasonKeyboard(groupId: unknown): InlineKeyboardMarkup {
  const reason = (key: string) => `${REJECT_WITH_REASON_DATA}${groupId}:${key}`;
  return {
    inline_keyboard: [
      [
        { text: '🔒 Private bot', callback_data: reason('private') },
        { text: '💬 Not a team chat', callback_data: reason('team') },
      ],
      [
        { text: '🚫 No reason', callback_data: reason('-') },
        { text: '← Back', callback_data: `${BACK_DATA}${groupId}` },
      ],
    ],
  };
}

const day = (date?: Date | null) => (date ? new Date(date).toISOString().slice(0, 10) : 'an earlier date');

/** Earlier decisions worth knowing before approving again, e.g. "Rejected on 2026-10-20: spam". */
export function approvalHistory(group: IGroup | null): string | null {
  if (!group) return null;
  if (group.status === GroupStatus.REJECTED) {
    return `Rejected on ${day(group.statusChangedAt)}${group.statusReason?.trim() ? `: ${group.statusReason.trim()}` : ''}`;
  }
  if (group.status === GroupStatus.LEFT && group.statusBeforeLeft === GroupStatus.PENDING) {
    return `Added on ${day(group.addedAt)}, removed on ${day(group.botLeftAt)} before you decided`;
  }
  return null;
}

/** The owner card's facts about a group. `chat` adds the public link when the group has one. */
export function approvalInfo(group: IGroup, extra: { history?: string | null; username?: string } = {}): OwnerApprovalInfo {
  const by = group.addedBy;
  return {
    groupName: group.groupName,
    addedBy: by ? (by.username ? `@${by.username}` : by.name) : null,
    memberCount: group.memberCount ?? null,
    isForum: Boolean(group.isForum),
    link: extra.username ? `https://t.me/${extra.username}` : null,
    history: extra.history ?? null,
  };
}

function personName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id);
}

/** Where a group goes when the bot is added (again). Pure, so the rules are easy to read and test. */
export function statusOnAdd(existing: Pick<IGroup, 'status' | 'statusBeforeLeft'> | null, autoApprove: boolean): GroupStatus {
  const fresh = autoApprove ? GroupStatus.ACTIVE : GroupStatus.PENDING;
  if (!existing) return fresh;
  switch (existing.status) {
    case GroupStatus.LEFT:
      // Removing the bot doesn't undo an approval (or a suspension); anything else asks again.
      return existing.statusBeforeLeft === GroupStatus.ACTIVE || existing.statusBeforeLeft === GroupStatus.SUSPENDED
        ? existing.statusBeforeLeft
        : fresh;
    case GroupStatus.REJECTED:
      // A rejected group is asked about again — even without an owner id, a rejection is never auto-overridden.
      return GroupStatus.PENDING;
    case GroupStatus.PENDING:
      return fresh;
    default:
      return existing.status;
  }
}

async function claim(key: string, seconds: number): Promise<boolean> {
  try {
    return (await redisService.set(key, '1', { NX: true, EX: seconds })) === 'OK';
  } catch (error) {
    logger.warn(`[GroupLifecycle] Redis claim ${key} failed: ${error}`);
    return true;
  }
}

async function memberCount(telegram: Telegram, chatId: number): Promise<number | null> {
  try {
    return await telegram.getChatMembersCount(chatId);
  } catch {
    return null;
  }
}

/** A group-wide notice (General in a forum); never throws. */
async function post(telegram: Telegram, target: number | NoticeTarget, text: string): Promise<void> {
  const group = typeof target === 'number' ? { telegramGroupId: target } : target;
  try {
    await sendGroupNotice(telegram, group, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  } catch (error) {
    logger.warn(`[GroupLifecycle] Could not post in ${group.telegramGroupId}: ${error}`);
  }
}

export class GroupLifecycleService {
  /**
   * The bot was added to a chat (my_chat_member), or a chat it never saw sent an update (the add was missed).
   * Creates/updates the group, applies the re-add rules and — for a fresh request — posts the pending note once
   * and DMs the owner an Approve / Reject card. `addedBy` is who added the bot, when known.
   */
  async onBotAdded(telegram: Telegram, chat: ApprovalChat, addedBy: TelegramUser | null, botName: string): Promise<IGroup | null> {
    const existing = await Group.findOne({ telegramGroupId: chat.id });
    if (existing?.status === GroupStatus.MIGRATED) return existing;

    const autoApprove = !approvalRequired();
    const target = statusOnAdd(existing, autoApprove);
    const changed = existing?.status !== target;
    const history = approvalHistory(existing);
    const now = new Date();
    // Never-announced supergroup (see NEW_SUPERGROUP_ANNOUNCE_DELAY_MS): addedAt stays empty until the announcement
    // goes out, which also keeps the group gate quiet meanwhile and lets a missed announcement be retried.
    const deferAnnounce =
      chat.type === 'supergroup' &&
      target === GroupStatus.PENDING &&
      (!existing || (existing.status === GroupStatus.PENDING && !existing.addedAt));

    const set: Record<string, unknown> = {
      groupName: chat.title || existing?.groupName || 'Group',
      isForum: Boolean(chat.is_forum),
      status: target,
      ...(deferAnnounce ? {} : { addedAt: now }),
      botLeftAt: null,
      statusBeforeLeft: null,
      memberCount: (await memberCount(telegram, chat.id)) ?? existing?.memberCount ?? null,
    };
    if (addedBy && !addedBy.is_bot) {
      set.addedBy = { telegramUserId: addedBy.id, name: personName(addedBy), username: addedBy.username ?? null };
    }
    if (changed) {
      set.statusChangedAt = now;
      // The old reason belongs to the old decision; a restored suspension keeps its reason.
      if (target !== GroupStatus.SUSPENDED) set.statusReason = null;
      if (target === GroupStatus.ACTIVE && existing?.status !== GroupStatus.LEFT) set.approvedAt = now;
    }

    const group = await Group.findOneAndUpdate(
      { telegramGroupId: chat.id },
      { $set: set, $setOnInsert: { telegramGroupId: chat.id, timezone: configService.timezone || 'UTC' } },
      { upsert: true, new: true, runValidators: true },
    );
    if (!group) return null;

    const restoredFrom = existing?.status === GroupStatus.LEFT && changed ? existing.statusBeforeLeft : null;
    logger.info(`[GroupLifecycle] Bot added to ${chat.id} "${group.groupName}": ${existing?.status ?? 'new'} → ${target}`);

    if (deferAnnounce) {
      // One timer per chat, however many updates arrive in the meantime.
      if (await claim(`group:request-deferred:${chat.id}`, REQUEST_CLAIM_SECONDS)) {
        this.schedule(
          () => this.announceDeferred(telegram, chat, botName, history),
          NEW_SUPERGROUP_ANNOUNCE_DELAY_MS,
        );
      }
    } else if (target === GroupStatus.PENDING) {
      // A PENDING group seen again (duplicate add event) is only re-announced if it was never announced.
      const fresh = changed || !existing?.addedAt;
      if (fresh && (await claim(`group:request:${chat.id}`, REQUEST_CLAIM_SECONDS))) {
        await post(telegram, chat.id, GROUP_NOTICES.pending(botName));
        await this.sendOwnerCard(telegram, group, { history, username: chat.username });
      }
    } else if (restoredFrom === GroupStatus.ACTIVE) {
      await post(telegram, group, GROUP_NOTICES.unsuspended);
    } else if (restoredFrom === GroupStatus.SUSPENDED) {
      await post(telegram, group, GROUP_NOTICES.suspended(group.statusReason, configService.ownerContact || null));
    }
    return group;
  }

  /** Runs `fn` after `ms` (replaced in tests). Errors are logged, never thrown. */
  schedule = (fn: () => Promise<void>, ms: number): void => {
    setTimeout(() => {
      fn().catch((error) => logger.error(`[GroupLifecycle] Deferred announcement failed: ${error}`));
    }, ms).unref?.();
  };

  /**
   * The deferred "waiting for approval" note + owner card of a new supergroup. Skipped when, meanwhile, the chat
   * turned out to be an upgraded group (its doc was merged away), was decided, or was announced by another path.
   */
  async announceDeferred(telegram: Telegram, chat: ApprovalChat, botName: string, history: string | null): Promise<void> {
    const group = await Group.findOneAndUpdate(
      { telegramGroupId: chat.id, status: GroupStatus.PENDING, addedAt: null },
      { $set: { addedAt: new Date() } },
      { new: true },
    );
    if (!group) {
      logger.info(`[GroupLifecycle] ${chat.id}: no announcement needed any more (migrated, decided or announced)`);
      return;
    }
    if (!(await claim(`group:request:${chat.id}`, REQUEST_CLAIM_SECONDS))) return;
    await post(telegram, group, GROUP_NOTICES.pending(botName));
    await this.sendOwnerCard(telegram, group, { history, username: chat.username });
  }

  /** DMs the owner the Approve / Reject card and remembers it so it can be edited after the decision. */
  async sendOwnerCard(telegram: Telegram, group: IGroup, extra: { history?: string | null; username?: string } = {}): Promise<void> {
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
  async closeOwnerCard(telegram: Telegram, group: IGroup, by: 'telegram' | 'admin'): Promise<void> {
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

  /**
   * The bot left or was removed. Active / pending / suspended groups become LEFT (remembering the status, so adding
   * the bot back restores it). Rejected / migrated groups keep their status — that decision stays visible.
   */
  async onBotRemoved(telegram: Telegram, chatId: number): Promise<void> {
    const group = await Group.findOne({ telegramGroupId: chatId });
    if (!group) return;
    const now = new Date();
    const leavable = [GroupStatus.ACTIVE, GroupStatus.PENDING, GroupStatus.SUSPENDED].includes(group.status);
    const updated = await Group.findOneAndUpdate(
      { _id: group._id },
      {
        $set: leavable
          ? { status: GroupStatus.LEFT, statusBeforeLeft: group.status, statusChangedAt: now, botLeftAt: now }
          : { botLeftAt: now },
      },
      { new: true },
    );
    logger.info(`[GroupLifecycle] Bot removed from ${chatId} "${group.groupName}" (was ${group.status})`);
    // A request nobody answered yet: show the owner it's moot instead of leaving live buttons.
    if (updated && group.status === GroupStatus.PENDING) await this.closeOwnerCard(telegram, updated, 'telegram');
  }

  /**
   * Telegram upgraded a basic group to a supergroup (new chat id). The group doc moves to the new id so its tasks
   * follow. If the new chat already got its own (empty) doc — an update arrived there first — that doc is merged in
   * and dropped. Idempotent: both the old chat's `migrate_to_chat_id` and the new chat's `migrate_from_chat_id` call it.
   */
  async migrateChat(telegram: Telegram, oldChatId: number, newChatId: number, isForum = false): Promise<void> {
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
}

export const groupLifecycleService = new GroupLifecycleService();
