import { Response } from 'express';
import { sendError } from 'src/api/http-error';
import { TASK_NOT_FOUND_MESSAGE } from 'src/api/middlewares/group-access.middleware';
import { subtaskService } from 'src/database/services/subtask.service';
import { TASK_POPULATE_FULL } from 'src/database/services/task-populate';
import { TaskMutationError, TaskMutationErrorCode } from 'src/shared/services/task-mutation.service';

export const SIGN_IN_MESSAGE = 'Please sign in to continue.';

const MUTATION_ERROR_STATUS: Record<TaskMutationErrorCode, number> = {
  assignee_not_member: 400,
  epic_not_in_group: 400,
  invalid_parent: 400,
  forbidden: 403,
  not_found: 404,
};

/** Sends the HTTP error for a TaskMutationError (true), or leaves other errors to the caller (false). */
export function sendMutationError(res: Response, error: unknown): boolean {
  if (!(error instanceof TaskMutationError)) return false;
  const status = MUTATION_ERROR_STATUS[error.code];
  sendError(res, status, error.code === 'not_found' ? TASK_NOT_FOUND_MESSAGE : error.message, status === 400 ? 'Validation error' : undefined);
  return true;
}

/** Populate user + epic + parent refs for API responses (no-op for plain objects). */
export async function populateTask<T>(task: T): Promise<T> {
  const doc = task as unknown as { populate?: (paths: unknown) => Promise<unknown> };
  if (doc && typeof doc.populate === 'function') {
    await doc.populate(TASK_POPULATE_FULL);
  }
  return task;
}

type TaskLike = { _id: unknown; toJSON?: () => Record<string, unknown> };

/** Tasks as JSON with `subtaskProgress` ({ total, done }, or null without subtasks) — one query for the whole page. */
export async function withSubtaskProgress<T extends TaskLike>(tasks: T[]): Promise<Record<string, unknown>[]> {
  const progress = await subtaskService.progress(tasks.map((t) => String(t._id)));
  return tasks.map((t) => ({
    ...(typeof t.toJSON === 'function' ? t.toJSON() : (t as unknown as Record<string, unknown>)),
    subtaskProgress: progress.get(String(t._id)) ?? null,
  }));
}

/** One task as the API returns it: populated refs + `subtaskProgress`. */
export async function taskJson<T extends TaskLike>(task: T): Promise<Record<string, unknown>> {
  return (await withSubtaskProgress([await populateTask(task)]))[0];
}
