import { IGroup } from 'src/database/models/group.model';

/** What the connected model is told about TaskBot (sent in `initialize`). */
export function serverInstructions(scopeGroup: IGroup | null): string {
  const scope = scopeGroup
    ? `This connection is scoped to the group "${scopeGroup.groupName}": every tool works on it, so you can omit \`group\`.`
    : "Call list_groups first to see the user's groups, then pass `group` (id or title) to the other tools. If the user didn't say which group and they have several, ask them.";
  return [
    'TaskBot manages tasks that live in Telegram groups: each group is a workspace with its own numbered tasks (#1, #2, …) and epics.',
    scope,
    'Prefer ask_taskbot for natural-language requests: it understands Vietnamese and English, resolves people, epics and dates, ' +
      'and may ask a clarifying question — answer it by calling ask_taskbot again with the same conversationId.',
    'Use the structured tools (list_tasks, get_task, create_tasks, update_task, delete_task, list_epics, create_epic, update_epic) when you already know the exact fields.',
    'Refer to tasks by their number within the group (#12 → taskNumber 12). Assign people by @username or name from list_members, or "me".',
    'Subtasks break one task into smaller pieces, each with its own number, assignee and status: create them with create_tasks `parent`, ' +
      'move or detach them with update_task `parent`. They are one level deep (a subtask has no subtasks) and always share the parent\'s epic; ' +
      'deleting a parent keeps its subtasks as regular tasks.',
    'Write task titles as clean, short work items ("Fix login redirect on iOS"), with details in the description — never paste a whole conversation as a title.',
    'Every change is visible to the team: the group gets a short message and assignees get a DM. Created tasks can be undone for 10 minutes with undo_last.',
  ].join('\n');
}
