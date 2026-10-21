import type { AiChatResponse, AiChatResultKind, ITask } from '@tbot/shared';
import { isClosedStatus } from '@tbot/shared';
import { useEffect, useState } from 'react';

import { Avatar, StatusLozenge, TypeIcon } from '@/components/ui/badges';
import { FormattedText } from '@/components/ui/formatted-text';
import { DueChip } from '@/pages/tasks/components/due-chip';

import type { AssistantMessage, UserMessage } from './ai-chat-store';
import { boardSearchFromAi } from './board-link';
import { SubtaskPreview } from './subtask-preview';

const chipClass =
  'inline-flex min-h-11 items-center rounded-full border border-tg-separator bg-tg-section px-3.5 text-left text-sm text-tg-link transition-colors enabled:hover:bg-tg-secondary enabled:active:bg-tg-secondary disabled:opacity-50';

export function AiAvatar() {
  return (
    <span className="tint-link flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm" aria-hidden>
      ✨
    </span>
  );
}

/** Quiet notes for outcomes where nothing changed — never styled as an alarm. */
const KIND_NOTES: Partial<Record<AiChatResultKind, string>> = {
  clarify: 'Needs a bit more detail',
  refused: 'Nothing was changed',
  unavailable: 'AI is unavailable right now',
};

export function SuggestionChips({
  items,
  onPick,
  disabled,
}: {
  items: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((s) => (
        <button key={s} type="button" disabled={disabled} onClick={() => onPick(s)} className={chipClass}>
          {s}
        </button>
      ))}
    </div>
  );
}

