import { configService } from 'src/configs/configuration';
import { buildMessageLink } from 'src/shared/services/group-messenger.service';
import { InlineKeyboardButton } from 'telegraf/types';

type IdLike = string | { toString(): string };

/**
 * Link that opens the board (or one task) from anywhere in Telegram.
 *
 * - With a Main Mini App configured in BotFather: `https://t.me/<bot>?startapp=<groupId>[_<taskId>]`
 *   (the only link that opens the Mini App with context from a group or a DM).
 * - Otherwise, when WEBAPP_URL is https: the browser version `WEBAPP_URL/<groupId>/tasks[/<taskId>]`.
 * - Otherwise null (no usable link).
 */
export function buildAppLink(groupId: IdLike, taskId?: IdLike | null): string | null {
  const gid = groupId.toString();
  const tid = taskId ? taskId.toString() : undefined;

  if (configService.botUsername && configService.botHasMainWebApp) {
    return `https://t.me/${configService.botUsername}?startapp=${tid ? `${gid}_${tid}` : gid}`;
  }

  const base = webappBaseUrl();
  if (base) {
    return `${base}/${gid}/tasks${tid ? `/${tid}` : ''}`;
  }

  return null;
}

/** A url button (safe in groups — never a web_app button) or null when no link is available. */
export function appLinkButton(text: string, groupId: IdLike, taskId?: IdLike | null): InlineKeyboardButton | null {
  const url = buildAppLink(groupId, taskId);
  return url ? { text, url } : null;
}

/** WEBAPP_URL without a trailing slash, only when it is https (Telegram rejects anything else). */
export function webappBaseUrl(): string | null {
  const url = configService.webappUrl;
  if (!url || !url.startsWith('https://')) return null;
  return url.replace(/\/+$/, '');
}

// ── Shared labels / helpers so every message opens tasks and the board the same way ──

export const OPEN_BOARD_LABEL = '📋 Open board';

/** "📱 Open #12" — says which task the button opens. */
export function openTaskLabel(taskNumber: number): string {
  return `📱 Open #${taskNumber}`;
}

/** "📋 Open board" url button, or null when no app link is configured. */
export function boardButton(groupId: IdLike): InlineKeyboardButton | null {
  return appLinkButton(OPEN_BOARD_LABEL, groupId);
}

interface TaskLinkTarget {
  _id: IdLike;
  taskNumber: number;
  groupId?: IdLike | null;
  taskCardChatId?: number | null;
  taskCardMessageId?: number | null;
}

/**
 * "📱 Open #N" into the app; when the app link isn't configured, "💬 View card" jumping to the task
 * card in the group (supergroups only). Null when neither is possible.
 */
export function taskButton(task: TaskLinkTarget): InlineKeyboardButton | null {
  if (task.groupId) {
    const open = appLinkButton(openTaskLabel(task.taskNumber), task.groupId, task._id);
    if (open) return open;
  }
  if (task.taskCardChatId && task.taskCardMessageId) {
    const url = buildMessageLink(task.taskCardChatId, task.taskCardMessageId);
    if (url) return { text: '💬 View card', url };
  }
  return null;
}

/** HTML `#N` that opens the task when a link exists (`<b>` kept), plain bold `#N` otherwise. */
export function taskNumberHtml(taskNumber: number, groupId?: IdLike | null, taskId?: IdLike | null): string {
  const num = `<b>#${taskNumber}</b>`;
  const url = groupId && taskId ? buildAppLink(groupId, taskId) : null;
  return url ? `<a href="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${num}</a>` : num;
}

/** Legacy-Markdown `#N` link (`[#12](url)`), or `*#12*` without a link. URLs here never contain `)`. */
export function taskNumberMarkdown(taskNumber: number, groupId?: IdLike | null, taskId?: IdLike | null): string {
  const url = groupId && taskId ? buildAppLink(groupId, taskId) : null;
  return url ? `[#${taskNumber}](${url})` : `*#${taskNumber}*`;
}

// ── AI tools (MCP) tokens page ──

export const TOKENS_PAGE_PATH = '/settings/tokens';
export const MANAGE_TOKENS_LABEL = '🔑 Manage tokens';

/** The Mini App page where people list / create / revoke MCP tokens, or null without an https WEBAPP_URL. */
export function tokensPageUrl(): string | null {
  const base = webappBaseUrl();
  return base ? `${base}${TOKENS_PAGE_PATH}` : null;
}

/**
 * "🔑 Manage tokens": a web_app button in private chats (opens the Mini App signed in), a url button elsewhere
 * (web_app buttons aren't allowed in groups). Null when no app URL is configured.
 */
export function manageTokensButton(privateChat: boolean): InlineKeyboardButton | null {
  const url = tokensPageUrl();
  if (!url) return null;
  return privateChat ? { text: MANAGE_TOKENS_LABEL, web_app: { url } } : { text: MANAGE_TOKENS_LABEL, url };
}

/** Deep link that opens a private chat with the bot and sends `/start <payload>`. */
export function botStartLink(payload?: string): string | null {
  if (!configService.botUsername) return null;
  return `https://t.me/${configService.botUsername}${payload ? `?start=${payload}` : ''}`;
}
