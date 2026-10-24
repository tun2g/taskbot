/** AI settings as saved by the owner (mutated by PUT /settings/ai). */
import type { AdminAiSettings } from '@tbot/shared';

import { DAY, iso } from './clock';

/** USD per 1M tokens. */
export const builtInPricing: AdminAiSettings['defaults']['builtInPricing'] = {
  'gemini-2.5-flash': { input: 0.3, cachedInput: 0.075, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, cachedInput: 0.025, output: 0.4 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
};

export const settings: AdminAiSettings = {
  dailyCallLimit: 400,
  dailyBudgetUsd: 1.5,
  alertAtPercent: 80,
  userDailyLimit: 40,
  pricing: { 'gemini-2.5-flash': { input: 0.3, cachedInput: 0.03, output: 2.5 } },
  lastChangedAt: iso(6 * DAY),
  defaults: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    envDailyCallLimit: 0,
    userDailyLimit: 30,
    builtInPricing,
  },
};

export function priceOf(model: string) {
  return settings.pricing[model] ?? builtInPricing[model];
}
