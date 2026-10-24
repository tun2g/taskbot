import type { AiChatTurn } from '@tbot/shared';
import { groupTimezone, populatedUser, todayIn } from 'src/bot/task-card.renderer';
import { IEpic } from 'src/database/models/epic.model';
import { IGroup } from 'src/database/models/group.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { taskService } from 'src/database/services/task.service';
import { dayOf, epicOf, personName } from 'src/shared/services/ai-command/format';
import { PromptTask } from 'src/shared/services/ai-command/prompt';
import { EpicRef } from 'src/shared/services/ai-command/result';
import { BufferedMention } from 'src/shared/services/message-buffer.service';

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

export const MAX_REFERENCED_TASKS = 5;
/** The web chat sends up to 20 turns; only the last few go to the planner. */
export const AI_HISTORY_TURNS = 8;

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
