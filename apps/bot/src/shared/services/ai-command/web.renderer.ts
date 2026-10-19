import type { AiChatResponse, AiTaskChange, ITask as SharedTask } from '@tbot/shared';
import { isClosedStatus } from '@tbot/shared';
import { refId } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import { unknownPersonText } from 'src/shared/services/ai-command.service';
import { shorten, typeIcon } from 'src/shared/services/ai-command/format';
import { MAX_AI_MUTATIONS } from 'src/shared/services/ai-command/plan.schema';
import { AiResult, AiSection, changedUpdates, QueryOutcome, TargetMiss, UpdateOutcome } from 'src/shared/services/ai-command/result';
import type { CreatedTask } from 'src/shared/services/task-creation.service';

// Web "Ask AI" replies: PLAIN text only (no HTML/Markdown) in short lines; the web app renders
// `tasks` / `changed` as rich chips.

export const WEB_AI_UNAVAILABLE_TEXT = 'AI is unavailable right now — you can still edit tasks on the board.';
export const WEB_AI_BUSY_TEXT = 'AI is busy in this group — try again in a few minutes. You can still edit tasks on the board.';
export const WEB_SAVE_FAILED_TEXT = "❌ I couldn't save the task. Please try again in a moment.";
const WHICH_TASK_TEXT = '🤔 Which task? Write its #number.';
/** Most tasks a query returns to the web (the rest is counted in totalMatches). */
export const WEB_QUERY_LIMIT = 20;
const MAX_SUGGESTIONS = 3;

/** API tasks are the shared shape (refs populated); the DB model type differs only in ref typing. */
const asShared = (task: ITask) => task as unknown as SharedTask;

type Lang = 'vi' | 'en';

const VIETNAMESE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

export function detectLang(text: string): Lang {
  return VIETNAMESE.test(text) ? 'vi' : 'en';
}

const PHRASES: Record<Lang, {
  mine: string;
  overdue: string;
  open: string;
  assignMe: (n: number) => string;
  done: (n: number) => string;
  due: (n: number) => string;
}> = {
  en: {
    mine: 'What are my open tasks?',
    overdue: "What's overdue?",
    open: 'What is still open?',
    assignMe: (n) => `Assign #${n} to me`,
    done: (n) => `Mark #${n} done`,
    due: (n) => `Set due date for #${n}`,
  },
  vi: {
    mine: 'Tôi còn task nào?',
    overdue: 'Có gì quá hạn không?',
    open: 'Còn task nào đang mở?',
    assignMe: (n) => `Giao #${n} cho tôi`,
    done: (n) => `#${n} xong rồi`,
    due: (n) => `Đặt hạn cho #${n}`,
  },
};

function pick(items: (string | false | null | undefined)[]): string[] {
  return Array.from(new Set(items.filter((s): s is string => !!s))).slice(0, MAX_SUGGESTIONS);
}

const isMine = (task: ITask, c: AiRequestContext) => refId(task.assigneeId) === c.requester._id.toString();

/** Follow-ups for one task: assign it to me (unless it was just reassigned) / mark done / set a due date. */
function taskFollowUps(task: ITask, c: AiRequestContext, lang: Lang, offerAssign = true): string[] {
  const p = PHRASES[lang];
  return [
    offerAssign && !isMine(task, c) && !isClosedStatus(task.status) ? p.assignMe(task.taskNumber) : null,
    isMine(task, c) && !isClosedStatus(task.status) ? p.done(task.taskNumber) : null,
    !task.dueDate && !isClosedStatus(task.status) ? p.due(task.taskNumber) : null,
  ].filter((s): s is string => !!s);
}

// ── Texts ──

