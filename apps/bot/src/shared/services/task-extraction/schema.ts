import { DEFAULT_TASK_TYPE, TASK_TYPE_VALUES } from '@tbot/shared';
import { z } from 'zod';
import { DESCRIPTION_MAX, TITLE_MAX } from 'src/shared/services/task-extraction/types';
import { TemplateDetails } from 'src/shared/services/task-templates';

// Lenient per-field parsing: a bad optional field is dropped instead of failing the whole run.
const optionalString = z
  .string()
  .nullish()
  .catch(undefined)
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const extractedTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .transform((t) => t.slice(0, TITLE_MAX)),
  description: optionalString.transform((v) => v?.slice(0, DESCRIPTION_MAX)),
  // Template fields for the task's type; rendered into `description` by code
  details: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .nullish()
    .catch(undefined)
    .transform((v) => (v ?? undefined) as TemplateDetails | undefined),
  type: z.enum(TASK_TYPE_VALUES).catch(DEFAULT_TASK_TYPE),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).nullish().catch(undefined).transform((v) => v ?? undefined),
  assignee: optionalString,
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)))
    .nullish()
    .catch(undefined)
    .transform((v) => v ?? undefined),
  epic: optionalString,
  sourceMessageIds: z.array(z.number().int()).catch([]),
});

// Tolerates a bare array as well as {"tasks": [...]}.
export const extractionResponseSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { tasks: v } : v),
  z.object({ tasks: z.array(extractedTaskSchema) }),
);

export type ParsedExtraction = z.infer<typeof extractionResponseSchema>;
