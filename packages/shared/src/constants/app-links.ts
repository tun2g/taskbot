/**
 * Links into the task board (Mini App), built the same way by every process that posts in Telegram
 * (the bot and the admin API), so an "Open board" button behaves identically wherever it was sent from.
 */
export interface AppLinkConfig {
  /** The bot's @username (without @), from getMe. */
  botUsername?: string | null;
  /** getMe's has_main_web_app: a Main Mini App is set up in BotFather, so t.me/<bot>?startapp works. */
  hasMainWebApp?: boolean;
  /** WEBAPP_URL — the browser version of the board. Only https is usable in Telegram buttons. */
  webappUrl?: string | null;
}

export const OPEN_BOARD_LABEL = '📋 Open board';

/** WEBAPP_URL without a trailing slash, only when it is https (Telegram rejects anything else). */
export function webappBase(url?: string | null): string | null {
  const value = url?.trim();
  if (!value || !value.startsWith('https://')) return null;
  return value.replace(/\/+$/, '');
}

/**
 * Link that opens the board (or one task) from anywhere in Telegram:
 * - with a Main Mini App: `https://t.me/<bot>?startapp=<groupId>[_<taskId>]` (opens the Mini App with context);
 * - else with an https WEBAPP_URL: `WEBAPP_URL/<groupId>/tasks[/<taskId>]`;
 * - else null (no usable link).
 */
export function appLink(config: AppLinkConfig, groupId: string, taskId?: string | null): string | null {
  if (config.botUsername && config.hasMainWebApp) {
    return `https://t.me/${config.botUsername}?startapp=${taskId ? `${groupId}_${taskId}` : groupId}`;
  }
  const base = webappBase(config.webappUrl);
  return base ? `${base}/${groupId}/tasks${taskId ? `/${taskId}` : ''}` : null;
}

/** "📋 Open board" url button (safe in groups), or null when no link is available. */
export function openBoardButton(config: AppLinkConfig, groupId: string): { text: string; url: string } | null {
  const url = appLink(config, groupId);
  return url ? { text: OPEN_BOARD_LABEL, url } : null;
}
