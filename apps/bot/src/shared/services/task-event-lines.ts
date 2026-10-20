import { IUser } from 'src/database/models/user.model';

// Pure builders for the one-line group "event" messages about task changes (HTML).

export type TaskChangeField = 'status' | 'assignee' | 'priority' | 'type' | 'title' | 'description' | 'due_date' | 'epic';

/** One changed field, with human-readable before/after values (labels, names, YYYY-MM-DD). */
export interface TaskChange {
  field: TaskChangeField;
  from: string | null;
  to: string | null;
  /** Emoji shown before `from` / `to` in group lines only (e.g. the epic's 🟦) — never stored in the activity log. */
  fromIcon?: string | null;
  toIcon?: string | null;
}

/** Only these changes are announced in the group; the rest just refresh the card. */
const ANNOUNCED_FIELDS: TaskChangeField[] = ['status', 'assignee', 'title'];
/** Mentioned in the line when an announced change is posted anyway — never a reason to post on their own. */
const PIGGYBACK_FIELDS: TaskChangeField[] = ['epic'];
const SHORT_TITLE_MAX = 60;

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Title cut to at most 60 characters (with an ellipsis when cut). */
export function shortTitle(title: string, max = SHORT_TITLE_MAX): string {
  const chars = Array.from((title || '').replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

export function userDisplayName(user?: Pick<IUser, 'username' | 'firstName' | 'lastName'> | null): string {
  if (!user) return 'Someone';
  if (user.username) return `@${user.username}`;
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || 'Someone';
}

/** `<b>#12</b> Title`; with a link the number opens the task (`<a href>` around the bold number). */
function taskRef(taskNumber: number, title: string, link?: string | null): string {
  return `${taskNumberRef(taskNumber, link)} ${escapeHtml(shortTitle(title))}`;
}

function taskNumberRef(taskNumber: number, link?: string | null): string {
  const num = `<b>#${taskNumber}</b>`;
  return link ? `<a href="${escapeHtml(link).replace(/"/g, '&quot;')}">${num}</a>` : num;
}

function describeStatus(change: TaskChange, single: boolean, ref: string): string {
  const to = escapeHtml(change.to || '');
  if (single) return `moved ${ref} to ${to}`;
  return `moved it to ${to}`;
}

function describeAssignee(change: TaskChange, single: boolean, ref: string): string {
  if (change.to) {
    const to = escapeHtml(change.to);
    return single ? `assigned ${ref} to ${to}` : `assigned it to ${to}`;
  }
  const prev = change.from ? ` ${escapeHtml(change.from)}` : '';
  return single ? `unassigned${prev} from ${ref}` : `unassigned${prev}`;
}

function withIcon(icon: string | null | undefined, text: string): string {
  return icon ? `${icon} ${escapeHtml(text)}` : escapeHtml(text);
}

/** Single: "added #12 Fix login to epic 🟦 Login"; combined: "epic → 🟦 Login" / "removed from epic 🟦 Login". */
function describeEpic(change: TaskChange, single: boolean, ref: string): string {
  if (change.to) {
    const to = withIcon(change.toIcon, change.to);
    if (!single) return `epic → ${to}`;
    return change.from ? `moved ${ref} to epic ${to}` : `added ${ref} to epic ${to}`;
  }
  const prev = change.from ? ` ${withIcon(change.fromIcon, change.from)}` : '';
  return single ? `removed ${ref} from epic${prev}` : `removed from epic${prev}`;
}

/**
 * One short HTML line for a change from the app (or `via` another channel, e.g. "/ai"), e.g.
 * `📝 @an moved <b>#12</b> Fix login to 🔄 In Progress (via app)`.
 * `link` (optional) makes the task number tappable — for multi-line posts where a button can't say which task.
 * Returns null when nothing worth announcing changed (priority/type/description/due date/epic only); an epic change
 * is still mentioned when it comes with a status / assignee / title change.
 */
export function buildChangeLine(
  actorName: string,
  taskNumber: number,
  title: string,
  changes: TaskChange[],
  via = 'app',
  link?: string | null,
): string | null {
  if (!changes.some((c) => ANNOUNCED_FIELDS.includes(c.field))) return null;
  const announced = changes.filter((c) => ANNOUNCED_FIELDS.includes(c.field) || PIGGYBACK_FIELDS.includes(c.field));

  const who = escapeHtml(actorName);
  const ref = taskRef(taskNumber, title, link);
  const single = announced.length === 1;

  const parts = announced.map((change) => {
    switch (change.field) {
      case 'status':
        return describeStatus(change, single, ref);
      case 'assignee':
        return describeAssignee(change, single, ref);
      case 'epic':
        return describeEpic(change, single, ref);
      default:
        return single ? `renamed ${taskNumberRef(taskNumber, link)} to ${escapeHtml(shortTitle(title))}` : 'renamed it';
    }
  });

  if (single) return `📝 ${who} ${parts[0]} (via ${via})`;
  return `📝 ${who} updated ${ref}: ${parts.join(', ')} (via ${via})`;
}

export function buildDeleteLine(actorName: string, taskNumber: number, title: string): string {
  return `🗑 ${escapeHtml(actorName)} deleted ${taskRef(taskNumber, title)} (via app)`;
}
