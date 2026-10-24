import type { AdminGroupDetail } from '@tbot/shared';
import { GroupStatus } from '@tbot/shared';
import type { ReactNode } from 'react';

import { formatDate } from '@/lib/format';

export const STATUS_CHANGE_VERB: Partial<Record<GroupStatus, string>> = {
  [GroupStatus.REJECTED]: 'Rejected',
  [GroupStatus.SUSPENDED]: 'Suspended',
  [GroupStatus.LEFT]: 'Bot removed',
  [GroupStatus.MIGRATED]: 'Moved',
  [GroupStatus.ACTIVE]: 'Status changed',
};

/** How the owner (or the group) can undo where this group is now. Null for states that need no way back. */
export function howToReverse(group: AdminGroupDetail): ReactNode {
  switch (group.status) {
    case GroupStatus.REJECTED:
      return (
        <>
          Changed your mind? <strong className="font-medium text-text">Reconsider</strong> clears the rejection. The bot
          can’t rejoin by itself — once someone adds it to the chat again, the group waits for your approval like a new
          one.
        </>
      );
    case GroupStatus.LEFT: {
      const left = group.botLeftAt ? `The bot left on ${formatDate(group.botLeftAt)}. ` : '';
      if (group.statusBeforeLeft === GroupStatus.ACTIVE) {
        return `${left}To bring it back, someone in the group adds the bot again — it works right away, no new approval needed.`;
      }
      if (group.statusBeforeLeft === GroupStatus.SUSPENDED) {
        return `${left}If someone adds the bot again, the group is still suspended until you unsuspend it.`;
      }
      return `${left}If someone adds the bot again, the group waits for your approval.`;
    }
    case GroupStatus.SUSPENDED:
      return (
        <>
          Members see that the bot is paused. <strong className="font-medium text-text">Unsuspend</strong> resumes
          service right away.
        </>
      );
    default:
      return null;
  }
}
