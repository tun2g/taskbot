// /ai and the web chat on subtasks: "chia #42 thành subtask …" and the `parent` change of update_task.
// Listed items are created at once; an AI-proposed breakdown is shown as a preview first (subtask-preview).
// Everything goes through the task mutation service, so the subtask rules, activity log, DMs and parent
// cards behave as in the app.

export { addSubtasks, type SubtaskDeps } from 'src/shared/services/ai-command/subtasks.add';
export {
  applyParentChange,
  moveSubtasksToEpic,
  type ParentChangeResult,
  subtaskEpicNote,
} from 'src/shared/services/ai-command/subtasks.parent';
