import { AiFeature } from '@tbot/shared';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { AiRequestContext, toPromptTask } from 'src/shared/services/ai-command/context';
import { createEpic } from 'src/shared/services/ai-command/epics';
import { explainTask } from 'src/shared/services/ai-command/explain';
import { explainTaskById, explainWithoutAi } from 'src/shared/services/ai-command/explain-direct';
import { refreshCard } from 'src/shared/services/ai-command/notify';
import { AiPlan, aiPlanSchema, CreateEpicAction, QueryAction, TaskRef, UpdateChanges } from 'src/shared/services/ai-command/plan.schema';
import { AI_COMMAND_SYSTEM_PROMPT, buildAiCommandPrompt } from 'src/shared/services/ai-command/prompt';
import { runQuery } from 'src/shared/services/ai-command/query';
import { resolvePerson, resolveTarget, Target } from 'src/shared/services/ai-command/resolve';
import {
  AiResult,
  CardEditor,
  EpicCreateOutcome,
  ExplainOutcome,
  QueryOutcome,
  UpdateOutcome,
} from 'src/shared/services/ai-command/result';
import { runPlan } from 'src/shared/services/ai-command/run';
import { AiOutcome, type AiReply, renderTelegram } from 'src/shared/services/ai-command/telegram.renderer';
import { applyUpdate } from 'src/shared/services/ai-command/update';
import { withRequestAiScope } from 'src/shared/services/ai-command/limits';
import { aiService } from 'src/shared/services/ai/ai.service';

export type { AiContextInput, AiRequestContext } from 'src/shared/services/ai-command/context';
export {
  AI_HISTORY_TURNS,
  buildAiContext,
  extractTaskNumbers,
  MAX_REFERENCED_TASKS,
  parentTaskNumber,
  toEpicRef,
  toPromptTask,
} from 'src/shared/services/ai-command/context';
export {
  AI_USER_RATE_LIMIT,
  AI_USER_RATE_WINDOW_SECONDS,
  aiChannelOf,
  checkUserAiRateLimit,
  withRequestAiScope,
} from 'src/shared/services/ai-command/limits';
export { buildEpicMiss } from 'src/shared/services/ai-command/epics';
export { EXPLAIN_WORDING, explainNoteLines } from 'src/shared/services/ai-command/explain-direct';
export { unknownPersonText } from 'src/shared/services/ai-command/resolve';
export type { AiOutcome, AiReply } from 'src/shared/services/ai-command/telegram.renderer';
export type { CardEditor } from 'src/shared/services/ai-command/result';
export {
  AI_UNAVAILABLE_MESSAGE,
  DELETE_REFUSAL_MESSAGE,
  WHICH_TASK_MESSAGE,
} from 'src/shared/services/ai-command/telegram.renderer';

/** The /ai + web chat entry point: plan with the model, then run the plan (see ai-command/run.ts). */
export class AiCommandService {
  /** Asks the model for a plan. Throws AIUnavailableError when unconfigured, failing or invalid twice. */
  async plan(c: AiRequestContext): Promise<AiPlan> {
    const user = buildAiCommandPrompt({
      request: c.request,
      requester: c.requester,
      members: c.members,
      timezone: c.timezone,
      today: c.today,
      replyTask: c.replyTask ? toPromptTask(c.replyTask) : null,
      replyMessage: c.replyMessage,
      referencedTasks: c.referencedTasks.map(toPromptTask),
      history: c.history,
      previousTask: c.previousTask ? toPromptTask(c.previousTask) : null,
      previousNumbers: c.previousNumbers,
      channel: c.channel,
      epics: (c.openEpics ?? []).map((e) => e.title),
    });
    return withRequestAiScope(AiFeature.PLANNER, c, () =>
      aiService.generateJson({ system: AI_COMMAND_SYSTEM_PROMPT, user, temperature: 0.1 }, aiPlanSchema, {
        retries: 1,
      }),
    );
  }

  /** Telegram: validates and runs the plan, then renders exactly one HTML reply (or a create hand-off). */
  async execute(c: AiRequestContext, plan: AiPlan, editor: CardEditor): Promise<AiOutcome> {
    return renderTelegram(c, await this.run(c, plan, editor));
  }

  /** The channel-agnostic core (safety rules + execution). */
  run(c: AiRequestContext, plan: AiPlan, editor: CardEditor): Promise<AiResult> {
    return runPlan(c, plan, editor);
  }

  resolveTarget(c: AiRequestContext, ref: TaskRef): Promise<Target> {
    return resolveTarget(c, ref);
  }

  explainTask(c: AiRequestContext, task: ITask): Promise<ExplainOutcome> {
    return explainTask(c, task);
  }

  explainTaskById(taskId: string, requester: IUser, group: IGroup, options: { onCard?: boolean } = {}): Promise<AiReply | null> {
    return explainTaskById(taskId, requester, group, options);
  }

  explainWithoutAi(c: AiRequestContext): AiReply | null {
    return explainWithoutAi(c);
  }

  resolvePerson(c: AiRequestContext, name: string): IUser | null {
    return resolvePerson(c, name);
  }

  createEpic(c: AiRequestContext, action: CreateEpicAction): Promise<EpicCreateOutcome> {
    return createEpic(c, action);
  }

  applyUpdate(
    c: AiRequestContext,
    original: ITask,
    changes: UpdateChanges,
    editor: CardEditor,
    options: { newEpic?: boolean } = {},
  ): Promise<UpdateOutcome> {
    return applyUpdate(c, original, changes, editor, options);
  }

  refreshCard(c: AiRequestContext, task: ITask, editor: CardEditor): Promise<void> {
    return refreshCard(c, task, editor);
  }

  runQuery(c: AiRequestContext, q: QueryAction): Promise<QueryOutcome> {
    return runQuery(c, q);
  }
}

export const aiCommandService = new AiCommandService();
