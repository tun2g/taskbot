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

export const SETTING_KEYS = { AI: 'ai' } as const;
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
