import { GroupStatus } from '@tbot/shared';

import type { GroupSort } from '@/lib/labels';

export type StatusTab = 'all' | GroupStatus;

/** With a period filter, "activity" and "tasks" are counted inside the period. */
export const PERIOD_SORT_LABELS: Partial<Record<GroupSort, string>> = {
  lastActivity: 'Most requests in the period',
  tasks: 'Tasks created in the period',
};

export const EMPTY: Record<StatusTab, { title: string; body: string }> = {
  all: {
    title: 'The bot isn’t in any group yet.',
    body: 'When someone adds the bot to a Telegram group, the group shows up here waiting for your approval.',
  },
  [GroupStatus.PENDING]: {
    title: 'No groups are waiting for approval.',
    body: 'When someone adds the bot to a new group, it shows up here for you to approve or reject.',
  },
  [GroupStatus.ACTIVE]: {
    title: 'No active groups yet.',
    body: 'Approve a waiting group and it shows up here.',
  },
  [GroupStatus.SUSPENDED]: {
    title: 'No suspended groups.',
    body: 'Suspending pauses a group’s service without deleting its tasks.',
  },
  [GroupStatus.REJECTED]: {
    title: 'You haven’t rejected any groups.',
    body: 'Groups you decline from the approval queue are listed here.',
  },
  [GroupStatus.LEFT]: {
    title: 'The bot hasn’t been removed from any group.',
    body: 'Groups where someone removed the bot (or you made it leave) are listed here. Their tasks are kept.',
  },
  [GroupStatus.MIGRATED]: {
    title: 'No groups have moved to a supergroup.',
    body: 'When Telegram upgrades a basic group to a supergroup, the old chat is listed here.',
  },
};

