import { callbackDataStorageService } from 'src/shared/services/callback-data-storage.service';

// ── Callback data ──

function generateStorageKey(): string {
  return Math.random().toString(36).substring(2, 10);
}

export async function storeTaskCallbackData(taskId: string, action: string, extra?: Record<string, unknown>): Promise<string> {
  const key = generateStorageKey();
  await callbackDataStorageService.setCallbackData(key, 'task_cb', {
    taskId,
    action,
    ...extra,
  });
  return `task:${action}:${key}`;
}
