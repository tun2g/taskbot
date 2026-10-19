import type { ITask } from './task.js';

/** One turn of the web "Ask AI" conversation, sent back as context for follow-ups. */
export interface AiChatTurn {
  role: 'user' | 'assistant';
  /** Plain text as the user typed it / as the assistant's `text` was shown. */
  content: string;
}

/** POST /api/groups/:groupId/ai */
export interface AiChatRequest {
  message: string;
  /** The task the chat is about (opened from a task's page) — plays the role of "replying to its card". */
  taskId?: string;
  /** Previous turns, oldest first; the server uses at most the last 8. */
  history?: AiChatTurn[];
}

export type AiChatResultKind =
  | 'updated' // one or more tasks changed
  | 'created' // new tasks were created
  | 'query' // a list of tasks answering a question
  | 'answer' // a plain answer / help
  | 'clarify' // the AI needs more info; nothing changed
  | 'refused' // not allowed (delete, bulk > 5, …); nothing changed
  | 'unavailable'; // AI not configured / failed / rate limited; nothing changed

export interface AiTaskChange {
  task: ITask;
  /** Human-readable change lines, e.g. "👤 @an → @ttt", "Status: 📝 To do → 👀 In review". Plain text. */
  changes: string[];
}

/** Response data of POST /api/groups/:groupId/ai */
export interface AiChatResponse {
  kind: AiChatResultKind;
  /** Plain text (no HTML/Markdown) to show as the assistant bubble. May contain line breaks and emoji. */
  text: string;
  /** For `updated`. */
  changed?: AiTaskChange[];
  /** For `created` and `query` (populated tasks, in display order). */
  tasks?: ITask[];
  /** For `query` when more tasks matched than returned. */
  totalMatches?: number;
  /** For `created`: undo via POST /api/batches/:batchId/undo until `undoUntil` (ISO). */
  batchId?: string;
  undoUntil?: string;
  /** Warnings to show under the reply (unknown assignee, AI fallback, …). Plain text. */
  warnings?: string[];
  /** Short follow-up prompts the UI can offer as chips. */
  suggestions?: string[];
}

/** Response data of POST /api/batches/:batchId/undo */
export interface AiUndoResponse {
  removed: number;
}
