import { LOGIN_CODE_TTL_SECONDS } from 'src/auth/login-codes';
import { config } from 'src/config/configuration';
import logger from 'src/shared/logger';
import { telegram } from 'src/shared/telegram';

/** The DM with the one-time login link. */
export function loginMessage(link: string): { text: string; buttons: boolean } {
  const minutes = Math.round(LOGIN_CODE_TTL_SECONDS / 60);
  const https = link.startsWith('https://');
  const text =
    '🔐 <b>Sign in to the TaskBot admin app</b>\n\n' +
    `Tap <b>Open admin</b> to sign in. The link works once and expires in ${minutes} minutes.` +
    (https ? '' : `\n\n${link}`) +
    "\n\nIf you didn't ask for this, ignore it — nobody can sign in without this link.";
  return { text, buttons: https };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Oct 2026, 10:20 UTC" */
export function utcTime(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** The Telegram notice the owner gets on every successful sign-in, so a sign-in they didn't make stands out. */
export function signInNotice(browser: string, ip: string | null, at: Date): string {
  return (
    `🔐 <b>New sign-in to TaskBot admin:</b> ${escapeHtml(browser)} · ${escapeHtml(ip ?? 'unknown address')} · ${utcTime(at)}.\n\n` +
    'Not you? Open admin → Log out everywhere.'
  );
}

/** DMs the owner about a successful sign-in. Never fails the sign-in. */
export async function sendSignInNotice(browser: string, ip: string | null): Promise<void> {
  const https = config.publicUrl.startsWith('https://');
  const notice = await telegram.sendMessage(
    config.ownerTelegramId,
    signInNotice(browser, ip, new Date()),
    https ? { inline_keyboard: [[{ text: 'Open admin', url: config.publicUrl }]] } : undefined,
  );
  if (!notice.ok) logger.warn(`Couldn't send the sign-in notice: ${notice.error}`);
}
