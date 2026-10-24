import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import { UpdateOutcome } from 'src/shared/services/ai-command/result';
import { InlineKeyboardButton } from 'telegraf/types';

// Telegram /ai reply shapes and fixed messages (HTML parse mode).

export interface AiReply {
  /** HTML. */
  text: string;
  buttons?: InlineKeyboardButton[][];
}

export type AiOutcome =
  /** `updates`: tasks this request changed (forums also announce them in the "Task events" topic). */
  | { kind: 'reply'; reply: AiReply; updates?: UpdateOutcome[] }
  | { kind: 'create'; useReply: boolean };

/** What still works without AI — appended when the AI says no (limit reached / turned off). */
export const AI_STILL_WORKS = 'Card buttons and /new, /list, /done still work.';
export const AI_UNAVAILABLE_MESSAGE = '🤖 AI is unavailable right now — use the card buttons or /new, /list, /done.';
export const WHICH_TASK_MESSAGE = '🤔 Which task? Reply to its card or write #number.';
/** The plan had nothing to do: show what /ai understands instead of asking "Which task?". */
export const NOT_UNDERSTOOD_MESSAGE =
  '🤔 I didn’t get that. Try:\n' +
  '<code>/ai tôi còn task nào?</code> — your open tasks\n' +
  '<code>/ai #12 xong rồi</code> — update a task\n' +
  '<code>/ai tạo task fix login cho @an hạn thứ 6</code> — create one';
/** Plain replies to the bot are ignored, so the answer to a question must come as a new /ai. */
export const CLARIFY_HINT = 'Answer with <code>/ai …</code> — I don’t read plain replies.';
/** Shown in an explanation when the second AI call failed: the task's own details follow. */
export const EXPLAIN_UNAVAILABLE_NOTE = '🤖 AI can’t explain it right now — here’s what the task says:';
/** Most description characters shown when the AI explanation is unavailable. */
export const EXPLAIN_FALLBACK_MAX = 300;
/** Most characters of the source message quoted when there's no description either. */
export const EXPLAIN_SOURCE_MAX = 100;

export const DELETE_REFUSAL_MESSAGE = '🗑 I don’t delete tasks from chat. To delete, use 🗑 on the task card (⋯ More → 🗑 Delete).';

export type GroupId = AiRequestContext['group']['_id'];