export function UserBubble({
  message,
  onRetry,
  retryDisabled,
}: {
  message: UserMessage;
  onRetry: () => void;
  retryDisabled?: boolean;
}) {
  return (
    <li className="flex flex-col items-end gap-1.5">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-tg-button px-3.5 py-2 text-sm text-tg-button-text">
        {message.text}
      </div>
      {message.error && (
        <div className="tint-danger flex max-w-[85%] items-center gap-2 rounded-xl py-1 pl-3 pr-1 text-sm" role="alert">
          <span className="flex-1">
            <span aria-hidden>⚠️ </span>
            {message.error}
          </span>
          <button
            type="button"
            onClick={onRetry}
            disabled={retryDisabled}
            className="focus-ring min-h-11 shrink-0 rounded-lg px-3 font-semibold transition-opacity enabled:hover:opacity-80 enabled:active:opacity-70 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}
    </li>
  );
}

export function ThinkingBubble() {
  return (
    <li className="flex items-end gap-2" aria-live="polite">
      <AiAvatar />
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-tg-secondary px-3.5 py-2.5 text-sm text-tg-hint">
        <span className="flex gap-1" aria-hidden>
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-tg-hint [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-tg-hint [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-tg-hint" />
        </span>
        Thinking…
      </div>
    </li>
  );
}

interface AssistantBubbleProps {
  message: AssistantMessage;
  timeZone?: string | null;
  onOpenTask: (task: ITask) => void;
  /** Rendered when more tasks matched than were returned: the board with the answer's filters, or just the board. */
  onViewAll: (response: AiChatResponse) => void;
  onUndo: (message: AssistantMessage) => Promise<string | null>;
  /** `kind: 'preview'`: create the suggested subtasks / drop them. Resolve to null, or an error message. */
  onAcceptPreview: (message: AssistantMessage) => Promise<string | null>;
  onCancelPreview: (message: AssistantMessage) => Promise<string | null>;
}

export function AssistantBubble({
  message,
  timeZone,
  onOpenTask,
  onViewAll,
  onUndo,
  onAcceptPreview,
  onCancelPreview,
}: AssistantBubbleProps) {
  const r: AiChatResponse = message.response;
  const note = KIND_NOTES[r.kind];
  const tasks = r.tasks ?? [];
  const changed = r.changed ?? [];
  const warnings = r.warnings ?? [];

  return (
    <li className="flex items-start gap-2">
      <AiAvatar />
      <div className="flex min-w-0 max-w-[92%] flex-1 flex-col gap-2">
        {(r.text || note) && (
          <div
            className={`w-fit max-w-full rounded-2xl rounded-tl-md bg-tg-secondary px-3.5 py-2 text-sm text-tg-text ${
              note ? 'border-l-[3px] border-tg-hint' : ''
            }`}
          >
            {note && <p className="mb-0.5 text-xs font-medium text-tg-hint">{note}</p>}
            {r.text && <FormattedText text={r.text} />}
          </div>
        )}

        {changed.length > 0 && (
          <ul className="flex flex-col gap-1.5" aria-label="Changed tasks">
            {changed.map(({ task, changes }) => (
              <li key={task._id} className="rounded-lg border border-tg-separator bg-tg-section">
                <button
                  type="button"
                  onClick={() => onOpenTask(task)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-t-lg px-3 text-left text-sm hover:bg-tg-secondary"
                >
                  <TypeIcon type={task.type} />
                  <span className="font-mono text-xs font-medium text-tg-hint">#{task.taskNumber}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-tg-text">{task.title}</span>
                </button>
                {changes.length > 0 && (
                  <ul className="border-t border-tg-separator px-3 py-1.5 text-xs text-tg-hint">
                    {changes.map((line, i) => (
                      <li key={i} className="whitespace-pre-wrap break-words py-0.5">
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}

        {r.kind === 'preview' && r.preview && (
          <SubtaskPreview
            preview={r.preview}
            cancelled={message.previewCancelled}
            onAccept={() => onAcceptPreview(message)}
            onCancel={() => onCancelPreview(message)}
          />
        )}

        {r.kind === 'created' && tasks.length > 0 ? (
          <CreatedBlock message={message} onOpenTask={onOpenTask} onUndo={onUndo} />
        ) : (
          tasks.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-tg-separator bg-tg-section">
              <ul className="divide-y divide-tg-separator" aria-label="Tasks">
                {tasks.map((task) => (
                  <li key={task._id}>
                    <TaskRow task={task} timeZone={timeZone} onClick={() => onOpenTask(task)} />
                  </li>
                ))}
              </ul>
              {(r.totalMatches ?? 0) > tasks.length && (
                <button
                  type="button"
                  onClick={() => onViewAll(r)}
                  className="flex min-h-11 w-full items-center justify-center gap-1 border-t border-tg-separator text-sm font-medium text-tg-link hover:bg-tg-secondary"
                >
                  {/* Only promise "all N" when the board can show exactly those N. */}
                  {boardSearchFromAi(r.boardFilters) ? `View all ${r.totalMatches} on board →` : 'Open board →'}
                </button>
              )}
            </div>
          )
        )}

        {warnings.length > 0 && (
          <div className="tint-neutral rounded-lg px-3 py-2 text-xs">
            {warnings.map((w, i) => (
              <p key={i} className="whitespace-pre-wrap break-words">
                <span aria-hidden>⚠️ </span>
                {w}
              </p>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function TaskRow({ task, timeZone, onClick }: { task: ITask; timeZone?: string | null; onClick: () => void }) {
  const closed = isClosedStatus(task.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full flex-col gap-1 px-3 py-2 text-left hover:bg-tg-secondary"
    >
      <span className="flex w-full items-center gap-2 text-sm">
        <TypeIcon type={task.type} />
        <span className={`font-mono text-xs font-medium text-tg-hint ${closed ? 'line-through' : ''}`}>
          #{task.taskNumber}
        </span>
        <span className={`min-w-0 flex-1 truncate ${closed ? 'text-tg-hint' : 'text-tg-text'}`}>{task.title}</span>
      </span>
      <span className="flex w-full items-center gap-2">
        <StatusLozenge status={task.status} />
        <DueChip dueDate={task.dueDate} timeZone={timeZone} status={task.status} />
        <span className="ml-auto">
          <Avatar user={task.assigneeId} />
        </span>
      </span>
    </button>
  );
}

function useCountdown(until?: string): number {
  const end = until ? new Date(until).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());
  const remaining = Number.isNaN(end) ? 0 : Math.max(0, end - now);
  useEffect(() => {
    if (remaining <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [remaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  return remaining;
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function CreatedBlock({
  message,
  onOpenTask,
  onUndo,
}: {
  message: AssistantMessage;
  onOpenTask: (task: ITask) => void;
  onUndo: (message: AssistantMessage) => Promise<string | null>;
}) {
  const { batchId, undoUntil, tasks = [] } = message.response;
  const remaining = useCountdown(undoUntil);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undone = message.undone !== undefined;

  const handleUndo = async () => {
    setBusy(true);
    setError(null);
    const err = await onUndo(message);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {tasks.map((task) =>
          undone ? (
            <span
              key={task._id}
              className="tint-neutral inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3 text-sm line-through"
            >
              <TypeIcon type={task.type} />
              <span className="font-mono text-xs">#{task.taskNumber}</span>
              <span className="truncate">{task.title}</span>
            </span>
          ) : (
            <button
              key={task._id}
              type="button"
              onClick={() => onOpenTask(task)}
              className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-tg-separator bg-tg-section px-3 text-sm text-tg-text hover:bg-tg-secondary"
            >
              <TypeIcon type={task.type} />
              <span className="font-mono text-xs text-tg-hint">#{task.taskNumber}</span>
              <span className="truncate">{task.title}</span>
            </button>
          ),
        )}
      </div>

      {undone ? (
        <p className="text-xs text-tg-hint">
          Undone · {message.undone} task{message.undone === 1 ? '' : 's'} removed
        </p>
      ) : (
        batchId &&
        remaining > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleUndo}
              disabled={busy}
              aria-busy={busy || undefined}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-tg-separator px-3 text-sm font-medium text-tg-text enabled:hover:bg-tg-secondary enabled:active:bg-tg-secondary disabled:opacity-50"
            >
              <span aria-hidden>↩️</span>
              {busy ? 'Undoing…' : 'Undo'}
              {!busy && (
                <span className="font-mono text-xs text-tg-hint" aria-label={`${formatRemaining(remaining)} left`}>
                  {formatRemaining(remaining)}
                </span>
              )}
            </button>
            {error && <span className="text-xs text-tg-destructive">{error}</span>}
          </div>
        )
      )}
    </div>
  );
}
