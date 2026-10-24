import type { AdminAuditEntry } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { Tooltip } from '@/components/ui/tooltip';

const LINK = 'text-accent-text hover:underline';

/** What the entry is about, linked to its page while that still exists. */
export function TargetLink({ entry }: { entry: AdminAuditEntry }) {
  const label = entry.targetLabel;
  if (entry.targetMissing) {
    return (
      <Tooltip content="Deleted since — there is no page to open.">
        <span className="text-text-2">
          {label ?? '—'} <span className="text-[13px] text-text-3">(deleted)</span>
        </span>
      </Tooltip>
    );
  }
  if (entry.targetType === 'group' && entry.targetId)
    return (
      <Link to="/groups/$groupId" params={{ groupId: entry.targetId }} className={LINK}>
        {label ?? 'Open group'}
      </Link>
    );
  if (entry.targetType === 'user' && entry.targetId)
    return (
      <Link to="/users/$userId" params={{ userId: entry.targetId }} className={LINK}>
        {label ?? 'Open person'}
      </Link>
    );
  if (entry.targetType === 'settings')
    return (
      <Link to="/settings" className={LINK}>
        {label ?? 'Settings'}
      </Link>
    );
  if (entry.targetType === 'system')
    return (
      <Link to="/system" className={LINK}>
        {label ?? 'System'}
      </Link>
    );
  return label ? <span className="text-text-2">{label}</span> : <span className="text-text-3">—</span>;
}
