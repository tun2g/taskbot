import { z } from 'zod';
import type { Lang } from 'src/shared/services/ai-command/format';
import { MAX_AI_SUBTASKS } from 'src/shared/services/ai-command/plan.schema';

// The second AI call of "/ai chia #42 thành subtask" when the user listed no items: proposes a short
// breakdown of ONE task from its own fields. Titles only — people and dates are never invented.

const DESCRIPTION_MAX = 2000;
export const BREAKDOWN_MIN = 2;
export const BREAKDOWN_MAX = Math.min(6, MAX_AI_SUBTASKS);

export interface BreakdownPromptInput {
  request: string;
  lang: Lang;
  task: {
    taskNumber: number;
    title: string;
    description: string | null;
    /** Plain word ("Bug", "Feature"). */
    type: string;
    epic?: string | null;
  };
  /** Titles of the subtasks it already has (don't repeat them). */
  existing: string[];
  /** How many subtasks the user asked for (e.g. one per named person); null = the AI decides. */
  count?: number | null;
}

export const breakdownSchema = z.object({
  subtasks: z.array(z.object({ title: z.string().trim().min(1).max(200) })).max(20),
});

export const BREAKDOWN_SYSTEM_PROMPT = `You split ONE task from a team's task board into subtasks: concrete, separately doable steps that together finish the task.

Return ONLY a JSON object: {"subtasks":[{"title":"..."}]}

Rules:
- ${BREAKDOWN_MIN} to ${BREAKDOWN_MAX} subtasks; fewer is better when the task is small. When "Wanted" gives a number, return exactly that many. Order them in the order people would do them.
- Each title is a clean work item: verb first, at most 8 words, no numbering, no task numbers, no people, no dates.
- Same language as the user's request (Vietnamese when the request is Vietnamese, even without accents). Keep technical terms as written.
- Use ONLY what the task says. Don't add scope it doesn't mention (no "write docs" / "deploy" unless the task implies it).
- Don't repeat a subtask that already exists.
- If the task is too vague to split into real steps, return {"subtasks":[]} — never pad with generic steps like "clarify scope".`;

const clip = (text: string, max: number) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

export function buildBreakdownPrompt(input: BreakdownPromptInput): string {
  const { task } = input;
  const lines = [`Request: ${clip(input.request, 300)}`];
  if (input.lang === 'vi') lines.push('The request is in Vietnamese — write the titles in Vietnamese.');
  lines.push('', `Task #${task.taskNumber}: ${JSON.stringify(task.title)}`, `Type: ${task.type}`);
  if (task.epic) lines.push(`Epic: ${JSON.stringify(task.epic)}`);
  lines.push(
    `Description: ${task.description?.trim() ? JSON.stringify(task.description.trim().slice(0, DESCRIPTION_MAX)) : 'none'}`,
  );
  if (input.count) lines.push(`Wanted: exactly ${input.count} subtasks.`);
  lines.push(
    input.existing.length
      ? `Existing subtasks: ${input.existing.map((t) => JSON.stringify(clip(t, 80))).join(', ')}`
      : 'Existing subtasks: none',
  );
  return lines.join('\n');
}
