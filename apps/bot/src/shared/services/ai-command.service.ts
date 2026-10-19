import type { AiChatTurn } from '@tbot/shared';
import { isClosedStatus } from '@tbot/shared';
import {
  buildTaskButtons,
  formatTaskCard,
  groupTimezone,
  populatedUser,
  refId,
  todayIn,
} from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import {
  dayOf,
  isOverdue,
  labelWord,
  personName,
  priorityText,
  shortDay,
  shorten,
  statusText,
  typeText,
} from 'src/shared/services/ai-command/format';
import {
  AiAction,
  AiPlan,
  aiPlanSchema,
  MAX_AI_MUTATIONS,
  QueryAction,
  TaskRef,
  UpdateChanges,
} from 'src/shared/services/ai-command/plan.schema';
import { AI_COMMAND_SYSTEM_PROMPT, buildAiCommandPrompt, PromptTask } from 'src/shared/services/ai-command/prompt';
import {
  AiResult,
  AiSection,
  CardEditor,
  QueryOutcome,
  TargetMiss,
  UpdateOutcome,
} from 'src/shared/services/ai-command/result';
import { AiOutcome, renderTelegram } from 'src/shared/services/ai-command/telegram.renderer';
import { aiService } from 'src/shared/services/ai/ai.service';
import { BufferedMention } from 'src/shared/services/message-buffer.service';
import { notificationService } from 'src/shared/services/notification.service';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { resolveMember } from 'src/shared/services/task-extraction.service';
import type { TaskChange } from 'src/shared/services/task-sync.service';

/** Everything the AI and the executor know about one AI request (Telegram /ai or web chat). */
export interface AiRequestContext {
  /** The text after "/ai" (or the web chat message). */
  request: string;
  requester: IUser;
  group: IGroup;
  members: IUser[];
  /** The task whose card the user replied to (web: the task open in the app). */
  replyTask: ITask | null;
  /** A replied normal message (material for create_tasks). */
  replyMessage: { from: string; text: string } | null;
  /** Tasks the user referenced as #N (found in this group). */
  referencedTasks: ITask[];
  /** Task numbers the user wrote (#N / "task N"), found or not. */
  referencedNumbers: number[];
  /** Mentions in the /ai message (text_mention ids for users without a username). */
  mentions: BufferedMention[];
  timezone: string;
  /** YYYY-MM-DD in the group timezone. */
  today: string;
  /** Web chat: earlier turns, oldest first (already trimmed to the last few). */
  history?: AiChatTurn[];
  /** Web chat: the ONE task shown/changed in the previous assistant answer, when exactly one. */
  previousTask?: ITask | null;
  /** Web chat: every task number in the previous assistant answer. */
  previousNumbers?: number[];
  channel?: 'telegram' | 'web';
}

export type { AiOutcome, AiReply } from 'src/shared/services/ai-command/telegram.renderer';
export type { CardEditor } from 'src/shared/services/ai-command/result';
export {
  AI_UNAVAILABLE_MESSAGE,
  DELETE_REFUSAL_MESSAGE,
  WHICH_TASK_MESSAGE,
} from 'src/shared/services/ai-command/telegram.renderer';

const SELF_WORDS = new Set(['me', 'myself', 'i', 'tôi', 'toi', 'mình', 'minh', 'em', 'tao', 'tớ']);

const TYPE_PLURAL: Record<string, string> = {
  bug: 'bugs',
  feature: 'features',
  improvement: 'improvements',
  task: 'tasks',
  chore: 'chores',
  research: 'research tasks',
  question: 'questions',
};

