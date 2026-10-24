import { GroupStatus, OwnerApprovalInfo } from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { IGroup } from 'src/database/models/group.model';
import { adminLink } from 'src/shared/utils/app-links';
import type { Chat, InlineKeyboardMarkup } from 'telegraf/types';

/** Owner DM buttons: `gapp:ok:<groupId>` / `gapp:no:<groupId>` (30 bytes, well under Telegram's 64). */
export const GROUP_APPROVAL_PREFIX = 'gapp:';
export const APPROVE_DATA = `${GROUP_APPROVAL_PREFIX}ok:`;
export const REJECT_DATA = `${GROUP_APPROVAL_PREFIX}no:`;
/** `gapp:nr:<groupId>:<reason key>` — the reject step's reason buttons (key `-` = no reason). */
export const REJECT_WITH_REASON_DATA = `${GROUP_APPROVAL_PREFIX}nr:`;
/** `gapp:bk:<groupId>` — back from the reason step to Approve / Reject. */
export const BACK_DATA = `${GROUP_APPROVAL_PREFIX}bk:`;

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
