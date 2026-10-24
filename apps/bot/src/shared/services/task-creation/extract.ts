import { AiFeature } from '@tbot/shared';
import { aiService } from 'src/shared/services/ai/ai.service';
import {
  aiDisabledBy,
  aiDisabledText,
  aiGroupLimitText,
  aiLimitText,
  aiTimezone,
  checkUserAiDailyLimit,
  withAiScope,
} from 'src/shared/services/ai-quota';
import { checkGroupAiRateLimit } from 'src/shared/services/task-creation/rate-limit';
import { CreateTasksCoreInput } from 'src/shared/services/task-creation/types';
import {
  buildFallbackTask,
  ExtractionInput,
  ExtractionResult,
  taskExtractionService,
} from 'src/shared/services/task-extraction.service';

/** The extraction to save, or why nothing is saved (multiMessage only). */
export type ExtractionStep =
  | { status: 'extracted'; result: ExtractionResult }
  | { status: 'rate_limited'; message: string }
  | { status: 'no_items' };

/**
 * AI extraction under the owner's switches and the AI limits, with a basic-task fallback. Pushes the
 * plain-text notes about a fallback onto `warnings`.
 */
export async function extractForRequest(
  input: CreateTasksCoreInput,
  extractionInput: ExtractionInput,
  chatId: number,
  warnings: string[],
): Promise<ExtractionStep> {
  const { requester, group, origin } = input;
  let result: ExtractionResult;
  // The owner turned AI off for this group / person: a basic task, no AI call, no AI limits counted.
  const disabledBy = aiService.isConfigured() ? aiDisabledBy(group, requester) : null;
  const userAllowed =
    !aiService.isConfigured() ||
    !!disabledBy ||
    input.userAiLimitChecked ||
    (await checkUserAiDailyLimit(requester.telegramUserId, requester)).allowed;
  const groupLimit = userAllowed && aiService.isConfigured() && !disabledBy ? await checkGroupAiRateLimit(chatId, group) : null;
  const allowed = userAllowed && (groupLimit?.allowed ?? true);
  if (disabledBy) {
    result = { tasks: [buildFallbackTask(extractionInput)], source: 'fallback' };
    warnings.push(`ℹ️ ${aiDisabledText(disabledBy, group, requester)} I made a basic task from the text instead.`);
  } else if (!allowed) {
    const why = userAllowed ? aiGroupLimitText(group, groupLimit) : aiLimitText('user', { scope: 'day', retryAfterSeconds: 0 }, aiTimezone(group));
    if (input.multiMessage) return { status: 'rate_limited', message: why };
    result = { tasks: [buildFallbackTask(extractionInput)], source: 'fallback' };
    warnings.push(`ℹ️ ${why} I made a basic task from the text instead.`);
  } else {
    const channel = input.activityVia === 'mcp' ? 'mcp' : origin === 'app' ? 'app' : 'telegram';
    result = await withAiScope(AiFeature.EXTRACT, { group, user: requester, channel }, () =>
      taskExtractionService.extract(extractionInput),
    );
    if (result.source === 'fallback') warnings.push(fallbackWarning(result, origin));
  }

  if (result.tasks.length === 0) {
    if (input.multiMessage) return { status: 'no_items' };
    result = { tasks: [buildFallbackTask(extractionInput)], source: 'fallback' };
    warnings.push('ℹ️ AI found no clear action item, so I made a basic task.');
  }
  return { status: 'extracted', result };
}

function fallbackWarning(result: ExtractionResult, origin: CreateTasksCoreInput['origin']): string {
  return result.fallbackReason === 'unconfigured'
    ? 'ℹ️ AI is off, so I made a basic task from the text.'
    : origin === 'app'
      ? '⚠️ AI was unavailable, so I made a basic task. You can edit it on the board.'
      : '⚠️ AI was unavailable, so I made a basic task. Use the buttons below to edit it.';
}
