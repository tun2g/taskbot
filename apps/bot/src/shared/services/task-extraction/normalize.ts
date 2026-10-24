import { parseJsonLoose } from 'src/shared/services/ai/ai.service';
import { extractionResponseSchema, ParsedExtraction } from 'src/shared/services/task-extraction/schema';
import { DESCRIPTION_MAX, ExtractedTask, MAX_EXTRACTED_TASKS } from 'src/shared/services/task-extraction/types';
import { cleanTitle, renderTemplate } from 'src/shared/services/task-templates';

/** Dedupes, caps at MAX_EXTRACTED_TASKS and keeps only source ids that were in the input. */
export function normalizeExtractedTasks(
  data: ParsedExtraction,
  validMessageIds: number[],
  language: 'vi' | 'en' = 'en',
): ExtractedTask[] {
  const valid = new Set(validMessageIds);
  const seenTitles = new Set<string>();
  const tasks: ExtractedTask[] = [];
  for (const task of data.tasks) {
    const title = cleanTitle(task.title);
    const description =
      (task.details && renderTemplate(task.type, task.details, language)) || task.description || undefined;
    const key = title.toLowerCase().replace(/\s+/g, ' ');
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    let ids = Array.from(new Set(task.sourceMessageIds.filter((id) => valid.has(id))));
    if (ids.length === 0) ids = validMessageIds.length === 1 ? [...validMessageIds] : [];
    tasks.push({
      title,
      type: task.type,
      sourceMessageIds: ids,
      ...(description ? { description: description.slice(0, DESCRIPTION_MAX) } : {}),
      ...(task.priority ? { priority: task.priority } : {}),
      ...(task.assignee ? { assignee: task.assignee } : {}),
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
      ...(task.epic ? { epic: task.epic } : {}),
    });
    if (tasks.length >= MAX_EXTRACTED_TASKS) break;
  }
  return tasks;
}

/** Parses and validates raw model output. Returns null when it is not usable. */
export function parseExtractionResponse(
  raw: string,
  validMessageIds: number[],
  language: 'vi' | 'en' = 'en',
): ExtractedTask[] | null {
  const result = extractionResponseSchema.safeParse(parseJsonLoose(raw));
  return result.success ? normalizeExtractedTasks(result.data, validMessageIds, language) : null;
}
