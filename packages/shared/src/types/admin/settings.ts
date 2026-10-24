/** AI settings (limits, budget, pricing). */

/** GET/PUT /settings/ai */
export interface AdminAiSettings {
  dailyCallLimit: number | null;
  dailyBudgetUsd: number | null;
  alertAtPercent: number;
  userDailyLimit: number | null;
  pricing: Record<string, { input: number; cachedInput?: number; output: number }>;
  /** When the owner last saved these settings (null = never). */
  lastChangedAt?: string | null;
  /** Read-only context for the form. */
  defaults: {
    /** What the bot reported when it last started (null = the bot hasn't reported yet). */
    provider: string | null;
    model: string | null;
    /** The bot's AI_DAILY_LIMIT fallback (0 = none). */
    envDailyCallLimit: number;
    userDailyLimit: number;
    builtInPricing: Record<string, { input: number; cachedInput?: number; output: number }>;
  };
}
