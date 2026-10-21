import type { AiSubtaskPreview } from '@tbot/shared';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

interface SubtaskPreviewProps {
  preview: AiSubtaskPreview;
  /** Turned down earlier in this conversation. */
  cancelled?: boolean;
  /** Each resolves to null, or an error message to show. */
  onAccept: () => Promise<string | null>;
  onCancel: () => Promise<string | null>;
}

const isExpired = (iso: string) => Date.now() >= new Date(iso).getTime();

/**
 * Subtasks the AI suggested for a task, not created yet: the list (with who would get each), then
 * [Add all N] or [Cancel]. A suggestion that sat too long can no longer be accepted — ask again.
 */
export function SubtaskPreview({ preview, cancelled, onAccept, onCancel }: SubtaskPreviewProps) {
  const [busy, setBusy] = useState<'accept' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(() => isExpired(preview.expiresAt));
  const n = preview.items.length;

  // Flip to "expired" on time even if nobody touches it.
  useEffect(() => {
    if (expired) return;
    const ms = new Date(preview.expiresAt).getTime() - Date.now();
    const id = window.setTimeout(() => setExpired(true), Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => window.clearTimeout(id);
  }, [expired, preview.expiresAt]);

  const run = async (kind: 'accept' | 'cancel') => {
    setBusy(kind);
    setError(null);
    const failure = await (kind === 'accept' ? onAccept() : onCancel());
    setBusy(null);
    if (failure) setError(failure);
  };

  const closed = cancelled || expired;

  return (
    <div className="overflow-hidden rounded-lg border border-tg-separator bg-tg-section">
      <p className="border-b border-tg-separator px-3 py-2 text-xs text-tg-hint">
        Suggested subtasks for <span className="font-mono">#{preview.parent.taskNumber}</span>{' '}
        <span className="text-tg-text">{preview.parent.title}</span>
      </p>
      <ol className={`divide-y divide-tg-separator ${closed ? 'opacity-60' : ''}`} aria-label="Suggested subtasks">
        {preview.items.map((item, i) => (
          <li key={i} className="flex min-h-11 items-center gap-2 px-3 py-1.5 text-sm">
            <span aria-hidden className="w-4 shrink-0 text-right font-mono text-xs text-tg-hint">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere] text-tg-text">{item.title}</span>
            <span className={`shrink-0 text-xs ${item.assignee ? 'text-tg-text' : 'text-tg-hint'}`}>
              {item.assignee ? item.assignee.name : 'Unassigned'}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2 border-t border-tg-separator px-3 py-2">
        {cancelled ? (
          <p className="text-xs text-tg-hint">Cancelled — nothing was added.</p>
        ) : expired ? (
          <p className="text-xs text-tg-hint">This suggestion expired. Ask again to get a fresh one.</p>
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void run('accept')}
              loading={busy === 'accept'}
              loadingText="Adding…"
              disabled={busy !== null}
            >
              Add {n === 1 ? 'it' : `all ${n}`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void run('cancel')}
              loading={busy === 'cancel'}
              loadingText="Cancelling…"
              disabled={busy !== null}
            >
              Cancel
            </Button>
            <span className="text-xs text-tg-hint">Nothing is created until you add them.</span>
          </>
        )}
        {error && (
          <p role="alert" className="w-full text-xs text-tg-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
