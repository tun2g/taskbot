import type { ITask, ITaskActivity, IUser, UpdateTaskInput } from '@tbot/shared';
import {
  isClosedStatus,
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_ORDER,
  TASK_STATUS_CATEGORY,
  TASK_STATUS_CATEGORY_LABELS,
  TASK_STATUS_HINTS,
  TASK_STATUS_LABELS,
  TASK_STATUS_ORDER,
  TASK_TYPE_HINTS,
  TASK_TYPE_LABELS,
  TASK_TYPE_ORDER,
  TaskPriority,
  TaskStatus,
  TaskStatusCategory,
  TaskType,
} from '@tbot/shared';
import { type ReactNode, useState } from 'react';

import { AiChatPanel } from '@/components/ai-chat/ai-chat-panel';
import { AskAiButton, useAskAi } from '@/components/ai-chat/ask-ai';
import { Layout } from '@/components/layout/layout';
import { Avatar, PriorityIcon, StatusLozenge, TypeIcon } from '@/components/ui/badges';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonPrimary, buttonSecondary, StateMessage } from '@/components/ui/state';
import { dueLabel, dueState, formatDate, formatRelative, toDueDay } from '@/lib/dates';
import { displayName, getUserId } from '@/lib/user';

import { ActivityTimeline } from './components/activity-timeline';
import { AssigneePicker } from './components/assignee-picker';
import { DeleteDialog } from './components/delete-dialog';
import { EditableText } from './components/editable-text';
import { OptionPicker } from './components/option-picker';
import { getSourceMessages, SourceMessages } from './components/source-messages';
import type { SaveResult } from './task-detail.container';

const STATUS_GROUPS = [TaskStatusCategory.TODO, TaskStatusCategory.IN_PROGRESS, TaskStatusCategory.DONE].map((cat) => ({
  label: TASK_STATUS_CATEGORY_LABELS[cat],
  options: TASK_STATUS_ORDER.filter((s) => TASK_STATUS_CATEGORY[s] === cat).map((s) => ({
    value: s,
    label: TASK_STATUS_LABELS[s],
    hint: TASK_STATUS_HINTS[s],
  })),
}));

const TYPE_GROUPS = [
  { options: TASK_TYPE_ORDER.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t], hint: TASK_TYPE_HINTS[t] })) },
];

const dueTextClass = {
  overdue: 'text-tg-destructive font-semibold',
  today: 'text-tg-link font-semibold',
  upcoming: 'text-tg-hint',
  none: 'text-tg-hint',
};

