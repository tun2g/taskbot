import { GroupStatus } from '@tbot/shared';
import type { IGroup } from 'src/database/models/group.model';

type GroupLike = Pick<IGroup, 'status' | 'statusReason'> & { groupName?: string };

/** Only ACTIVE groups get service. A doc without a status predates approval (the startup migration approves those). */
export function isGroupActive(group: Pick<IGroup, 'status'> | null | undefined): boolean {
  return (group?.status ?? GroupStatus.ACTIVE) === GroupStatus.ACTIVE;
}

const reasonSuffix = (reason?: string | null) => (reason?.trim() ? ` Reason: ${reason.trim()}` : '');

/** Why an inactive group can't be used — for people (Mini App / API errors). */
export function groupUnavailableMessage(group: GroupLike): string {
  switch (group.status) {
    case GroupStatus.PENDING:
      return "This group is waiting for approval from the bot owner. You'll see a message in the group when it's approved.";
    case GroupStatus.SUSPENDED:
      return `The bot is paused in this group by its owner. Your tasks are kept.${reasonSuffix(group.statusReason)}`;
    case GroupStatus.REJECTED:
      return `The bot's owner did not approve this group.${reasonSuffix(group.statusReason)}`;
    case GroupStatus.LEFT:
      return 'The bot is no longer in this group. Add it back to the Telegram group to use it again.';
    case GroupStatus.MIGRATED:
      return 'This group moved to a new Telegram chat. Open it again from your group list.';
    default:
      return 'This group is not available right now.';
  }
}

/**
 * Plain-text button toast (≤200 chars, no HTML) for a tap on a task of an inactive group — on its card in the
 * group, or on a DM reminder / notification, where the group's name says which group is meant.
 */
export function groupUnavailableToast(group: GroupLike, options: { named?: boolean } = {}): string {
  const subject = options.named && group.groupName ? `“${group.groupName}”` : 'This group';
  let text: string;
  switch (group.status) {
    case GroupStatus.PENDING:
      text = `⏳ ${subject} is waiting for the bot owner's approval. Tasks can't be changed until then.`;
      break;
    case GroupStatus.SUSPENDED:
      text = `⏸ The bot owner paused the bot in ${options.named && group.groupName ? subject : 'this group'}. Tasks are kept but can't be changed for now.${reasonSuffix(group.statusReason)}`;
      break;
    case GroupStatus.LEFT:
      text = `The bot is no longer in ${options.named && group.groupName ? subject : 'this group'}. Add it back to use these tasks again.`;
      break;
    default:
      text = `${subject} can't be used with the bot right now.`;
  }
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

/** Why an inactive group can't be used — for AI agents (MCP tool errors): what happened and what (not) to do. */
export function groupUnavailableToolMessage(group: GroupLike): string {
  const name = `"${group.groupName ?? 'this group'}"`;
  switch (group.status) {
    case GroupStatus.PENDING:
      return `Group ${name} is waiting for the bot owner's approval, so it can't be used yet. Tell the user; retrying won't help until it is approved.`;
    case GroupStatus.SUSPENDED:
      return `Group ${name} is paused by the bot owner, so its tasks can't be read or changed until it is resumed.${reasonSuffix(group.statusReason)}`;
    case GroupStatus.REJECTED:
      return `The bot owner did not approve group ${name}, so it can't be used.${reasonSuffix(group.statusReason)}`;
    case GroupStatus.LEFT:
      return `The bot was removed from group ${name}, so it can't be used. The user can add the bot back to the Telegram group.`;
    case GroupStatus.MIGRATED:
      return `Group ${name} moved to a new Telegram chat. Call list_groups to find it.`;
    default:
      return `Group ${name} is not available right now.`;
  }
}
