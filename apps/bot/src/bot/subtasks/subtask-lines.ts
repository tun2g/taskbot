import type { SubtaskProgress } from 'src/database/services/subtask.service';

// Pure text pieces for subtasks on cards, DMs and /list. Legacy Markdown unless the name says Html.

export interface ParentRefLike {
  taskNumber: number;
  title: string;
}

/** A populated parent ref (`{ _id, taskNumber, title, status }` from TASK_POPULATE) or null. */
export function populatedParent(ref: unknown): ParentRefLike | null {
  if (ref && typeof ref === 'object' && 'taskNumber' in (ref as object) && 'title' in (ref as object)) {
    return ref as ParentRefLike;
  }
  return null;
}

/** Shorten long text for one mobile line. */
function cut(text: string, max: number): string {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function escapeMd(text: string): string {
  return text.replace(/([_*`[])/g, '\\$1');
}

/** "↳ Subtask of *#42* · Fix login" — under a subtask card's title. */
export function parentLine(parent: ParentRefLike | null, max = 40): string | null {
  if (!parent) return null;
  return `↳ Subtask of *#${parent.taskNumber}* · ${escapeMd(cut(parent.title, max))}`;
}

/** " (↳ #42)" after a subtask in a one-line group event; "" for a regular task. */
export function parentSuffix(parent: ParentRefLike | null): string {
  return parent ? ` (↳ #${parent.taskNumber})` : '';
}

const hasSubtasks = (p: SubtaskProgress | null | undefined): p is SubtaskProgress =>
  !!p && p.total + p.cancelled > 0;

/** All counted subtasks are done (cancelled ones don't count). */
export function allSubtasksDone(p: SubtaskProgress | null | undefined): boolean {
  return !!p && p.total > 0 && p.done >= p.total;
}

/** "2/4 done · 1 cancelled", "4/4 done ✅", "2 cancelled" — the counts part of the progress line. */
function progressCounts(p: SubtaskProgress): string {
  const parts: string[] = [];
  if (p.total > 0) parts.push(`${p.done}/${p.total} done${allSubtasksDone(p) ? ' ✅' : ''}`);
  if (p.cancelled > 0) parts.push(`${p.cancelled} cancelled`);
  return parts.join(' · ');
}

/** "🧩 Subtasks: 2/4 done · 1 cancelled" (cancelled ones are left out of the count), or null without subtasks. */
export function progressLine(progress: SubtaskProgress | null | undefined): string | null {
  if (!hasSubtasks(progress)) return null;
  return `🧩 Subtasks: ${progressCounts(progress)}`;
}

/** /list suffix (HTML): " ↳ #42" for a subtask, " · 🧩 2/4" for a parent, "" otherwise. */
export function listSuffixHtml(parent: ParentRefLike | null, progress: SubtaskProgress | null | undefined): string {
  if (parent) return ` <i>↳ #${parent.taskNumber}</i>`;
  if (progress && progress.total > 0) return ` · 🧩 ${progress.done}/${progress.total}`;
  return '';
}

export interface SubtaskRow {
  taskNumber: number;
  title: string;
  /** Status emoji, e.g. "🔄". */
  statusEmoji: string;
  /** "@an", or null when nobody is assigned. Not escaped. */
  assignee: string | null;
}

/**
 * The card's "🧩 Subtasks" view (Markdown), shown under the card text:
 *   🧩 *Subtasks* · 2/4 done · 1 cancelled
 *   ✅ #45 Write tests — @an
 *   🔄 #46 Build the UI — @binh
 * Empty: how to add one with /sub.
 */
export function subtaskListText(rows: SubtaskRow[], progress: SubtaskProgress | null | undefined): string {
  if (rows.length === 0) {
    return ['🧩 *No subtasks yet*', 'Reply `/sub Write tests @an` to this card to add one — one per line for several.'].join(
      '\n',
    );
  }
  const head = hasSubtasks(progress) ? `🧩 *Subtasks* · ${progressCounts(progress)}` : '🧩 *Subtasks*';
  const lines = rows.map((r) => {
    const who = r.assignee ? ` — ${escapeMd(r.assignee)}` : ' — _unassigned_';
    return `${r.statusEmoji} #${r.taskNumber} ${escapeMd(cut(r.title, 40))}${who}`;
  });
  return [head, ...lines, '', 'Reply `/sub …` to this card to add more.'].join('\n');
}
