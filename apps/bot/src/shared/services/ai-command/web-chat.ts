import type { AiChatResponse } from '@tbot/shared';
import { refId } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { TASK_POPULATE_FULL } from 'src/database/services/task-populate';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import {
  aiCommandService,
  AiRequestContext,
  buildAiContext,
  checkUserAiRateLimit,
} from 'src/shared/services/ai-command.service';
import { personName } from 'src/shared/services/ai-command/format';
import { changedUpdates } from 'src/shared/services/ai-command/result';
import { rememberAppBatchPost } from 'src/shared/services/ai-command/web-chat.batch-post';
import { ChatChannel, viaArg, WebChatInput, WebChatOutcome } from 'src/shared/services/ai-command/web-chat.channel';
import {
  renderWeb,
  renderWebCreated,
  WEB_AI_STILL_WORKS,
  WEB_AI_UNAVAILABLE_TEXT,
  WEB_SAVE_FAILED_TEXT,
} from 'src/shared/services/ai-command/web.renderer';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import { epicEventsService } from 'src/shared/services/epic-events.service';
import { BATCH_UNDO_WINDOW_MS, checkGroupAiRateLimit, createTasks } from 'src/shared/services/task-creation.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';
import { aiDisabledBy, aiDisabledText, aiGroupLimitText, aiUserLimitText } from 'src/shared/services/ai-quota';
import { noteGroup, withContext } from 'src/shared/services/telemetry/request-context';

export type { ChatChannel, WebChatInput, WebChatOutcome } from 'src/shared/services/ai-command/web-chat.channel';
export {
  forgetAppBatchPost,
  getAppBatchPost,
  rememberAppBatchPost,
} from 'src/shared/services/ai-command/web-chat.batch-post';
export {
  BATCH_NOT_FOUND_MESSAGE,
  UNDO_EXPIRED_MESSAGE,
  UNDO_FORBIDDEN_MESSAGE,
  UNDO_NOT_A_MEMBER_MESSAGE,
  type UndoAppBatchResult,
  undoAppBatch,
} from 'src/shared/services/ai-command/web-chat.undo';

const unavailable = (text = WEB_AI_UNAVAILABLE_TEXT): WebChatOutcome => ({
  status: 'ok',
  data: { kind: 'unavailable', text, suggestions: [] },
});

/** API responses carry populated users + epic (no-op for plain objects in tests). */
async function populate(tasks: ITask[] | undefined) {
  if (!tasks) return;
  await Promise.all(
    tasks.map(async (task) => {
      const doc = task as unknown as { populate?: (paths: unknown) => Promise<unknown> };
      if (typeof doc.populate === 'function') await doc.populate(TASK_POPULATE_FULL);
    }),
  );
}

export async function populateResponse(data: AiChatResponse) {
  await populate(data.tasks as unknown as ITask[] | undefined);
  await populate(data.changed?.map((c) => c.task) as unknown as ITask[] | undefined);
}

/**
 * POST /api/groups/:groupId/ai — the same planner, safety rules, activity log, DMs and card refreshes as
 * Telegram /ai; group-visible changes get "(via app)" posts; created tasks are undoable from the chat.
 */
export function handleWebChat(input: WebChatInput): Promise<WebChatOutcome> {
  // Every AI call in this request is attributed to the group, the person and the app (or MCP).
  const channel = input.channel?.activity === 'mcp' ? 'mcp' : 'app';
  noteGroup(input.group._id);
  return withContext({ channel, groupId: input.group._id, userId: input.requester._id }, () => runWebChat(input));
}

