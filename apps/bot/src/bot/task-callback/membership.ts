import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import logger from 'src/shared/logger/logger';
import { Telegram } from 'telegraf';

/**
 * May this user change the task from a DM? In the group, pressing the card is proof enough of
 * membership; from a DM we check the user is (still) in the task's group — Telegram first,
 * the members we've seen as a fallback.
 */
export async function canChangeFromDm(telegram: Telegram, group: IGroup, task: ITask, user: IUser): Promise<boolean> {
  try {
    const member = await telegram.getChatMember(group.telegramGroupId, user.telegramUserId);
    if (member.status === 'left' || member.status === 'kicked') return false;
    if (member.status === 'restricted' && !member.is_member) return false;
    return true;
  } catch (error) {
    logger.warn(`Could not check membership of ${user.telegramUserId} in ${group.telegramGroupId}: ${error}`);
    return groupMemberService.isMember(task.groupId, user._id);
  }
}