/** Task numbers written as "#12" or "task 12". */
export function extractTaskNumbers(text: string): number[] {
  const numbers = new Set<number>();
  for (const m of text.matchAll(/(?:#|\btask\s*#?)(\d{1,7})\b/gi)) numbers.add(parseInt(m[1], 10));
  return Array.from(numbers);
}

export function toPromptTask(task: ITask): PromptTask {
  const assignee = populatedUser(task.assigneeId);
  return {
    taskNumber: task.taskNumber,
    title: task.title,
    status: task.status,
    type: task.type,
    priority: task.priority,
    assignee: assignee ? personName(assignee) : null,
    dueDate: task.dueDate ? dayOf(task.dueDate) : null,
  };
}

type Target = { task: ITask } | { miss: TargetMiss };

/** Per-user AI limit, shared by Telegram /ai and the web chat (same Redis key). */
export const AI_USER_RATE_LIMIT = 6;
export const AI_USER_RATE_WINDOW_SECONDS = 60;
export const MAX_REFERENCED_TASKS = 5;
/** The web chat sends up to 20 turns; only the last few go to the planner. */
export const AI_HISTORY_TURNS = 8;

export function checkUserAiRateLimit(telegramUserId: number, chatId: number) {
  return rateLimitService.checkRateLimit(
    telegramUserId,
    `ai_command:${chatId}`,
    AI_USER_RATE_LIMIT,
    AI_USER_RATE_WINDOW_SECONDS,
  );
}

export interface AiContextInput {
  request: string;
  requester: IUser;
  group: IGroup;
  replyTask: ITask | null;
  replyMessage?: { from: string; text: string } | null;
  mentions?: BufferedMention[];
  /** Web chat only. */
  history?: AiChatTurn[];
  channel?: 'telegram' | 'web';
}

/**
 * Loads everything the planner needs: #N references, members (requester included), the group's
 * timezone/today and — for the web chat — the last turns and the task of the previous answer.
 */
export async function buildAiContext(input: AiContextInput): Promise<AiRequestContext> {
  const { request, requester, group } = input;
  const referencedNumbers = extractTaskNumbers(request).slice(0, MAX_REFERENCED_TASKS);
  const referencedTasks = (
    await Promise.all(referencedNumbers.map((n) => taskService.getTaskByNumber(group._id, n)))
  ).filter((t): t is ITask => !!t);

  const members = await groupMemberService.getMembers(group._id);
  if (!members.some((m) => m.telegramUserId === requester.telegramUserId)) members.push(requester);

  const timezone = groupTimezone(group);
  const context: AiRequestContext = {
    request,
    requester,
    group,
    members,
    replyTask: input.replyTask,
    replyMessage: input.replyMessage ?? null,
    referencedTasks,
    referencedNumbers,
    mentions: input.mentions ?? [],
    timezone,
    today: todayIn(timezone),
  };
  if (input.channel) context.channel = input.channel;

  if (input.history) {
    const history = input.history.slice(-AI_HISTORY_TURNS);
    const lastAnswer = [...history].reverse().find((t) => t.role === 'assistant');
    const previousNumbers = lastAnswer ? extractTaskNumbers(lastAnswer.content) : [];
    // Only an unambiguous single task may be referred to as "it".
    const previousTask =
      previousNumbers.length === 1 ? await taskService.getTaskByNumber(group._id, previousNumbers[0]) : null;
    Object.assign(context, { history, previousNumbers, previousTask });
  }
  return context;
}

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
    });
    return aiService.generateJson({ system: AI_COMMAND_SYSTEM_PROMPT, user, temperature: 0.1 }, aiPlanSchema, {
      retries: 1,
    });
  }

  /** Telegram: validates and runs the plan, then renders exactly one HTML reply (or a create hand-off). */
  async execute(c: AiRequestContext, plan: AiPlan, editor: CardEditor): Promise<AiOutcome> {
    return renderTelegram(c, await this.run(c, plan, editor));
  }

  /**
   * The channel-agnostic core: validates the plan against the safety rules (never guess a target,
   * no delete, at most MAX_AI_MUTATIONS changes, unknown people are never assigned) and runs it.
   */
  async run(c: AiRequestContext, plan: AiPlan, editor: CardEditor): Promise<AiResult> {
    const actions = plan.actions;

    const clarify = actions.find((a) => a.action === 'clarify');
    if (clarify && clarify.action === 'clarify') return { kind: 'clarify', question: clarify.question };

    if (actions.some((a) => a.action === 'delete_task')) return { kind: 'refused', reason: 'delete' };

    const updates = actions.filter((a): a is Extract<AiAction, { action: 'update_task' }> => a.action === 'update_task');
    if (actions.some((a) => a.action === 'bulk') || updates.length > MAX_AI_MUTATIONS) {
      return { kind: 'refused', reason: 'bulk' };
    }

    const creates = actions.filter((a) => a.action === 'create_tasks');
    if (creates.length) {
      if (actions.some((a) => a.action !== 'create_tasks' && a.action !== 'answer')) {
        return { kind: 'refused', reason: 'mixed_create' };
      }
      return { kind: 'create', useReply: creates.some((a) => a.action === 'create_tasks' && !!a.useReply) };
    }

    // Resolve every target BEFORE changing anything: an unclear target aborts the whole request.
    const resolved: { task: ITask; changes: UpdateChanges }[] = [];
    for (const update of updates) {
      const target = await this.resolveTarget(c, update.taskRef);
      if ('miss' in target) return { kind: 'which_task', miss: target.miss };
      const existing = resolved.find((r) => r.task._id.toString() === target.task._id.toString());
      if (existing) existing.changes = { ...existing.changes, ...update.changes };
      else resolved.push({ task: target.task, changes: update.changes });
    }

    const sections: AiSection[] = [];
    for (const { task, changes } of resolved) {
      sections.push({ type: 'update', update: await this.applyUpdate(c, task, changes, editor) });
    }
    for (const action of actions) {
      if (action.action === 'query') sections.push({ type: 'query', query: await this.runQuery(c, action) });
      else if (action.action === 'answer') sections.push({ type: 'answer', text: action.text });
    }
    return { kind: 'sections', sections };
  }

  /**
   * Never guesses: the replied card (web: the open task), a number the user wrote, the single task of
   * the previous answer (web chat), or a search with exactly one match.
   */
  async resolveTarget(c: AiRequestContext, ref: TaskRef): Promise<Target> {
    if (ref === 'reply') {
      return c.replyTask ? { task: c.replyTask } : { miss: { reason: 'which' } };
    }

    const previousNumbers = c.previousNumbers ?? [];
    if (ref === 'previous') {
      if (c.previousTask && previousNumbers.length === 1) return { task: c.previousTask };
      if (previousNumbers.length > 1) return { miss: { reason: 'previous_ambiguous', numbers: previousNumbers } };
      return { miss: { reason: 'which' } };
    }

    if (typeof ref === 'number') {
      if (c.replyTask?.taskNumber === ref) return { task: c.replyTask };
      if (!c.referencedNumbers.includes(ref)) {
        // A number the user didn't write is only accepted when it is THE one task of the previous answer.
        if (c.previousTask?.taskNumber === ref && previousNumbers.length === 1) return { task: c.previousTask };
        return { miss: { reason: 'which' } };
      }
      const task =
        c.referencedTasks.find((t) => t.taskNumber === ref) ?? (await taskService.getTaskByNumber(c.group._id, ref));
      return task ? { task } : { miss: { reason: 'missing', number: ref } };
    }

    const { tasks } = await taskService.getTasksByGroup(c.group._id, { search: ref.search, limit: 20 });
    const open = tasks.filter((t) => !isClosedStatus(t.status));
    const candidates = open.length ? open : tasks;
    if (candidates.length === 1) return { task: candidates[0] };
    if (candidates.length === 0) return { miss: { reason: 'no_match', search: ref.search } };
    return { miss: { reason: 'ambiguous', candidates } };
  }

  /** Resolves "@an", "Hùng" or "me" to a group member; null when unknown (never guesses). */
  resolvePerson(c: AiRequestContext, name: string): IUser | null {
    if (SELF_WORDS.has(name.trim().toLowerCase())) return c.requester;
    return resolveMember(name, c.members, c.mentions);
  }

  async applyUpdate(c: AiRequestContext, task: ITask, changes: UpdateChanges, editor: CardEditor): Promise<UpdateOutcome> {
    const changed: string[] = [];
    const notes: string[] = [];
    const fieldChanges: TaskChange[] = [];
    const via = 'ai' as const;
    const actor = c.requester._id;
    const record = (action: string, from: string | null, to: string | null) =>
      taskActivityService.record({ taskId: task._id, groupId: task.groupId, actor, action, from, to, via });

    const previousAssignee = populatedUser(task.assigneeId);
    const previousAssigneeId = refId(task.assigneeId);

    // ── Assignee: only a known member (or null = unassign) ──
    let newAssignee: IUser | null | undefined;
    if (changes.assignee !== undefined) {
      if (changes.assignee === null) {
        if (previousAssigneeId) newAssignee = null;
        else notes.push('ℹ️ Already unassigned.');
      } else {
        const member = this.resolvePerson(c, changes.assignee);
        if (!member) {
          notes.push(`⚠️ ${unknownPersonText(changes.assignee, c.channel)}`);
        } else if (previousAssigneeId === member._id.toString()) {
          notes.push(`ℹ️ Already assigned to ${personName(member)}.`);
        } else {
          newAssignee = member;
        }
      }
    }

    // ── Plain fields ──
    const fields: Record<string, unknown> = {};
    const activities: [string, string | null, string | null][] = [];
    if (changes.title !== undefined && changes.title !== task.title) {
      fields.title = changes.title;
      activities.push(['title', task.title, changes.title]);
      fieldChanges.push({ field: 'title', from: task.title, to: changes.title });
      changed.push(`✏️ Renamed (was “${shorten(task.title)}”)`);
    }
    if (changes.type !== undefined) {
      if (changes.type !== (task.type || 'task')) {
        fields.type = changes.type;
        activities.push(['type', typeText(task.type), typeText(changes.type)]);
        fieldChanges.push({ field: 'type', from: typeText(task.type), to: typeText(changes.type) });
        changed.push(typeText(changes.type));
      } else notes.push(`ℹ️ Already ${typeText(changes.type)}.`);
    }
    if (changes.priority !== undefined) {
      if (changes.priority !== (task.priority || 'medium')) {
        fields.priority = changes.priority;
        activities.push(['priority', priorityText(task.priority), priorityText(changes.priority)]);
        fieldChanges.push({ field: 'priority', from: priorityText(task.priority), to: priorityText(changes.priority) });
        changed.push(`${priorityText(changes.priority)} priority`);
      } else notes.push(`ℹ️ Priority is already ${labelWord(priorityText(changes.priority)).toLowerCase()}.`);
    }
    if (changes.dueDate !== undefined) {
      const before = task.dueDate ? dayOf(task.dueDate) : null;
      if (changes.dueDate !== before) {
        fields.dueDate = changes.dueDate ? new Date(`${changes.dueDate}T00:00:00Z`) : null;
        if (changes.dueDate) fields.reminderSent = false;
        const label = (d: string | null) => (d ? shortDay(d, c.today) : 'No due date');
        activities.push(['due_date', before ? label(before) : null, label(changes.dueDate)]);
        fieldChanges.push({ field: 'due_date', from: before, to: changes.dueDate });
        changed.push(changes.dueDate ? `📅 Due ${shortDay(changes.dueDate, c.today)}` : '📅 No due date');
      }
    }

    const statusChange = changes.status !== undefined && changes.status !== task.status ? changes.status : undefined;
    if (changes.status !== undefined && !statusChange) notes.push(`ℹ️ Already ${statusText(task.status)}.`);

    let current: ITask = task;
    let failed = false;

    if (Object.keys(fields).length) {
      const updated = await taskService.updateTask(task._id, fields);
      if (updated) {
        current = updated;
        for (const [action, from, to] of activities) await record(action, from, to);
      } else failed = true;
    }

    if (!failed && newAssignee !== undefined) {
      const updated = await taskService.assignTask(task._id, newAssignee ? newAssignee._id : null);
      if (updated) {
        current = updated;
        const from = previousAssignee ? personName(previousAssignee) : null;
        const to = newAssignee ? personName(newAssignee) : 'Unassigned';
        await record('assignee', from, to);
        fieldChanges.unshift({ field: 'assignee', from, to: newAssignee ? to : null });
        changed.unshift(`👤 ${from ?? 'Unassigned'} → ${to}`);
      } else failed = true;
    }

    if (!failed && statusChange) {
      const updated = await taskService.updateTaskStatus(task._id, statusChange, actor);
      if (updated) {
        current = updated;
        await record('status', statusText(task.status), statusText(statusChange));
        fieldChanges.push({ field: 'status', from: statusText(task.status), to: statusText(statusChange) });
        changed.push(statusText(statusChange));
      } else failed = true;
    }

    if (!failed && changed.length) {
      await this.notify(c, current, previousAssignee, newAssignee, !!statusChange);
      await this.refreshCard(c, current, editor);
    }

    return { original: task, task: current, changes: changed, notes: failed ? [] : notes, fieldChanges, failed };
  }

  private async notify(
    c: AiRequestContext,
    task: ITask,
    previousAssignee: IUser | null,
    newAssignee: IUser | null | undefined,
    statusChanged: boolean,
  ) {
    try {
      if (newAssignee) await notificationService.notifyAssignment(task, newAssignee, c.requester);
      if (newAssignee !== undefined && previousAssignee) {
        await notificationService.notifyUnassigned(task, previousAssignee, c.requester);
      }
      // A fresh assignee already got the assignment DM (which shows the task); others hear about the status.
      const assignee = newAssignee === undefined ? previousAssignee : null;
      if (statusChanged && assignee) await notificationService.notifyStatusChange(task, c.requester, assignee);
    } catch (error) {
      logger.warn(`AI command notification failed for task ${task._id}: ${error}`);
    }
  }

  /** Edit the original task card so it shows the new state. */
  async refreshCard(c: AiRequestContext, task: ITask, editor: CardEditor) {
    if (!task.taskCardChatId || !task.taskCardMessageId) return;
    try {
      const text = formatTaskCard(task, undefined, undefined, groupTimezone(c.group));
      const buttons = await buildTaskButtons(task);
      await editor.editMessageText(task.taskCardChatId, task.taskCardMessageId, undefined, text, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (error) {
      if (!String(error).includes('message is not modified')) {
        logger.warn(`Could not refresh task card for #${task.taskNumber}: ${error}`);
      }
    }
  }

  async runQuery(c: AiRequestContext, q: QueryAction): Promise<QueryOutcome> {
    let assignee: IUser | null = null;
    if (q.kind === 'mine') assignee = c.requester;
    else if (q.person) {
      assignee = this.resolvePerson(c, q.person);
      if (!assignee) return { kind: 'unknown_person', person: q.person };
    }
    const mine = !!assignee && assignee._id.toString() === c.requester._id.toString();
    const search = q.text ?? undefined;

    const { tasks } = await taskService.getTasksByGroup(c.group._id, {
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(assignee ? { assigneeId: assignee._id } : {}),
      ...(search ? { search } : {}),
      limit: 500,
    });

    let list = q.status ? tasks : tasks.filter((t) => !isClosedStatus(t.status));
    if (q.kind === 'overdue') list = list.filter((t) => isOverdue(t.dueDate, t.status, c.today));
    list = [...list].sort((a, b) => {
      const da = a.dueDate ? dayOf(a.dueDate) : '9999-99-99';
      const db = b.dueDate ? dayOf(b.dueDate) : '9999-99-99';
      return da === db ? b.taskNumber - a.taskNumber : da < db ? -1 : 1;
    });

    // ── Title: "Your open tasks", "Overdue bugs for @an matching “login”" ──
    const noun = q.type ? (TYPE_PLURAL[q.type] ?? 'tasks') : 'tasks';
    const qualifier =
      q.kind === 'overdue' ? 'overdue' : q.status ? labelWord(statusText(q.status)).toLowerCase() : 'open';
    const icon = q.kind === 'overdue' ? '⚠️' : search ? '🔎' : '📋';
    let title: string;
    if (mine) title = `Your ${qualifier} ${noun}`;
    else {
      title = `${qualifier.charAt(0).toUpperCase()}${qualifier.slice(1)} ${noun}`;
      if (assignee) title += ` for ${personName(assignee)}`;
    }
    if (search) title += ` matching “${shorten(search, 30)}”`;

    return {
      kind: 'list',
      queryKind: q.kind,
      mine,
      title,
      icon,
      tasks: list,
      showStatus: !q.status,
      showAssignee: !assignee,
      emptyText: q.kind === 'overdue' || (!search && !q.status && !q.type) ? 'Nothing here. 🎉' : 'No matches.',
    };
  }
}

/** "Couldn't find @x in this group — they need to send a message here first." (plain). */
export function unknownPersonText(name: string, channel: AiRequestContext['channel'] = 'telegram'): string {
  const where = channel === 'web' ? 'in the group' : 'here';
  return `Couldn't find ${name} in this group — they need to send a message ${where} first.`;
}

export const aiCommandService = new AiCommandService();
