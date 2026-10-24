import { GroupDecision, GROUP_TRANSITIONS } from '@tbot/db';
import { GROUP_STATUS_LABELS, GroupStatus } from '@tbot/shared';

const ALREADY: Record<GroupDecision, string> = {
  approve: 'This group is already active.',
  reject: 'This group was already rejected.',
  suspend: 'This group is already suspended.',
  unsuspend: 'This group is not suspended.',
};

const VERB: Record<GroupDecision | 'leave', string> = {
  approve: 'approve',
  reject: 'reject',
  suspend: 'suspend',
  unsuspend: 'unsuspend',
  leave: 'remove the bot from',
};

/** 409 message when a decision doesn't apply to the group's current status. */
export function wrongStateMessage(action: GroupDecision | 'leave', current: GroupStatus): string {
  if (action !== 'leave' && GROUP_TRANSITIONS[action].to === current) return ALREADY[action];
  if (action === 'unsuspend' && current !== GroupStatus.SUSPENDED) return ALREADY.unsuspend;
  if (action === 'leave') return `The bot is not in this group (status: “${GROUP_STATUS_LABELS[current]}”).`;
  return `You can't ${VERB[action]} this group while its status is “${GROUP_STATUS_LABELS[current]}”.`;
}

/** Statuses in which the bot is still a member of the chat. */
export const BOT_IN_CHAT = [GroupStatus.PENDING, GroupStatus.ACTIVE, GroupStatus.SUSPENDED];
