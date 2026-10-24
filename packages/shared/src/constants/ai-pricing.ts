/** USD per 1M tokens. `cachedInput` = price of input tokens served from the provider's cache (defaults to `input`). */
export interface AiModelPrice {
  input: number;
  cachedInput?: number;
  output: number;
}

/**
 * Built-in price table used to estimate AI cost (USD per 1M tokens), by model id.
 *
 * PLACEHOLDER PRICES — verify each one against the provider's pricing page before trusting the totals.
 * The bot owner can override or add models in the admin app (Settings → AI → pricing); those entries win.
 * A model with no entry here or in the overrides is recorded with cost 0 and `priced: false` ("unknown").
 * Thinking / reasoning tokens are billed as output.
 */
export const AI_BUILT_IN_PRICING: Record<string, AiModelPrice> = {
  // Google Gemini — verify against the provider's pricing page
  'gemini-3.5-flash-lite': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gemini-3.5-flash': { input: 0.3, cachedInput: 0.075, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, cachedInput: 0.075, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, cachedInput: 0.31, output: 10 },
  // OpenAI — verify against the provider's pricing page
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-5': { input: 1.25, cachedInput: 0.125, output: 10 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
  // Anthropic models through OpenAI-compatible gateways (e.g. Fuse) — verify against the provider's pricing page
  'claude-haiku-4.5': { input: 1, cachedInput: 0.1, output: 5 },
  'claude-sonnet-4.5': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-opus-4.6': { input: 5, cachedInput: 0.5, output: 25 },
};

/** AI requests one person can make per day across all groups, unless the owner changes it in Settings. */
export const AI_DEFAULT_USER_DAILY_LIMIT = 100;

/** Default "DM me at …% of the daily budget" threshold. */
export const AI_DEFAULT_ALERT_AT_PERCENT = 80;

/** Without an owner-set group limit, a group may make this many AI requests per rolling window. */
export const AI_DEFAULT_GROUP_BURST = { limit: 20, windowMinutes: 10 } as const;

/**
 * Names of the bot's AI limiters (the `name` of a `rate_limited` usage event), so the admin app can say which
 * limit refused a request. Every limit is checked on each request; whichever runs out first refuses it.
 */
export const AI_LIMITER = {
  /** The person's daily limit (their override, else Settings, else AI_DEFAULT_USER_DAILY_LIMIT). */
  personDaily: 'ai_user_daily',
  /** Too many /ai requests in a row from one person in one chat. */
  personBurst: 'ai_command',
  /** The owner's daily limit for the group (replaces groupBurst when set). */
  groupDaily: 'ai_group_daily',
  /** The group's default AI_DEFAULT_GROUP_BURST window. */
  groupBurst: 'ai_task_extract',
  /** The bot-wide daily call cap (also recorded as an AI call with status "quota"). */
  botDaily: 'ai_daily_budget',
} as const;
