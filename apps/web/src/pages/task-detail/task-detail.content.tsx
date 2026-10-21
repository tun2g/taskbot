import type { EpicWithProgress, IEpic, ITask, ITaskActivity, IUser, UpdateTaskInput } from '@tbot/shared';
import { EpicStatus, isClosedStatus, TaskPriority, TaskStatus, TaskType } from '@tbot/shared';
import { type ReactNode, useState } from 'react';

import { AiChatPanel } from '@/components/ai-chat/ai-chat-panel';
import { AskAiButton, useAskAi } from '@/components/ai-chat/ask-ai';
import type { EpicFormValues } from '@/components/epics/epic-form-dialog';
import { EpicPicker } from '@/components/epics/epic-picker';
import { Layout } from '@/components/layout/layout';
import { Avatar, TypeIcon } from '@/components/ui/badges';
import { SelectMenu } from '@/components/ui/select-menu';
import { PRIORITY_OPTIONS, STATUS_SECTIONS, TYPE_OPTIONS } from '@/components/ui/task-options';
import { FormattedText } from '@/components/ui/formatted-text';
import { Skeleton } from '@/components/ui/skeleton';
import { StateMessage } from '@/components/ui/state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { dueLabel, dueState, formatDate, formatRelative, toDueDay } from '@/lib/dates';
import { getEpicId } from '@/lib/epics';
import { getParent, getProgress, isSubtask, subtaskCount as countSubtasks } from '@/lib/subtasks';
import { displayName, getUserId } from '@/lib/user';

import { ActivityTimeline } from './components/activity-timeline';
import { AssigneePicker } from './components/assignee-picker';
import { DeleteDialog } from './components/delete-dialog';
import { EditableText } from './components/editable-text';
import { getSourceMessages, SourceMessages } from './components/source-messages';
import { ParentBreadcrumb } from './components/subtasks/parent-breadcrumb';
import { ParentField } from './components/subtasks/parent-field';
import { SubtasksSection } from './components/subtasks/subtasks-section';
import type { SaveResult } from './task-detail.container';

/** Short hint under the Epic field: "3/8 done", or "Done" once the epic is closed. */
function epicFieldHint(epic: EpicWithProgress | undefined): string | null {
  if (!epic) return null;
  if (epic.status === EpicStatus.DONE) return 'Done';
  return `${epic.progress.done}/${epic.progress.total} done`;
}

const dueTextClass = {
  overdue: 'text-tg-destructive font-semibold',
  today: 'text-tg-link font-semibold',
  upcoming: 'text-tg-hint',
  none: 'text-tg-hint',
};

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
  epics: EpicWithProgress[];
  onCreateEpic: (values: EpicFormValues) => Promise<IEpic | string>;
  isCreatingEpic?: boolean;
  /** Board filtered to this epic. */
  onOpenEpicBoard: (epicId: string) => void;
  activity: ITaskActivity[];
  activityLoading: boolean;
  activityError: string | null;
  onRetryActivity: () => void;
  /** Back: to the task this one was opened from, else the board. */
  onBack: () => void;
  /** The group name in the breadcrumb, and the error states' "Back to board". */
  onBackToBoard: () => void;
  /** Opens another task (a subtask row, the parent link). */
  onOpenTask: (taskId: string) => void;
  /** Make it a subtask of `parent`, or a regular task with null. */
  onChangeParent: (parent: ITask | null) => void;
  /**
   * Opened straight from a chat deep link: no native BackButton (Telegram shows "Close"); the
   * breadcrumb still leads to the board.
   */
  quickLook?: boolean;
  onUpdate: (input: UpdateTaskInput, optimistic?: Partial<ITask>) => Promise<SaveResult>;
  isUpdating?: boolean;
  onDelete: () => void;
  isDeleting: boolean;
  deleteError: string | null;
  onClearDeleteError: () => void;
}

