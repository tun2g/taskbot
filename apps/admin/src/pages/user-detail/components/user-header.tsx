import type { AdminUserDetail } from '@tbot/shared';

import { AiOverrideBadge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/card';
import { Avatar } from '@/components/ui/values';
import { formatDate, personName } from '@/lib/format';
import { scrollToSection } from '@/lib/use-scroll-to-hash';

/** Name, @username, first use, and — only when you set one — the AI override with its reason. */
export function UserHeader({ user }: { user: AdminUserDetail }) {
  const name = personName(user.person);
  const overridden = user.aiDisabled || user.aiDailyLimit != null;
  return (
    <PageHeader
      title={
        <span className="flex items-center gap-3">
          <Avatar name={name} seed={user.person.telegramUserId} className="size-11 text-base" />
          {name}
        </span>
      }
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {user.person.username && <span>@{user.person.username}</span>}
          <span>First used the bot on {formatDate(user.createdAt)}</span>
          {overridden ? (
            <button type="button" onClick={() => scrollToSection('ai-limits')} className="flex cursor-pointer items-center gap-2 text-left">
              <AiOverrideBadge disabled={user.aiDisabled} dailyLimit={user.aiDailyLimit} />
              {user.aiReason && <span className="text-[15px] text-text-2">“{user.aiReason}”</span>}
            </button>
          ) : (
            <span>AI: default limit{user.aiToday.limit != null ? ` (${user.aiToday.limit}/day)` : ''}</span>
          )}
        </span>
      }
    />
  );
}
