import type { AiChatTurn } from '@tbot/shared';
import { EpicStatus, isClosedStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import {
  buildTaskButtons,
  formatTaskCard,
  groupTimezone,
  populatedUser,
  refId,
  todayIn,
} from 'src/bot/task-card.renderer';
import { refreshParentAfterStatus } from 'src/bot/subtasks/parent-sync';
import { IEpic } from 'src/database/models/epic.model';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { EpicTitleTakenError, epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { subtaskService } from 'src/database/services/subtask.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import {
  EXPLAIN_TASK_SYSTEM_PROMPT,
  buildExplainPrompt,
  explanationSchema,
  tidyExplanation,
} from 'src/shared/services/ai-command/explain.prompt';
import {
  dayOf,
  detectLang,
  epicDot,
  epicLabel,
  epicOf,
  isOverdue,
  labelWord,
  MAX_EPIC_SUGGESTIONS,
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
  CreateEpicAction,
  CreateSubtasksAction,
  MAX_AI_EXPLAINS,
  MAX_AI_MUTATIONS,
  QueryAction,
  TaskRef,
  UpdateChanges,
} from 'src/shared/services/ai-command/plan.schema';
import { AI_COMMAND_SYSTEM_PROMPT, buildAiCommandPrompt, PromptTask } from 'src/shared/services/ai-command/prompt';
import {
  addSubtasks,
  applyParentChange,
  moveSubtasksToEpic,
  subtaskEpicNote,
} from 'src/shared/services/ai-command/subtasks';
import { queryBoardFilters } from 'src/shared/services/ai-command/query-filters';
import {
  AiResult,
  AiSection,
  CardEditor,
  EpicCreateOutcome,
  EpicMiss,
  EpicOverviewRow,
  EpicRef,
  ExplainOutcome,
  QueryOutcome,
  TargetMiss,
  UpdateOutcome,
} from 'src/shared/services/ai-command/result';
import { AiOutcome, type AiReply, renderTelegram } from 'src/shared/services/ai-command/telegram.renderer';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
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
  /** The group's open epics, oldest first (planner prompt + "no such epic" suggestions). */
  openEpics?: EpicRef[];
  /** Activity-log channel for changes (default 'ai'; the MCP server passes 'mcp'). */
  activityVia?: TaskActivityVia;
  /** Epics this request created (filled by `createEpic`) — the caller announces them in the group. */
  createdEpics?: IEpic[];
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
    description: task.description || null,
    epic: epicOf(task.epicId)?.title ?? null,
    parent: parentTaskNumber(task.parentTaskId),
  };
}

/** The parent's number of a subtask (populated `parentTaskId`), else null. */
export function parentTaskNumber(ref: unknown): number | null {
  return ref && typeof ref === 'object' && 'taskNumber' in (ref as object) ? (ref as { taskNumber: number }).taskNumber : null;
}

/** Plain epic ref for results (id as string). */
export function toEpicRef(epic: { _id: unknown; title: string; color: string }): EpicRef {
  return { _id: String(epic._id), title: epic.title, color: epic.color };
}

const normalizeTitle = (title: string) => title.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * "No epic “Logn”" + the group's open epics to pick from — the closest ones first (one title contains
 * the other), at most MAX_EPIC_SUGGESTIONS.
 */
export function buildEpicMiss(title: string, openEpics: EpicRef[]): EpicMiss {
  const wanted = normalizeTitle(title);
  const close = (e: EpicRef) => {
    const t = normalizeTitle(e.title);
    return !!wanted && (t.includes(wanted) || wanted.includes(t));
  };
  const sorted = [...openEpics.filter(close), ...openEpics.filter((e) => !close(e))];
  return {
    title,
    suggestions: sorted.slice(0, MAX_EPIC_SUGGESTIONS),
    more: Math.max(0, sorted.length - MAX_EPIC_SUGGESTIONS),
  };
}

type Target = { task: ITask } | { miss: TargetMiss };

/** Per-user AI limit, shared by Telegram /ai and the web chat (same Redis key). */
export const AI_USER_RATE_LIMIT = 6;
export const AI_USER_RATE_WINDOW_SECONDS = 60;
export const MAX_REFERENCED_TASKS = 5;
/** The web chat sends up to 20 turns; only the last few go to the planner. */
export const AI_HISTORY_TURNS = 8;

