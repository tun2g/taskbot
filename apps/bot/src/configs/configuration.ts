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
    // Gemini model id; the lite tier is cheapest and fast enough for task extraction and /ai
    model: process.env.AI_MODEL || 'gemini-3.5-flash-lite',
    fuseApiUrl: process.env.FUSE_API_URL || 'https://api.fuseapi.app/v1/chat/completions',
  };
  timezone = process.env.TIMEZONE || 'UTC';
  devMode = process.env.NODE_ENV === 'development';
}

export const configService = new ConfigService();
