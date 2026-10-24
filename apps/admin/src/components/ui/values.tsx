import type { AdminPersonRef } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { cn } from '@/lib/cn';
import { formatDateTime, formatRelative, personName } from '@/lib/format';

import { Tooltip } from './tooltip';

/** "3 hours ago" with the exact time on hover. */
export function RelativeTime({ value, never = 'Never' }: { value: string | null | undefined; never?: string }) {
  if (!value) return <span className="text-text-3">{never}</span>;
  return (
    <Tooltip content={formatDateTime(value)}>
      <time dateTime={value} className="whitespace-nowrap">
        {formatRelative(value)}
      </time>
    </Tooltip>
  );
}

/** Soft tinted backgrounds for initials; the same person always gets the same tint. */
const AVATAR_TINTS = [
  'bg-accent-soft text-accent-text',
  'bg-good-soft text-good',
  'bg-warn-soft text-warn',
  'bg-danger-soft text-danger',
  'bg-neutral-soft text-text-2',
];

export function Avatar({ name, seed, className }: { name: string; seed: number | string; className?: string }) {
  const initials =
    name
      .replace(/^@/, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  const n = Math.abs(String(seed).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0));
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
        AVATAR_TINTS[n % AVATAR_TINTS.length],
        className,
      )}
    >
      {initials}
    </span>
  );
}

/** A person's name with @username; links to their page when they have an account. */
export function PersonCell({ person, link = true }: { person: AdminPersonRef | null; link?: boolean }) {
  if (!person) return <span className="text-text-3">Unknown person</span>;
  const name = personName(person);
  const content = (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name} seed={person.telegramUserId} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-text">{name}</span>
        {person.username && <span className="block truncate text-sm text-text-3">@{person.username}</span>}
      </span>
    </span>
  );
  if (!link || !person.id) return content;
  return (
    <Link to="/users/$userId" params={{ userId: person.id }} className="block min-w-0 hover:[&_.font-medium]:text-accent-text" onClick={(e) => e.stopPropagation()}>
      {content}
    </Link>
  );
}
