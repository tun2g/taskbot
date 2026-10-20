import type { AiChatResponse, AiChatTurn } from '@tbot/shared';
import { refId } from 'src/bot/task-card.renderer';
import mongoose from 'mongoose';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { IGroup } from 'src/database/models/group.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { TASK_POPULATE_FULL } from 'src/database/services/task-populate';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { undoBatch } from 'src/shared/services/batch-undo.service';
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
import { epicEventsService } from 'src/shared/services/epic-events.service';
import { redisService } from 'src/shared/services/redis.service';
import { BATCH_UNDO_WINDOW_MS, checkGroupAiRateLimit, createTasks } from 'src/shared/services/task-creation.service';
import { taskSyncService, userDisplayName } from 'src/shared/services/task-sync.service';

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
  /**
   * Who is asking when it isn't the web app: the MCP server passes `{ activity: 'mcp', label: 'Claude Code' }`, so
   * the activity log says mcp and group posts say "(via Claude Code)". Omitted = the web chat ("(via app)").
   */
  channel?: ChatChannel;
}

export interface ChatChannel {
  activity: TaskActivityVia;
  label: string;
}

/** Extra "(via …)" argument for the group-post helpers — only when it isn't the default "app". */
const viaArg = (channel?: ChatChannel): [] | [string] => (channel ? [channel.label] : []);

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

/** Remembers the group post of an app/MCP-created batch so an undo can mark it "↩️ Undone". Never throws. */
export async function rememberAppBatchPost(batchId: string, post: { chatId: number; messageId: number }): Promise<void> {
  await Promise.resolve(
    redisService.set(`${APP_BATCH_POST_PREFIX}:${batchId}`, JSON.stringify(post), { EX: APP_BATCH_POST_TTL_SECONDS }),
  ).catch((error: unknown) => logger.warn(`Could not remember batch post ${batchId}: ${error}`));
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

export const UNDO_EXPIRED_MESSAGE = 'Undo is only available for 10 minutes after creating.';
export const UNDO_FORBIDDEN_MESSAGE = 'Only the person who created these tasks or a group admin can undo.';
export const BATCH_NOT_FOUND_MESSAGE = 'These tasks were already removed or could not be found.';
export const UNDO_NOT_A_MEMBER_MESSAGE = 'You are not a member of this group.';
const BATCH_ID = /^[0-9a-f]{16}$/;

export type UndoAppBatchResult =
  | { status: 'ok'; removed: number }
  | { status: 'not_found' | 'not_member' | 'expired' | 'forbidden'; message: string };

/**
 * Undo of a batch created from the web chat or the MCP server: the requester (or a Telegram group admin),
 * within 10 minutes. Removes the tasks, logs them and turns the group post into "↩️ Undone by …".
 * `groupId` (optional) must match the batch's group.
 */
export async function undoAppBatch(params: {
  user: IUser;
  batchId: string;
  groupId?: string;
  channel?: ChatChannel;
}): Promise<UndoAppBatchResult> {
  const { user, batchId } = params;
  const tasks = BATCH_ID.test(batchId) ? await taskService.getTasksByBatch(batchId) : [];
  if (tasks.length === 0 || (params.groupId && String(tasks[0].groupId) !== params.groupId)) {
    return { status: 'not_found', message: BATCH_NOT_FOUND_MESSAGE };
  }

  const groupId = tasks[0].groupId as mongoose.Types.ObjectId;
  if (!(await groupMemberService.isMember(groupId, user._id as mongoose.Types.ObjectId))) {
    return { status: 'not_member', message: UNDO_NOT_A_MEMBER_MESSAGE };
  }

  const createdAt = Math.min(...tasks.map((t) => new Date(t.createdAt ?? 0).getTime()));
  if (Date.now() - createdAt > BATCH_UNDO_WINDOW_MS) return { status: 'expired', message: UNDO_EXPIRED_MESSAGE };

  const isRequester = refId(tasks[0].createdBy) === String(user._id);
  if (!isRequester) {
    const group = await groupService.findGroupById(groupId);
    const isAdmin = group ? await isTelegramGroupAdmin(group.telegramGroupId, user.telegramUserId) : false;
    if (!isAdmin) return { status: 'forbidden', message: UNDO_FORBIDDEN_MESSAGE };
  }

  const { removed, tasks: removedTasks } = await undoBatch({
    batchId,
    groupId: groupId.toString(),
    actor: user._id as mongoose.Types.ObjectId,
    via: params.channel ? (params.channel.activity === 'mcp' ? 'mcp' : 'app') : 'app',
    tasks,
  });

  const post = await getAppBatchPost(batchId);
  if (post) {
    await taskSyncService.markBatchUndone(post, userDisplayName(user), removed, removedTasks, groupId, ...viaArg(params.channel));
    await forgetAppBatchPost(batchId);
  }
  return { status: 'ok', removed };
}
