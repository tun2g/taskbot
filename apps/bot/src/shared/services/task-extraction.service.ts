import { DEFAULT_TASK_TYPE, TASK_TYPE_HINTS, TASK_TYPE_ORDER, TASK_TYPE_VALUES } from '@tbot/shared';
import { z } from 'zod';
import logger from 'src/shared/logger/logger';
import { aiService, AIUnavailableError, parseJsonLoose } from 'src/shared/services/ai/ai.service';
import { BufferedMention, BufferedMessage } from 'src/shared/services/message-buffer.service';

export const MAX_EXTRACTED_TASKS = 20;
const TITLE_MAX = 200; // DB limit; the prompt asks for ≤ 120
const DESCRIPTION_MAX = 1000;
const FALLBACK_DESCRIPTION_MAX = 4000;

export interface ExtractionMember {
  telegramUserId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface ExtractionInput {
  /** Oldest first. */
  messages: BufferedMessage[];
  /** Extra instruction from the person running /task (e.g. a title or "assign to @an"). */
  note?: string;
  members: ExtractionMember[];
  timezone: string;
  now?: Date;
}

export interface ExtractedTask {
  title: string;
  description?: string;
  /** One of TASK_TYPE_VALUES (bug, feature, improvement, task, chore, research, question). */
  type: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: string;
  /** YYYY-MM-DD */
  dueDate?: string;
  sourceMessageIds: number[];
}

export type ExtractionFallbackReason = 'unconfigured' | 'failed';

export interface ExtractionResult {
  tasks: ExtractedTask[];
  /** 'ai' when the model produced the tasks, 'fallback' for the deterministic basic task. */
  source: 'ai' | 'fallback';
  fallbackReason?: ExtractionFallbackReason;
}

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
  sourceMessageIds: z.array(z.number().int()).catch([]),
});

// Tolerates a bare array as well as {"tasks": [...]}.
export const extractionResponseSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { tasks: v } : v),
  z.object({ tasks: z.array(extractedTaskSchema) }),
);

const TYPE_RULES = TASK_TYPE_ORDER.map((t) => `"${t}" = ${TASK_TYPE_HINTS[t].toLowerCase()}`).join('; ');

const SYSTEM_PROMPT = `You turn Telegram group chat messages into well-formed work items for a team task board.

Return ONLY JSON of this shape:
{"tasks":[{"title":string,"description":string?,"type":${TASK_TYPE_VALUES.map((t) => `"${t}"`).join('|')},"priority":"low"|"medium"|"high"|"urgent"?,"assignee":string?,"dueDate":"YYYY-MM-DD"?,"sourceMessageIds":number[]}]}

Rules:
- One task per distinct actionable item (something someone must do, fix, build, decide or answer). Skip greetings, chit-chat, thanks, status chatter and items that are already done. Merge duplicates. At most 20 tasks. If nothing is actionable, return {"tasks":[]}.
- title: imperative and specific ("Fix login crash on iOS 17", "Gửi báo giá cho khách A"), at most 120 characters, written in the SAME language as the source messages. No trailing period, no @mentions, no dates in the title.
- description: a short summary of context and acceptance criteria taken ONLY from the messages (at most 1000 characters, same language as the messages). Never invent facts, names, numbers or deadlines. Omit it if there is nothing beyond the title.
- type: pick the best fit — ${TYPE_RULES}. Use "task" when unsure.
- priority: include ONLY when urgency is stated explicitly (e.g. "urgent", "gấp", "ASAP", "khẩn", "low priority"); otherwise omit it.
- assignee: the person the messages say should do it, copied exactly as written (e.g. "@an" or "Hùng"). Prefer a name from the member list when it clearly refers to them. Omit if nobody is named. Never assign to someone just because they wrote the message.
- dueDate: include ONLY when a date or deadline is stated explicitly. Resolve relative dates ("tomorrow", "thứ 6", "next Monday", "cuối tuần", "EOD") against the date of the message that says it, in the group timezone. Format YYYY-MM-DD. Otherwise omit it.
- sourceMessageIds: the ids of the messages this task comes from.
- The requester's note, if present, is an instruction from the person creating the tasks (e.g. a preferred title or who to assign). Follow it.`;

function safeTimezone(timezone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return 'UTC';
  }
}

