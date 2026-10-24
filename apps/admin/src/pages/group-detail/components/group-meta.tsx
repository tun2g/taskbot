import type { AdminGroupDetail } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { Meta } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/tooltip';
import { formatDate, formatDateTime, formatNumber, formatRelative, personName } from '@/lib/format';

/** Facts under the group's name: who added it, chat size, last activity, timezone, link / approval date. */
export function GroupMeta({ group }: { group: AdminGroupDetail }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl border border-border bg-surface px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
      <Meta label="Added">
        {/* Wraps instead of cutting off the name of who added the bot. */}
        <span className="block whitespace-normal">
          <Tooltip content={formatDateTime(group.addedAt ?? group.createdAt)}>
            <span>{formatDate(group.addedAt ?? group.createdAt)}</span>
          </Tooltip>
          {group.addedBy && (
            <>
              {' by '}
              {group.addedBy.id ? (
                <TextLink to="/users/$userId" params={{ userId: group.addedBy.id }}>
                  {personName(group.addedBy)}
                </TextLink>
              ) : (
                personName(group.addedBy)
              )}
            </>
          )}
        </span>
      </Meta>
      <Meta label="People in the chat">
        <span className="block whitespace-normal">
          {group.memberCount == null ? (
            <Tooltip content="Telegram didn’t report a member count (the bot may not be in the chat).">
              <span className="text-text-3">Unknown</span>
            </Tooltip>
          ) : (
            formatNumber(group.memberCount)
          )}
          <span className="text-text-3"> · {formatNumber(group.knownMembers)} used the bot</span>
        </span>
      </Meta>
      <Meta label="Last activity">
        {group.lastActivityAt ? (
          <Tooltip content={formatDateTime(group.lastActivityAt)}>
            <span>{formatRelative(group.lastActivityAt)}</span>
          </Tooltip>
        ) : (
          'No activity yet'
        )}
      </Meta>
      <Meta label="Timezone">
        <Tooltip content="Used for due dates, reminders and the daily digest in this group.">
          <span>{group.timezone}</span>
        </Tooltip>
      </Meta>
      <Meta label={group.publicLink ? 'Public link' : 'Approved'}>
        {group.publicLink ? (
          <a href={group.publicLink} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">
            {group.publicLink.replace(/^https?:\/\//, '')}
          </a>
        ) : group.approvedAt ? (
          <Tooltip content={formatDateTime(group.approvedAt)}>
            <span>{formatDate(group.approvedAt)}</span>
          </Tooltip>
        ) : (
          <span className="text-text-3">Not approved</span>
        )}
      </Meta>
    </dl>
  );
}