const PRIORITY_OPTIONS = [
  { options: TASK_PRIORITY_ORDER.map((p) => ({ value: p, label: TASK_PRIORITY_LABELS[p] })) },
];

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 py-0.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-xs font-semibold text-tg-hint">
          {label}
        </label>
      ) : (
        <span className="text-xs font-semibold text-tg-hint">{label}</span>
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

interface TaskDetailContentProps {
  groupId: string;
  task: ITask | null;
  isLoading: boolean;
  notFound: { status?: number; message: string } | null;
  loadError: string | null;
  onRetry: () => void;
  timeZone?: string | null;
  groupName?: string;
  members: IUser[];
  activity: ITaskActivity[];
  activityLoading: boolean;
  activityError: string | null;
  onRetryActivity: () => void;
  onBack: () => void;
  onUpdate: (input: UpdateTaskInput, optimistic?: Partial<ITask>) => Promise<SaveResult>;
  isUpdating?: boolean;
  onDelete: () => void;
  isDeleting: boolean;
  deleteError: string | null;
  onClearDeleteError: () => void;
}

export function TaskDetailContent(props: TaskDetailContentProps) {
  const { task, isLoading, notFound, loadError, onRetry, timeZone, groupName, members, onBack, onUpdate } = props;
  const [showDelete, setShowDelete] = useState(false);
  const ai = useAskAi();

  if (isLoading) {
    return (
      <Layout title={<Skeleton className="h-5 w-16" />} onBack={onBack}>
        <div className="flex flex-col gap-4 p-4">
          <Skeleton className="h-7 w-4/5" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </Layout>
    );
  }

  if (notFound || loadError || !task) {
    const forbidden = notFound?.status === 403;
    return (
      <Layout title="Task" onBack={onBack}>
        <StateMessage
          icon={forbidden ? '🔒' : notFound ? '🔍' : '⚠️'}
          title={forbidden ? 'No access to this task' : notFound ? 'Task not found' : "Couldn't load this task"}
          body={notFound?.message ?? loadError ?? 'It may have been deleted.'}
          action={
            <>
              {loadError && (
                <button type="button" onClick={onRetry} className={buttonSecondary}>
                  Retry
                </button>
              )}
              <button type="button" onClick={onBack} className={buttonPrimary}>
                Back to board
              </button>
            </>
          }
        />
      </Layout>
    );
  }

  const due = dueState(task.dueDate, timeZone, task.status);
  const dueDay = toDueDay(task.dueDate) ?? '';
  const sources = getSourceMessages(task);

  const saveStatus = (status: TaskStatus) => onUpdate({ status }, { status });
  const saveAssignee = (assigneeId: string | null) => {
    const member = assigneeId ? members.find((m) => m._id === assigneeId) : null;
    return onUpdate({ assigneeId }, { assigneeId: member ?? assigneeId });
  };

  const breadcrumb = (
    <span className="flex min-w-0 items-center gap-1.5 text-base">
      <button type="button" onClick={onBack} className="min-h-11 truncate font-normal text-tg-link hover:underline">
        {groupName ?? 'Board'}
      </button>
      <span className="text-tg-hint">/</span>
      <span className="flex items-center gap-1 whitespace-nowrap">
        <TypeIcon type={task.type} /> <span className="font-mono">#{task.taskNumber}</span>
      </span>
    </span>
  );

  const details = (
    <section aria-labelledby="details-heading" className="rounded-lg border border-tg-separator bg-tg-section">
      <h2 id="details-heading" className="border-b border-tg-separator px-4 py-2.5 text-sm font-semibold text-tg-text">
        Details
      </h2>
      <div className="flex flex-col gap-1 px-4 py-3">
        <Field label="Status">
          <OptionPicker<TaskStatus>
            ariaLabel="Status"
            value={task.status}
            groups={STATUS_GROUPS}
            onChange={saveStatus}
            renderOption={(o) => <StatusLozenge status={o.value} />}
          />
        </Field>
        <Field label="Assignee" htmlFor="detail-assignee">
          <AssigneePicker id="detail-assignee" members={members} assignee={task.assigneeId} onSelect={saveAssignee} />
        </Field>
        <Field label="Type">
          <OptionPicker<TaskType>
            ariaLabel="Type"
            value={task.type ?? TaskType.TASK}
            groups={TYPE_GROUPS}
            onChange={(type) => onUpdate({ type }, { type })}
            renderOption={(o) => (
              <span className="text-sm text-tg-text">
                <TypeIcon type={o.value} withLabel />
              </span>
            )}
          />
        </Field>
        <Field label="Priority">
          <OptionPicker<TaskPriority>
            ariaLabel="Priority"
            value={task.priority}
            groups={PRIORITY_OPTIONS}
            onChange={(priority) => onUpdate({ priority }, { priority })}
            renderOption={(o) => (
              <span className="text-sm text-tg-text">
                <PriorityIcon priority={o.value} withLabel />
              </span>
            )}
          />
        </Field>
        <Field label="Due date" htmlFor="detail-due">
          <div className="flex items-center gap-1">
            <input
              id="detail-due"
              type="date"
              value={dueDay}
              onChange={(e) => {
                const dueDate = e.target.value || null;
                onUpdate({ dueDate }, { dueDate });
              }}
              className="-ml-2 min-h-11 min-w-0 flex-1 rounded-md bg-transparent px-2 text-sm text-tg-text outline-none hover:bg-tg-secondary focus:ring-2 focus:ring-tg-link"
            />
            {dueDay && (
              <button
                type="button"
                onClick={() => onUpdate({ dueDate: null }, { dueDate: null })}
                className="min-h-11 rounded-md px-2 text-sm text-tg-link hover:bg-tg-secondary"
              >
                Clear
              </button>
            )}
          </div>
          {due !== 'none' && (due === 'overdue' || due === 'today') && (
            <p className={`text-xs ${dueTextClass[due]}`}>{dueLabel(task.dueDate, timeZone, task.status)}</p>
          )}
        </Field>
        <Field label="Reporter">
          <span className="flex min-h-11 items-center gap-2 text-sm text-tg-text">
            <Avatar user={task.createdBy} members={members} />
            <span className="truncate">{displayName(task.createdBy, { members, fallback: 'A group member' })}</span>
          </span>
        </Field>
      </div>
      <dl className="flex flex-col gap-1 border-t border-tg-separator px-4 py-3 text-xs text-tg-hint">
        <div className="flex gap-1">
          <dt>Created</dt>
          <dd title={formatDate(task.createdAt)}>{formatRelative(task.createdAt)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>Updated</dt>
          <dd title={formatDate(task.updatedAt)}>{formatRelative(task.updatedAt)}</dd>
        </div>
        {isClosedStatus(task.status) && task.completedAt && (
          <div className="flex flex-wrap gap-1">
            <dt>Resolved</dt>
            <dd title={formatDate(task.completedAt)}>
              {formatRelative(task.completedAt)}
              {getUserId(task.completedBy) && ` by ${displayName(task.completedBy, { members, fallback: 'a group member' })}`}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );

  return (
    <Layout
      title={breadcrumb}
      onBack={ai.backHandler(onBack)}
      width="medium"
      actions={<AskAiButton onClick={ai.open ? ai.close : ai.openChat} active={ai.open} />}
    >
      <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_320px] md:items-start md:gap-8">
        <div className="md:col-start-1 md:row-start-1">
          <EditableText
            label="Summary"
            value={task.title}
            placeholder="Add a summary"
            required
            maxLength={200}
            onSave={(title) => onUpdate({ title }, { title })}
            displayClassName="text-xl font-semibold leading-snug text-tg-text"
          />
        </div>

        <aside className="md:sticky md:top-20 md:col-start-2 md:row-span-2 md:row-start-1">{details}</aside>

        <div className="flex flex-col gap-6 md:col-start-1 md:row-start-2">
          <EditableText
            label="Description"
            value={task.description ?? ''}
            placeholder="Add a description…"
            multiline
            maxLength={2000}
            onSave={(description) => onUpdate({ description: description || null }, { description: description || null })}
            displayClassName="text-sm text-tg-text"
          />

          <SourceMessages messages={sources} />

          <ActivityTimeline
            items={props.activity}
            members={members}
            isLoading={props.activityLoading}
            error={props.activityError}
            onRetry={props.onRetryActivity}
          />

          <div className="border-t border-tg-separator pt-3">
            <button
              type="button"
              onClick={() => {
                props.onClearDeleteError();
                setShowDelete(true);
              }}
              className="min-h-11 rounded-md px-3 text-sm font-medium text-tg-destructive hover:bg-tg-secondary"
            >
              🗑 Delete task
            </button>
          </div>
        </div>
      </div>

      {showDelete && (
        <DeleteDialog
          taskNumber={task.taskNumber}
          isDeleting={props.isDeleting}
          error={props.deleteError}
          onConfirm={props.onDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}

      <AiChatPanel
        groupId={props.groupId}
        open={ai.open}
        isDesktop={ai.isDesktop}
        onClose={ai.close}
        contextTask={task}
      />
    </Layout>
  );
}
