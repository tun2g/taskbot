// Registers the Epic model so `populate('epicId')` works in every process that loads tasks.
import 'src/database/models/epic.model';

/** Epic fields the API and task cards need (a card shows `🟦 Login`). */
export const EPIC_POPULATE = { path: 'epicId', select: '_id title color status' };

/** A subtask's parent as cards / the API show it (`↳ #12 Fix login`). */
export const PARENT_POPULATE = { path: 'parentTaskId', select: '_id taskNumber title status' };

/** Populate paths for a task as cards / the API show it. */
export const TASK_POPULATE = [{ path: 'createdBy' }, { path: 'assigneeId' }, EPIC_POPULATE, PARENT_POPULATE];

/** TASK_POPULATE + who completed it (single-task reads). */
export const TASK_POPULATE_FULL = [...TASK_POPULATE, { path: 'completedBy' }];
