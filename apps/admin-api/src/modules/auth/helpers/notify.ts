/** The DM with the one-time login link (`ttlSeconds`: how long the link works). */
export function loginMessage(link: string, ttlSeconds: number): { text: string; buttons: boolean } {
  const minutes = Math.round(ttlSeconds / 60);
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
