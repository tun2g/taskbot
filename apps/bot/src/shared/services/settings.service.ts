import { AI_DEFAULT_ALERT_AT_PERCENT } from '@tbot/shared';
import mongoose from 'mongoose';
import { configService } from 'src/configs/configuration';
import {
  AiSettings,
  BotRuntimeInfo,
  Setting,
  SETTING_KEYS,
  SETTINGS_CACHE_SECONDS,
} from 'src/database/models/setting.model';
import logger from 'src/shared/logger/logger';

/** What the bot uses when the owner never saved AI settings (env vars / built-ins apply). */
export const DEFAULT_AI_SETTINGS: AiSettings = {
  dailyCallLimit: null,
  dailyBudgetUsd: null,
  alertAtPercent: AI_DEFAULT_ALERT_AT_PERCENT,
  userDailyLimit: null,
  pricing: {},
};

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** Tolerant read of the stored document (the admin app validates on write; this never throws). */
export function normalizeAiSettings(value: unknown): AiSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof AiSettings, unknown>>;
  const pricing: AiSettings['pricing'] = {};
  if (v.pricing && typeof v.pricing === 'object') {
    for (const [model, price] of Object.entries(v.pricing as Record<string, unknown>)) {
      const p = (price ?? {}) as { input?: unknown; cachedInput?: unknown; output?: unknown };
      const input = num(p.input);
      const output = num(p.output);
      if (input === null || output === null) continue;
      const cachedInput = num(p.cachedInput);
      pricing[model] = cachedInput === null ? { input, output } : { input, cachedInput, output };
    }
  }
  const alert = num(v.alertAtPercent);
  return {
    dailyCallLimit: num(v.dailyCallLimit),
    dailyBudgetUsd: num(v.dailyBudgetUsd),
    alertAtPercent: alert && alert > 0 ? alert : AI_DEFAULT_ALERT_AT_PERCENT,
    userDailyLimit: num(v.userDailyLimit),
    pricing,
  };
}

/** What this bot process runs with, as the admin app shows it (provider, model, env daily limit, start time). */
export function runtimeInfo(startedAt = new Date()): BotRuntimeInfo {
  return {
    provider: configService.ai.provider,
    model: configService.ai.model,
    envDailyCallLimit: configService.ai.dailyLimit,
    startedAt: startedAt.toISOString(),
  };
}

/**
 * Publishes runtimeInfo() to the settings collection (key `runtime`) on startup, so the admin API reads the bot's
 * effective env defaults instead of keeping its own copy of AI_PROVIDER / AI_MODEL / AI_DAILY_LIMIT. Never throws.
 */
export async function publishRuntimeInfo(startedAt = new Date()): Promise<void> {
  try {
    await Setting.updateOne(
      { key: SETTING_KEYS.RUNTIME },
      { $set: { value: runtimeInfo(startedAt) } },
      { upsert: true },
    );
  } catch (error) {
    logger.warn(`[Settings] Could not publish the bot's runtime info: ${error}`);
  }
}

/** Runtime settings from the admin app, cached for SETTINGS_CACHE_SECONDS so admin changes apply within it. */
class SettingsService {
  private ai: { value: AiSettings; at: number } | null = null;
  /** No DB connection (tests, startup) → defaults without waiting on Mongoose's command buffer. */
  dbReady = () => mongoose.connection.readyState === 1;

  async getAi(): Promise<AiSettings> {
    const now = Date.now();
    if (this.ai && now - this.ai.at < SETTINGS_CACHE_SECONDS * 1000) return this.ai.value;
    let value = this.ai?.value ?? DEFAULT_AI_SETTINGS;
    if (!this.dbReady()) return value;
    try {
      const doc = await Setting.findOne({ key: SETTING_KEYS.AI }).lean();
      value = normalizeAiSettings((doc as { value?: unknown } | null)?.value);
    } catch (error) {
      // Keep the last good value (or the defaults): a settings read must never break AI or the bot.
      logger.warn(`[Settings] Could not load AI settings: ${error}`);
    }
    this.ai = { value, at: now };
    return value;
  }

  /** Tests. */
  clearCache() {
    this.ai = null;
  }
}

export const settingsService = new SettingsService();
