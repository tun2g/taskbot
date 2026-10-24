import { unknownPersonText } from 'src/shared/services/ai-command.service';
import {
  createEpicCommand,
  epicLabel,
  epicProgressLine,
  MAX_EPIC_OVERVIEW,
  shorten,
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

// The plain-text body of each web "Ask AI" answer section (no HTML/Markdown).

export const WHICH_TASK_TEXT = '🤔 Which task? Write its #number.';

export function missText(miss: TargetMiss): string {
  switch (miss.reason) {
    case 'missing':
      return `❌ There's no task #${miss.number} in this group.`;
    case 'no_match':
      return `🤔 I couldn't find a task matching “${shorten(miss.search, 40)}”.\nWrite its #number.`;
    case 'ambiguous': {
      const list = miss.candidates.slice(0, 3).map((t) => `#${t.taskNumber} ${typeIcon(t.type)} ${shorten(t.title)}`);
      const more = miss.candidates.length > 3 ? [`…and ${miss.candidates.length - 3} more`] : [];
      return ['🤔 Which task? Several match:', ...list, ...more, 'Write its #number.'].join('\n');
    }
    case 'previous_ambiguous':
      return `🤔 Which one? The last answer had ${miss.numbers.length} tasks.\nWrite its #number.`;
    default:
      return WHICH_TASK_TEXT;
  }
}

/** "⚠️ There's no epic “Login” yet." + open epics + the exact message that creates it. */
function epicMissLines(miss: EpicMiss): string[] {
  const lines = [`⚠️ There's no epic “${shorten(miss.title, 30)}” yet.`];
  if (miss.suggestions.length) {
    const more = miss.more ? ` · +${miss.more} more` : '';
    lines.push(`Open epics: ${miss.suggestions.map((e) => epicLabel(e, 24)).join(' · ')}${more}`);
  } else {
    lines.push('This group has no epics yet.');
  }
  lines.push(`➕ Create it: “${createEpicCommand(miss.title, 'web')}”`);
  return lines;
}

function epicCreatedText(o: EpicCreateOutcome): string {
  return [
    o.duplicate ? `ℹ️ Epic ${epicLabel(o.epic)} already exists.` : `✅ Epic ${epicLabel(o.epic)} created`,
    `➕ Add tasks: “Thêm #N vào epic ${shorten(o.epic.title, 30)}”`,
  ].join('\n');
}

function updateText(u: UpdateOutcome): string {
  if (u.failed) {
    return [`❌ #${u.original.taskNumber} couldn't be fully updated. Please try again or edit it on the board.`, ...u.changes].join(
      '\n',
    );
  }
  const header = `${u.changes.length ? '✅' : 'ℹ️'} #${u.task.taskNumber} ${shorten(u.task.title)}`;
  return [header, ...u.changes, ...u.notes, ...(u.epicMiss ? epicMissLines(u.epicMiss) : [])].join('\n');
}

/** "💡 #5 Title", the explanation, then the state lines. #5 stays in the text so "giao nó cho @an" works next. */
function explainText(e: ExplainOutcome, today: string): string {
  const t = e.task;
  const body = e.text
    ? [e.text]
    : [
        '🤖 AI can’t explain it right now — here’s what the task says:',
        t.description?.trim() ? `📝 ${shorten(t.description, 300)}` : '📝 No description yet.',
      ];
  const state = e.fromReply ? [] : ['', ...taskStateLines(t, e.assignee, today, e.subtasks)];
  return [`💡 #${t.taskNumber} ${shorten(t.title)}`, ...body, ...state].join('\n');
}

function queryText(q: QueryOutcome): string {
  if (q.kind === 'unknown_person') return `⚠️ ${unknownPersonText(q.person, 'web')}`;
  if (q.kind === 'unknown_epic') return epicMissLines(q.miss).join('\n');
  if (q.kind === 'epics') {
    const lines = [`🗂 Epics · ${q.epics.length}`];
    if (q.epics.length === 0) lines.push('No epics yet.', `➕ Create one: “${createEpicCommand('Login', 'web')}”`);
    for (const row of q.epics.slice(0, MAX_EPIC_OVERVIEW)) lines.push(epicProgressLine(row));
    if (q.epics.length > MAX_EPIC_OVERVIEW) lines.push(`…and ${q.epics.length - MAX_EPIC_OVERVIEW} more`);
    return lines.join('\n');
  }
  const lines = [`${q.icon} ${q.title} · ${q.tasks.length}`];
  if (q.tasks.length === 0) lines.push(q.emptyText);
  // One task is spelled out so a follow-up ("assign it to @an") can refer to it.
  else if (q.tasks.length === 1) lines.push(`#${q.tasks[0].taskNumber} ${typeIcon(q.tasks[0].type)} ${shorten(q.tasks[0].title)}`);
  return lines.join('\n');
}

export function sectionText(s: AiSection, today: string): string {
  if (s.type === 'update') return updateText(s.update);
  if (s.type === 'query') return queryText(s.query);
  if (s.type === 'explain') return explainText(s.explain, today);
  if (s.type === 'epic_created') return epicCreatedText(s.epic);
  if (s.type === 'note') return s.lines.join('\n');
  if (s.type === 'subtasks') return '';
  return s.text;
}
