import { AiSettings, Setting, SETTING_KEYS, SETTINGS_CACHE_SECONDS } from '@tbot/db';
import type { AdminAiSettings } from '@tbot/shared';
import { Request, Response, Router } from 'express';
import { config } from 'src/config/configuration';
import { BUILT_IN_AI_PRICING, BUILT_IN_USER_DAILY_LIMIT } from 'src/config/pricing';
import { aiSettingsSchema } from 'src/routes/schemas';
import { writeAudit } from 'src/shared/audit';
import { asyncHandler, parseOr400 } from 'src/shared/http';

export const DEFAULT_AI_SETTINGS: AiSettings = {
  dailyCallLimit: null,
  dailyBudgetUsd: null,
  alertAtPercent: 80,
  userDailyLimit: null,
  pricing: {},
};

/** Stored AI settings with defaults for anything unset. */
export async function loadAiSettings(): Promise<AiSettings> {
  const doc = await Setting.findOne({ key: SETTING_KEYS.AI }).lean<{ value?: Partial<AiSettings> }>();
  const v = (doc?.value ?? {}) as Partial<AiSettings>;
  return {
    dailyCallLimit: v.dailyCallLimit ?? DEFAULT_AI_SETTINGS.dailyCallLimit,
    dailyBudgetUsd: v.dailyBudgetUsd ?? DEFAULT_AI_SETTINGS.dailyBudgetUsd,
    alertAtPercent: v.alertAtPercent ?? DEFAULT_AI_SETTINGS.alertAtPercent,
    userDailyLimit: v.userDailyLimit ?? DEFAULT_AI_SETTINGS.userDailyLimit,
    pricing: v.pricing && typeof v.pricing === 'object' ? v.pricing : {},
  };
}

function withDefaults(s: AiSettings): AdminAiSettings {
  const ai = config.ai;
  return {
    ...s,
    defaults: {
      provider: ai.provider,
      model: ai.model,
      envDailyCallLimit: ai.envDailyCallLimit,
      userDailyLimit: BUILT_IN_USER_DAILY_LIMIT,
      builtInPricing: BUILT_IN_AI_PRICING,
    },
  };
}

export const settingsRouter: Router = Router();

settingsRouter.get(
  '/ai',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ data: withDefaults(await loadAiSettings()) });
  }),
);

// PUT /settings/ai — replaces the AI settings (the bot picks them up within SETTINGS_CACHE_SECONDS).
settingsRouter.put(
  '/ai',
  asyncHandler(async (req: Request, res: Response) => {
    const input = parseOr400(aiSettingsSchema, req.body);
    const before = await loadAiSettings();
    const next: AiSettings = {
      dailyCallLimit: input.dailyCallLimit,
      dailyBudgetUsd: input.dailyBudgetUsd,
      alertAtPercent: input.alertAtPercent,
      userDailyLimit: input.userDailyLimit,
      pricing: input.pricing,
    };
    await Setting.updateOne({ key: SETTING_KEYS.AI }, { $set: { value: next } }, { upsert: true });
    await writeAudit(req, { action: 'settings.ai.update', targetType: 'settings', targetId: SETTING_KEYS.AI, targetLabel: 'AI settings', details: { before, after: next } });
    res.json({ data: { ...withDefaults(next), appliesWithinSeconds: SETTINGS_CACHE_SECONDS } });
  }),
);
