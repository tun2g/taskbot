// Subtask rules for the task mutation service. Subtasks are one level deep (a subtask never has subtasks)
// and always share their parent's epic. Deleting a parent keeps its subtasks as regular tasks.
// The rules live in ./subtask-{messages,parent,plan,hooks}; this module is their single entry point
// (callers import it, some lazily, and tests mock it).

export {
  closedParentMessage,
  hasSubtasksMessage,
  nestedSubtaskMessage,
  PARENT_NOT_FOUND_MESSAGE,
  SUBTASK_OF_SELF_MESSAGE,
  subtaskEpicMessage,
  subtasksFullMessage,
} from 'src/shared/services/task-mutation/subtask-messages';
export { parentOrThrow } from 'src/shared/services/task-mutation/subtask-parent';
export { planParentChange, type ParentPlan } from 'src/shared/services/task-mutation/subtask-plan';
export { afterSubtaskCreated, afterTaskDeleted, afterTaskUpdated } from 'src/shared/services/task-mutation/subtask-hooks';