async function runWebChat(input: WebChatInput): Promise<WebChatOutcome> {
  const { group, requester, message, editor } = input;

  // "This task" must belong to the group — checked before anything else.
  let replyTask: ITask | null = null;
  if (input.taskId) {
    replyTask = await taskService.getTaskById(input.taskId);
    if (!replyTask || refId(replyTask.groupId) !== group._id.toString()) return { status: 'task_not_found' };
  }

  if (!aiService.isConfigured()) return unavailable();
  const disabledBy = aiDisabledBy(group, requester);
  if (disabledBy) return unavailable(`${aiDisabledText(disabledBy, group, requester)} ${WEB_AI_STILL_WORKS}`);

  const chatId = group.telegramGroupId;
  const userLimit = await checkUserAiRateLimit(requester.telegramUserId, chatId, requester);
  if (!userLimit.allowed) {
    return {
      status: 'rate_limited',
      message: aiUserLimitText(userLimit, group),
    };
  }
  const groupLimit = await checkGroupAiRateLimit(chatId, group);
  if (!groupLimit.allowed) return unavailable(`${aiGroupLimitText(group, groupLimit)} ${WEB_AI_STILL_WORKS}`);

  const context = await buildAiContext({
    request: message,
    requester,
    group,
    replyTask,
    history: input.history ?? [],
    channel: 'web',
    ...(input.channel ? { activityVia: input.channel.activity } : {}),
  });

  let plan;
  try {
    plan = await aiCommandService.plan(context);
  } catch (error) {
    if (!(error instanceof AIUnavailableError)) throw error;
    logger.warn(`Web AI planning failed (${error.reason}): ${error.message}`);
    return unavailable();
  }

  const result = await aiCommandService.run(context, plan, editor);

  // New epics ("tạo epic Login", or "put #5 in a new epic Login"): one group post each, "(via app)" / "(via Claude Code)".
  for (const epic of context.createdEpics ?? []) {
    void epicEventsService.created(epic, requester, input.channel?.label ?? 'app', { group });
  }

  if (result.kind === 'create') return { status: 'ok', data: await createFromChat(context, input.channel) };

  if (result.kind === 'sections') {
    // Same one-line "(via app)" group messages as other app changes (status / assignee / title only).
    for (const update of changedUpdates(result.sections)) {
      taskSyncService
        .postChangeSummary(update.task, requester._id, update.fieldChanges, ...viaArg(input.channel))
        .catch(() => undefined);
    }
    // New subtasks: ONE group post, like tasks created from the chat (undo marks it "↩️ Undone").
    for (const section of result.sections) {
      if (section.type !== 'subtasks' || !section.subtasks.batchId) continue;
      const post = await taskSyncService.postCreatedFromApp(group, requester, section.subtasks.created, ...viaArg(input.channel));
      if (post) await rememberAppBatchPost(section.subtasks.batchId, post);
    }
  }

  const data = renderWeb(context, result);
  await populateResponse(data);
  return { status: 'ok', data };
}

/** The /task pipeline for a web chat message, plus ONE "(via app)" group post (no Undo button there). */
async function createFromChat(c: AiRequestContext, channel?: ChatChannel): Promise<AiChatResponse> {
  const { requester, group, request } = c;
  const result = await createTasks({
    origin: 'app',
    userAiLimitChecked: true,
    ...(channel ? { activityVia: channel.activity } : {}),
    requester,
    group,
    messages: [
      {
        messageId: 0,
        chatId: group.telegramGroupId,
        text: request,
        fromUserId: requester.telegramUserId,
        fromName: personName(requester),
        date: Math.floor(Date.now() / 1000),
        mentions: [],
      },
    ],
  });
  if (result.status !== 'created') return { kind: 'unavailable', text: WEB_SAVE_FAILED_TEXT, suggestions: [] };

  const createdAt = new Date();
  const post = await taskSyncService.postCreatedFromApp(group, requester, result.created, ...viaArg(channel));
  if (post) await rememberAppBatchPost(result.batchId, post);

  const data = renderWebCreated(
    c,
    result.created,
    result.warnings,
    result.batchId,
    new Date(createdAt.getTime() + BATCH_UNDO_WINDOW_MS),
  );
  await populateResponse(data);
  return data;
}
