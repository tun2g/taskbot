import * as dotenv from 'dotenv';

dotenv.config({ quiet: true });

const env = (name: string) => (process.env[name] ?? '').trim();

/**
 * Admin API settings. Values are read from the environment on access (not cached), so a restart with a
 * different BOT_OWNER_TELEGRAM_ID immediately invalidates sessions created for the previous owner.
 */
export const config = {
  get nodeEnv() {
    return env('NODE_ENV') || 'production';
  },
  get devMode() {
    return env('NODE_ENV') === 'development';
  },
  get port() {
    return parseInt(env('ADMIN_API_PORT') || '3001', 10);
  },
  get botToken() {
    return env('BOT_TOKEN');
  },
  get telegramApiUrl() {
    return (env('TELEGRAM_API_URL') || 'https://api.telegram.org').replace(/\/+$/, '');
  },
  /** The only person allowed in. NaN when unset/invalid (validateConfig refuses to start then). */
  get ownerTelegramId() {
    const raw = env('BOT_OWNER_TELEGRAM_ID');
    return /^\d+$/.test(raw) ? Number(raw) : NaN;
  },
  /**
   * The task board's https URL (same WEBAPP_URL as the bot). Optional: used for the "Open board" button on the
   * approval message when the bot has no Main Mini App in BotFather (then the t.me/<bot>?startapp link is used).
   */
  get webappUrl() {
    return env('WEBAPP_URL');
  },
  /** Optional (same as the bot): how groups can reach the bot owner, e.g. "@tun2g" — shown on reject / pause notices. */
  get ownerContact() {
    return env('OWNER_CONTACT');
  },
  get publicUrl() {
    return env('ADMIN_PUBLIC_URL').replace(/\/+$/, '');
  },
  get sessionSecret() {
    return env('ADMIN_SESSION_SECRET');
  },
  get mongoUri() {
    return env('MONGODB_URI');
  },
  get redis() {
    return {
      host: env('REDIS_HOST') || 'localhost',
      port: parseInt(env('REDIS_PORT') || '6379', 10),
      database: parseInt(env('REDIS_DATABASE') || '0', 10),
    };
  },
};

/** Problems that must stop the server from starting (empty = OK). */
export function validateConfig(): string[] {
  const problems: string[] = [];
  if (!config.botToken) problems.push('BOT_TOKEN is required (the admin API sends login links and group notices as the bot).');
  if (!Number.isFinite(config.ownerTelegramId) || config.ownerTelegramId <= 0) {
    problems.push('BOT_OWNER_TELEGRAM_ID is required: your numeric Telegram user id (the only person who can sign in).');
  }
  if (config.sessionSecret.length < 32) problems.push('ADMIN_SESSION_SECRET is required and must be at least 32 characters.');
  if (!config.publicUrl) problems.push('ADMIN_PUBLIC_URL is required (e.g. https://admin-taskbot.example.com) — login links point there.');
  else if (!/^https?:\/\//.test(config.publicUrl)) problems.push('ADMIN_PUBLIC_URL must start with https:// (or http:// in development).');
  if (!config.mongoUri) problems.push('MONGODB_URI is required.');
  return problems;
}
