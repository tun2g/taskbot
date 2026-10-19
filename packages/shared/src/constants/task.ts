export enum TaskStatus {
  BACKLOG = 'backlog',
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  IN_REVIEW = 'in_review',
  PENDING = 'pending',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

/**
 * Jira-style status categories. Every status belongs to exactly one category;
 * counts, "open vs closed", overdue and completion logic work on categories so
 * adding a status never breaks them.
 */
export enum TaskStatusCategory {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum TaskType {
  BUG = 'bug',
  FEATURE = 'feature',
  IMPROVEMENT = 'improvement',
  TASK = 'task',
  CHORE = 'chore',
  RESEARCH = 'research',
  QUESTION = 'question',
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.BACKLOG]: '📥 Backlog',
  [TaskStatus.TODO]: '📝 To do',
  [TaskStatus.IN_PROGRESS]: '🔄 In progress',
  [TaskStatus.IN_REVIEW]: '👀 In review',
  [TaskStatus.PENDING]: '⏸ Pending',
  [TaskStatus.DONE]: '✅ Done',
  [TaskStatus.CANCELLED]: '🚫 Cancelled',
};

/** One-line hint shown next to the status picker so users know which to choose. */
export const TASK_STATUS_HINTS: Record<TaskStatus, string> = {
  [TaskStatus.BACKLOG]: 'Captured, not planned yet',
  [TaskStatus.TODO]: 'Planned, ready to start',
  [TaskStatus.IN_PROGRESS]: 'Someone is working on it',
  [TaskStatus.IN_REVIEW]: 'Work finished, waiting for review or testing',
  [TaskStatus.PENDING]: 'On hold, waiting on someone or something',
  [TaskStatus.DONE]: 'Completed',
  [TaskStatus.CANCELLED]: "Won't be done",
};

export const TASK_STATUS_CATEGORY: Record<TaskStatus, TaskStatusCategory> = {
  [TaskStatus.BACKLOG]: TaskStatusCategory.TODO,
  [TaskStatus.TODO]: TaskStatusCategory.TODO,
  [TaskStatus.IN_PROGRESS]: TaskStatusCategory.IN_PROGRESS,
  [TaskStatus.IN_REVIEW]: TaskStatusCategory.IN_PROGRESS,
  [TaskStatus.PENDING]: TaskStatusCategory.IN_PROGRESS,
  [TaskStatus.DONE]: TaskStatusCategory.DONE,
  [TaskStatus.CANCELLED]: TaskStatusCategory.DONE,
};

export const TASK_STATUS_CATEGORY_LABELS: Record<TaskStatusCategory, string> = {
  [TaskStatusCategory.TODO]: '📝 To do',
  [TaskStatusCategory.IN_PROGRESS]: '🔄 In progress',
  [TaskStatusCategory.DONE]: '✅ Done',
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  [TaskPriority.LOW]: '⬇️ Low',
  [TaskPriority.MEDIUM]: '➡️ Medium',
  [TaskPriority.HIGH]: '⬆️ High',
  [TaskPriority.URGENT]: '🔴 Urgent',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  [TaskType.BUG]: '🐞 Bug',
  [TaskType.FEATURE]: '✨ Feature',
  [TaskType.IMPROVEMENT]: '🛠 Improvement',
  [TaskType.TASK]: '📌 Task',
  [TaskType.CHORE]: '🧹 Chore',
  [TaskType.RESEARCH]: '🔬 Research',
  [TaskType.QUESTION]: '❓ Question',
};

/** One-line hint shown next to the type picker so users know which to choose. */
export const TASK_TYPE_HINTS: Record<TaskType, string> = {
  [TaskType.BUG]: 'Something is broken and needs fixing',
  [TaskType.FEATURE]: 'A new capability users can see',
  [TaskType.IMPROVEMENT]: 'Make something that already exists better',
  [TaskType.TASK]: 'A piece of work to get done',
  [TaskType.CHORE]: 'Maintenance or housekeeping, no visible change',
  [TaskType.RESEARCH]: 'Investigate or prototype before deciding',
  [TaskType.QUESTION]: 'Needs an answer or a decision',
};

export const TASK_STATUS_ORDER: TaskStatus[] = [
  TaskStatus.BACKLOG,
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.IN_REVIEW,
  TaskStatus.PENDING,
  TaskStatus.DONE,
  TaskStatus.CANCELLED,
];

/** Statuses shown as board columns by default; the rest sit behind a "Show all statuses" toggle. */
export const TASK_BOARD_DEFAULT_STATUSES: TaskStatus[] = [
  TaskStatus.TODO,
  TaskStatus.IN_PROGRESS,
  TaskStatus.IN_REVIEW,
  TaskStatus.DONE,
];

export const TASK_TYPE_ORDER: TaskType[] = [
  TaskType.BUG,
  TaskType.FEATURE,
  TaskType.IMPROVEMENT,
  TaskType.TASK,
  TaskType.CHORE,
  TaskType.RESEARCH,
  TaskType.QUESTION,
];

export const TASK_PRIORITY_ORDER: TaskPriority[] = [
  TaskPriority.LOW,
  TaskPriority.MEDIUM,
  TaskPriority.HIGH,
  TaskPriority.URGENT,
];

export const DEFAULT_TASK_STATUS = TaskStatus.TODO;
export const DEFAULT_TASK_PRIORITY = TaskPriority.MEDIUM;
export const DEFAULT_TASK_TYPE = TaskType.TASK;

export const TASK_STATUS_VALUES = TASK_STATUS_ORDER.map((s) => s as string) as [string, ...string[]];
export const TASK_TYPE_VALUES = TASK_TYPE_ORDER.map((t) => t as string) as [string, ...string[]];
export const TASK_PRIORITY_VALUES = TASK_PRIORITY_ORDER.map((p) => p as string) as [string, ...string[]];

export function getStatusCategory(status: TaskStatus | string): TaskStatusCategory {
  return TASK_STATUS_CATEGORY[status as TaskStatus] ?? TaskStatusCategory.TODO;
}

/** Done or cancelled — no longer open work (excluded from overdue, reminders, "open" counts). */
export function isClosedStatus(status: TaskStatus | string): boolean {
  return getStatusCategory(status) === TaskStatusCategory.DONE;
}

/** Statuses in a category, for Mongo `$in` queries. */
export function statusesInCategory(category: TaskStatusCategory): TaskStatus[] {
  return TASK_STATUS_ORDER.filter((s) => TASK_STATUS_CATEGORY[s] === category);
}
