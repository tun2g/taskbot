// Undo of a created batch (AI /task runs, AI subtasks, app/MCP batches). Kept dependency-free so the AI
// command modules can use it without importing the creation pipeline (which loads the bot).

export const BATCH_CALLBACK_PREFIX = 'batch_cb';
export const BATCH_UNDO_WINDOW_MS = 10 * 60 * 1000;

/** What the Telegram ↩️ Undo button (`batch:undo:<key>`) stores. */
export interface BatchCallbackData {
  batchId: string;
  groupId: string;
  chatId: number;
  requesterTelegramId: number;
  requesterName: string;
  count: number;
  createdAt: number;
}
