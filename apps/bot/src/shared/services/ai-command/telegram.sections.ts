import { populatedUser } from 'src/bot/task-card.renderer';
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
import {
  AiSection,
  EpicCreateOutcome,
  EpicMiss,
  ExplainOutcome,
  QueryOutcome,
  TargetMiss,
  UpdateOutcome,
} from 'src/shared/services/ai-command/result';
import { telegramSubtasksText } from 'src/shared/services/ai-command/subtasks.render';
import {
  EXPLAIN_FALLBACK_MAX,
  EXPLAIN_SOURCE_MAX,
  EXPLAIN_UNAVAILABLE_NOTE,
  GroupId,
  WHICH_TASK_MESSAGE,
} from 'src/shared/services/ai-command/telegram.messages';
import { taskNumberHtml } from 'src/shared/utils/app-links';

// The HTML text of each /ai reply section; every plain string from the core goes through escapeHtml.

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
  return [header, body, '', ...taskStateLines(t, e.assignee, today, e.subtasks).map(escapeHtml)].join('\n');
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

export function sectionText(s: AiSection, today: string, groupId: GroupId): string {
  if (s.type === 'update') return updateText(s.update, groupId);
  if (s.type === 'query') return queryText(s.query, today, groupId);
  if (s.type === 'explain') return explainText(s.explain, today, groupId);
  if (s.type === 'epic_created') return epicCreatedText(s.epic);
  if (s.type === 'note') return s.lines.map(escapeHtml).join('\n');
  if (s.type === 'subtasks') return telegramSubtasksText(s.subtasks, today, groupId);
  return `🤖 ${escapeHtml(s.text)}`;
}
