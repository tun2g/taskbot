import * as dotenv from 'dotenv';

dotenv.config();

class ConfigService {
  botToken = process.env.BOT_TOKEN!;
  botUsername: string | undefined = process.env.BOT_USERNAME;
  botHasMainWebApp = false;
  nodeEnv = process.env.NODE_ENV!;
  telegramApiUrl = process.env.TELEGRAM_API_URL!;
  webappUrl = process.env.WEBAPP_URL;
  /** Optional secret for signing browser login tokens; falls back to a key derived from BOT_TOKEN. */
  webAuthSecret = process.env.WEB_AUTH_SECRET || '';
  database = {
    redis: {
      host: process.env.REDIS_HOST!,
      port: +process.env.REDIS_PORT!,
      database: process.env.REDIS_DATABASE!,
    },
    mongodb: {
      uri: process.env.MONGODB_URI!,
    },
  };
  ai = {
    provider: process.env.AI_PROVIDER || 'gemini',
    apiKey: process.env.AI_API_KEY || '',
    // Per-provider default when AI_MODEL is unset; cheap tiers are fast enough for task extraction and /ai
    model: process.env.AI_MODEL || ((process.env.AI_PROVIDER || '').toLowerCase() === 'openai' ? 'gpt-5-mini' : 'gemini-3.5-flash-lite'),
    // Base URL for the HTTP providers (openai, fuse) — any OpenAI-compatible endpoint works.
    // FUSE_API_URL is the legacy name; empty means the provider's own default.
    apiUrl: process.env.AI_API_URL || process.env.FUSE_API_URL || '',
    // Bot-wide cap on AI calls per day (a cost circuit breaker); 0 = no cap.
    dailyLimit: parseInt(process.env.AI_DAILY_LIMIT || '0', 10) || 0,
  };
  timezone = process.env.TIMEZONE || 'UTC';
  devMode = process.env.NODE_ENV === 'development';
  /** Public base URL of this server (Telegram webhook mode). */
  webhookUrl = process.env.WEBHOOK_URL || '';
  /** Full public URL of the MCP endpoint; overrides `<WEBHOOK_URL>/mcp`. */
  mcpPublicUrlOverride = process.env.MCP_PUBLIC_URL || '';

  /** Public MCP endpoint (MCP_PUBLIC_URL, else <WEBHOOK_URL>/mcp), or null when neither is set. */
  mcpPublicUrl(): string | null {
    if (this.mcpPublicUrlOverride) return this.mcpPublicUrlOverride.replace(/\/+$/, '');
    if (this.webhookUrl) return `${this.webhookUrl.replace(/\/+$/, '')}/mcp`;
    return null;
  }
}

export const configService = new ConfigService();
