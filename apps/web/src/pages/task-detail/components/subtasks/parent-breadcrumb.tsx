import type { ITask } from '@tbot/shared';

import { getParent, getParentId } from '@/lib/subtasks';

/** "↳ Subtask of #42 Fix login" above a subtask's summary; opens the parent. */
export function ParentBreadcrumb({ task, onOpen }: { task: ITask; onOpen: (parentId: string) => void }) {
  const parentId = getParentId(task);
  if (!parentId) return null;
  const parent = getParent(task);
  return (
    <button
      type="button"
      onClick={() => onOpen(parentId)}
      className="focus-ring -ml-1 mb-1 flex min-h-8 max-w-full items-center gap-1.5 rounded-md px-1 text-left text-sm text-tg-hint transition-colors hover:bg-tg-secondary hover:text-tg-text active:bg-tg-secondary"
    >
      <span aria-hidden>↳</span>
      <span className="shrink-0">Subtask of</span>
      <span className="shrink-0 font-mono text-xs text-tg-link">#{parent?.taskNumber ?? '…'}</span>
      {parent && <span className="min-w-0 truncate text-tg-link">{parent.title}</span>}
    </button>
  );
}
