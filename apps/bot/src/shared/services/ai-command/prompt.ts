export { AI_COMMAND_SYSTEM_PROMPT } from 'src/shared/services/ai-command/prompt.system';

export interface PromptMember {
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export interface PromptTask {
  taskNumber: number;
  title: string;
  status: string;
  type?: string;
  priority?: string;
  assignee?: string | null;
  dueDate?: string | null;
  /** Current description, so "add to the description" can keep what's there. */
  description?: string | null;
  /** Title of the task's epic (null = none). */
  epic?: string | null;
  /** Number of the parent task when this is a subtask. */
  parent?: number | null;
}

export interface AiPromptInput {
  request: string;
  requester: PromptMember;
  members: PromptMember[];
  timezone: string;
  /** YYYY-MM-DD in the group timezone. */
  today: string;
  replyTask?: PromptTask | null;
  /** Text of a replied normal (non-card) message. */
  replyMessage?: { from: string; text: string } | null;
  referencedTasks?: PromptTask[];
  /** Web chat: earlier turns (oldest first). Absent in Telegram. */
  history?: { role: 'user' | 'assistant'; content: string }[];
  /** Web chat: the ONE task the previous assistant answer showed or changed (null when none or several). */
  previousTask?: PromptTask | null;
  /** Web chat: every task number in the previous assistant answer. */
  previousNumbers?: number[];
  /** 'web' labels the replied card as the task open in the app. */
  channel?: 'telegram' | 'web';
  /** Titles of the group's open epics (oldest first). */
  epics?: string[];
}

/** Most epic titles listed in the planner prompt. */
export const PROMPT_EPICS_MAX = 30;

const HISTORY_TURN_MAX = 500;

function memberLabel(m: PromptMember): string {
  const name = [m.firstName, m.lastName].filter(Boolean).join(' ');
  if (m.username && name) return `@${m.username} (${name})`;
  return m.username ? `@${m.username}` : name || 'unknown';
}

function taskLabel(t: PromptTask): string {
  const parts = [`#${t.taskNumber} "${t.title.slice(0, 120)}"`, `status ${t.status}`];
  if (t.type) parts.push(`type ${t.type}`);
  if (t.priority) parts.push(`priority ${t.priority}`);
  parts.push(`assignee ${t.assignee || 'none'}`);
  if (t.dueDate) parts.push(`due ${t.dueDate}`);
  if (t.epic) parts.push(`epic "${t.epic.slice(0, 80)}"`);
  if (t.parent) parts.push(`subtask of #${t.parent}`);
  const label = parts.join(' · ');
  return t.description ? `${label}\n    description: ${JSON.stringify(t.description.slice(0, 800))}` : label;
}

/** The next 7 days with weekday names so the model can resolve "thứ 6", "next Monday", "mai". */
export function calendarLines(today: string): string[] {
  const lines: string[] = [];
  const start = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const label = i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : '';
    lines.push(`  ${weekday} ${iso}${label}`);
  }
  return lines;
}

export function buildAiCommandPrompt(input: AiPromptInput): string {
  const lines: string[] = [];
  lines.push(`Group timezone: ${input.timezone}`);
  lines.push('Calendar:');
  lines.push(...calendarLines(input.today));
  lines.push('');
  lines.push(`Requester: ${memberLabel(input.requester)}`);
  lines.push('Group members:');
  if (input.members.length === 0) lines.push('- (unknown)');
  for (const m of input.members.slice(0, 200)) lines.push(`- ${memberLabel(m)}`);
  lines.push('');
  const epics = input.epics ?? [];
  if (epics.length) {
    lines.push('Open epics:');
    for (const title of epics.slice(0, PROMPT_EPICS_MAX)) lines.push(`- ${JSON.stringify(title)}`);
    if (epics.length > PROMPT_EPICS_MAX) lines.push(`- …and ${epics.length - PROMPT_EPICS_MAX} more`);
  } else {
    lines.push('Open epics: none');
  }
  lines.push('');
  if (input.history?.length) {
    lines.push('Conversation so far (oldest first):');
    for (const turn of input.history) {
      const text = turn.content.replace(/\s+/g, ' ').trim().slice(0, HISTORY_TURN_MAX);
      lines.push(`${turn.role === 'user' ? 'User' : 'Assistant'}: ${text}`);
    }
    if (input.previousTask) {
      lines.push(`Task in the previous answer: ${taskLabel(input.previousTask)}`);
    } else if ((input.previousNumbers?.length ?? 0) > 1) {
      lines.push(
        `The previous answer showed several tasks (${input.previousNumbers!.map((n) => `#${n}`).join(', ')}) — "it" is ambiguous.`,
      );
    } else {
      lines.push('Task in the previous answer: none');
    }
    lines.push('');
  }
  if (input.replyTask) {
    const label = input.channel === 'web' ? 'Replied task card (the task open in the app, "this task")' : 'Replied task card';
    lines.push(`${label}: ${taskLabel(input.replyTask)}`);
  } else if (input.replyMessage) {
    lines.push(`Replied message (not a task card) from ${input.replyMessage.from}:`);
    lines.push(input.replyMessage.text.slice(0, 2000));
  } else {
    lines.push('Replied message: none');
  }
  if (input.referencedTasks?.length) {
    lines.push('Tasks mentioned in the request:');
    for (const t of input.referencedTasks) lines.push(`- ${taskLabel(t)}`);
  }
  lines.push('');
  lines.push(`Request: ${input.request}`);
  return lines.join('\n');
}
