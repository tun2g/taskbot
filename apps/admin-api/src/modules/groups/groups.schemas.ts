import type { AdminGroupMemberSort, AdminGroupTaskFilter } from '@tbot/shared';
import { z } from 'zod';

const reason = z
  .string({ message: 'The reason must be text.' })
  .trim()
  .max(500, 'Keep the reason under 500 characters.');

const notifyGroup = z.boolean({ message: 'notifyGroup must be true or false.' }).optional();

/** Reject / suspend: the reason is shown to the group, so it's required. */
export const actionWithReasonSchema = z.object({
  reason: reason.min(1, 'Please give a reason — it is shown to the group.'),
  notifyGroup,
});

export const actionSchema = z.object({ reason: reason.optional(), notifyGroup });

export const deleteGroupSchema = z.object({
  confirmName: z.string({ message: 'Type the group name to confirm.' }),
});

export const GROUP_SORTS = ['lastActivity', 'aiCost', 'tasks', 'members', 'added'] as const;
export type GroupSort = (typeof GROUP_SORTS)[number];

export const MEMBER_SORTS: readonly AdminGroupMemberSort[] = [
  'lastActive',
  'events',
  'aiCalls',
  'aiCost',
  'tasks',
  'tokens',
  'joined',
];

export const TASK_FILTERS: readonly AdminGroupTaskFilter[] = ['open', 'overdue', 'done', 'all'];
