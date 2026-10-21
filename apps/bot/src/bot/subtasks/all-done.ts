import { isClosedStatus, TaskStatus } from '@tbot/shared';
import { allSubtasksDone } from 'src/bot/subtasks/subtask-lines';
import { ITask, Task } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { SubtaskProgress } from 'src/database/services/subtask.service';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';

// "All subtasks of #42 are done" → one DM to the parent's assignee (or its creator when unassigned), unless they
// closed the last subtask themselves. Runs whenever the parent's card is re-rendered (task-sync), which every
// channel triggers after a subtask closes — bot buttons, /done, the app, MCP and /ai — so this is the one place.
// A Redis flag sends it once per "all done" streak; reopening a subtask clears it.

const SENT_TTL_SECONDS = 30 * 24 * 60 * 60;
const sentKey = (parentId: string) => `subtasks_all_done:${parentId}`;

function idOf(ref: unknown): string | null {
  if (!ref) return null;
  const value = ref as { _id?: { toString(): string }; toString(): string };
  return value._id ? value._id.toString() : value.toString();
}

async function ownerOf(parent: ITask): Promise<IUser | null> {
  const ref = parent.assigneeId ?? parent.createdBy;
  if (ref && typeof ref === 'object' && 'telegramUserId' in (ref as object)) return ref as unknown as IUser;
  const id = idOf(ref);
  return id ? User.findById(id) : null;
}

/** Who closed the most recently finished subtask (to skip nudging someone about their own action). */
async function lastCloserId(parentId: string): Promise<string | null> {
  const last = await Task.findOne({ parentTaskId: parentId, status: TaskStatus.DONE })
    .sort({ completedAt: -1 })
    .select('completedBy');
  return idOf(last?.completedBy);
}

export async function notifyIfAllSubtasksDone(parent: ITask, progress: SubtaskProgress | null): Promise<void> {
  if (parent.parentTaskId) return;
  const parentId = String(parent._id);
  try {
    if (!allSubtasksDone(progress) || isClosedStatus(parent.status)) {
      if (progress && progress.total > progress.done) await redisService.del(sentKey(parentId));
      return;
    }
    const claimed = await redisService.set(sentKey(parentId), '1', { NX: true, EX: SENT_TTL_SECONDS });
    if (claimed === null) return;

    const owner = await ownerOf(parent);
    if (!owner || String(owner._id) === (await lastCloserId(parentId))) return;
    const { notificationService } = await import('src/shared/services/notification.service');
    await notificationService.notifyAllSubtasksDone(parent, owner, progress!.total);
  } catch (error) {
    logger.warn(`All-subtasks-done nudge for #${parent.taskNumber} failed: ${error}`);
  }
}
