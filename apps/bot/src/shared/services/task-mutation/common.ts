import { EPIC_COLOR_EMOJI, EpicColor } from '@tbot/shared';
import { Epic, IEpic } from 'src/database/models/epic.model';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { ITask } from 'src/database/models/task.model';
import { IUser, User } from 'src/database/models/user.model';
import { TaskChange } from 'src/shared/services/task-event-lines';

// Errors, channels and small helpers shared by the task mutation service and its subtask rules.

export const ASSIGNEE_NOT_MEMBER_MESSAGE =
  'That person is not a member of this group. Pick someone from the member list.';
export const EPIC_NOT_IN_GROUP_MESSAGE = 'That epic is not part of this group. Pick an epic from the list.';
export const DELETE_FORBIDDEN_MESSAGE = 'Only the task creator or a group admin can delete this task.';
export const TASK_GONE_MESSAGE = 'This task could not be found. It may have been deleted.';
const ACTIVITY_TEXT_MAX = 300;

export type TaskMutationErrorCode =
  | 'assignee_not_member'
  | 'epic_not_in_group'
  | 'invalid_parent'
  | 'forbidden'
  | 'not_found';

/** A rule the change broke; `message` is a plain sentence safe to show to people (and LLMs). */
export class TaskMutationError extends Error {
  constructor(
    public readonly code: TaskMutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TaskMutationError';
  }
}

/** Which channel made the change: `activity` is stored in the log, `label` shows as "(via …)" in the group. */
export interface MutationChannel {
  activity: TaskActivityVia;
  /** Omitted = "app" (the default wording of every group line). */
  label?: string;
}

export const APP_CHANNEL: MutationChannel = { activity: 'app' };

/** Extra "(via …)" argument for the group-line helpers — only when it isn't the default "app". */
export const viaArg = (channel: MutationChannel): [] | [string] => (channel.label ? [channel.label] : []);

/** Id of a ref that may be populated (user doc) or a bare ObjectId/string. */
export function refId(ref: unknown): string | null {
  if (!ref) return null;
  if (typeof ref === 'object' && ref !== null && '_id' in ref) return String((ref as { _id: unknown })._id);
  return String(ref);
}

export function clip(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > ACTIVITY_TEXT_MAX ? `${text.slice(0, ACTIVITY_TEXT_MAX - 1)}…` : text;
}

/** "#12 Fix login" — how a parent / subtask is written in the activity log. */
export const taskRefText = (task: Pick<ITask, 'taskNumber' | 'title'>) => clip(`#${task.taskNumber} ${task.title}`);

function isUserDoc(value: unknown): value is IUser {
  return !!value && typeof value === 'object' && 'telegramUserId' in (value as object);
}

export async function resolveUser(ref: unknown): Promise<IUser | null> {
  if (!ref) return null;
  if (isUserDoc(ref)) return ref;
  return User.findById(refId(ref));
}

export type EpicLike = Pick<IEpic, 'title' | 'color'> & { _id: unknown };

function isEpicDoc(value: unknown): value is EpicLike {
  return !!value && typeof value === 'object' && 'title' in (value as object) && 'color' in (value as object);
}

/** A task's epic as a doc with title/color (populated ref, or loaded by id), or null. */
export async function resolveEpic(ref: unknown): Promise<EpicLike | null> {
  if (!ref) return null;
  if (isEpicDoc(ref)) return ref;
  return Epic.findById(refId(ref));
}

const epicIcon = (epic: EpicLike | null) => (epic ? (EPIC_COLOR_EMOJI[epic.color as EpicColor] ?? null) : null);

/** The "epic" change entry (titles for the log, colored dots for group lines). */
export function epicChange(prev: EpicLike | null, next: EpicLike | null): TaskChange {
  return {
    field: 'epic',
    from: prev ? clip(prev.title) : null,
    to: next ? clip(next.title) : null,
    fromIcon: epicIcon(prev),
    toIcon: epicIcon(next),
  };
}
