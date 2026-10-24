import type { AdminPersonRef } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { formatDateTime, formatRelative, personName } from '@/lib/format';

/** "3 hours ago" with the exact time on hover. */
export function RelativeTime({ value, never = 'Never' }: { value: string | null | undefined; never?: string }) {
  if (!value) return <span className="text-text-3">{never}</span>;
  return (
    <time dateTime={value} title={formatDateTime(value)} className="whitespace-nowrap">
      {formatRelative(value)}
    </time>
  );
}

/** A person's name with @username; links to their page when they have an account. */
export function PersonCell({ person, link = true }: { person: AdminPersonRef | null; link?: boolean }) {
  if (!person) return <span className="text-text-3">Unknown person</span>;
  const content = (
    <span className="min-w-0">
      <span className="block truncate font-medium text-text">{personName(person)}</span>
      {person.username && <span className="block truncate text-xs text-text-3">@{person.username}</span>}
    </span>
  );
  if (!link || !person.id) return content;
  return (
    <Link to="/users/$userId" params={{ userId: person.id }} className="block hover:[&_span:first-child]:text-accent-text" onClick={(e) => e.stopPropagation()}>
      {content}
    </Link>
  );
}