export function TaskDetailContent(props: TaskDetailContentProps) {
  const { task, isLoading, notFound, loadError, onRetry, timeZone, groupName, members, onBack, onUpdate, quickLook } =
    props;
  const [showDelete, setShowDelete] = useState(false);
  const ai = useAskAi();

  if (isLoading) {
    return (
      <Layout title={<Skeleton className="h-5 w-16" />} onBack={onBack} nativeBack={!quickLook}>
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
      <Layout title="Task" onBack={onBack} nativeBack={!quickLook}>
        <StateMessage
          icon={forbidden ? '🔒' : notFound ? '🔍' : '⚠️'}
          title={forbidden ? 'No access to this task' : notFound ? 'Task not found' : "Couldn't load this task"}
          body={notFound?.message ?? loadError ?? 'It may have been deleted.'}
          action={
            <>
              {loadError && (
                <Button variant="secondary" onClick={onRetry}>
                  Retry
                </Button>
              )}
              <Button variant="primary" onClick={props.onBackToBoard}>
                Back to board
              </Button>
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

  const epicId = getEpicId(task.epicId);
  const epicProgress = epicFieldHint(props.epics.find((e) => e._id === epicId));
  const subtask = isSubtask(task);
  const parent = getParent(task);
  const subtaskCount = countSubtasks(getProgress(task));

  const breadcrumb = (
    <span className="flex min-w-0 items-center gap-1.5 text-base">
      <button type="button" onClick={props.onBackToBoard} className="min-h-11 truncate font-normal text-tg-link hover:underline">
        {groupName ?? 'Board'}
      </button>
      <span className="text-tg-hint">/</span>
      <span className="flex items-center gap-1 whitespace-nowrap">
        <TypeIcon type={task.type} /> <span className="font-mono">#{task.taskNumber}</span>
      </span>
    </span>
  );

  const details = (
    <Card title="Details" titleId="details-heading">
      <div className="flex flex-col gap-1 px-4 py-3">
        <Field label="Status" htmlFor="detail-status">
          <SelectMenu<TaskStatus>
            id="detail-status"
            title="Status"
            value={task.status}
            onChange={(s) => s && saveStatus(s)}
            sections={STATUS_SECTIONS}
            searchable={false}
            menuWidth={280}
          />
        </Field>
        <Field label="Assignee" htmlFor="detail-assignee">
          <AssigneePicker id="detail-assignee" members={members} assignee={task.assigneeId} onSelect={saveAssignee} />
        </Field>
        <Field label="Parent" htmlFor="detail-parent">
          <ParentField
            id="detail-parent"
            groupId={props.groupId}
            task={task}
            ownSubtasks={subtaskCount}
            onOpenParent={props.onOpenTask}
            onChange={props.onChangeParent}
          />
        </Field>
        <Field label="Epic" htmlFor="detail-epic">
          <EpicPicker
            id="detail-epic"
            disabled={subtask}
            epics={props.epics}
            value={task.epicId}
            onSelect={(epic) =>
              onUpdate(
                { epicId: epic?._id ?? null },
                {
                  epicId: epic ? { _id: epic._id, title: epic.title, color: epic.color, status: epic.status } : null,
                },
              )
            }
            onCreateEpic={props.onCreateEpic}
            isCreating={props.isCreatingEpic}
          />
          {subtask && (
            <p className="text-xs text-tg-hint">
              Follows its parent{parent ? ` #${parent.taskNumber}` : ''}. Change the epic there.
            </p>
          )}
          {epicId && (
            <button
              type="button"
              onClick={() => props.onOpenEpicBoard(epicId)}
              className="mt-0.5 flex min-h-11 items-center gap-1 text-xs text-tg-hint hover:underline sm:min-h-8"
              aria-label="See all tasks in this epic on the board"
            >
              {epicProgress && <span>{epicProgress}</span>}
              {epicProgress && <span aria-hidden>·</span>}
              <span className="text-tg-link">See all tasks ›</span>
            </button>
          )}
        </Field>
        <Field label="Type" htmlFor="detail-type">
          <SelectMenu<TaskType>
            id="detail-type"
            title="Type"
            value={task.type ?? TaskType.TASK}
            onChange={(type) => type && onUpdate({ type }, { type })}
            options={TYPE_OPTIONS}
            menuWidth={300}
          />
        </Field>
        <Field label="Priority" htmlFor="detail-priority">
          <SelectMenu<TaskPriority>
            id="detail-priority"
            title="Priority"
            value={task.priority}
            onChange={(priority) => priority && onUpdate({ priority }, { priority })}
            options={PRIORITY_OPTIONS}
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
              <Button
                variant="link"
                size="sm"
                aria-label="Clear due date"
                onClick={() => onUpdate({ dueDate: null }, { dueDate: null })}
              >
                Clear
              </Button>
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
        <div className="flex flex-wrap gap-x-1">
          <dt>Created</dt>
          <dd>
            {formatRelative(task.createdAt)} · {formatDate(task.createdAt)}
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-1">
          <dt>Updated</dt>
          <dd>
            {formatRelative(task.updatedAt)} · {formatDate(task.updatedAt)}
          </dd>
        </div>
        {isClosedStatus(task.status) && task.completedAt && (
          <div className="flex flex-wrap gap-1">
            <dt>Resolved</dt>
            <dd>
              {formatRelative(task.completedAt)} · {formatDate(task.completedAt)}
              {getUserId(task.completedBy) &&
                ` by ${displayName(task.completedBy, { members, fallback: 'a group member' })}`}
            </dd>
          </div>
        )}
      </dl>
    </Card>
  );

  return (
    <Layout
      title={breadcrumb}
      onBack={ai.backHandler(onBack)}
      // Quick look: BackButton only while the Ask AI sheet is open (it closes the sheet).
      nativeBack={!quickLook || ai.open}
      width="medium"
      actions={<AskAiButton onClick={ai.open ? ai.close : ai.openChat} active={ai.open} />}
    >
      <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,1fr)_320px] md:items-start md:gap-8">
        <div className="md:col-start-1 md:row-start-1">
          <ParentBreadcrumb task={task} onOpen={props.onOpenTask} />
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

        <aside className="md:sticky md:top-[calc(5rem+var(--app-safe-top))] md:col-start-2 md:row-span-2 md:row-start-1">{details}</aside>

        <div className="flex flex-col gap-6 md:col-start-1 md:row-start-2">
          <EditableText
            label="Description"
            value={task.description ?? ''}
            placeholder="Add a description…"
            multiline
            maxLength={2000}
            onSave={(description) =>
              onUpdate({ description: description || null }, { description: description || null })
            }
            displayClassName="text-sm leading-relaxed text-tg-text"
            renderValue={(v) => <FormattedText text={v} />}
          />

          {!subtask && (
            <SubtasksSection
              groupId={props.groupId}
              task={task}
              members={members}
              onOpenTask={(t) => props.onOpenTask(t._id)}
              onParentStatus={(status) => void saveStatus(status)}
            />
          )}

          <SourceMessages messages={sources} />

          <ActivityTimeline
            items={props.activity}
            members={members}
            isLoading={props.activityLoading}
            error={props.activityError}
            onRetry={props.onRetryActivity}
          />

          <div className="border-t border-tg-separator pt-3">
            <Button
              variant="ghost"
              size="sm"
              icon="🗑"
              onClick={() => {
                props.onClearDeleteError();
                setShowDelete(true);
              }}
              className="text-tg-destructive"
            >
              Delete task
            </Button>
          </div>
        </div>
      </div>

      {showDelete && (
        <DeleteDialog
          task={task}
          subtaskCount={subtaskCount}
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
