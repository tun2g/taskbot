import {
  ExtractedTask,
  ExtractionInput,
  FALLBACK_DESCRIPTION_MAX,
  TITLE_MAX,
} from 'src/shared/services/task-extraction/types';

/**
 * Deterministic task used when AI is unavailable: one task for the whole request.
 * Title = requester note or the first line of the first message; a trailing @mention
 * (or a tagged user) becomes the assignee.
 */
export function buildFallbackTask(input: ExtractionInput): ExtractedTask {
  const first = input.messages.find((m) => m.text.trim()) ?? input.messages[0];
  const allText = input.messages
    .map((m) => m.text.trim())
    .filter(Boolean)
    .join('\n\n');
  let title = (input.note?.trim() || first?.text.trim().split('\n')[0] || 'Task from chat').trim();
  let assignee: string | undefined;

  const trailing = title.match(/\s*(@[A-Za-z0-9_]+)\s*$/);
  if (trailing && trailing.index! > 0) {
    assignee = trailing[1];
    title = title.slice(0, trailing.index).trim();
  }
  if (!assignee) {
    const tagged = input.messages.flatMap((m) => m.mentions ?? []).find((x) => x.telegramUserId);
    if (tagged) {
      assignee = tagged.text;
      const idx = title.lastIndexOf(tagged.text);
      if (idx > 0 && idx + tagged.text.length >= title.trimEnd().length) title = title.slice(0, idx).trim();
    }
  }
  title = title.slice(0, TITLE_MAX) || 'Task from chat';

  const description = allText && allText !== title ? allText.slice(0, FALLBACK_DESCRIPTION_MAX) : undefined;
  return {
    title,
    type: 'task',
    sourceMessageIds: input.messages.map((m) => m.messageId),
    ...(description ? { description } : {}),
    ...(assignee ? { assignee } : {}),
  };
}
