import type { IUser, UserRef } from '@tbot/shared';

/** `_id` of a populated user object or a bare id string. */
export function getUserId(ref: UserRef | null | undefined): string | null {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  return ref._id ?? null;
}

/** Resolve a ref to a user object, looking bare ids up in `members` when given. */
export function resolveUser(ref: UserRef | null | undefined, members?: IUser[]): IUser | null {
  if (!ref) return null;
  if (typeof ref !== 'string') return ref;
  return members?.find((m) => m._id === ref) ?? null;
}

/** "@username", else "First Last", else a neutral fallback — never "@undefined". */
export function displayName(
  ref: UserRef | null | undefined,
  options: { members?: IUser[]; fallback?: string } = {},
): string {
  const { members, fallback = 'Unknown user' } = options;
  const user = resolveUser(ref, members);
  if (!user) return ref ? fallback : 'Unassigned';
  if (user.username) return `@${user.username}`;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  return user.telegramUserId ? `User ${user.telegramUserId}` : fallback;
}

/**
 * Two letters for an avatar bubble, so "Tuan" and "Thao" don't both read "T": first + last initial
 * ("TN"), else the first two letters of the first name / username ("Tu", "Th").
 */
export function initials(ref: UserRef | null | undefined, members?: IUser[]): string {
  const user = resolveUser(ref, members);
  if (!user) return '?';
  const first = Array.from((user.firstName ?? '').trim());
  const last = Array.from((user.lastName ?? '').trim());
  if (first.length && last.length) return `${first[0]}${last[0]}`.toUpperCase();
  const source = Array.from((user.firstName || user.username || '?').replace(/^@/, '').trim());
  return `${(source[0] ?? '?').toUpperCase()}${(source[1] ?? '').toLowerCase()}`;
}
