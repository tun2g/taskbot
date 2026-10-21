export interface IGroup {
  _id: string;
  telegramGroupId: number;
  groupName: string;
  taskCounter: number;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

/** Returned by GET /groups — the caller's groups with headline counts. */
export interface IGroupSummary extends IGroup {
  counts: { todo: number; in_progress: number; done: number };
  /** Open (not done) tasks assigned to the caller in this group. */
  mine: number;
  /** Open tasks whose due day is before today in the group's timezone. */
  overdue: number;
}
