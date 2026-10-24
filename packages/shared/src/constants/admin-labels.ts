/**
 * Plain-language names for the bot's background jobs and MCP tools, shared by the admin API (overview
 * "needs attention" sentences) and the admin app. Keyed by the internal name the bot uses.
 */

export interface BackgroundJobInfo {
  label: string;
  /** What it does, in one sentence. */
  what: string;
  /** What the owner notices when it fails. */
  ifFailing: string;
  /**
   * The schedule in words when the cron alone would mislead (jobs that check hourly but act at a local time per
   * group). Without it the admin app describes the cron.
   */
  schedule?: string;
  /** What pressing "Run now" does, for the confirmation. */
  runNow?: string;
}

/** Keyed by job name, or `name|cron` when one job runs on several schedules. */
export const BACKGROUND_JOBS: Record<string, BackgroundJobInfo> = {
  'due-reminder': {
    label: 'Due-date reminders',
    what: 'Pings assignees about tasks due today or tomorrow, from 9:00 in each group’s timezone.',
    ifFailing: 'People stop getting reminders about due tasks.',
    schedule: 'Checks every hour; reminds from 9:00 local time per group',
    runNow:
      'Checks now for tasks due today or tomorrow and reminds their assignees, but only in groups where it’s already past 9:00. Nobody is reminded about the same task twice.',
  },
  'daily-digest': {
    label: 'Morning digest',
    what: 'Posts each group’s summary of due and overdue tasks at 9:00 in that group’s timezone.',
    ifFailing: 'Groups don’t get their morning summary.',
    schedule: 'Checks every hour; sends at 9:00 local time per group',
    runNow:
      'Checks every group now. Only groups where it’s 9:00 right now and that haven’t had today’s digest get one — at any other hour it sends nothing.',
  },
  'stats-rollup': {
    label: 'Dashboard numbers',
    what: 'Adds up usage, AI and task numbers for this dashboard.',
    ifFailing: 'Charts on this dashboard stop updating.',
    runNow: 'Recounts the numbers for this dashboard now. Nothing is sent to anyone; safe to run any time.',
  },
  'stats-rollup|10 0 * * *': {
    label: 'Dashboard numbers — daily close',
    what: 'Finalises yesterday’s usage, AI and task numbers for this dashboard.',
    ifFailing: 'Yesterday’s numbers on this dashboard stay incomplete.',
    runNow:
      'Recounts yesterday’s and today’s numbers for this dashboard now. Nothing is sent to anyone; safe to run any time.',
  },
  'stats-rollup|20 * * * *': {
    label: 'Dashboard numbers & alerts — hourly',
    what: 'Updates today’s numbers, sends you AI budget / spike alerts and reminds you about groups waiting for approval.',
    ifFailing: 'Today’s numbers go stale and you stop getting AI and approval alerts in Telegram.',
    runNow:
      'Recounts today’s numbers now and checks the AI budget and waiting groups. You may get an alert in Telegram, but never the same alert twice in a day.',
  },
};

export function backgroundJobInfo(name: string, cron?: string | null): BackgroundJobInfo {
  return (
    (cron ? BACKGROUND_JOBS[`${name}|${cron}`] : undefined) ??
    BACKGROUND_JOBS[name] ?? {
      label: name.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      what: 'A background job of the bot.',
      ifFailing: 'Whatever this job does stops happening.',
    }
  );
}

/** MCP tools (apps/bot/src/mcp/tools): what an AI client asked the bot to do. */
export const MCP_TOOLS: Record<string, { label: string; what: string; writes: boolean }> = {
  list_tasks: { label: 'List tasks', what: 'Search and filter tasks on a board.', writes: false },
  get_task: { label: 'Open a task', what: 'Read one task with its details and subtasks.', writes: false },
  create_tasks: { label: 'Create tasks', what: 'Add one or more tasks (or subtasks).', writes: true },
  update_task: { label: 'Update a task', what: 'Change status, assignee, due date, title…', writes: true },
  delete_task: { label: 'Delete a task', what: 'Permanently remove one task.', writes: true },
  undo_last: { label: 'Undo created tasks', what: 'Remove the tasks a recent “Create tasks” or “Ask TaskBot” call made (within 10 minutes).', writes: true },
  list_groups: { label: 'List groups', what: 'See which groups the token can reach.', writes: false },
  list_members: { label: 'List members', what: 'See who is in a group (to assign tasks).', writes: false },
  list_epics: { label: 'List epics', what: 'See a group’s epics and their progress.', writes: false },
  create_epic: { label: 'Create an epic', what: 'Add an epic to group tasks under.', writes: true },
  update_epic: { label: 'Update an epic', what: 'Rename or change an epic.', writes: true },
  ask_taskbot: { label: 'Ask TaskBot', what: 'Plain-words requests handled by the bot’s AI, like /ai in Telegram (uses AI calls).', writes: true },
};

export function mcpToolInfo(tool: string): { label: string; what: string; writes: boolean } {
  return MCP_TOOLS[tool] ?? { label: tool.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()), what: 'A tool of the MCP server.', writes: false };
}