function missText(miss: TargetMiss): string {
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

function updateText(u: UpdateOutcome): string {
  if (u.failed) {
    return [`❌ #${u.original.taskNumber} couldn't be fully updated. Please try again or edit it on the board.`, ...u.changes].join(
      '\n',
    );
  }
  const header = `${u.changes.length ? '✅' : 'ℹ️'} #${u.task.taskNumber} ${shorten(u.task.title)}`;
  return [header, ...u.changes, ...u.notes].join('\n');
}

function queryText(q: QueryOutcome): string {
  if (q.kind === 'unknown_person') return `⚠️ ${unknownPersonText(q.person, 'web')}`;
  const lines = [`${q.icon} ${q.title} · ${q.tasks.length}`];
  if (q.tasks.length === 0) lines.push(q.emptyText);
  // One task is spelled out so a follow-up ("assign it to @an") can refer to it.
  else if (q.tasks.length === 1) lines.push(`#${q.tasks[0].taskNumber} ${typeIcon(q.tasks[0].type)} ${shorten(q.tasks[0].title)}`);
  return lines.join('\n');
}

function sectionText(s: AiSection): string {
  if (s.type === 'update') return updateText(s.update);
  if (s.type === 'query') return queryText(s.query);
  return s.text;
}

/** Renders a core result (anything but `create`) as the web chat response. */
export function renderWeb(c: AiRequestContext, result: Exclude<AiResult, { kind: 'create' }>): AiChatResponse {
  const lang = detectLang(c.request);
  const p = PHRASES[lang];

  switch (result.kind) {
    case 'clarify':
      return { kind: 'clarify', text: `🤔 ${result.question}`, suggestions: [] };
    case 'which_task': {
      const response: AiChatResponse = { kind: 'clarify', text: missText(result.miss), suggestions: [] };
      if (result.miss.reason === 'ambiguous') response.tasks = result.miss.candidates.slice(0, 5).map(asShared);
      return response;
    }
    case 'refused': {
      const text =
        result.reason === 'delete'
          ? '🗑 I don’t delete tasks from chat. Open the task and delete it there.'
          : result.reason === 'bulk'
            ? `✋ I can change at most ${MAX_AI_MUTATIONS} tasks per request.\nFor bulk changes, use the board.`
            : '✋ One thing at a time: send the new task and the other change as two separate messages.';
      return { kind: 'refused', text, suggestions: pick([p.mine, p.overdue]) };
    }
  }

  const { sections } = result;
  if (sections.length === 0) return { kind: 'clarify', text: WHICH_TASK_TEXT, suggestions: [] };

  const text = sections.map(sectionText).join('\n\n');
  const changed = changedUpdates(sections);
  const list = sections.find(
    (s): s is { type: 'query'; query: Extract<QueryOutcome, { kind: 'list' }> } =>
      s.type === 'query' && s.query.kind === 'list',
  )?.query;

  const response: AiChatResponse = { kind: 'answer', text };
  if (list) {
    response.tasks = list.tasks.slice(0, WEB_QUERY_LIMIT).map(asShared);
    if (list.tasks.length > WEB_QUERY_LIMIT) response.totalMatches = list.tasks.length;
  }

  if (changed.length) {
    response.kind = 'updated';
    response.changed = changed.map((u): AiTaskChange => ({ task: asShared(u.task), changes: u.changes }));
    const single = changed.length === 1 ? taskFollowUps(changed[0].task, c, lang, false) : [];
    response.suggestions = pick([...single, p.mine, p.overdue]);
  } else if (list) {
    response.kind = 'query';
    const first = list.tasks[0];
    response.suggestions = pick([
      ...(first ? taskFollowUps(first, c, lang).slice(0, 1) : []),
      list.queryKind !== 'overdue' && p.overdue,
      !list.mine && p.mine,
      list.mine && p.open,
    ]);
  } else {
    response.suggestions = pick([p.mine, p.overdue]);
  }
  return response;
}

/** Tasks created from the web chat (the group already got its "(via app)" post). */
export function renderWebCreated(
  c: AiRequestContext,
  created: CreatedTask[],
  warnings: string[],
  batchId: string,
  undoUntil: Date,
): AiChatResponse {
  const tasks = created.map((x) => x.task);
  const text =
    tasks.length === 1
      ? `✅ Created #${tasks[0].taskNumber} ${shorten(tasks[0].title)}`
      : `🤖 Created ${tasks.length} tasks: ${tasks.map((t) => `#${t.taskNumber}`).join(', ')}`;
  const lang = detectLang(c.request);
  const p = PHRASES[lang];
  const first = tasks[0];
  return {
    kind: 'created',
    text,
    tasks: tasks.map(asShared),
    batchId,
    undoUntil: undoUntil.toISOString(),
    ...(warnings.length ? { warnings } : {}),
    suggestions: pick([
      !first.dueDate && p.due(first.taskNumber),
      !first.assigneeId && p.assignMe(first.taskNumber),
      p.mine,
    ]),
  };
}
