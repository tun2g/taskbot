import { EpicStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { IEpic } from 'src/database/models/epic.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ISourceMessage } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { normalizeEpicTitle } from 'src/database/services/epic.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import { TASK_POPULATE } from 'src/database/services/task-populate';
import { taskService } from 'src/database/services/task.service';
import logger from 'src/shared/logger/logger';
import { BufferedMention, BufferedMessage } from 'src/shared/services/message-buffer.service';
import { notificationService } from 'src/shared/services/notification.service';
import { messageLink, SUMMARY_TITLE_MAX, truncate } from 'src/shared/services/task-creation/text';
import { CreatedTask, CreateTasksCoreInput, CreationOrigin } from 'src/shared/services/task-creation/types';
import { ExtractedTask, resolveMember } from 'src/shared/services/task-extraction.service';

/**
 * The AI's epic pick, only when it is exactly (case-insensitively) one of the group's OPEN epics.
 * Anything else — a closed epic, a made-up title — means no epic. Epics are never created here.
 */
export function matchEpic(title: string, openEpics: IEpic[]): IEpic | null {
  const wanted = normalizeEpicTitle(title).toLowerCase();
  if (!wanted) return null;
  return (
    openEpics.find(
      (e) => (e.status ?? EpicStatus.OPEN) === EpicStatus.OPEN && normalizeEpicTitle(e.title).toLowerCase() === wanted,
    ) ?? null
  );
}

function toSourceMessages(extracted: ExtractedTask, byId: Map<number, BufferedMessage>, chatId: number): ISourceMessage[] {
  return extracted.sourceMessageIds
    .map((id) => byId.get(id))
    .filter((m): m is BufferedMessage => !!m)
    .map((m) => ({
      messageId: m.messageId,
      chatId,
      text: m.text.slice(0, 2000),
      fromUserId: m.fromUserId,
      fromName: m.fromName,
      link: messageLink(chatId, m.messageId, m.threadId),
    }));
}

/** Everything shared by the tasks of one creation request. */
export interface SaveBatch {
  input: CreateTasksCoreInput;
  chatId: number;
  members: IUser[];
  openEpics: IEpic[];
  batchId: string;
  via: TaskActivityVia;
  mentions: BufferedMention[];
  byId: Map<number, BufferedMessage>;
}

export interface SaveOutcome {
  created: CreatedTask[];
  unknownNames: string[];
  failedTitles: string[];
}

/** Saves each extracted task (assignee resolved server-side, the AI's epic pick when valid) with its activity rows. */
export async function saveExtractedTasks(batch: SaveBatch, tasks: ExtractedTask[]): Promise<SaveOutcome> {
  const { members, mentions, openEpics } = batch;
  const outcome: SaveOutcome = { created: [], unknownNames: [], failedTitles: [] };

  for (const extracted of tasks) {
    const assignee = extracted.assignee ? resolveMember(extracted.assignee, members, mentions) : null;
    if (extracted.assignee && !assignee) {
      const name = extracted.assignee.trim();
      if (!outcome.unknownNames.includes(name)) outcome.unknownNames.push(name);
    }

    const epic = extracted.epic ? matchEpic(extracted.epic, openEpics) : null;
    try {
      const task = await saveOne(batch, extracted, assignee, epic);
      outcome.created.push({ task, assignee });
      await recordCreated(batch, task, epic);
    } catch (error) {
      outcome.failedTitles.push(extracted.title);
      logger.error(`Failed to create extracted task "${extracted.title}": ${error}`);
    }
  }
  return outcome;
}

async function saveOne(batch: SaveBatch, extracted: ExtractedTask, assignee: IUser | null, epic: IEpic | null) {
  const { input, chatId, byId, batchId } = batch;
  // The web chat has no Telegram message to link back to.
  const sourceMessages = input.origin === 'app' ? [] : toSourceMessages(extracted, byId, chatId);
  const task = await taskService.createTask({
    groupId: input.group._id,
    title: extracted.title,
    description: extracted.description,
    type: extracted.type,
    priority: extracted.priority,
    createdBy: input.requester._id,
    assigneeId: assignee?._id,
    dueDate: extracted.dueDate ? new Date(`${extracted.dueDate}T00:00:00Z`) : undefined,
    ...(epic ? { epicId: epic._id as mongoose.Types.ObjectId } : {}),
    sourceMessage: sourceMessages[0],
    sourceMessages,
    batchId,
    taskCardChatId: chatId,
  });
  // The card shows "Epic: 🔵 Login" from the populated ref.
  if (epic && typeof task.populate === 'function') await task.populate(TASK_POPULATE);
  return task;
}

async function recordCreated(batch: SaveBatch, task: CreatedTask['task'], epic: IEpic | null) {
  const { input, via } = batch;
  const { group, requester } = input;
  await taskActivityService.record({
    taskId: task._id,
    groupId: group._id,
    actor: requester._id,
    action: 'created',
    to: task.title,
    via,
  });
  // The AI's epic pick is logged as its own change, so it shows up (and is easy to spot) in the history.
  if (epic) {
    await taskActivityService.record({
      taskId: task._id,
      groupId: group._id,
      actor: requester._id,
      action: 'epic',
      from: null,
      to: epic.title,
      via: input.activityVia ?? 'ai',
    });
  }
}

/** Plain-text notes about people who couldn't be assigned and tasks that couldn't be saved. */
export function saveWarnings(outcome: SaveOutcome, origin: CreationOrigin): string[] {
  const warnings: string[] = [];
  const { unknownNames, failedTitles } = outcome;
  if (unknownNames.length) {
    const names = unknownNames.map((n) => `"${n}"`).join(', ');
    const where = origin === 'app' ? 'in the group' : 'here';
    warnings.push(`⚠️ Couldn't find ${names} in this group — left unassigned. They need to post ${where} once first.`);
  }
  if (failedTitles.length) {
    const titles = failedTitles.map((t) => `“${truncate(t, SUMMARY_TITLE_MAX)}”`).join(', ');
    const many = failedTitles.length > 1;
    warnings.push(`⚠️ Couldn't save ${many ? `${failedTitles.length} tasks` : 'a task'}: ${titles}. Please add ${many ? 'them' : 'it'} again.`);
  }
  return warnings;
}

/** DMs each assignee; a failed DM never fails the request. */
export async function notifyAssignees(created: CreatedTask[], requester: IUser): Promise<void> {
  for (const { task, assignee } of created) {
    if (!assignee) continue;
    try {
      await notificationService.notifyAssignment(task, assignee, requester);
    } catch (error) {
      logger.warn(`Assignment notification failed for task ${task._id}: ${error}`);
    }
  }
}
