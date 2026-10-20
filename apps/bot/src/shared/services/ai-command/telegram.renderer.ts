import { populatedUser } from 'src/bot/task-card.renderer';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import {
  createEpicCommand,
  dueText,
  epicLabel,
  epicProgressLine,
  escapeHtml,
  MAX_EPIC_OVERVIEW,
  personName,
  QUERY_LIST_LIMIT,
  shorten,
  statusText,
  taskStateLines,
  typeIcon,
} from 'src/shared/services/ai-command/format';
import { MAX_AI_MUTATIONS } from 'src/shared/services/ai-command/plan.schema';
import {
  AiResult,
  AiSection,
  changedUpdates,
  EpicCreateOutcome,
  EpicMiss,
  ExplainOutcome,
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
/** Shown in an explanation when the second AI call failed: the task's own details follow. */
export const EXPLAIN_UNAVAILABLE_NOTE = '🤖 AI can’t explain it right now — here’s what the task says:';
/** Most description characters shown when the AI explanation is unavailable. */
const EXPLAIN_FALLBACK_MAX = 300;
/** Most characters of the source message quoted when there's no description either. */
const EXPLAIN_SOURCE_MAX = 100;

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

/** The command that adds tasks to an epic (shown after creating one). */
export function addToEpicCommand(title: string): string {
  return `/ai thêm #N vào epic ${shorten(title, 30)}`;
}

/**
 * ⚠️ There's no epic “Login” yet.
 * Open epics: 🔵 Auth · 🟢 Payments
 * ➕ Create it: /ai tạo epic Login
 */
export function epicMissLines(miss: EpicMiss): string[] {
  const lines = [`⚠️ There's no epic “${escapeHtml(shorten(miss.title, 30))}” yet.`];
  if (miss.suggestions.length) {
    const more = miss.more ? ` · +${miss.more} more` : '';
    lines.push(`Open epics: ${miss.suggestions.map((e) => escapeHtml(epicLabel(e, 24))).join(' · ')}${more}`);
  } else {
    lines.push('This group has no epics yet.');
  }
  lines.push(`➕ Create it: <code>${escapeHtml(createEpicCommand(miss.title))}</code>`);
  return lines;
}

function epicCreatedText(o: EpicCreateOutcome): string {
  const label = `<b>${escapeHtml(epicLabel(o.epic))}</b>`;
  return [
    o.duplicate ? `ℹ️ Epic ${label} already exists.` : `✅ Epic ${label} created`,
    `➕ Add tasks: <code>${escapeHtml(addToEpicCommand(o.epic.title))}</code>`,
  ].join('\n');
}

function updateText(u: UpdateOutcome, groupId: GroupId): string {
  if (u.failed) {
    return [
      `❌ ${taskNumberHtml(u.original.taskNumber, groupId, u.original._id)} couldn't be fully updated. Please try again or use the buttons on its card.`,
      ...u.changes.map(escapeHtml),
    ].join('\n');
  }
  const header = `${taskNumberHtml(u.task.taskNumber, groupId, u.task._id)} <b>${escapeHtml(shorten(u.task.title))}</b>`;
  return [
    `${u.changes.length ? '✅' : 'ℹ️'} ${header}`,
    ...u.changes.map(escapeHtml),
    ...u.notes.map(escapeHtml),
    ...(u.epicMiss ? epicMissLines(u.epicMiss) : []),
  ].join('\n');
}

/**
 * Without the AI: the description, else what the task was created from ("💬 Tú: “…”"), else a plain
 * "No description yet."
 */
function fallbackDetail(t: ExplainOutcome['task']): string {
  if (t.description?.trim()) return `📝 ${escapeHtml(shorten(t.description, EXPLAIN_FALLBACK_MAX))}`;
  const source = t.sourceMessages?.find((m) => m?.text?.trim()) ?? (t.sourceMessage?.text?.trim() ? t.sourceMessage : null);
  if (source) {
    const name = source.fromName?.replace(/^@/, '').trim();
    const quote = `“${escapeHtml(shorten(source.text, EXPLAIN_SOURCE_MAX))}”`;
    return `💬 ${name ? `${escapeHtml(name)}: ` : ''}${quote}`;
  }
  return '📝 No description yet.';
}

/**
 * 💡 #5 <b>Title</b>
 * <explanation, ≤ 6 short lines>
 *
 * 🐞 Bug · 🔄 In progress · ⬆️ High
 * 👤 @an · 📅 due tomorrow
 */
function explainText(e: ExplainOutcome, today: string, groupId: GroupId): string {
  const t = e.task;
  const header = `💡 ${taskNumberHtml(t.taskNumber, groupId, t._id)} <b>${escapeHtml(shorten(t.title))}</b>`;
  const body = e.text ? escapeHtml(e.text) : [`<i>${EXPLAIN_UNAVAILABLE_NOTE}</i>`, fallbackDetail(t)].join('\n');
  // The replied card is right above: its state would only repeat it.
  if (e.fromReply) return [header, body].join('\n');
  return [header, body, '', ...taskStateLines(t, e.assignee, today).map(escapeHtml)].join('\n');
}

function queryText(q: QueryOutcome, today: string, groupId: GroupId): string {
  if (q.kind === 'unknown_person') {
    return `⚠️ Couldn't find ${escapeHtml(q.person)} in this group — they need to send a message here first.`;
  }
  if (q.kind === 'unknown_epic') return epicMissLines(q.miss).join('\n');
  if (q.kind === 'epics') {
    const lines = [`<b>🗂 Epics · ${q.epics.length}</b>`];
    if (q.epics.length === 0) {
      lines.push('No epics yet.', `➕ Create one: <code>${escapeHtml(createEpicCommand('Login'))}</code>`);
      return lines.join('\n');
    }
    for (const row of q.epics.slice(0, MAX_EPIC_OVERVIEW)) lines.push(escapeHtml(epicProgressLine(row)));
    if (q.epics.length > MAX_EPIC_OVERVIEW) lines.push(`…and ${q.epics.length - MAX_EPIC_OVERVIEW} more`);
    return lines.join('\n');
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
  if (s.type === 'explain') return explainText(s.explain, today, groupId);
  if (s.type === 'epic_created') return epicCreatedText(s.epic);
  if (s.type === 'note') return s.lines.map(escapeHtml).join('\n');
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
  const explainSections = sections.flatMap((s) => (s.type === 'explain' ? [s.explain] : []));
  // The replied card needs no "Open" button — the user is looking at it.
  const explained = explainSections.filter((e) => !e.fromReply).map((e) => e.task);
  if (sections.some((s) => s.type === 'query')) {
    buttons = boardButtons;
  } else if (sections.some((s) => s.type === 'epic_created')) {
    // The new epic lives on the board; tasks changed in the same request get their own button.
    const row = [...updatedTasks.slice(0, 2).map((t) => taskButton(t)), board].filter(
      (b): b is InlineKeyboardButton => !!b,
    );
    if (row.length) buttons = [row];
  } else if (explainSections.length && failed.length === 0) {
    // "📱 Open #N" for each task on screen (explained or changed) — one row, at most 3.
    const shown = [...updatedTasks, ...explained].filter(
      (t, i, all) => all.findIndex((x) => x._id.toString() === t._id.toString()) === i,
    );
    const row = shown
      .slice(0, 3)
      .map((t) => taskButton(t))
      .filter((b): b is InlineKeyboardButton => !!b);
    if (row.length) buttons = [row];
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