/** YYYY-MM-DD of `date` in `timezone`. */
export function dateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dateTimeLabel(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimezone(timezone),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${dateInTimezone(date, timezone)} ${get('weekday')} ${get('hour')}:${get('minute')}`;
}

function memberLabel(m: ExtractionMember): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ');
  if (m.username && name) return `@${m.username} (${name})`;
  return m.username ? `@${m.username}` : name || `user ${m.telegramUserId}`;
}

export function buildExtractionPrompt(input: ExtractionInput): string {
  const tz = safeTimezone(input.timezone);
  const now = input.now ?? new Date();
  const lines: string[] = [];
  lines.push(`Group timezone: ${tz}`);
  lines.push(`Today: ${dateTimeLabel(now, tz)}`);
  lines.push('');
  lines.push('Group members:');
  if (input.members.length === 0) lines.push('- (unknown)');
  for (const m of input.members.slice(0, 200)) lines.push(`- ${memberLabel(m)}`);
  lines.push('');
  lines.push('Messages (oldest first):');
  for (const msg of input.messages) {
    const when = dateTimeLabel(new Date(msg.date * 1000), tz);
    lines.push(`[id ${msg.messageId}] ${msg.fromName} · ${when}:`);
    lines.push(msg.text);
    const tagged = (msg.mentions ?? []).filter((x) => x.telegramUserId).map((x) => x.text);
    if (tagged.length) lines.push(`(tagged people: ${tagged.join(', ')})`);
    lines.push('');
  }
  if (input.note) {
    lines.push(`Requester's note: ${input.note}`);
  }
  return lines.join('\n');
}

type ParsedExtraction = z.infer<typeof extractionResponseSchema>;

/** Dedupes, caps at MAX_EXTRACTED_TASKS and keeps only source ids that were in the input. */
export function normalizeExtractedTasks(data: ParsedExtraction, validMessageIds: number[]): ExtractedTask[] {
  const valid = new Set(validMessageIds);
  const seenTitles = new Set<string>();
  const tasks: ExtractedTask[] = [];
  for (const task of data.tasks) {
    const key = task.title.toLowerCase().replace(/\s+/g, ' ');
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    let ids = Array.from(new Set(task.sourceMessageIds.filter((id) => valid.has(id))));
    if (ids.length === 0) ids = validMessageIds.length === 1 ? [...validMessageIds] : [];
    tasks.push({
      title: task.title,
      type: task.type,
      sourceMessageIds: ids,
      ...(task.description ? { description: task.description } : {}),
      ...(task.priority ? { priority: task.priority } : {}),
      ...(task.assignee ? { assignee: task.assignee } : {}),
      ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    });
    if (tasks.length >= MAX_EXTRACTED_TASKS) break;
  }
  return tasks;
}

/** Parses and validates raw model output. Returns null when it is not usable. */
export function parseExtractionResponse(raw: string, validMessageIds: number[]): ExtractedTask[] | null {
  const result = extractionResponseSchema.safeParse(parseJsonLoose(raw));
  return result.success ? normalizeExtractedTasks(result.data, validMessageIds) : null;
}

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

/** Matches the AI's assignee string to a group member. Never trusts the AI with ids. */
export function resolveMember<T extends ExtractionMember>(
  name: string,
  members: T[],
  mentions: BufferedMention[] = [],
): T | null {
  const raw = name.trim();
  if (!raw) return null;
  const lower = raw.replace(/^@/, '').toLowerCase();

  // 1. @username (case-insensitive)
  const byUsername = members.find((m) => m.username && m.username.toLowerCase() === lower);
  if (byUsername) return byUsername;

  const unique = (list: T[]) => (list.length === 1 ? list[0] : null);
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const target = norm(raw);

  // 2. exact full name, then first name (only when unambiguous)
  const byFull = unique(members.filter((m) => norm([m.firstName, m.lastName].filter(Boolean).join(' ')) === target));
  if (byFull) return byFull;
  const byFirst = unique(members.filter((m) => m.firstName && norm(m.firstName) === target));
  if (byFirst) return byFirst;

  // 3. text_mention entities in the source messages (users without a username)
  const tagged = mentions.find(
    (x) => x.telegramUserId && (norm(x.text) === target || norm(x.text).replace(/^@/, '') === lower),
  );
  if (tagged) {
    const byId = members.find((m) => m.telegramUserId === tagged.telegramUserId);
    if (byId) return byId;
  }
  return null;
}

/** @deprecated alias of resolveMember */
export const resolveAssignee = resolveMember;

export class TaskExtractionService {
  /** Never throws for AI problems: falls back to one deterministic basic task. */
  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const request = { system: SYSTEM_PROMPT, user: buildExtractionPrompt(input), temperature: 0.2 };
    try {
      const data = await aiService.generateJson(request, extractionResponseSchema, { retries: 1 });
      return { tasks: normalizeExtractedTasks(data, input.messages.map((m) => m.messageId)), source: 'ai' };
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      if (error.reason !== 'unconfigured') logger.warn(`Task extraction fell back to a basic task: ${error.message}`);
      return {
        tasks: [buildFallbackTask(input)],
        source: 'fallback',
        fallbackReason: error.reason === 'unconfigured' ? 'unconfigured' : 'failed',
      };
    }
  }
}

export const taskExtractionService = new TaskExtractionService();
