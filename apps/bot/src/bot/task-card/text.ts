import { EPIC_COLOR_EMOJI, EpicColor } from '@tbot/shared';
import { IUser } from 'src/database/models/user.model';

/** Escape user text for legacy Markdown (only `_ * \` [` are special outside entities). */
export function escapeMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  return String(text).replace(/([_*`[])/g, '\\$1');
}

/** Shorten long text for list lines on mobile. */
export function truncate(text: string | null | undefined, max = 60): string {
  const value = (text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

type UserLike = Pick<IUser, 'username' | 'firstName'> & { telegramUserId?: number };

/** @username, else first name, else "someone" — never "User 12345". Not escaped. */
export function displayName(user: UserLike | null | undefined): string {
  if (!user) return 'someone';
  if (user.username) return `@${user.username}`;
  return user.firstName || 'someone';
}

/** Escaped display name, ready to drop into a Markdown message. */
export function mdName(user: UserLike | null | undefined): string {
  return escapeMarkdown(displayName(user));
}

/** A populated user ref (from `.populate('createdBy assigneeId')`) or null. */
export function populatedUser(ref: unknown): IUser | null {
  if (ref && typeof ref === 'object' && 'telegramUserId' in (ref as object)) return ref as IUser;
  return null;
}

export function refId(ref: unknown): string | null {
  if (!ref) return null;
  const value = ref as { _id?: { toString(): string }; toString(): string };
  return value._id ? value._id.toString() : value.toString();
}

/** A populated epic ref (`{ _id, title, color }` from TASK_POPULATE) or null. */
export function populatedEpic(ref: unknown): { title: string; color: string } | null {
  if (ref && typeof ref === 'object' && 'title' in (ref as object)) return ref as { title: string; color: string };
  return null;
}

/** "🔵 Login" — the epic as a colored dot + name (escaped, cut for mobile), or null without a (populated) epic. */
export function epicTag(ref: unknown, max = 40): string | null {
  const epic = populatedEpic(ref);
  if (!epic?.title) return null;
  const dot = EPIC_COLOR_EMOJI[epic.color as EpicColor] ?? EPIC_COLOR_EMOJI[EpicColor.GRAY];
  return `${dot} ${escapeMarkdown(truncate(epic.title, max))}`;
}
