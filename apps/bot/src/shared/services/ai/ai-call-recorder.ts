import { AiCallStatus, AiFeature } from '@tbot/shared';
import mongoose from 'mongoose';
import { AiCall } from 'src/database/models/ai-call.model';
import logger from 'src/shared/logger/logger';
import { computeCost, mergePricing } from 'src/shared/services/ai/ai-cost';
import { AiUsage, EMPTY_USAGE } from 'src/shared/services/ai/ai.interface';
import { settingsService } from 'src/shared/services/settings.service';
import { currentContext } from 'src/shared/services/telemetry/request-context';
import { telemetry } from 'src/shared/services/telemetry/usage-tracker';

export interface AiAttempt {
  provider: string;
  model: string;
  status: AiCallStatus;
  attempt: number;
  latencyMs: number;
  usage?: AiUsage | null;
  error?: string | null;
}

const validId = (id: string | null | undefined) => (id && mongoose.Types.ObjectId.isValid(id) ? id : null);

/**
 * The AiCall row for one provider attempt: feature / group / person / channel from the request context,
 * cost from the price table (+ the owner's overrides) in effect now.
 */
export async function buildAiCallRow(attempt: AiAttempt) {
  const ctx = currentContext();
  const usage = attempt.usage ?? EMPTY_USAGE;
  const settings = await settingsService.getAi();
  const { costUsd, priced } = computeCost(attempt.model, usage, mergePricing(settings.pricing));
  return {
    feature: ctx.feature ?? AiFeature.OTHER,
    provider: attempt.provider,
    aiModel: attempt.model,
    status: attempt.status,
    attempt: attempt.attempt,
    latencyMs: Math.max(0, Math.round(attempt.latencyMs)),
    inputTokens: usage.inputTokens,
    cachedTokens: usage.cachedTokens,
    outputTokens: usage.outputTokens,
    thinkingTokens: usage.thinkingTokens,
    costUsd,
    priced,
    groupId: validId(ctx.groupId),
    userId: validId(ctx.userId),
    channel: ctx.channel ?? null,
    error: attempt.error ? attempt.error.slice(0, 500) : null,
  };
}

/** Records one provider attempt (each retry is its own row). Fire-and-forget: never throws, never waits. */
export function recordAiCall(attempt: AiAttempt): void {
  if (!telemetry.enabled) return;
  // Built synchronously enough to capture the context before the caller moves on.
  void buildAiCallRow(attempt)
    .then((row) => AiCall.create(row))
    .catch((error) => logger.warn(`[AiCall] Could not record an AI call: ${error}`));
}
