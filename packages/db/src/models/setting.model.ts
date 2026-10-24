import mongoose, { Document, Schema } from 'mongoose';

/** Runtime settings edited in the admin app (env vars are only the defaults). */
export interface AiSettings {
  /** Max AI calls per day for the whole bot; null = AI_DAILY_LIMIT env (0 = no cap). */
  dailyCallLimit: number | null;
  /** Daily spend the owner wants to stay under (USD); null = no budget. Used for alerts and the overview gauge. */
  dailyBudgetUsd: number | null;
  /** DM the owner when today's spend reaches this % of the budget. */
  alertAtPercent: number;
  /** Default AI requests per person per day (all groups); null = built-in default. */
  userDailyLimit: number | null;
  /** USD per 1M tokens, by model id; overrides the built-in price table. */
  pricing: Record<string, { input: number; cachedInput?: number; output: number }>;
}

/**
 * What the bot process runs with, published by the bot on every start (key `runtime`), so the admin API can show
 * the model and the env fallbacks without its own copy of the bot's env vars.
 */
export interface BotRuntimeInfo {
  /** AI_PROVIDER, e.g. "gemini". */
  provider: string;
  /** AI_MODEL (or the provider's default). */
  model: string;
  /** AI_DAILY_LIMIT: the bot-wide daily call cap used when Settings has none (0 = no cap). */
  envDailyCallLimit: number;
  /** When this bot process started (ISO). */
  startedAt: string;
}

export const SETTING_KEYS = { AI: 'ai', RUNTIME: 'runtime' } as const;
export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export interface ISetting extends Document {
  key: SettingKey;
  value: unknown;
  updatedAt: Date;
}

const SettingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: false, updatedAt: true }, collection: 'settings', minimize: false },
);

export const Setting = mongoose.model<ISetting>('Setting', SettingSchema);


/** The bot caches settings and AI overrides for this long, so admin changes apply within it. */
export const SETTINGS_CACHE_SECONDS = 30;
