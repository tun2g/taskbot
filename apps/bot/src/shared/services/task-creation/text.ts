import { TASK_TYPE_LABELS, TaskType } from '@tbot/shared';
import { IUser } from 'src/database/models/user.model';
import { buildMessageLink } from 'src/shared/services/group-messenger.service';

export const SUMMARY_TITLE_MAX = 60;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes text for Telegram's legacy `Markdown` parse mode (used by the task card). */
export function escapeLegacyMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, '\\$1');
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function typeEmoji(type: string): string {
  return (TASK_TYPE_LABELS[type as TaskType] ?? TASK_TYPE_LABELS[TaskType.TASK]).split(' ')[0];
}

export function userName(user: IUser | null | undefined): string {
  if (!user) return 'someone';
  return user.username ? `@${user.username}` : user.firstName || 'someone';
}

/** t.me/c link for supergroups, topic-aware (opens in the right forum topic); basic groups have none (''). */
export function messageLink(chatId: number, messageId: number, threadId?: number): string {
  return buildMessageLink(chatId, messageId, threadId) ?? '';
}
