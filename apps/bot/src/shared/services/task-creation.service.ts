import { randomBytes } from 'crypto';
import mongoose from 'mongoose';
import { EpicStatus, TASK_TYPE_LABELS, TaskType } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { buildTaskButtons, formatTaskCard } from 'src/bot/task-card.renderer';
import { configService } from 'src/configs/configuration';
import { IGroup } from 'src/database/models/group.model';
import { ISourceMessage, ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { IEpic } from 'src/database/models/epic.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { epicService, normalizeEpicTitle } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import { aiService } from 'src/shared/services/ai/ai.service';
import { checkUserAiDailyLimit } from 'src/shared/services/ai-quota';
import { epicLabel, epicOf } from 'src/shared/services/ai-command/format';
import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';
import { buildMessageLink, groupMessengerService, isForumChat } from 'src/shared/services/group-messenger.service';
import { BufferedMessage } from 'src/shared/services/message-buffer.service';
import { notificationService } from 'src/shared/services/notification.service';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import {
  buildFallbackTask,
  ExtractedTask,
  ExtractionInput,
  ExtractionResult,
  resolveMember,
  taskExtractionService,
} from 'src/shared/services/task-extraction.service';
import { boardButton, taskNumberHtml } from 'src/shared/utils/app-links';
import { InlineKeyboardButton, Message } from 'telegraf/types';

import { BATCH_CALLBACK_PREFIX, BatchCallbackData } from 'src/shared/services/batch-undo.constants';
import { parentRefOf, sharedParentOf } from 'src/shared/services/created-summary';

export { BATCH_CALLBACK_PREFIX, BATCH_UNDO_WINDOW_MS } from 'src/shared/services/batch-undo.constants';
export type { BatchCallbackData } from 'src/shared/services/batch-undo.constants';
const AI_RATE_LIMIT = 20;
const AI_RATE_WINDOW_SECONDS = 10 * 60;
const PROGRESS_DELAY_MS = 1500;
const SUMMARY_TITLE_MAX = 60;


export interface CreateTasksInput {
  /** Oldest first. For free text, pass one message whose text is the request. */
  messages: BufferedMessage[];
  /** Extra instruction from the requester (title hint, "assign to @an", …). */
  note?: string;
  requester: IUser;
  group: IGroup;
  /** Notes shown under the result (e.g. privacy-mode hints). */
  warnings?: string[];
  /**
   * True for "/task N" / "/task all": zero action items → "nothing found" reply, and when the
   * AI rate limit is hit → ask to wait. False (default): always creates at least a basic task.
   */
  multiMessage?: boolean;
  /** True when the caller already counted this request against the person's AI limits (/ai, web chat). */
  userAiLimitChecked?: boolean;
}

type SendExtra = Parameters<BotContext['reply']>[1];

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes text for Telegram's legacy `Markdown` parse mode (used by the task card). */
export function escapeLegacyMarkdown(text: string): string {
  return text.replace(/([_*`[])/g, '\\$1');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function typeEmoji(type: string): string {
  return (TASK_TYPE_LABELS[type as TaskType] ?? TASK_TYPE_LABELS[TaskType.TASK]).split(' ')[0];
}

export function userName(user: IUser | null | undefined): string {
  if (!user) return 'someone';
  return user.username ? `@${user.username}` : user.firstName || 'someone';
}

/** t.me/c link for supergroups, topic-aware (opens in the right forum topic); basic groups have none (''). */
export function messageLink(chatId: number, messageId: number, threadId?: number): string {
  return buildMessageLink(chatId, messageId, threadId) ?? '';
}

/** Per-group AI rate limit shared by /task and /ai. True when the call is allowed. */
export async function checkGroupAiRateLimit(chatId: number): Promise<boolean> {
  const result = await rateLimitService.checkRateLimit(chatId, 'ai_task_extract', AI_RATE_LIMIT, AI_RATE_WINDOW_SECONDS);
  return result.allowed;
}

/**
 * Keeps each request to ONE bot message: posts `text` only if the work takes longer than
 * 1.5s, then `finish()` edits that same message into the final answer (or posts it).
 * `delayMs: null` = no progress message at all (finish just posts).
 */
export class ReplyProgress {
  private timer: NodeJS.Timeout | null;
  private pending: Promise<Message.TextMessage | null> | null = null;

  constructor(
    private ctx: BotContext,
    text: string,
    delayMs: number | null = PROGRESS_DELAY_MS,
  ) {
    this.timer =
      delayMs === null
        ? null
        : setTimeout(() => {
            this.timer = null;
            this.pending = ctx.reply(text).catch((error) => {
              logger.warn(`Could not post progress message: ${error}`);
              return null;
            });
          }, delayMs);
  }

  /** Stops the pending progress message and removes it if it was already posted. */
  async cancel(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const progress = this.pending ? await this.pending : null;
    this.pending = null;
    if (progress) await this.ctx.telegram.deleteMessage(this.ctx.chat!.id, progress.message_id).catch(() => undefined);
  }

  async finish(text: string, extra: SendExtra = {}): Promise<number | undefined> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const progress = this.pending ? await this.pending : null;
    const chatId = this.ctx.chat!.id;

    if (progress) {
      try {
        await this.sendWithParseFallback(extra, (e) =>
          this.ctx.telegram.editMessageText(chatId, progress.message_id, undefined, text, e as never),
        );
        return progress.message_id;
      } catch (error) {
        logger.warn(`Could not edit progress message, posting a new one: ${error}`);
        await this.ctx.telegram.deleteMessage(chatId, progress.message_id).catch(() => undefined);
      }
    }
    const sent = await this.sendWithParseFallback(extra, (e) => this.ctx.reply(text, e));
    return (sent as Message.TextMessage | undefined)?.message_id;
  }

  // A formatting mistake must never cost the user their reply: retry without parse_mode.
  private async sendWithParseFallback<R>(extra: SendExtra, send: (extra: SendExtra) => Promise<R>): Promise<R> {
    try {
      return await send(extra);
    } catch (error) {
      if (extra?.parse_mode && String(error).includes("can't parse entities")) {
        logger.warn(`Message formatting rejected, resending as plain text: ${error}`);
        const { parse_mode: _ignored, ...plain } = extra;
        return await send(plain);
      }
      throw error;
    }
  }
}

function toSourceMessages(extracted: ExtractedTask, byId: Map<number, BufferedMessage>, chatId: number): ISourceMessage[] {
  return extracted.sourceMessageIds
    .map((id) => byId.get(id))
    .filter((m): m is BufferedMessage => !!m)
    .map((m) => ({
      messageId: m.messageId,
      chatId,
      text: m.text.slice(0, 2000),
      fromUserId: m.fromUserId,
      fromName: m.fromName,
      link: messageLink(chatId, m.messageId, m.threadId),
    }));
}

export type CreationOrigin = 'telegram' | 'app';

export interface CreateTasksCoreInput extends CreateTasksInput {
  /** 'app' = the web chat: no Telegram source message, activity via 'app' for fallbacks. */
  origin: CreationOrigin;
  /** Telegram chat of the group (defaults to group.telegramGroupId). */
  chatId?: number;
  /** Activity-log channel for every row written here (default: 'ai' / 'app' / 'bot' by origin and source). */
  activityVia?: TaskActivityVia;
}

export interface CreatedTask {
  task: ITask;
  assignee: IUser | null;
}

export type CreateTasksResult =
  | {
      status: 'created';
      created: CreatedTask[];
      /** Same tasks as `created`, in order. */
      tasks: ITask[];
      /** Plain text (not escaped). */
      warnings: string[];
      batchId: string;
      source: 'ai' | 'fallback';
    }
  /** multiMessage only: the group AI limit was hit. */
  | { status: 'rate_limited' }
  /** multiMessage only: the AI found no action items. */
  | { status: 'no_items' }
  | { status: 'save_failed' };

/**
 * The AI's epic pick, only when it is exactly (case-insensitively) one of the group's OPEN epics.
 * Anything else — a closed epic, a made-up title — means no epic. Epics are never created here.
 */
export function matchEpic(title: string, openEpics: IEpic[]): IEpic | null {
  const wanted = normalizeEpicTitle(title).toLowerCase();
  if (!wanted) return null;
  return (
    openEpics.find(
      (e) => (e.status ?? EpicStatus.OPEN) === EpicStatus.OPEN && normalizeEpicTitle(e.title).toLowerCase() === wanted,
    ) ?? null
  );
}

/**
 * The channel-agnostic /task core: AI extraction (with fallback), server-side assignee resolution,
 * task creation (shared batchId), activity log and assignee DMs. Posts nothing to the group.
 */
export async function createTasks(input: CreateTasksCoreInput): Promise<CreateTasksResult> {
  const { messages, note, requester, group, origin } = input;
  const warnings = [...(input.warnings ?? [])];
  const chatId = input.chatId ?? group.telegramGroupId;

  const members = await groupMemberService.getMembers(group._id);
  if (!members.some((m) => m.telegramUserId === requester.telegramUserId)) members.push(requester);
  const openEpics = await epicService.listOpen(group._id);
  const extractionInput: ExtractionInput = {
    messages,
    note,
    members,
    timezone: group.timezone || configService.timezone || 'UTC',
    ...(openEpics.length ? { epics: openEpics.map((e) => ({ title: e.title, description: e.description })) } : {}),
  };

  let result: ExtractionResult;
  const userAllowed =
    !aiService.isConfigured() ||
    input.userAiLimitChecked ||
    (await checkUserAiDailyLimit(requester.telegramUserId)).allowed;
  const allowed = userAllowed && (!aiService.isConfigured() || (await checkGroupAiRateLimit(chatId)));
  if (!allowed) {
    if (input.multiMessage) return { status: 'rate_limited' };
    result = { tasks: [buildFallbackTask(extractionInput)], source: 'fallback' };
    warnings.push(
      userAllowed
        ? 'ℹ️ AI limit reached for this group, so I made a basic task.'
        : "ℹ️ You've reached your daily AI limit, so I made a basic task.",
    );
  } else {
    result = await taskExtractionService.extract(extractionInput);
    if (result.source === 'fallback') {
      warnings.push(
        result.fallbackReason === 'unconfigured'
          ? 'ℹ️ AI is off, so I made a basic task from the text.'
          : origin === 'app'
            ? '⚠️ AI was unavailable, so I made a basic task. You can edit it on the board.'
            : '⚠️ AI was unavailable, so I made a basic task. Use the buttons below to edit it.',
      );
    }
  }

  if (result.tasks.length === 0) {
    if (input.multiMessage) return { status: 'no_items' };
    result = { tasks: [buildFallbackTask(extractionInput)], source: 'fallback' };
    warnings.push('ℹ️ AI found no clear action item, so I made a basic task.');
  }

  const batchId = randomBytes(8).toString('hex');
  const via: TaskActivityVia = input.activityVia ?? (result.source === 'ai' ? 'ai' : origin === 'app' ? 'app' : 'bot');
  const mentions = messages.flatMap((m) => m.mentions ?? []);
  const byId = new Map(messages.map((m) => [m.messageId, m]));

  const created: CreatedTask[] = [];
  const unknownNames: string[] = [];
  const failedTitles: string[] = [];

  for (const extracted of result.tasks) {
    const assignee = extracted.assignee ? resolveMember(extracted.assignee, members, mentions) : null;
    if (extracted.assignee && !assignee) {
      const name = extracted.assignee.trim();
      if (!unknownNames.includes(name)) unknownNames.push(name);
    }

    const epic = extracted.epic ? matchEpic(extracted.epic, openEpics) : null;
    // The web chat has no Telegram message to link back to.
    const sourceMessages = origin === 'app' ? [] : toSourceMessages(extracted, byId, chatId);
    try {
      const task = await taskService.createTask({
        groupId: group._id,
        title: extracted.title,
        description: extracted.description,
        type: extracted.type,
        priority: extracted.priority,
        createdBy: requester._id,
        assigneeId: assignee?._id,
        dueDate: extracted.dueDate ? new Date(`${extracted.dueDate}T00:00:00Z`) : undefined,
        ...(epic ? { epicId: epic._id as mongoose.Types.ObjectId } : {}),
        sourceMessage: sourceMessages[0],
        sourceMessages,
        batchId,
        taskCardChatId: chatId,
      });
      // The card shows "Epic: 🔵 Login" from the populated ref.
      if (epic && typeof task.populate === 'function') await task.populate(TASK_POPULATE);
      created.push({ task, assignee });
      await taskActivityService.record({
        taskId: task._id,
        groupId: group._id,
        actor: requester._id,
        action: 'created',
        to: task.title,
        via,
      });
      // The AI's epic pick is logged as its own change, so it shows up (and is easy to spot) in the history.
      if (epic) {
        await taskActivityService.record({
          taskId: task._id,
          groupId: group._id,
          actor: requester._id,
          action: 'epic',
          from: null,
          to: epic.title,
          via: input.activityVia ?? 'ai',
        });
      }
    } catch (error) {
      failedTitles.push(extracted.title);
      logger.error(`Failed to create extracted task "${extracted.title}": ${error}`);
    }
  }

  if (created.length === 0) return { status: 'save_failed' };

  if (unknownNames.length) {
    const names = unknownNames.map((n) => `"${n}"`).join(', ');
    const where = origin === 'app' ? 'in the group' : 'here';
    warnings.push(`⚠️ Couldn't find ${names} in this group — left unassigned. They need to post ${where} once first.`);
  }
  if (failedTitles.length) {
    const titles = failedTitles.map((t) => `“${truncate(t, SUMMARY_TITLE_MAX)}”`).join(', ');
    const many = failedTitles.length > 1;
    warnings.push(`⚠️ Couldn't save ${many ? `${failedTitles.length} tasks` : 'a task'}: ${titles}. Please add ${many ? 'them' : 'it'} again.`);
  }

  for (const { task, assignee } of created) {
    if (!assignee) continue;
    try {
      await notificationService.notifyAssignment(task, assignee, requester);
    } catch (error) {
      logger.warn(`Assignment notification failed for task ${task._id}: ${error}`);
    }
  }

  return { status: 'created', created, tasks: created.map((c) => c.task), warnings, batchId, source: result.source };
}

/**
 * Telegram /task and /ai: runs the core and posts exactly one reply in the chat — the task card for
 * 1 task, or a summary with ↩️ Undo for 2+ (progress message edited in place). Never throws.
 */
export async function createTasksFromInput(ctx: BotContext, input: CreateTasksInput): Promise<void> {
  const { messages } = input;
  const chatId = ctx.chat!.id;

  void Promise.resolve(ctx.sendChatAction?.('typing')).catch(() => undefined);
  // Forums: the result is an event for the "Task events" topic, so no progress message in the user's topic.
  const forum = isForumChat(ctx) || !!input.group.isForum;
  const progress = new ReplyProgress(
    ctx,
    messages.length === 1 ? '🤖 Reading the message…' : `🤖 Reading ${messages.length} messages…`,
    forum ? null : PROGRESS_DELAY_MS,
  );

  try {
    const result = await createTasks({ ...input, origin: 'telegram', chatId });
    switch (result.status) {
      case 'rate_limited':
        await progress.finish(
          '⏳ AI is busy in this group — too many requests in the last 10 minutes. Try again in a few minutes, or reply to a single message with /new.',
        );
        return;
      case 'no_items':
        await progress.finish(
          `🤷 No action items in ${messages.length === 1 ? 'that message' : `those ${messages.length} messages`}. ` +
            'Reply to a specific message with /new to create one anyway.',
        );
        return;
      case 'save_failed':
        await progress.finish("❌ I couldn't save the task. Please try again in a moment.");
        return;
      default:
        await replyCreated(ctx, progress, input, result);
    }
  } catch (error) {
    logger.error(`Task creation pipeline failed: ${error instanceof Error ? error.stack : error}`);
    try {
      await progress.finish('❌ Something went wrong and no task was created. Please try again in a moment.');
    } catch (replyError) {
      logger.error(`Could not send task creation error reply: ${replyError}`);
    }
  }
}

/**
 * Summary lines "#12 🐞 Fix login → @an · 🔵 Login" (HTML-escaped; #12 opens the task when an app link
 * exists; the epic only when the AI put the task in one, so a wrong pick is easy to spot).
 */
export function createdSummaryLines(created: CreatedTask[], groupId: IGroup['_id'] | string): string[] {
  // Subtasks of different parents say whose they are; when all share one, the headline says it instead.
  const shared = sharedParentOf(created.map((c) => c.task));
  return created.map(({ task, assignee }) => {
    const who = assignee ? ` → ${escapeHtml(userName(assignee))}` : '';
    const parent = shared ? null : parentRefOf(task);
    const under = parent ? ` ↳ #${parent.taskNumber}` : '';
    const epic = epicOf(task.epicId);
    const inEpic = epic ? ` · ${escapeHtml(epicLabel(epic, 16))}` : '';
    return `${taskNumberHtml(task.taskNumber, groupId, task._id)} ${typeEmoji(task.type)} ${escapeHtml(truncate(task.title, SUMMARY_TITLE_MAX))}${under}${who}${inEpic}`;
  });
}

async function replyCreated(
  ctx: BotContext,
  progress: ReplyProgress,
  input: CreateTasksInput,
  result: Extract<CreateTasksResult, { status: 'created' }>,
) {
  const { requester, group, messages } = input;
  const { created, warnings, batchId } = result;
  const chatId = ctx.chat!.id;

  // Forums: the card/summary goes to the "Task events" topic as a reply to the source message.
  const forum = isForumChat(ctx) || !!group.isForum;
  const eventSource = messages[0] ? { messageId: messages[0].messageId, threadId: messages[0].threadId } : undefined;
  const post = async (text: string, extra: SendExtra, linkFallback: boolean): Promise<number | undefined> => {
    if (!forum) return progress.finish(text, extra);
    await progress.cancel();
    const { message } = await groupMessengerService.sendCommandEvent(ctx, group, text, {
      extra,
      ...(eventSource?.messageId ? { source: { ...eventSource, linkFallback } } : {}),
    });
    return message?.message_id;
  };

  if (created.length === 1) {
    const { task, assignee } = created[0];
    let text = formatTaskCard(task, requester, assignee);
    if (warnings.length) text += `\n\n${escapeLegacyMarkdown(warnings.join('\n'))}`;
    const buttons = await buildTaskButtons(task);
    // The card already links its source message, so no extra link if the cross-topic reply fails.
    const messageId = await post(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }, false);
    if (messageId) await taskService.updateTask(task._id, { taskCardMessageId: messageId, taskCardChatId: chatId });
    return;
  }

  const key = randomBytes(6).toString('hex');
  const batch: BatchCallbackData = {
    batchId,
    groupId: group._id.toString(),
    chatId,
    requesterTelegramId: requester.telegramUserId,
    requesterName: userName(requester),
    count: created.length,
    createdAt: Date.now(),
  };
  await callbackDataStorageService.setCallbackData(key, BATCH_CALLBACK_PREFIX, batch);

  // The source label links to the (first) source message, so it doubles as the cross-topic fallback link.
  const sourceLabel = messages.length === 1 ? 'this message' : `${messages.length} messages`;
  const sourceUrl = eventSource ? messageLink(chatId, eventSource.messageId, eventSource.threadId) : '';
  const source = sourceUrl ? `<a href="${sourceUrl}">${sourceLabel}</a>` : sourceLabel;
  const lines = [`<b>🤖 Created ${created.length} tasks from ${source}</b>`, '', ...createdSummaryLines(created, group._id)];
  if (warnings.length) lines.push('', ...warnings.map(escapeHtml));

  const row: InlineKeyboardButton[] = [{ text: '↩️ Undo', callback_data: `batch:undo:${key}` }];
  const board = boardButton(group._id);
  if (board) row.push(board);

  await post(
    lines.join('\n'),
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [row] },
    },
    !sourceUrl,
  );
}
