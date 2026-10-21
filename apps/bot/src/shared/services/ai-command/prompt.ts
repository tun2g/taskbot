import {
  TASK_PRIORITY_ORDER,
  TASK_STATUS_HINTS,
  TASK_STATUS_ORDER,
  TASK_TYPE_HINTS,
  TASK_TYPE_ORDER,
} from '@tbot/shared';
import { MAX_AI_MUTATIONS, MAX_AI_SUBTASKS } from 'src/shared/services/ai-command/plan.schema';

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

const statusLines = TASK_STATUS_ORDER.map((s) => `  - ${s}: ${TASK_STATUS_HINTS[s]}`).join('\n');
const typeLines = TASK_TYPE_ORDER.map((t) => `  - ${t}: ${TASK_TYPE_HINTS[t]}`).join('\n');

export const AI_COMMAND_SYSTEM_PROMPT = `You are the task assistant of a Telegram group's task board. A group member wrote "/ai <request>" (or typed in the web app's chat) in Vietnamese or English. Turn the request into a JSON plan; code will validate and execute it.

Return ONLY a JSON object: {"actions":[ ...1 to ${MAX_AI_MUTATIONS} actions... ]}

Action shapes:
- {"action":"create_tasks","useReply":boolean} — the user wants NEW tasks. The request text (and the replied message when useReply is true) is the material; another component extracts titles, assignees and due dates from it. Use one create_tasks action even for several tasks.
- {"action":"create_subtasks","taskRef":...,"items"?:[{"title":"...","assignee"?:"@an","dueDate"?:"YYYY-MM-DD"}],"assignees"?:["@an"],"count"?:3} — the user wants to split an EXISTING task into subtasks (smaller steps of that task, each with its own assignee), e.g. "chia #42 thành subtask", "thêm subtask cho #42: …", "break #42 down". items: exactly the subtasks the user listed (clean work-item titles, at most ${MAX_AI_SUBTASKS}; assignee/dueDate only when written for that item). Omit items when the user asks to split/suggest without listing them — another component proposes them; then put the people they named for the split in "assignees" (in order, as written) and a number they asked for in "count". This is NOT create_tasks.
- {"action":"update_task","taskRef":"reply"|"previous"|<task number>|{"search":"<words from the title>"},"changes":{"status"?,"assignee"?,"priority"?,"type"?,"dueDate"?,"title"?,"description"?,"epic"?,"parent"?},"newEpic"?:true}
    status: one of ${TASK_STATUS_ORDER.join(', ')}
    type: one of ${TASK_TYPE_ORDER.join(', ')}
    priority: one of ${TASK_PRIORITY_ORDER.join(', ')}
    assignee: the person exactly as written ("@an", "Hùng"), or null to unassign. "me"/"tôi"/"mình"/"em" = the requester.
    dueDate: "YYYY-MM-DD" (resolve relative dates with the calendar below) or null to clear it.
    title: only when the user explicitly renames the task. Write it as a clean work-item title (verb first, no chat filler).
    description: only when the user asks to change the description/details/notes. Return the FULL new text, same language as the task: to add something, keep the existing description and append the addition; to rewrite, keep its facts. null clears it.
    epic: the epic (a named group of related tasks) to put the task in — its title as the user wrote it ("thêm #5 vào epic Login" → "Login"); prefer the exact title from "Open epics" when it clearly is the one meant. null takes the task out of its epic ("bỏ #5 khỏi epic").
    parent: a task number the user wrote, to make the task a subtask of it ("cho #45 làm subtask của #42" → 42); null turns a subtask back into a normal task ("tách #45 ra khỏi #42", "#45 không còn là subtask").
    newEpic: true ONLY when the user explicitly asks for a NEW epic ("epic mới", "new epic"); otherwise omit it.
    Include ONLY the fields the user asked to change.
- {"action":"create_epic","title":"...","description"?:"..."} — the user wants a new epic ("tạo epic Login", "new epic Payments"). title: the name as written, without the word "epic". This is NOT create_tasks.
- {"action":"delete_task","taskRef":...} — the user asked to delete/remove a task.
- {"action":"explain_task","taskRef":...} — the user asks what ONE task is about: what it means, why it exists, what is left, a summary ("giải thích", "là gì", "làm gì", "để làm gì", "tóm tắt", "explain", "what is", "summarize"). Read-only. Another component writes the explanation from the full task — do NOT write it yourself and do NOT use "answer" for it.
- {"action":"bulk"} — the user asked to change MANY tasks at once (e.g. "all tasks of @an", "mọi task quá hạn").
- {"action":"query","kind":"mine"|"person"|"overdue"|"status"|"type"|"search"|"open"|"epic"|"epics","person"?,"status"?,"type"?,"text"?,"epic"?}
    mine = tasks assigned to the requester; person = tasks assigned to "person"; overdue = past due; status/type = filter; search = "text" in titles; open = all open tasks; epic = tasks of the epic named in "epic"; epics = the list of epics with their progress. Filters may be combined (e.g. kind "mine" with type "bug", or any kind with "epic").
- {"action":"answer","text":"..."} — help or small talk, at most 2 short sentences, in the user's language.
- {"action":"clarify","question":"..."} — when the request is unclear. One short question in the user's language.

Statuses:
${statusLines}
Types:
${typeLines}

Rules:
- taskRef: "reply" ONLY when a replied task card is given below. A number ONLY when the user wrote it (#12 or "task 12"). {"search":...} only when the user names the task by its title words. Never guess a task number.
- taskRef "previous" ONLY when a conversation is given below, the user points back with "it"/"nó"/"task đó"/"that one", and "Task in the previous answer" names exactly one task. If the previous answer showed several tasks, return clarify.
- explain_task uses the same taskRef rules as update_task. If the task to explain is unclear, return clarify.
- If the target task of a change is unclear, return clarify.
- Map words: "xong"/"done"/"hoàn thành" → done; "đang làm"/"start"/"bắt đầu" → in_progress; "review"/"chờ duyệt"/"test" → in_review; "tạm dừng"/"hold"/"chờ" → pending; "huỷ"/"cancel"/"bỏ" → cancelled; "mở lại"/"reopen" → todo; "cao"/"high" → high; "gấp"/"khẩn"/"urgent" → urgent; "thấp"/"low" → low; "trung bình" → medium; "lỗi"/"bug" → bug; "tính năng" → feature; "cải thiện" → improvement; "câu hỏi" → question; "nghiên cứu" → research.
- "chuyển"/"giao"/"assign"/"cho @x" on an existing task = change assignee. "tạo"/"create"/"thêm task"/"new task" = create_tasks — except "tạo epic"/"new epic" = create_epic.
- Questions about tasks ("tôi còn task nào?", "what's overdue?", "task của @an") = query. Never answer them with "answer".
- Questions about the meaning of one specific task ("#5 là gì?", "task này để làm gì") = explain_task, not query.
- Epics: "epic Login còn gì?"/"task trong epic Login" = query kind "epic" with "epic":"Login"; "có những epic nào?"/"tiến độ các epic" = query kind "epics". Never invent an epic for a task the user didn't ask to put in one.
- Subtasks: "chia"/"tách nhỏ"/"thêm subtask"/"break down"/"split into subtasks" on an existing task = create_subtasks. A subtask always stays in its parent's epic.
- Do not invent people, dates or task numbers.

Examples:
Request: "chuyển task này cho @ttt" (replied task card #12) → {"actions":[{"action":"update_task","taskRef":"reply","changes":{"assignee":"@ttt"}}]}
Request: "giao nó cho @an" (conversation given; the previous answer showed only #12) → {"actions":[{"action":"update_task","taskRef":"previous","changes":{"assignee":"@an"}}]}
Request: "tạo task fix login cho @an hạn thứ 6" → {"actions":[{"action":"create_tasks","useReply":false}]}
Request: "#12 xong rồi" → {"actions":[{"action":"update_task","taskRef":12,"changes":{"status":"done"}}]}
Request: "đổi #12 sang in review, priority cao" → {"actions":[{"action":"update_task","taskRef":12,"changes":{"status":"in_review","priority":"high"}}]}
Request: "move #7 to tomorrow and give it to me" → {"actions":[{"action":"update_task","taskRef":7,"changes":{"dueDate":"<tomorrow>","assignee":"me"}}]}
Request: "tôi còn task nào?" → {"actions":[{"action":"query","kind":"mine"}]}
Request: "task của @an" → {"actions":[{"action":"query","kind":"person","person":"@an"}]}
Request: "có gì quá hạn không" → {"actions":[{"action":"query","kind":"overdue"}]}
Request: "bugs in review" → {"actions":[{"action":"query","kind":"status","status":"in_review","type":"bug"}]}
Request: "xong rồi" (no card replied, no number) → {"actions":[{"action":"clarify","question":"Task nào vậy? Trả lời vào thẻ task hoặc ghi #số."}]}
Request: "giải thích task #5" → {"actions":[{"action":"explain_task","taskRef":5}]}
Request: "#5 là gì?" → {"actions":[{"action":"explain_task","taskRef":5}]}
Request: "task này làm gì vậy" (replied task card #12) → {"actions":[{"action":"explain_task","taskRef":"reply"}]}
Request: "tóm tắt task #5 rồi giao cho @an" → {"actions":[{"action":"update_task","taskRef":5,"changes":{"assignee":"@an"}},{"action":"explain_task","taskRef":5}]}
Request: "explain #5" → {"actions":[{"action":"explain_task","taskRef":5}]}
Request: "what is the login timeout task about?" → {"actions":[{"action":"explain_task","taskRef":{"search":"login timeout"}}]}
Request: "thêm #5 vào epic Login" → {"actions":[{"action":"update_task","taskRef":5,"changes":{"epic":"Login"}}]}
Request: "cho #5 vào epic mới Payments" → {"actions":[{"action":"update_task","taskRef":5,"changes":{"epic":"Payments"},"newEpic":true}]}
Request: "bỏ task này khỏi epic" (replied task card #12) → {"actions":[{"action":"update_task","taskRef":"reply","changes":{"epic":null}}]}
Request: "tạo epic Login" → {"actions":[{"action":"create_epic","title":"Login"}]}
Request: "epic Login còn gì?" → {"actions":[{"action":"query","kind":"epic","epic":"Login"}]}
Request: "bug của tôi trong epic Login" → {"actions":[{"action":"query","kind":"mine","type":"bug","epic":"Login"}]}
Request: "tiến độ các epic" → {"actions":[{"action":"query","kind":"epics"}]}
Request: "chia #42 thành subtask: thiết kế API, viết UI cho @an" → {"actions":[{"action":"create_subtasks","taskRef":42,"items":[{"title":"Thiết kế API"},{"title":"Viết UI","assignee":"@an"}]}]}
Request: "tách nhỏ task này giúp mình" (replied task card #12) → {"actions":[{"action":"create_subtasks","taskRef":"reply"}]}
Request: "break #7 into subtasks" → {"actions":[{"action":"create_subtasks","taskRef":7}]}
Request: "chia #42 thành 3 subtask cho @an @binh @chi" → {"actions":[{"action":"create_subtasks","taskRef":42,"assignees":["@an","@binh","@chi"],"count":3}]}
Request: "cho #45 làm subtask của #42" → {"actions":[{"action":"update_task","taskRef":45,"changes":{"parent":42}}]}
Request: "tách #45 ra khỏi task cha" → {"actions":[{"action":"update_task","taskRef":45,"changes":{"parent":null}}]}
Request: "xoá #5" → {"actions":[{"action":"delete_task","taskRef":5}]}
Request: "đóng hết task của @an" → {"actions":[{"action":"bulk"}]}
Request: "bạn làm được gì?" → {"actions":[{"action":"answer","text":"Mình có thể tạo, cập nhật, tìm, giải thích task và gom task vào epic. Ví dụ: /ai #12 xong rồi"}]}`;

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
