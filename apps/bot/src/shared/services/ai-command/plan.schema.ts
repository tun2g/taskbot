import { EPIC_TITLE_MAX, TASK_PRIORITY_VALUES, TASK_STATUS_VALUES, TASK_TYPE_VALUES } from '@tbot/shared';
import { z } from 'zod';

/** Most task mutations one /ai request may perform; bigger jobs go to the board. */
export const MAX_AI_MUTATIONS = 5;
/** Most tasks one request may explain (each explanation is a second AI call; read-only, not a mutation). */
export const MAX_AI_EXPLAINS = 3;
/** Most subtasks one /ai request may add (listed by the user or proposed by the AI). */
export const MAX_AI_SUBTASKS = 8;
/** Hard cap on parsed actions (bigger plans are still parsed so we can refuse them politely). */
const MAX_PARSED_ACTIONS = 20;

/** "In Review" / "in-review" → "in_review" so small formatting slips don't fail the whole plan. */
const enumWord = (values: [string, ...string[]]) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : v),
    z.enum(values),
  );

const STATUS_ALIASES: Record<string, string> = {
  review: 'in_review',
  progress: 'in_progress',
  doing: 'in_progress',
  to_do: 'todo',
  on_hold: 'pending',
  canceled: 'cancelled',
};

export const statusSchema = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const word = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return STATUS_ALIASES[word] ?? word;
  },
  z.enum(TASK_STATUS_VALUES),
);
export const typeSchema = enumWord(TASK_TYPE_VALUES);
export const prioritySchema = enumWord(TASK_PRIORITY_VALUES);

/**
 * 'reply' (the replied task card / the task open in the app), 'previous' (the single task shown in the
 * previous assistant answer — web chat only), a task number, or a search text that must match exactly one task.
 */
export const taskRefSchema = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      const m = v.trim().match(/^#?(\d+)$/);
      if (m) return parseInt(m[1], 10);
      const word = v.trim().toLowerCase();
      if (word === 'reply' || word === 'previous') return word;
      return { search: v.trim() };
    }
    return v;
  },
  z.union([
    z.literal('reply'),
    z.literal('previous'),
    z.number().int().positive(),
    z.object({ search: z.string().trim().min(1).max(100) }),
  ]),
);

/** An epic title as the user wrote it ("Login"); resolved case-insensitively in the group by code. */
const epicTitleSchema = z.string().trim().min(1).max(EPIC_TITLE_MAX);

const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Invalid date');

/** "#42" / "42" / 42 → 42 (a parent task number the user wrote). */
const taskNumberSchema = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const m = v.trim().match(/^#?(\d+)$/);
  return m ? parseInt(m[1], 10) : v;
}, z.number().int().positive());

/** One subtask the user listed: a clean title, optionally who does it and when. */
const subtaskItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  assignee: z.string().trim().min(1).max(100).nullish(),
  dueDate: z.preprocess((v) => (v === '' ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()),
});

/**
 * "/ai chia #42 thành subtask: API, UI cho @an" — subtasks of an existing task. `items` = what the user listed;
 * omitted when they asked for a breakdown without listing them (a second AI call proposes them).
 */
export const createSubtasksActionSchema = z.object({
  action: z.literal('create_subtasks'),
  taskRef: taskRefSchema,
  // Extra items are parsed and cut by the executor, which says so.
  items: z.array(subtaskItemSchema).max(MAX_PARSED_ACTIONS).nullish(),
  /** No items listed: the people the user named for the split ("cho @an @binh"), in order — one subtask each. */
  assignees: z.array(z.string().trim().min(1).max(100)).max(MAX_PARSED_ACTIONS).nullish(),
  /** No items listed: how many subtasks the user asked for ("chia #42 thành 3 subtask"). */
  count: z.number().int().positive().max(MAX_PARSED_ACTIONS).nullish(),
});

export const createTasksActionSchema = z.object({
  action: z.literal('create_tasks'),
  /** True when the replied (non-card) message is the material for the tasks. */
  useReply: z.boolean().optional(),
});

