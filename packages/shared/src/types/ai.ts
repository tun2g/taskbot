import type { ITask, TaskFilters } from './task.js';

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
  | 'preview' // the AI proposed subtasks; nothing is created until the user accepts (see `preview`)
  | 'clarify' // the AI needs more info; nothing changed
  | 'refused' // not allowed (delete, bulk > 5, …); nothing changed
  | 'unavailable'; // AI not configured / failed / rate limited; nothing changed

export interface AiTaskChange {
  task: ITask;
  /** Human-readable change lines, e.g. "👤 @an → @ttt", "Status: 📝 To do → 👀 In review". Plain text. */
  changes: string[];
}

/**
 * The board filters behind a `query` answer, so "View all N on board" opens exactly those N tasks.
 * Same meaning as the list endpoint's query params.
 */
export type AiBoardFilters = Pick<
  TaskFilters,
  'status' | 'category' | 'open' | 'type' | 'priority' | 'assigneeId' | 'epicId' | 'due' | 'search' | 'parentTaskId'
>;

/** For `preview`: subtasks the AI proposed for `parent`, waiting for the user's decision. */
export interface AiSubtaskPreview {
  /** POST /api/ai/previews/:previewId/accept (→ AiChatResponse, kind `created`) or …/cancel (→ { cancelled: true }). */
  previewId: string;
  parent: { _id: string; taskNumber: number; title: string };
  /** In order; `assignee` is a group member the user named for the split, or null. */
  items: { title: string; assignee: { _id: string; name: string } | null }[];
  /** ISO time after which the preview can no longer be accepted (ask again). */
  expiresAt: string;
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
  /** For `query`: the filters that produced `tasks` (open the board with them). Absent = no exact board view. */
  boardFilters?: AiBoardFilters;
  /** For `preview`. */
  preview?: AiSubtaskPreview;
  /** For `created`: undo via POST /api/batches/:batchId/undo until `undoUntil` (ISO). */
  batchId?: string;
  undoUntil?: string;
  /** Warnings to show under the reply (unknown assignee, AI fallback, …). Plain text. */
  warnings?: string[];
  /** Short follow-up prompts the UI can offer as chips. */
  suggestions?: string[];
}

/** Response data of POST /api/ai/previews/:previewId/cancel */
export interface AiPreviewCancelResponse {
  cancelled: true;
}

/** Response data of POST /api/batches/:batchId/undo */
export interface AiUndoResponse {
  removed: number;
}
