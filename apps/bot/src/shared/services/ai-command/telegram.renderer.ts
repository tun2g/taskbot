import { populatedUser } from 'src/bot/task-card.renderer';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import {
  dueText,
  escapeHtml,
  personName,
  QUERY_LIST_LIMIT,
  shorten,
  statusText,
  typeIcon,
} from 'src/shared/services/ai-command/format';
import { MAX_AI_MUTATIONS } from 'src/shared/services/ai-command/plan.schema';
import {
  AiResult,
  AiSection,
  changedUpdates,
  QueryOutcome,
  TargetMiss,
  UpdateOutcome,
} from 'src/shared/services/ai-command/result';
import { boardButton, taskButton, taskNumberHtml } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

// Telegram /ai replies: HTML parse mode; every plain string from the core goes through escapeHtml.

export interface AiReply {
  /** HTML. */
  text: string;
  buttons?: InlineKeyboardButton[][];
}

export type AiOutcome =
  /** `updates`: tasks this request changed (forums also announce them in the "Task events" topic). */
  | { kind: 'reply'; reply: AiReply; updates?: UpdateOutcome[] }
  | { kind: 'create'; useReply: boolean };

export const AI_UNAVAILABLE_MESSAGE = '🤖 AI is unavailable right now — use the card buttons or /new, /list, /done.';
export const WHICH_TASK_MESSAGE = '🤔 Which task? Reply to its card or write #number.';
/** The plan had nothing to do: show what /ai understands instead of asking "Which task?". */
export const NOT_UNDERSTOOD_MESSAGE =
  '🤔 I didn’t get that. Try:\n' +
  '<code>/ai tôi còn task nào?</code> — your open tasks\n' +
  '<code>/ai #12 xong rồi</code> — update a task\n' +
  '<code>/ai tạo task fix login cho @an hạn thứ 6</code> — create one';
/** Plain replies to the bot are ignored, so the answer to a question must come as a new /ai. */
export const CLARIFY_HINT = 'Answer with <code>/ai …</code> — I don’t read plain replies.';
export const DELETE_REFUSAL_MESSAGE = '🗑 I don’t delete tasks from chat. To delete, use 🗑 on the task card (⋯ More → 🗑 Delete).';

type GroupId = AiRequestContext['group']['_id'];

/** `groupId` links each #N to the task (when an app link is configured). */
export function telegramMissText(miss: TargetMiss, groupId?: GroupId): string {
  switch (miss.reason) {
    case 'missing':
      return `❌ There's no task #${miss.number} in this group. Check the number with /list.`;
    case 'no_match':
      return `🤔 I couldn't find a task matching “${escapeHtml(shorten(miss.search, 40))}”. Reply to its card or write #number.`;
    case 'ambiguous': {
      const list = miss.candidates
        .slice(0, 3)
        .map((t) => `${taskNumberHtml(t.taskNumber, groupId, t._id)} ${typeIcon(t.type)} ${escapeHtml(shorten(t.title))}`)
        .join('\n');
      const more = miss.candidates.length > 3 ? `\n…and ${miss.candidates.length - 3} more` : '';
      return `🤔 Which task? Several match:\n${list}${more}\n\nReply to its card or write #number.`;
    }
    default:
      return WHICH_TASK_MESSAGE;
  }
}

function updateText(u: UpdateOutcome, groupId: GroupId): string {
  if (u.failed) {
    return [
      `❌ ${taskNumberHtml(u.original.taskNumber, groupId, u.original._id)} couldn't be fully updated. Please try again or use the buttons on its card.`,
      ...u.changes.map(escapeHtml),
    ].join('\n');
  }
  const header = `${taskNumberHtml(u.task.taskNumber, groupId, u.task._id)} <b>${escapeHtml(shorten(u.task.title))}</b>`;
  return [`${u.changes.length ? '✅' : 'ℹ️'} ${header}`, ...u.changes.map(escapeHtml), ...u.notes.map(escapeHtml)].join('\n');
}