export const updateTaskActionSchema = z.object({
  action: z.literal('update_task'),
  taskRef: taskRefSchema,
  changes: z
    .object({
      status: statusSchema.optional(),
      assignee: z.string().trim().min(1).max(100).nullable().optional(),
      priority: prioritySchema.optional(),
      type: typeSchema.optional(),
      dueDate: dueDateSchema.nullable().optional(),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().trim().max(2000).nullable().optional(),
      /** Epic title as written, or null to take the task out of its epic. */
      epic: epicTitleSchema.nullable().optional(),
      /** Parent task number (make it a subtask of #N), or null to turn a subtask back into a regular task. */
      parent: taskNumberSchema.nullable().optional(),
    })
    .refine((c) => Object.values(c).some((v) => v !== undefined), 'No changes'),
  /** True only when the user explicitly asked for a NEW epic ("epic mới", "new epic") — then a missing one is created. */
  newEpic: z.boolean().nullish(),
});

/** "/ai tạo epic Login" — a new epic (bucket of tasks) in the group. */
export const createEpicActionSchema = z.object({
  action: z.literal('create_epic'),
  title: epicTitleSchema,
  description: z.string().trim().max(2000).nullish(),
});

export const deleteTaskActionSchema = z.object({
  action: z.literal('delete_task'),
  taskRef: taskRefSchema.optional(),
});

/** The user asks what a task is / why it exists / what's left ("giải thích #5", "#5 là gì"). Read-only. */
export const explainTaskActionSchema = z.object({
  action: z.literal('explain_task'),
  taskRef: taskRefSchema,
});

/** The request targets many tasks at once ("move all of @an's tasks to done"). */
export const bulkActionSchema = z.object({
  action: z.literal('bulk'),
});

/** `epic` = tasks of one epic; `epics` = the overview of every epic with its progress. */
export const QUERY_KINDS = ['mine', 'person', 'overdue', 'status', 'type', 'search', 'open', 'epic', 'epics'] as const;

export const queryActionSchema = z.object({
  action: z.literal('query'),
  kind: z.enum(QUERY_KINDS),
  person: z.string().trim().min(1).max(100).nullish(),
  status: statusSchema.nullish(),
  type: typeSchema.nullish(),
  text: z.string().trim().min(1).max(100).nullish(),
  /** Only tasks of this epic (title as written). */
  epic: epicTitleSchema.nullish(),
});

export const answerActionSchema = z.object({
  action: z.literal('answer'),
  text: z.string().trim().min(1).max(500),
});

export const clarifyActionSchema = z.object({
  action: z.literal('clarify'),
  question: z.string().trim().min(1).max(300),
});

export const aiActionSchema = z.discriminatedUnion('action', [
  createTasksActionSchema,
  createSubtasksActionSchema,
  updateTaskActionSchema,
  createEpicActionSchema,
  deleteTaskActionSchema,
  explainTaskActionSchema,
  bulkActionSchema,
  queryActionSchema,
  answerActionSchema,
  clarifyActionSchema,
]);

export const aiPlanSchema = z.preprocess(
  // Tolerate a bare action or a bare array.
  (v) => (Array.isArray(v) ? { actions: v } : v && typeof v === 'object' && 'action' in v ? { actions: [v] } : v),
  z.object({ actions: z.array(aiActionSchema).min(1).max(MAX_PARSED_ACTIONS) }),
);

export type AiAction = z.infer<typeof aiActionSchema>;
export type AiPlan = z.infer<typeof aiPlanSchema>;
export type TaskRef = z.infer<typeof taskRefSchema>;
export type UpdateTaskAction = z.infer<typeof updateTaskActionSchema>;
export type UpdateChanges = UpdateTaskAction['changes'];
export type ExplainTaskAction = z.infer<typeof explainTaskActionSchema>;
export type CreateEpicAction = z.infer<typeof createEpicActionSchema>;
export type QueryAction = z.infer<typeof queryActionSchema>;
export type CreateSubtasksAction = z.infer<typeof createSubtasksActionSchema>;
export type SubtaskItem = z.infer<typeof subtaskItemSchema>;