/**
 * "giải thích #5", "task này làm gì?", "what is #5" — wording that asks what a task is about. Used to still
 * answer from the task's own details when the planner is down (no AI needed to know what was asked).
 */
export const EXPLAIN_WORDING = /giải thích|giai thich|là gì|la gi\b|làm gì|lam gi\b|tóm tắt|tom tat|explain|what is|what's/i;

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
  /** Activity-log channel for changes (default 'ai'). */
  activityVia?: TaskActivityVia;
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
  const openEpics = (await epicService.listOpen(group._id)).map(toEpicRef);
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
    openEpics,
  };
  if (input.channel) context.channel = input.channel;
  if (input.activityVia) context.activityVia = input.activityVia;

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
      epics: (c.openEpics ?? []).map((e) => e.title),
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
    const epicCreates = actions.filter((a): a is CreateEpicAction => a.action === 'create_epic');
    if (actions.some((a) => a.action === 'bulk') || updates.length + epicCreates.length > MAX_AI_MUTATIONS) {
      return { kind: 'refused', reason: 'bulk' };
    }

    const creates = actions.filter((a) => a.action === 'create_tasks');
    if (creates.length) {
      if (actions.some((a) => a.action !== 'create_tasks' && a.action !== 'answer')) {
        return { kind: 'refused', reason: 'mixed_create' };
      }
      return { kind: 'create', useReply: creates.some((a) => a.action === 'create_tasks' && !!a.useReply) };
    }

    // "chia #42 thành subtask …": one parent per request, on its own (like create_tasks).
    const subtaskAsk = actions.find((a): a is CreateSubtasksAction => a.action === 'create_subtasks');
    if (subtaskAsk) {
      if (actions.some((a) => a.action !== 'create_subtasks' && a.action !== 'answer')) {
        return { kind: 'refused', reason: 'mixed_create' };
      }
      const target = await this.resolveTarget(c, subtaskAsk.taskRef);
      if ('miss' in target) return { kind: 'which_task', miss: target.miss };
      const subtasks = await addSubtasks(c, target.task, subtaskAsk, {
        resolvePerson: (name) => this.resolvePerson(c, name),
        unknownPersonText: (name) => unknownPersonText(name, c.channel),
      });
      return { kind: 'sections', sections: [{ type: 'subtasks', subtasks }] };
    }

    // Resolve every target BEFORE changing anything: an unclear target aborts the whole request.
    const resolved: { task: ITask; changes: UpdateChanges; newEpic: boolean }[] = [];
    for (const update of updates) {
      const target = await this.resolveTarget(c, update.taskRef);
      if ('miss' in target) return { kind: 'which_task', miss: target.miss };
      const existing = resolved.find((r) => r.task._id.toString() === target.task._id.toString());
      if (existing) {
        existing.changes = { ...existing.changes, ...update.changes };
        existing.newEpic ||= !!update.newEpic;
      } else resolved.push({ task: target.task, changes: update.changes, newEpic: !!update.newEpic });
    }
    // Explanations are read-only (no mutation cap) but each is a second AI call: at most MAX_AI_EXPLAINS tasks.
    // One unclear target doesn't sink the others: the found ones are explained, the rest get a short note.
    const toExplain: ITask[] = [];
    const explainMisses: TargetMiss[] = [];
    for (const explain of actions.filter((a) => a.action === 'explain_task')) {
      const target = await this.resolveTarget(c, explain.taskRef);
      if ('miss' in target) explainMisses.push(target.miss);
      else if (!toExplain.some((t) => t._id.toString() === target.task._id.toString())) toExplain.push(target.task);
    }
    const otherWork = resolved.length || epicCreates.length || actions.some((a) => a.action === 'query');
    if (explainMisses.length && !toExplain.length && !otherWork) return { kind: 'which_task', miss: explainMisses[0] };

    // Changes first, so an explanation in the same request describes the task as it is now.
    // New epics before the updates, so "tạo epic Login rồi thêm #5 vào" finds it.
    const sections: AiSection[] = [];
    for (const action of epicCreates) sections.push({ type: 'epic_created', epic: await this.createEpic(c, action) });
    const current = new Map<string, ITask>();
    for (const { task, changes, newEpic } of resolved) {
      const update = await this.applyUpdate(c, task, changes, editor, { newEpic });
      current.set(task._id.toString(), update.task);
      sections.push({ type: 'update', update });
    }
    for (const task of toExplain.slice(0, MAX_AI_EXPLAINS)) {
      sections.push({ type: 'explain', explain: await this.explainTask(c, current.get(task._id.toString()) ?? task) });
    }
    const explainNotes = explainNoteLines(explainMisses, toExplain);
    if (explainNotes.length) sections.push({ type: 'note', lines: explainNotes });
    for (const action of actions) {
      if (action.action === 'query') sections.push({ type: 'query', query: await this.runQuery(c, action) });
      // The explanation IS the answer — a planner "answer" next to it would only repeat it.
      else if (action.action === 'answer' && !toExplain.length) sections.push({ type: 'answer', text: action.text });
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

  /**
   * "giải thích #5": a second AI call that writes a short plain-text explanation from the full task —
   * fields, the chat messages it was created from and its activity log. Read-only. When the AI is
   * unavailable the outcome has `text: null` and the renderers fall back to the task's own details.
   */
  async explainTask(c: AiRequestContext, task: ITask): Promise<ExplainOutcome> {
    const assigneeUser = populatedUser(task.assigneeId);
    const assignee = assigneeUser ? personName(assigneeUser) : null;
    const creatorUser = populatedUser(task.createdBy);
    const [activity, children] = await Promise.all([
      taskActivityService.getForTask(task._id),
      task.parentTaskId ? Promise.resolve([] as ITask[]) : subtaskService.list(task._id),
    ]);
    const subtaskRows = children.map((t) => ({
      title: t.title,
      state: t.status === 'done' ? ('done' as const) : t.status === 'cancelled' ? ('cancelled' as const) : ('open' as const),
    }));
    const cancelled = children.filter((t) => t.status === 'cancelled').length;
    const subtasks = children.length
      ? { total: children.length - cancelled, done: children.filter((t) => t.status === 'done').length, cancelled }
      : null;
    const parentRef = task.parentTaskId as unknown as { taskNumber?: number; title?: string } | null;

    const sources = (task.sourceMessages?.length ? task.sourceMessages : task.sourceMessage ? [task.sourceMessage] : [])
      .filter((m) => m?.text?.trim())
      .map((m) => ({ from: m.fromName || 'someone', text: m.text }));

    const due = task.dueDate ? dayOf(task.dueDate) : null;
    // The replied card (web: the task open in the app) is already on screen: no state lines, no Open button.
    const fromReply = !!c.replyTask && c.replyTask._id.toString() === task._id.toString();

    // Who could answer open questions, best first: whoever wrote the source messages, the creator, the
    // assignee — never the person asking. Names without "@" so the explanation pings nobody.
    const requesterId = c.requester._id.toString();
    const sourceList = task.sourceMessages?.length ? task.sourceMessages : task.sourceMessage ? [task.sourceMessage] : [];
    const whoToAsk: string[] = [];
    const addPerson = (name: string | null | undefined) => {
      const plain = name?.replace(/^@/, '').trim();
      if (plain && plain !== 'someone' && !whoToAsk.includes(plain)) whoToAsk.push(plain);
    };
    for (const m of sourceList) if (m?.fromUserId !== c.requester.telegramUserId) addPerson(m?.fromName);
    if (creatorUser && creatorUser._id.toString() !== requesterId) addPerson(personName(creatorUser));
    if (assigneeUser && assigneeUser._id.toString() !== requesterId) addPerson(personName(assigneeUser));

    const user = buildExplainPrompt({
      request: c.request,
      lang: detectLang(c.request),
      today: c.today,
      timezone: c.timezone,
      task: {
        taskNumber: task.taskNumber,
        title: task.title,
        description: task.description || null,
        type: labelWord(typeText(task.type)),
        status: labelWord(statusText(task.status)),
        priority: labelWord(priorityText(task.priority)),
        assignee,
        creator: creatorUser ? personName(creatorUser) : null,
        createdAt: task.createdAt ? dayOf(task.createdAt) : null,
        dueDate: due,
        closed: isClosedStatus(task.status),
        epic: epicOf(task.epicId)?.title ?? null,
        parent: parentRef?.taskNumber ? `#${parentRef.taskNumber} ${parentRef.title ?? ''}`.trim() : null,
      },
      subtasks: subtaskRows,
      askedBy: personName(c.requester).replace(/^@/, ''),
      whoToAsk: whoToAsk.slice(0, 3),
      sources,
      activity: activity.map((a) => {
        const actor = populatedUser(a.actor);
        const change = a.from || a.to ? ` ${a.from ?? '—'} → ${a.to ?? '—'}` : '';
        const when = a.createdAt ? `${dayOf(a.createdAt)} ` : '';
        return `${when}${actor ? personName(actor) : 'someone'}: ${a.action.replace(/_/g, ' ')}${change}`;
      }),
    });

    try {
      const { text } = await aiService.generateJson(
        { system: EXPLAIN_TASK_SYSTEM_PROMPT, user, temperature: 0.3 },
        explanationSchema,
        { retries: 1 },
      );
      return { task, text: tidyExplanation(text, task.taskNumber) || null, assignee, fromReply, subtasks };
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      logger.warn(`AI explanation of #${task.taskNumber} failed (${error.reason}): ${error.message}`);
      return { task, text: null, assignee, fromReply, subtasks };
    }
  }

  /**
   * "💡 Explain" buttons (card ⋯ More, DM notifications): explains ONE task directly — no planner call.
   * `onCard`: the answer is threaded under the task card, so it skips the state lines and Open button
   * (the card is right above). Null when the task is gone or belongs to another group.
   * The caller checks membership and the /ai rate limits first.
   */
  async explainTaskById(
    taskId: string,
    requester: IUser,
    group: IGroup,
    options: { onCard?: boolean } = {},
  ): Promise<AiReply | null> {
    const task = await taskService.getTaskById(taskId);
    if (!task || refId(task.groupId) !== group._id.toString()) return null;
    const timezone = groupTimezone(group);
    const c: AiRequestContext = {
      // Vietnamese wording: the explanation is written in the language of the request.
      request: `Giải thích task #${task.taskNumber}`,
      requester,
      group,
      members: [],
      replyTask: options.onCard ? task : null,
      replyMessage: null,
      referencedTasks: [task],
      referencedNumbers: [task.taskNumber],
      mentions: [],
      timezone,
      today: todayIn(timezone),
      channel: 'telegram',
    };
    const explain = await this.explainTask(c, task);
    return replyOf(renderTelegram(c, { kind: 'sections', sections: [{ type: 'explain', explain }] }));
  }

  /**
   * The AI is down but the request clearly asks what ONE task is about ("giải thích #5", or "task này làm
   * gì?" on its card): answer from the task's own details (description / source message + state) instead
   * of a bare "AI is unavailable". Null when the request isn't that.
   */
  explainWithoutAi(c: AiRequestContext): AiReply | null {
    if (!EXPLAIN_WORDING.test(c.request)) return null;
    let task: ITask | null = null;
    if (c.referencedNumbers.length === 1) {
      const n = c.referencedNumbers[0];
      task = c.replyTask?.taskNumber === n ? c.replyTask : (c.referencedTasks.find((t) => t.taskNumber === n) ?? null);
    } else if (c.referencedNumbers.length === 0) {
      task = c.replyTask;
    }
    if (!task) return null;
    const assigneeUser = populatedUser(task.assigneeId);
    const fromReply = !!c.replyTask && c.replyTask._id.toString() === task._id.toString();
    const explain: ExplainOutcome = { task, text: null, assignee: assigneeUser ? personName(assigneeUser) : null, fromReply };
    return replyOf(renderTelegram(c, { kind: 'sections', sections: [{ type: 'explain', explain }] }));
  }

  /** Resolves "@an", "Hùng" or "me" to a group member; null when unknown (never guesses). */
  resolvePerson(c: AiRequestContext, name: string): IUser | null {
    if (SELF_WORDS.has(name.trim().toLowerCase())) return c.requester;
    return resolveMember(name, c.members, c.mentions);
  }

  /** "/ai tạo epic Login": creates it (auto color) unless an epic with that title already exists. */
  async createEpic(c: AiRequestContext, action: CreateEpicAction): Promise<EpicCreateOutcome> {
    const existing = await epicService.findByTitle(c.group._id, action.title);
    if (existing) return { epic: toEpicRef(existing), duplicate: true };
    try {
      const doc = await epicService.create({
        groupId: c.group._id,
        createdBy: c.requester._id as mongoose.Types.ObjectId,
        title: action.title,
        description: action.description ?? null,
      });
      const epic = toEpicRef(doc);
      c.openEpics?.push(epic);
      (c.createdEpics ??= []).push(doc);
      return { epic, duplicate: false };
    } catch (error) {
      if (!(error instanceof EpicTitleTakenError)) throw error;
      const clash = await epicService.findByTitle(c.group._id, action.title);
      if (!clash) throw error;
      return { epic: toEpicRef(clash), duplicate: true };
    }
  }

  /** The task's epic (populated ref, else loaded by id), or null. */
  private async currentEpic(task: ITask): Promise<EpicRef | null> {
    const populated = epicOf(task.epicId);
    if (populated) return toEpicRef(populated as unknown as EpicRef);
    const id = refId(task.epicId);
    if (!id) return null;
    const epic = await epicService.findById(id);
    return epic ? toEpicRef(epic) : null;
  }

  /** Finds the epic by title in the group; with `create` (the user said "epic mới") a missing one is created. */
  private async findEpic(c: AiRequestContext, title: string, create: boolean): Promise<{ epic: EpicRef; created: boolean } | null> {
    const found = await epicService.findByTitle(c.group._id, title);
    if (found) return { epic: toEpicRef(found), created: false };
    if (!create) return null;
    const outcome = await this.createEpic(c, { action: 'create_epic', title });
    return { epic: outcome.epic, created: !outcome.duplicate };
  }

  private async openEpics(c: AiRequestContext): Promise<EpicRef[]> {
    if (!c.openEpics) c.openEpics = (await epicService.listOpen(c.group._id)).map(toEpicRef);
    return c.openEpics;
  }

  async applyUpdate(
    c: AiRequestContext,
    original: ITask,
    changes: UpdateChanges,
    editor: CardEditor,
    options: { newEpic?: boolean } = {},
  ): Promise<UpdateOutcome> {
    const changed: string[] = [];
    const notes: string[] = [];
    const fieldChanges: TaskChange[] = [];

    // ── Parent (subtask): through the mutation service so the subtask rules and parent cards apply ──
    let task = original;
    if (changes.parent !== undefined) {
      const moved = await applyParentChange(c, task, changes.parent, (ref) => this.resolveTarget(c, ref));
      task = moved.task;
      changed.push(...moved.changes);
      notes.push(...moved.notes);
      fieldChanges.push(...moved.fieldChanges);
    }
    const via: TaskActivityVia = c.activityVia ?? 'ai';
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
    if (changes.description !== undefined) {
      const next = changes.description?.trim() || null;
      const prev = task.description?.trim() || null;
      if (next !== prev) {
        fields.description = next;
        activities.push(['description', prev ? shorten(prev, 80) : null, next ? shorten(next, 80) : null]);
        fieldChanges.push({ field: 'description', from: prev, to: next });
        changed.push(next ? (prev ? '📝 Description updated' : '📝 Description added') : '📝 Description cleared');
      }
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

    // ── Epic: an existing epic of this group (by title), never created silently ──
    let epicMiss: EpicMiss | undefined;
    if (changes.epic !== undefined && task.parentTaskId) {
      notes.push(subtaskEpicNote(task));
    } else if (changes.epic !== undefined) {
      const prev = await this.currentEpic(task);
      if (changes.epic === null) {
        if (prev) {
          fields.epicId = null;
          activities.push(['epic', prev.title, null]);
          fieldChanges.push({ field: 'epic', from: prev.title, to: null, fromIcon: epicDot(prev.color), toIcon: null });
          changed.push(`Epic removed (was ${epicLabel(prev)})`);
        } else notes.push('ℹ️ Not in an epic.');
      } else {
        const next = await this.findEpic(c, changes.epic, !!options.newEpic);
        if (!next) {
          epicMiss = buildEpicMiss(changes.epic, await this.openEpics(c));
        } else if (prev?._id === next.epic._id) {
          notes.push(`ℹ️ Already in epic ${epicLabel(next.epic)}.`);
        } else {
          fields.epicId = new mongoose.Types.ObjectId(next.epic._id);
          activities.push(['epic', prev?.title ?? null, next.epic.title]);
          fieldChanges.push({
            field: 'epic',
            from: prev?.title ?? null,
            to: next.epic.title,
            fromIcon: prev ? epicDot(prev.color) : null,
            toIcon: epicDot(next.epic.color),
          });
          changed.push(
            prev
              ? `Epic: ${epicLabel(prev)} → ${epicLabel(next.epic)}`
              : `Epic → ${epicLabel(next.epic)}${next.created ? ' (new)' : ''}`,
          );
        }
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
        if (fields.epicId !== undefined) await moveSubtasksToEpic(task, fields.epicId);
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
        // A subtask's parent card shows "2/5 done".
        void refreshParentAfterStatus(task, task.status, statusChange);
        await record('status', statusText(task.status), statusText(statusChange));
        fieldChanges.push({ field: 'status', from: statusText(task.status), to: statusText(statusChange) });
        changed.push(statusText(statusChange));
      } else failed = true;
    }

    if (!failed && changed.length) {
      await this.notify(c, current, previousAssignee, newAssignee, !!statusChange);
      await this.refreshCard(c, current, editor);
    }

    const outcome: UpdateOutcome = { original, task: current, changes: changed, notes: failed ? [] : notes, fieldChanges, failed };
    if (epicMiss && !failed) outcome.epicMiss = epicMiss;
    return outcome;
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

  /** "có những epic nào?" — every epic with its progress, open ones first (oldest first within). */
  private async epicOverview(c: AiRequestContext, only?: EpicRef): Promise<QueryOutcome> {
    const epics = await epicService.listWithProgress(c.group._id);
    const rows: EpicOverviewRow[] = epics
      .map((e) => ({
        ...toEpicRef(e as unknown as IEpic),
        status: String(e.status ?? EpicStatus.OPEN),
        total: e.progress.total,
        done: e.progress.done,
      }))
      .filter((row) => !only || row._id === only._id);
    const open = rows.filter((r) => r.status !== EpicStatus.DONE);
    const closed = rows.filter((r) => r.status === EpicStatus.DONE);
    return { kind: 'epics', epics: [...open, ...closed] };
  }

  async runQuery(c: AiRequestContext, q: QueryAction): Promise<QueryOutcome> {
    let epic: EpicRef | undefined;
    if (q.epic) {
      const found = await epicService.findByTitle(c.group._id, q.epic);
      if (!found) return { kind: 'unknown_epic', miss: buildEpicMiss(q.epic, await this.openEpics(c)) };
      epic = toEpicRef(found);
    }
    if (q.kind === 'epics') return this.epicOverview(c, epic);

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
      ...(epic ? { epicId: new mongoose.Types.ObjectId(epic._id) } : {}),
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
    if (epic) title += ` in ${epicLabel(epic)}`;

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
      ...(epic ? { epic } : {}),
      boardFilters: queryBoardFilters(q, assignee, epic),
    };
  }
}

/**
 * Notes under the explanations of a multi-task request: "❌ No task #55." for numbers that don't exist,
 * "🤔 …" for unclear ones, and "ℹ️ Explained 3 of 4 — ask about #4 separately." over the cap. Plain.
 */
export function explainNoteLines(misses: TargetMiss[], toExplain: ITask[]): string[] {
  const lines: string[] = [];
  for (const miss of misses) {
    if (miss.reason === 'missing') lines.push(`❌ No task #${miss.number}.`);
    else if (miss.reason === 'no_match') lines.push(`🤔 No task matches “${shorten(miss.search, 30)}”.`);
    else lines.push('🤔 One task was unclear — ask again with its #number.');
  }
  const skipped = toExplain.slice(MAX_AI_EXPLAINS);
  if (skipped.length) {
    const asked = toExplain.length;
    const refs = skipped.map((t) => `#${t.taskNumber}`).join(', ');
    lines.push(`ℹ️ Explained ${MAX_AI_EXPLAINS} of ${asked} — ask about ${refs} separately.`);
  }
  return Array.from(new Set(lines));
}

function replyOf(outcome: AiOutcome): AiReply | null {
  return outcome.kind === 'reply' ? outcome.reply : null;
}

/** "Couldn't find @x in this group — they need to send a message here first." (plain). */
export function unknownPersonText(name: string, channel: AiRequestContext['channel'] = 'telegram'): string {
  const where = channel === 'web' ? 'in the group' : 'here';
  return `Couldn't find ${name} in this group — they need to send a message ${where} first.`;
}

export const aiCommandService = new AiCommandService();
