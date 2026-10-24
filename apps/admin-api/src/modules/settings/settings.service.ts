import { AiSettings, SETTING_KEYS, SETTINGS_CACHE_SECONDS } from '@tbot/db';
import type { AdminAiSettings } from '@tbot/shared';
import type { Request } from 'express';
import { BUILT_IN_AI_PRICING, BUILT_IN_USER_DAILY_LIMIT } from 'src/config/pricing';
import { findAiSettingsDoc, saveAiSettings } from 'src/modules/settings/settings.repository';
import { writeAudit } from 'src/shared/audit';
import { loadBotRuntime } from 'src/shared/runtime';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  dailyCallLimit: null,
  dailyBudgetUsd: null,
  alertAtPercent: 80,
  userDailyLimit: null,
  pricing: {},
};

/** Stored AI settings with defaults for anything unset. */
export async function loadAiSettings(): Promise<AiSettings> {
  return (await loadAiSettingsDoc()).settings;
}

/** The settings plus when the owner last saved them. */
async function loadAiSettingsDoc(): Promise<{ settings: AiSettings; updatedAt: Date | null }> {
  const doc = await findAiSettingsDoc();
  const v = (doc?.value ?? {}) as Partial<AiSettings>;
  return {
    updatedAt: doc?.updatedAt ?? null,
    settings: {
      dailyCallLimit: v.dailyCallLimit ?? DEFAULT_AI_SETTINGS.dailyCallLimit,
      dailyBudgetUsd: v.dailyBudgetUsd ?? DEFAULT_AI_SETTINGS.dailyBudgetUsd,
      alertAtPercent: v.alertAtPercent ?? DEFAULT_AI_SETTINGS.alertAtPercent,
      userDailyLimit: v.userDailyLimit ?? DEFAULT_AI_SETTINGS.userDailyLimit,
      pricing: v.pricing && typeof v.pricing === 'object' ? v.pricing : {},
    },
  };
}

/** The bot's env fallbacks come from what the bot reported on startup (see loadBotRuntime). */
async function withDefaults(s: AiSettings, lastChangedAt: Date | null): Promise<AdminAiSettings> {
  const bot = await loadBotRuntime();
  return {
    ...s,
    lastChangedAt: lastChangedAt ? new Date(lastChangedAt).toISOString() : null,
    defaults: {
      provider: bot?.provider || null,
      model: bot?.model || null,
      envDailyCallLimit: bot?.envDailyCallLimit ?? 0,
      userDailyLimit: BUILT_IN_USER_DAILY_LIMIT,
      builtInPricing: BUILT_IN_AI_PRICING,
    },
  };
}

export async function getAiSettings(): Promise<AdminAiSettings> {
  const { settings, updatedAt } = await loadAiSettingsDoc();
  return withDefaults(settings, updatedAt);
}

/** Replaces the AI settings (the bot picks them up within SETTINGS_CACHE_SECONDS) and records it in the audit log. */
export async function updateAiSettings(
  req: Request,
  input: AiSettings,
  restoredFrom: string | undefined,
): Promise<AdminAiSettings & { appliesWithinSeconds: number }> {
  const before = await loadAiSettings();
  const next: AiSettings = {
    dailyCallLimit: input.dailyCallLimit,
    dailyBudgetUsd: input.dailyBudgetUsd,
    alertAtPercent: input.alertAtPercent,
    userDailyLimit: input.userDailyLimit,
    pricing: input.pricing,
  };
  await saveAiSettings(next);
  await writeAudit(req, {
    action: restoredFrom ? 'settings.ai.restore' : 'settings.ai.update',
    targetType: 'settings',
    targetId: SETTING_KEYS.AI,
    targetLabel: 'AI settings',
    details: { before, after: next, ...(restoredFrom ? { restoredFrom } : {}) },
  });
  return { ...(await withDefaults(next, new Date())), appliesWithinSeconds: SETTINGS_CACHE_SECONDS };
}
