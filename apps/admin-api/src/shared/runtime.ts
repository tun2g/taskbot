import { BotRuntimeInfo, Setting, SETTING_KEYS } from '@tbot/db';
import logger from 'src/shared/logger';

/**
 * What the bot runs with (AI provider / model / env daily limit) and when it started. The bot publishes this to
 * the settings collection on startup; the admin API never reads the bot's env vars itself. Null = the bot hasn't
 * reported yet (never started against this database, or an older bot version).
 */
export async function loadBotRuntime(): Promise<BotRuntimeInfo | null> {
  try {
    const doc = await Setting.findOne({ key: SETTING_KEYS.RUNTIME }).lean<{ value?: Partial<BotRuntimeInfo> } | null>();
    const v = doc?.value;
    if (!v || typeof v !== 'object') return null;
    return {
      provider: typeof v.provider === 'string' ? v.provider : '',
      model: typeof v.model === 'string' ? v.model : '',
      envDailyCallLimit: typeof v.envDailyCallLimit === 'number' && v.envDailyCallLimit > 0 ? v.envDailyCallLimit : 0,
      startedAt: typeof v.startedAt === 'string' ? v.startedAt : '',
    };
  } catch (err) {
    logger.warn(`Couldn't read the bot's runtime info: ${err}`);
    return null;
  }
}
