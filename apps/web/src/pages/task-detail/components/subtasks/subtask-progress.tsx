import type { SubtaskProgress as Progress } from '@tbot/shared';

import { isProgressComplete, progressText } from '@/lib/subtasks';

/** "2/4 done · 1 cancelled" with a thin bar; green once every subtask that counts is done. */
export function SubtaskProgress({ progress }: { progress: Progress }) {
  const { done, total } = progress;
  if (total === 0 && progress.cancelled === 0) return null;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const complete = isProgressComplete(progress);
  const text = progressText(progress);
  return (
    <div className="flex items-center gap-2">
      {total > 0 && (
        <div
          role="progressbar"
          aria-label="Subtasks done"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-valuetext={text}
          className="h-1.5 w-20 overflow-hidden rounded-full bg-tg-secondary"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${complete ? 'bg-[var(--tbot-success)]' : 'bg-tg-link'}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <span
        className={`text-xs tabular-nums ${complete ? 'font-semibold text-[var(--tbot-success)]' : 'text-tg-hint'}`}
      >
        {text}
      </span>
    </div>
  );
}
