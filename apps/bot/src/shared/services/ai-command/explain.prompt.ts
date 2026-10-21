import { z } from 'zod';
import type { Lang } from 'src/shared/services/ai-command/format';

// The second AI call of "giải thích #5": the planner only picks the task; this prompt writes the
// explanation from everything we know about it. Plain text out — each renderer formats it.

/** Most source chat messages / activity entries / characters sent to the model. */
const MAX_SOURCE_MESSAGES = 12;
const SOURCE_TEXT_MAX = 600;
const SOURCES_TOTAL_MAX = 4000;
const MAX_ACTIVITY = 10;
const DESCRIPTION_MAX = 2000;

export interface ExplainPromptInput {
  request: string;
  lang: Lang;
  /** YYYY-MM-DD in the group timezone. */
  today: string;
  timezone: string;
  task: {
    taskNumber: number;
    title: string;
    description: string | null;
    /** Plain words ("Bug", "In progress", "High"). */
    type: string;
    status: string;
    priority: string;
    assignee: string | null;
    creator: string | null;
    /** YYYY-MM-DD. */
    createdAt: string | null;
    /** YYYY-MM-DD. */
    dueDate: string | null;
    closed: boolean;
    /** Title of the epic (group of related tasks) the task belongs to. */
    epic?: string | null;
    /** "#42 Checkout v2" when this is a subtask (a step of that bigger task). */
    parent?: string | null;
  };
  /** Its subtasks (steps), oldest first: title + where it stands. */
  subtasks?: { title: string; state: 'open' | 'done' | 'cancelled' }[];
  /** Who asked (display name without "@") — never suggested as the person to ask. */
  askedBy: string;
  /** People who could answer open questions, best first (source-message authors → creator → assignee), without "@". */
  whoToAsk: string[];
  /** The chat messages the task was created from (oldest first). */
  sources: { from: string; text: string }[];
  /** Activity log, oldest first: "2026-10-12 @an: status To do → In progress". */
  activity: string[];
}

// Generous on input (a long answer is trimmed by tidyExplanation, not rejected and retried).
export const explanationSchema = z.object({ text: z.string().trim().min(1).max(4000) });

/** What tidyExplanation keeps of the model's text. */
export const EXPLANATION_MAX_LINES = 5;
export const EXPLANATION_MAX_CHARS = 400;

export const EXPLAIN_TASK_SYSTEM_PROMPT = `You explain ONE task from a team's task board to a group member who asked about it in a Telegram group or the board app.
Use ONLY the facts given below: the task fields, the original chat messages the task was created from, and its activity log. Never invent people, dates, reasons, requirements, links or task numbers. When you infer something, say so ("có lẽ" / "probably").

Return ONLY a JSON object: {"text":"..."}

Rules for "text":
- Language: the same as the user's request (Vietnamese when the request is Vietnamese, even without accents). Keep task titles, names and technical terms as written.
- Plain text only: no Markdown (no **, no #, no bullets like "-"), no HTML, no task numbers. Write people's names WITHOUT "@" (so nobody gets pinged).
- At most 4 short lines, each under 60 characters. Start each line with ONE of these emoji, in this order, and skip a line when you have nothing true to say for it:
  🎯 what the task is and why it exists — the original chat messages are the best source for the "why"
  🏁 what "done" most likely looks like
  💬 what is missing or unclear and who could answer, e.g. "Chưa có mô tả — hỏi Tú" / "No description yet — ask Tú". Pick the first fitting name from "Who could answer"; never the person who asked.
- You may use 2 lines for 🎯 when the original discussion has important details (steps, error message, scope).
- Status, assignee, due date and epic are shown to the user separately — don't repeat them.
- A subtask is one step of its parent task: say in the 🎯 line what it is part of (by the parent's title, no number).
- When the task has subtasks, the 🏁 line may say what is left by their titles (e.g. "Còn: viết UI, test").
- If the request asks something specific about the task ("vì sao?", "ai làm?", "hạn khi nào?", "why?"), answer that on the first line.
- If there is too little information to explain the task, say so in one 🎯 line and add the 💬 line.`;