function queryText(q: QueryOutcome, today: string, groupId: GroupId): string {
  if (q.kind === 'unknown_person') {
    return `⚠️ Couldn't find ${escapeHtml(q.person)} in this group — they need to send a message here first.`;
  }
  const lines = [`<b>${q.icon} ${escapeHtml(q.title)} · ${q.tasks.length}</b>`];
  if (q.tasks.length === 0) {
    lines.push(q.emptyText);
    return lines.join('\n');
  }
  for (const task of q.tasks.slice(0, QUERY_LIST_LIMIT)) {
    const parts = [`${taskNumberHtml(task.taskNumber, groupId, task._id)} ${typeIcon(task.type)} ${escapeHtml(shorten(task.title))}`];
    if (q.showStatus) parts.push(statusText(task.status));
    const due = dueText(task.dueDate, task.status, today);
    if (due) parts.push(due);
    const who = populatedUser(task.assigneeId);
    if (q.showAssignee) parts.push(who ? escapeHtml(personName(who)) : 'unassigned');
    lines.push(parts.join(' · '));
  }
  if (q.tasks.length > QUERY_LIST_LIMIT) lines.push(`…and ${q.tasks.length - QUERY_LIST_LIMIT} more`);
  return lines.join('\n');
}

function sectionText(s: AiSection, today: string, groupId: GroupId): string {
  if (s.type === 'update') return updateText(s.update, groupId);
  if (s.type === 'query') return queryText(s.query, today, groupId);
  return `🤖 ${escapeHtml(s.text)}`;
}

/** Exactly today's /ai HTML replies and buttons. */
export function renderTelegram(c: AiRequestContext, result: AiResult): AiOutcome {
  const groupId = c.group._id;
  const board = boardButton(groupId);
  const boardButtons = board ? [[board]] : undefined;
  const reply = (text: string, buttons?: InlineKeyboardButton[][]): AiOutcome => ({ kind: 'reply', reply: { text, buttons } });

  switch (result.kind) {
    case 'clarify':
      return reply(`🤔 ${escapeHtml(result.question)}\n\n<i>${CLARIFY_HINT}</i>`);
    case 'which_task': {
      // A wrong number / search: the board is where to look it up.
      const lookUp = result.miss.reason === 'missing' || result.miss.reason === 'no_match';
      return reply(telegramMissText(result.miss, groupId), lookUp ? boardButtons : undefined);
    }
    case 'create':
      return { kind: 'create', useReply: result.useReply };
    case 'refused':
      if (result.reason === 'delete') return reply(DELETE_REFUSAL_MESSAGE);
      if (result.reason === 'bulk') {
        return reply(
          `✋ I can change at most ${MAX_AI_MUTATIONS} tasks per /ai request. For bulk changes, use the board.`,
          boardButtons,
        );
      }
      return reply('✋ One thing at a time: send the new task and the other change as two separate /ai messages.');
  }

  const { sections } = result;
  if (sections.length === 0) return reply(NOT_UNDERSTOOD_MESSAGE);

  let buttons: InlineKeyboardButton[][] | undefined;
  const updates = sections.flatMap((s) => (s.type === 'update' ? [s.update] : []));
  const failed = updates.filter((u) => u.failed);
  const updatedTasks = updates.filter((u) => !u.failed && u.changes.length).map((u) => u.task);
  if (sections.some((s) => s.type === 'query')) {
    buttons = boardButtons;
  } else if (failed.length === 1 && updatedTasks.length === 0) {
    // "use the buttons on its card" → one tap to that task.
    const open = taskButton(failed[0].original);
    if (open) buttons = [[open]];
  } else if (updatedTasks.length === 1 && failed.length === 0) {
    const open = taskButton(updatedTasks[0]);
    if (open) buttons = [[open]];
  }
  const outcome = reply(sections.map((s) => sectionText(s, c.today, groupId)).join('\n\n'), buttons);
  const changed = changedUpdates(sections).filter((u) => !u.failed);
  return changed.length && outcome.kind === 'reply' ? { ...outcome, updates: changed } : outcome;
}
