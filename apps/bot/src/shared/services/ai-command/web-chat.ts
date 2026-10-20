import type { AiChatResponse, AiChatTurn } from '@tbot/shared';
import { refId } from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { TASK_POPULATE_FULL } from 'src/database/services/task-populate';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import {
  aiCommandService,
  AiRequestContext,
  buildAiContext,
  CardEditor,
  checkUserAiRateLimit,
} from 'src/shared/services/ai-command.service';
import { personName } from 'src/shared/services/ai-command/format';
import { changedUpdates } from 'src/shared/services/ai-command/result';
import {
  renderWeb,
  renderWebCreated,
  WEB_AI_BUSY_TEXT,
  WEB_AI_UNAVAILABLE_TEXT,
  WEB_SAVE_FAILED_TEXT,
} from 'src/shared/services/ai-command/web.renderer';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import { redisService } from 'src/shared/services/redis.service';
import { BATCH_UNDO_WINDOW_MS, checkGroupAiRateLimit, createTasks } from 'src/shared/services/task-creation.service';
import { taskSyncService } from 'src/shared/services/task-sync.service';

/** Where the "(via app)" group post of a web-created batch is remembered (for undo). */
const APP_BATCH_POST_PREFIX = 'app_batch_post';
const APP_BATCH_POST_TTL_SECONDS = 15 * 60;

export interface WebChatInput {
  group: IGroup;
  requester: IUser;
  message: string;
  taskId?: string;
  history?: AiChatTurn[];
  /** Refreshes group task cards (bot.telegram in production). */
  editor: CardEditor;
}

export type WebChatOutcome =
  | { status: 'ok'; data: AiChatResponse }
  | { status: 'rate_limited'; message: string }
  | { status: 'task_not_found' };

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

async function populateResponse(data: AiChatResponse) {
  await populate(data.tasks as unknown as ITask[] | undefined);
  await populate(data.changed?.map((c) => c.task) as unknown as ITask[] | undefined);
}

/**
 * POST /api/groups/:groupId/ai — the same planner, safety rules, activity log, DMs and card refreshes as
 * Telegram /ai; group-visible changes get "(via app)" posts; created tasks are undoable from the chat.
 */
export async function handleWebChat(input: WebChatInput): Promise<WebChatOutcome> {
  const { group, requester, message, editor } = input;

  // "This task" must belong to the group — checked before anything else.
  let replyTask: ITask | null = null;
  if (input.taskId) {
    replyTask = await taskService.getTaskById(input.taskId);
    if (!replyTask || refId(replyTask.groupId) !== group._id.toString()) return { status: 'task_not_found' };
  }

  if (!aiService.isConfigured()) return unavailable();

  const chatId = group.telegramGroupId;
  const userLimit = await checkUserAiRateLimit(requester.telegramUserId, chatId);
  if (!userLimit.allowed) {
    return {
      status: 'rate_limited',
      message: `Too many AI requests. Try again in ${userLimit.retryAfterSeconds}s.`,
    };
  }
  if (!(await checkGroupAiRateLimit(chatId))) return unavailable(WEB_AI_BUSY_TEXT);

  const context = await buildAiContext({
    request: message,
    requester,
    group,
    replyTask,
    history: input.history ?? [],
    channel: 'web',
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

  if (result.kind === 'create') return { status: 'ok', data: await createFromChat(context) };

  if (result.kind === 'sections') {
    // Same one-line "(via app)" group messages as other app changes (status / assignee / title only).
    for (const update of changedUpdates(result.sections)) {
      taskSyncService.postChangeSummary(update.task, requester._id, update.fieldChanges).catch(() => undefined);
    }
  }

  const data = renderWeb(context, result);
  await populateResponse(data);
  return { status: 'ok', data };
}

/** The /task pipeline for a web chat message, plus ONE "(via app)" group post (no Undo button there). */
async function createFromChat(c: AiRequestContext): Promise<AiChatResponse> {
  const { requester, group, request } = c;
  const result = await createTasks({
    origin: 'app',
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
  const post = await taskSyncService.postCreatedFromApp(group, requester, result.created);
  if (post) {
    await redisService
      .set(`${APP_BATCH_POST_PREFIX}:${result.batchId}`, JSON.stringify(post), { EX: APP_BATCH_POST_TTL_SECONDS })
      .catch((error: unknown) => logger.warn(`Could not remember batch post ${result.batchId}: ${error}`));
  }

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

/** The group post of a web-created batch, if it was remembered. */
export async function getAppBatchPost(batchId: string): Promise<{ chatId: number; messageId: number } | null> {
  try {
    const raw = await redisService.get(`${APP_BATCH_POST_PREFIX}:${batchId}`);
    return raw ? (JSON.parse(raw) as { chatId: number; messageId: number }) : null;
  } catch (error) {
    logger.warn(`Could not load batch post ${batchId}: ${error}`);
    return null;
  }
}

export async function forgetAppBatchPost(batchId: string) {
  await Promise.resolve(redisService.del(`${APP_BATCH_POST_PREFIX}:${batchId}`)).catch(() => undefined);
}
