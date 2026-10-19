import { configService } from 'src/configs/configuration';
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
