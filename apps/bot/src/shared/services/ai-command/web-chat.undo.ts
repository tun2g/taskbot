import mongoose from 'mongoose';
import { isTelegramGroupAdmin } from 'src/api/telegram-admin';
import { refId } from 'src/bot/task-card.renderer';
import { IUser } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { forgetAppBatchPost, getAppBatchPost } from 'src/shared/services/ai-command/web-chat.batch-post';
import { ChatChannel, viaArg } from 'src/shared/services/ai-command/web-chat.channel';
import { undoBatch } from 'src/shared/services/batch-undo.service';
import { BATCH_UNDO_WINDOW_MS } from 'src/shared/services/task-creation.service';
import { taskSyncService, userDisplayName } from 'src/shared/services/task-sync.service';

export const UNDO_EXPIRED_MESSAGE = 'Undo is only available for 10 minutes after creating.';
export const UNDO_FORBIDDEN_MESSAGE = 'Only the person who created these tasks or a group admin can undo.';
export const BATCH_NOT_FOUND_MESSAGE = 'These tasks were already removed or could not be found.';
export const UNDO_NOT_A_MEMBER_MESSAGE = 'You are not a member of this group.';
const BATCH_ID = /^[0-9a-f]{16}$/;

export type UndoAppBatchResult =
  | { status: 'ok'; removed: number }
  | { status: 'not_found' | 'not_member' | 'expired' | 'forbidden'; message: string };

/**
 * Undo of a batch created from the web chat or the MCP server: the requester (or a Telegram group admin),
 * within 10 minutes. Removes the tasks, logs them and turns the group post into "↩️ Undone by …".
 * `groupId` (optional) must match the batch's group.
 */
export async function undoAppBatch(params: {
  user: IUser;
  batchId: string;
  groupId?: string;
  channel?: ChatChannel;
}): Promise<UndoAppBatchResult> {
  const { user, batchId } = params;
  const tasks = BATCH_ID.test(batchId) ? await taskService.getTasksByBatch(batchId) : [];
  if (tasks.length === 0 || (params.groupId && String(tasks[0].groupId) !== params.groupId)) {
    return { status: 'not_found', message: BATCH_NOT_FOUND_MESSAGE };
  }

  const groupId = tasks[0].groupId as mongoose.Types.ObjectId;
  if (!(await groupMemberService.isMember(groupId, user._id as mongoose.Types.ObjectId))) {
    return { status: 'not_member', message: UNDO_NOT_A_MEMBER_MESSAGE };
  }

  const createdAt = Math.min(...tasks.map((t) => new Date(t.createdAt ?? 0).getTime()));
  if (Date.now() - createdAt > BATCH_UNDO_WINDOW_MS) return { status: 'expired', message: UNDO_EXPIRED_MESSAGE };

  const isRequester = refId(tasks[0].createdBy) === String(user._id);
  if (!isRequester) {
    const group = await groupService.findGroupById(groupId);
    const isAdmin = group ? await isTelegramGroupAdmin(group.telegramGroupId, user.telegramUserId) : false;
    if (!isAdmin) return { status: 'forbidden', message: UNDO_FORBIDDEN_MESSAGE };
  }

  const { removed, tasks: removedTasks } = await undoBatch({
    batchId,
    groupId: groupId.toString(),
    actor: user._id as mongoose.Types.ObjectId,
    via: params.channel ? (params.channel.activity === 'mcp' ? 'mcp' : 'app') : 'app',
    tasks,
  });

  const post = await getAppBatchPost(batchId);
  if (post) {
    await taskSyncService.markBatchUndone(post, userDisplayName(user), removed, removedTasks, groupId, ...viaArg(params.channel));
    await forgetAppBatchPost(batchId);
  }
  return { status: 'ok', removed };
}
