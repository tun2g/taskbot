import type { EpicWithProgress, TaskStatusCategory } from '@tbot/shared';
import { EpicStatus } from '@tbot/shared';
import { type ReactNode, useState } from 'react';

import { type EpicFormValues, EpicFormDialog } from '@/components/epics/epic-form-dialog';
import { Layout } from '@/components/layout/layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StateMessage } from '@/components/ui/state';

import { DeleteEpicDialog } from './components/delete-epic-dialog';
import { EpicRow } from './components/epic-row';
import { MarkDoneDialog } from './components/mark-done-dialog';
import type { EpicSheet } from './epics.container';

interface EpicsContentProps {
  groupName?: string;
  accessError: string | null;
  epics: EpicWithProgress[];
  isLoading: boolean;
  error: string | null;
  isRetrying: boolean;
  onRetry: () => void;
  onBack: () => void;
  onOpenEpic: (epic: EpicWithProgress, category?: TaskStatusCategory | 'open') => void;
  onOpenNoEpic: () => void;
  sheet: EpicSheet;
  onOpenSheet: (sheet: EpicSheet) => void;
  onSave: (values: EpicFormValues) => Promise<string | null>;
  isSaving: boolean;
  onToggleDone: (epic: EpicWithProgress) => void;
  /** Marking done an epic that still has open tasks asks first. */
  toConfirmDone: EpicWithProgress | null;
  onCancelDone: () => void;
  onConfirmDone: () => void;
  onShowOpenOf: (epic: EpicWithProgress) => void;
  toDelete: EpicWithProgress | null;
  onAskDelete: (epic: EpicWithProgress) => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  isDeleting: boolean;
  deleteError: string | null;
}

/** The one-line explanation of the term (the bot says "epic" too, so the word stays). */
const EPIC_GLOSS = 'An epic groups related tasks under one bigger goal.';

export function EpicsContent(props: EpicsContentProps) {
  const { groupName, accessError, epics, isLoading, error, isRetrying, onRetry, onBack, sheet, onOpenSheet } = props;
  const [showDone, setShowDone] = useState(false);

  const open = epics.filter((e) => e.status !== EpicStatus.DONE);
  const done = epics.filter((e) => e.status === EpicStatus.DONE);

  const rowProps = {
    onOpen: props.onOpenEpic,
    onEdit: (epic: EpicWithProgress) => onOpenSheet(epic),
    onToggleDone: props.onToggleDone,
    onDelete: props.onAskDelete,
  };

  let body: ReactNode;
  if (accessError) {
    body = (
      <StateMessage
        icon="🔒"
        title="Can't open this group"
        body={accessError}
        action={
          <Button variant="primary" onClick={onBack}>
            Back
          </Button>
        }
      />
    );
  } else if (isLoading) {
    body = (
      <div className="p-4">
        <div className="flex flex-col divide-y divide-tg-separator rounded-lg border border-tg-separator bg-tg-section">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3 px-4 py-3.5" aria-hidden>
              <Skeleton className="mt-0.5 h-3 w-3 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-1.5 w-full rounded-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  } else if (error) {
    body = (
      <StateMessage
        icon="⚠️"
        title="Couldn't load epics"
        body={error}
        action={
          <Button variant="primary" onClick={onRetry} disabled={isRetrying}>
            {isRetrying ? 'Retrying…' : 'Retry'}
          </Button>
        }
      />
    );
  } else if (epics.length === 0) {
    body = (
      <StateMessage
        icon="⚡"
        title="No epics yet"
        body={`${EPIC_GLOSS} For example “Website relaunch” — you’ll see how close it is to done.`}
        action={
          <Button variant="primary" icon="+" onClick={() => onOpenSheet('new')}>
            Create epic
          </Button>
        }
      />
    );
  } else {
    // Done epics stay folded while there are open ones.
    const doneVisible = showDone || open.length === 0;
    body = (
      <div className="flex flex-col gap-5 p-4">
        <p className="-mb-2 px-1 text-sm text-tg-hint">{EPIC_GLOSS}</p>
        <Section title="Open" count={open.length}>
          {open.length > 0 ? (
            <ul className="divide-y divide-tg-separator">
              {open.map((epic) => (
                <EpicRow key={epic._id} epic={epic} {...rowProps} />
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-tg-hint">Every epic is done. Tap ＋ to start a new one.</p>
          )}
        </Section>

        {done.length > 0 &&
          (doneVisible ? (
            <Section
              title="Done"
              count={done.length}
              action={
                open.length > 0 && (
                  <Button variant="link" size="sm" onClick={() => setShowDone(false)}>
                    Hide
                  </Button>
                )
              }
            >
              <ul className="divide-y divide-tg-separator">
                {done.map((epic) => (
                  <EpicRow key={epic._id} epic={epic} {...rowProps} />
                ))}
              </ul>
            </Section>
          ) : (
            <button
              type="button"
              onClick={() => setShowDone(true)}
              className="flex min-h-11 items-center gap-1 self-start rounded-lg px-2 text-sm font-medium text-tg-link hover:bg-tg-secondary"
            >
              Show {done.length} done epic{done.length === 1 ? '' : 's'} <span aria-hidden>›</span>
            </button>
          ))}

        <button
          type="button"
          onClick={props.onOpenNoEpic}
          className="flex min-h-11 items-center justify-between rounded-lg border border-dashed border-tg-separator px-4 text-left text-sm text-tg-hint transition-colors hover:bg-tg-secondary/50 active:bg-tg-secondary"
        >
          <span className="flex items-center gap-3">
            <span aria-hidden className="w-3 text-center">
              ∅
            </span>
            Tasks without an epic
          </span>
          <span aria-hidden className="text-lg">
            ›
          </span>
        </button>
      </div>
    );
  }

  return (
    <Layout
      title="Epics"
      subtitle={groupName ?? <Skeleton className="h-3 w-24" />}
      onBack={onBack}
      fab={
        !accessError && (
          <Button variant="primary" size="fab" onClick={() => onOpenSheet('new')} aria-label="New epic" title="New epic">
            +
          </Button>
        )
      }
    >
      {body}

      {sheet && (
        <EpicFormDialog
          key={sheet === 'new' ? 'new' : sheet._id}
          epic={sheet === 'new' ? undefined : sheet}
          existing={epics}
          onClose={() => onOpenSheet(null)}
          onSubmit={props.onSave}
          isSaving={props.isSaving}
        />
      )}

      {props.toConfirmDone && (
        <MarkDoneDialog
          epic={props.toConfirmDone}
          onConfirm={props.onConfirmDone}
          onCancel={props.onCancelDone}
          onShowOpen={() => props.toConfirmDone && props.onShowOpenOf(props.toConfirmDone)}
        />
      )}

      {props.toDelete && (
        <DeleteEpicDialog
          epic={props.toDelete}
          isDeleting={props.isDeleting}
          error={props.deleteError}
          onConfirm={props.onConfirmDelete}
          onCancel={props.onCancelDelete}
        />
      )}
    </Layout>
  );
}

function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={`${title} epics`}>
      <div className="mb-1.5 flex min-h-8 items-center justify-between px-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-tg-hint">
          {title} · {count}
        </h2>
        {action}
      </div>
      <div className="overflow-hidden rounded-lg border border-tg-separator bg-tg-section">{children}</div>
    </section>
  );
}
