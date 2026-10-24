/** Turns chat messages into tasks (AI with a deterministic fallback). Helpers live in ./task-extraction/. */
import logger from 'src/shared/logger/logger';
import { aiService, AIUnavailableError } from 'src/shared/services/ai/ai.service';
import { buildFallbackTask } from 'src/shared/services/task-extraction/fallback';
import { normalizeExtractedTasks } from 'src/shared/services/task-extraction/normalize';
import { buildExtractionPrompt } from 'src/shared/services/task-extraction/prompt';
import { extractionResponseSchema } from 'src/shared/services/task-extraction/schema';
import { EXTRACTION_SYSTEM_PROMPT } from 'src/shared/services/task-extraction/system-prompt';
import { ExtractionInput, ExtractionResult } from 'src/shared/services/task-extraction/types';
import { resolveMember } from 'src/shared/services/task-extraction/resolve-member';
import { detectLanguage } from 'src/shared/services/task-templates';

export { EXTRACTION_EPICS_MAX, MAX_EXTRACTED_TASKS } from 'src/shared/services/task-extraction/types';
export type {
  ExtractedTask,
  ExtractionEpic,
  ExtractionFallbackReason,
  ExtractionInput,
  ExtractionMember,
  ExtractionResult,
} from 'src/shared/services/task-extraction/types';
export { extractedTaskSchema, extractionResponseSchema } from 'src/shared/services/task-extraction/schema';
export { buildExtractionPrompt, dateInTimezone } from 'src/shared/services/task-extraction/prompt';
export { normalizeExtractedTasks, parseExtractionResponse } from 'src/shared/services/task-extraction/normalize';
export { buildFallbackTask } from 'src/shared/services/task-extraction/fallback';
export { resolveMember };

/** @deprecated alias of resolveMember */
export const resolveAssignee = resolveMember;

export class TaskExtractionService {
  /** Never throws for AI problems: falls back to one deterministic basic task. */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const request = { system: EXTRACTION_SYSTEM_PROMPT, user: buildExtractionPrompt(input), temperature: 0.2 };
    try {
      const data = await aiService.generateJson(request, extractionResponseSchema, { retries: 1 });
      const language = detectLanguage(input.messages.map((m) => m.text).join('\n'));
      return {
        tasks: normalizeExtractedTasks(data, input.messages.map((m) => m.messageId), language),
        source: 'ai',
      };
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      if (error.reason !== 'unconfigured') logger.warn(`Task extraction fell back to a basic task: ${error.message}`);
      return {
        tasks: [buildFallbackTask(input)],
        source: 'fallback',
        fallbackReason: error.reason === 'unconfigured' ? 'unconfigured' : 'failed',
      };
    }
  }
}

export const taskExtractionService = new TaskExtractionService();
