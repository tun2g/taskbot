import { GroupStatus, type IGroup } from '@tbot/shared';

/** Only active groups can be opened. Older API responses have no status: treat them as active. */
export function isGroupUsable(group: Pick<IGroup, 'status'>): boolean {
  return (group.status ?? GroupStatus.ACTIVE) === GroupStatus.ACTIVE;
}

/** Short badge + one-line explanation for a group that can't be opened. */
export function groupUnavailableInfo(group: Pick<IGroup, 'status' | 'statusReason'>): { badge: string; text: string } {
  const reason = group.statusReason?.trim();
  switch (group.status) {
    case GroupStatus.PENDING:
      return {
        badge: 'Waiting for approval',
        text: "The bot's owner hasn't approved this group yet. You'll see a message in the group when it's ready.",
      };
    case GroupStatus.SUSPENDED:
      return {
        badge: 'Paused',
        text: `The bot's owner paused this group. Your tasks are kept.${reason ? ` Reason: ${reason}` : ''}`,
      };
    case GroupStatus.REJECTED:
      return {
        badge: 'Not approved',
        text: `The bot's owner did not approve this group.${reason ? ` Reason: ${reason}` : ''} Adding the bot again sends a new request.`,
      };
    case GroupStatus.LEFT:
      return { badge: 'Bot removed', text: 'The bot is no longer in this group. Add it back to use the board again.' };
    case GroupStatus.MIGRATED:
      return { badge: 'Moved', text: 'This group moved to a new Telegram chat.' };
    default:
      return { badge: 'Unavailable', text: 'This group is not available right now.' };
  }
}
