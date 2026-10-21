import type { AiChatResponse, AiSubtaskPreview, ITask as SharedTask } from '@tbot/shared';
import { ITask } from 'src/database/models/task.model';
import { detectLang, escapeHtml, personName, shortDay, shorten, typeIcon } from 'src/shared/services/ai-command/format';
import { SubtasksOutcome } from 'src/shared/services/ai-command/result';
import { SUBTASK_PREVIEW_PREFIX, SUBTASK_PREVIEW_TTL_SECONDS } from 'src/shared/services/ai-command/subtask-preview';
import { BATCH_UNDO_WINDOW_MS } from 'src/shared/services/batch-undo.constants';
import { taskButton, taskNumberHtml } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

// How "/ai chia #42 thành subtask" replies look, in Telegram (HTML) and the web chat (plain text):
//
//   🧩 #42 Checkout v2 · 3 subtasks added
//   #43 ✨ Design the API
//   #44 ✨ Build the UI → @an · 📅 Fri 24 Oct
//   💡 Suggested by AI — edit or remove them on the board.
//
// An AI-proposed breakdown is a preview first (nothing created):
//
//   🧩 #42 Checkout v2 · AI suggests 3 subtasks
//   1. Design the API → @an
//   2. Build the UI
//   Add them?                       [✅ Add all] [✖ Cancel]

const dayOf = (date: Date | string) => new Date(date).toISOString().slice(0, 10);

/** "#44 ✨ Build the UI → @an · 📅 Fri 24 Oct" (number part already formatted by the caller). */
function itemLine(num: string, item: SubtasksOutcome['created'][number], today: string, esc: (s: string) => string): string {
  const { task, assignee } = item;
  const parts = [`${num} ${typeIcon(task.type)} ${esc(shorten(task.title))}${assignee ? ` → ${esc(personName(assignee))}` : ''}`];
  if (task.dueDate) parts.push(`📅 ${shortDay(dayOf(task.dueDate), today)}`);
  return parts.join(' · ');
}

function headline(o: SubtasksOutcome, parentRef: string): string {
  const n = o.created.length;
  if (o.refusal) return `⚠️ ${o.refusal}`;
  if (o.preview) {
    const p = o.preview.items.length;
    return `🧩 ${parentRef} · AI suggests ${p} subtask${p === 1 ? '' : 's'}`;
  }
  if (n === 0) return `ℹ️ ${parentRef} · no new subtasks added.`;
  return `🧩 ${parentRef} · ${n} subtask${n === 1 ? '' : 's'} added`;
}

const PROPOSED_NOTE = '💡 Suggested by AI — edit or remove them on the board.';
const PREVIEW_QUESTION = 'Add them? Nothing is created until you tap ✅ Add all.';

/** "1. Design the API → @an" — a proposed (not yet created) subtask. */
const previewLine = (i: number, title: string, assignee: string | null, esc: (s: string) => string) =>
  `${i + 1}. ${esc(shorten(title))}${assignee ? ` → ${esc(assignee)}` : ''}`;

/** Telegram HTML. */
export function telegramSubtasksText(o: SubtasksOutcome, today: string, groupId: unknown): string {
  const gid = groupId as string;
  const parentRef = `${taskNumberHtml(o.parent.taskNumber, gid, o.parent._id)} <b>${escapeHtml(shorten(o.parent.title))}</b>`;
  const lines = [headline(o, parentRef)].map((l) => (o.refusal ? escapeHtml(l) : l));
  for (const item of o.created) {
    lines.push(itemLine(taskNumberHtml(item.task.taskNumber, gid, item.task._id), item, today, escapeHtml));
  }
  o.preview?.items.forEach((item, i) =>
    lines.push(previewLine(i, item.title, item.assignee ? personName(item.assignee) : null, escapeHtml)),
  );
  if (o.preview) lines.push(`<i>${PREVIEW_QUESTION}</i>`);
  if (o.created.length && o.proposed) lines.push(`<i>${PROPOSED_NOTE}</i>`);
  if (o.warnings.length) lines.push('', ...o.warnings.map(escapeHtml));
  return lines.join('\n');
}