function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function buildExplainPrompt(input: ExplainPromptInput): string {
  const { task } = input;
  const lines: string[] = [];
  lines.push(`Today: ${input.today} (group timezone ${input.timezone})`);
  lines.push(`Request: ${clip(input.request, 300)}`);
  lines.push(`Asked by: ${input.askedBy}`);
  if (input.lang === 'vi') lines.push('The request is in Vietnamese — answer in Vietnamese.');
  lines.push('');
  lines.push(`Task #${task.taskNumber}: ${JSON.stringify(task.title)}`);
  lines.push(`Type: ${task.type}`);
  lines.push(`Status: ${task.status}${task.closed ? ' (closed)' : ''}`);
  lines.push(`Priority: ${task.priority}`);
  lines.push(`Assignee: ${task.assignee ?? 'none'}`);
  lines.push(`Created by: ${task.creator ?? 'unknown'}${task.createdAt ? ` on ${task.createdAt}` : ''}`);
  if (task.epic) lines.push(`Epic: ${JSON.stringify(task.epic)}`);
  if (task.parent) lines.push(`Subtask of: ${JSON.stringify(task.parent)}`);
  if (input.subtasks?.length) {
    const left = input.subtasks.filter((s) => s.state === 'open').map((s) => JSON.stringify(clip(s.title, 80)));
    const done = input.subtasks.filter((s) => s.state === 'done').length;
    const counted = input.subtasks.filter((s) => s.state !== 'cancelled').length;
    const cancelled = input.subtasks.length - counted;
    lines.push(
      `Subtasks: ${done}/${counted} done${cancelled ? ` (${cancelled} cancelled, not counted)` : ''}${left.length ? `; still open: ${left.slice(0, 8).join(', ')}` : ''}`,
    );
  }
  lines.push(`Due date: ${task.dueDate ?? 'none'}`);
  lines.push(
    `Description: ${task.description?.trim() ? JSON.stringify(task.description.trim().slice(0, DESCRIPTION_MAX)) : 'none'}`,
  );
  lines.push(`Who could answer (best first): ${input.whoToAsk.length ? input.whoToAsk.join(', ') : 'nobody known'}`);
  lines.push('');

  if (input.sources.length) {
    lines.push('Original chat messages the task was created from (oldest first):');
    let budget = SOURCES_TOTAL_MAX;
    for (const m of input.sources.slice(0, MAX_SOURCE_MESSAGES)) {
      const text = clip(m.text, Math.min(SOURCE_TEXT_MAX, budget));
      if (!text) continue;
      lines.push(`- ${m.from || 'someone'}: ${text}`);
      budget -= text.length;
      if (budget <= 0) break;
    }
  } else {
    lines.push('Original chat messages: none (the task was created without a chat discussion).');
  }
  lines.push('');

  if (input.activity.length) {
    lines.push('Activity (oldest first):');
    for (const a of input.activity.slice(-MAX_ACTIVITY)) lines.push(`- ${clip(a, 200)}`);
  } else {
    lines.push('Activity: none');
  }
  return lines.join('\n');
}

/**
 * Keeps the model's text plain and short: no Markdown emphasis, no blank-line runs, no "@" (no pings),
 * at most EXPLANATION_MAX_LINES lines / EXPLANATION_MAX_CHARS characters, and no OTHER task numbers
 * (the web chat reads "#N" in the last answer as "the task we talk about").
 */
export function tidyExplanation(text: string, taskNumber: number): string {
  const tidy = text
    .replace(/\r/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/#(\d+)/g, (m, n) => (Number(n) === taskNumber ? m : n))
    .replace(/(^|[^\w])@(\w)/g, '$1$2')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, EXPLANATION_MAX_LINES)
    .join('\n')
    .trim();
  return tidy.length > EXPLANATION_MAX_CHARS ? `${tidy.slice(0, EXPLANATION_MAX_CHARS - 1).trimEnd()}…` : tidy;
}
