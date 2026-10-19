import { TASK_PRIORITY_VALUES, TASK_STATUS_VALUES, TASK_TYPE_VALUES } from '@tbot/shared';
import { z } from 'zod';

/** Most task mutations one /ai request may perform; bigger jobs go to the board. */
export const MAX_AI_MUTATIONS = 5;
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

const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), 'Invalid date');

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
    })
    .refine((c) => Object.values(c).some((v) => v !== undefined), 'No changes'),
});

export const deleteTaskActionSchema = z.object({
  action: z.literal('delete_task'),
  taskRef: taskRefSchema.optional(),
});

/** The request targets many tasks at once ("move all of @an's tasks to done"). */
export const bulkActionSchema = z.object({
  action: z.literal('bulk'),
});

export const QUERY_KINDS = ['mine', 'person', 'overdue', 'status', 'type', 'search', 'open'] as const;

export const queryActionSchema = z.object({
  action: z.literal('query'),
  kind: z.enum(QUERY_KINDS),
  person: z.string().trim().min(1).max(100).nullish(),
  status: statusSchema.nullish(),
  type: typeSchema.nullish(),
  text: z.string().trim().min(1).max(100).nullish(),
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
  updateTaskActionSchema,
  deleteTaskActionSchema,
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
export type QueryAction = z.infer<typeof queryActionSchema>;