/** Telegram buttons: ✅ Add all / ✖ Cancel for a preview; else ↩️ Undo (10 minutes) and 📱 Open #42 — one row. */
export function telegramSubtasksButtons(o: SubtasksOutcome): InlineKeyboardButton[][] | undefined {
  if (o.preview) {
    return [
      [
        { text: '✅ Add all', callback_data: `${SUBTASK_PREVIEW_PREFIX}:add:${o.preview.id}` },
        { text: '✖ Cancel', callback_data: `${SUBTASK_PREVIEW_PREFIX}:cancel:${o.preview.id}` },
      ],
    ];
  }
  const row: InlineKeyboardButton[] = [];
  if (o.undoKey && o.created.length) row.push({ text: '↩️ Undo', callback_data: `batch:undo:${o.undoKey}` });
  const open = taskButton(o.parent);
  if (open) row.push(open);
  return row.length ? [row] : undefined;
}

/** Web chat: plain text + the new subtasks as chips (with undo), like tasks created from the chat. */
export function webSubtasksResponse(o: SubtasksOutcome, request: string, today: string): AiChatResponse {
  const parentRef = `#${o.parent.taskNumber} ${shorten(o.parent.title)}`;
  const lines = [headline(o, parentRef)];
  for (const item of o.created) lines.push(itemLine(`#${item.task.taskNumber}`, item, today, (s) => s));
  o.preview?.items.forEach((item, i) =>
    lines.push(previewLine(i, item.title, item.assignee ? personName(item.assignee) : null, (s) => s)),
  );
  if (o.created.length && o.proposed) lines.push(PROPOSED_NOTE);

  const vi = detectLang(request) === 'vi';
  const n = o.parent.taskNumber;
  const firstUnassigned = o.created.find((c) => !c.assignee)?.task;
  const suggestions = [
    firstUnassigned ? (vi ? `Giao #${firstUnassigned.taskNumber} cho tôi` : `Assign #${firstUnassigned.taskNumber} to me`) : null,
    vi ? `Giải thích #${n}` : `Explain #${n}`,
  ].filter((s): s is string => !!s);

  const asShared = (t: ITask) => t as unknown as SharedTask;
  if (o.preview) {
    const preview: AiSubtaskPreview = {
      previewId: o.preview.id,
      parent: { _id: String(o.parent._id), taskNumber: o.parent.taskNumber, title: o.parent.title },
      items: o.preview.items.map((i) => ({
        title: i.title,
        assignee: i.assignee ? { _id: String(i.assignee._id), name: personName(i.assignee) } : null,
      })),
      expiresAt: new Date(Date.now() + SUBTASK_PREVIEW_TTL_SECONDS * 1000).toISOString(),
    };
    return {
      kind: 'preview',
      // Older clients that don't know `preview` still show the list and how to add them.
      text: [...lines, vi ? 'Bấm "Add all" để tạo, hoặc bỏ qua.' : 'Tap "Add all" to create them, or ignore this.'].join('\n'),
      tasks: [asShared(o.parent)],
      preview,
      ...(o.warnings.length ? { warnings: o.warnings } : {}),
      suggestions: [],
    };
  }
  if (!o.created.length || !o.batchId) {
    return {
      kind: o.refusal ? 'refused' : 'answer',
      text: lines.join('\n'),
      tasks: [asShared(o.parent)],
      ...(o.warnings.length ? { warnings: o.warnings } : {}),
      suggestions,
    };
  }
  return {
    kind: 'created',
    text: lines.join('\n'),
    tasks: o.created.map((c) => asShared(c.task)),
    batchId: o.batchId,
    undoUntil: new Date(Date.now() + BATCH_UNDO_WINDOW_MS).toISOString(),
    ...(o.warnings.length ? { warnings: o.warnings } : {}),
    suggestions,
  };
}
