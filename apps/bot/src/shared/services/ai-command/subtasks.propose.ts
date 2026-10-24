import { AiFeature } from '@tbot/shared';
import { ITask } from 'src/database/models/task.model';
import logger from 'src/shared/logger/logger';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import {
  BREAKDOWN_MAX,
  BREAKDOWN_SYSTEM_PROMPT,
  breakdownSchema,
  buildBreakdownPrompt,
} from 'src/shared/services/ai-command/breakdown.prompt';
import { detectLang, epicOf, labelWord, typeText } from 'src/shared/services/ai-command/format';
import { SubtaskItem } from 'src/shared/services/ai-command/plan.schema';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import { withAiScope } from 'src/shared/services/ai-quota';

/** The AI's breakdown of `parent` (titles only); [] when it's too vague to split; null when the AI is unavailable. */
export async function proposeSubtasks(
  c: AiRequestContext,
  parent: ITask,
  existing: ITask[],
  count: number | null,
): Promise<SubtaskItem[] | null> {
  const user = buildBreakdownPrompt({
    request: c.request,
    lang: detectLang(c.request),
    task: {
      taskNumber: parent.taskNumber,
      title: parent.title,
      description: parent.description || null,
      type: labelWord(typeText(parent.type)),
      epic: epicOf(parent.epicId)?.title ?? null,
    },
    existing: existing.map((t) => t.title),
    count,
  });
  try {
    const { subtasks } = await withAiScope(
      AiFeature.BREAKDOWN,
      { group: c.group, user: c.requester, channel: c.activityVia === 'mcp' ? 'mcp' : c.channel === 'web' ? 'app' : 'telegram' },
      () => aiService.generateJson({ system: BREAKDOWN_SYSTEM_PROMPT, user, temperature: 0.3 }, breakdownSchema, { retries: 1 }),
    );
    return subtasks.slice(0, count ?? BREAKDOWN_MAX).map((s) => ({ title: s.title }));
  } catch (error) {
    if (!(error instanceof AIUnavailableError)) throw error;
    logger.warn(`AI breakdown of #${parent.taskNumber} failed (${error.reason}): ${error.message}`);
    return null;
  }
}
