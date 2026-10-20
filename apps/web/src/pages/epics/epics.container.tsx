import type { EpicWithProgress, TaskStatusCategory } from '@tbot/shared';
import { EpicStatus } from '@tbot/shared';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';

import { useCreateEpic, useDeleteEpic, useEpics, useUpdateEpic } from '@/api/epics';
import { useGroup } from '@/api/groups';
import type { EpicFormValues } from '@/components/epics/epic-form-dialog';
import { useToast } from '@/components/ui/toast';
import { getErrorMessage, getErrorStatus } from '@/lib/api-client';
import { formatEpicProgress } from '@/lib/epics';
import { haptic } from '@/lib/telegram';

import { recallBoardSearch } from '../tasks/board-search';
import { EpicsContent } from './epics.content';

/** `null` = closed; `'new'` = create sheet; an epic = edit sheet. */
export type EpicSheet = null | 'new' | EpicWithProgress;

export function EpicsContainer() {
  const { groupId } = useParams({ from: '/$groupId/epics/' });
  const navigate = useNavigate();
  const toast = useToast();

  const group = useGroup(groupId);
  const epics = useEpics(groupId);
  const createEpic = useCreateEpic(groupId);
  const updateEpic = useUpdateEpic(groupId);
  const deleteEpic = useDeleteEpic(groupId);

  const [sheet, setSheet] = useState<EpicSheet>(null);
  const [toDelete, setToDelete] = useState<EpicWithProgress | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toConfirmDone, setToConfirmDone] = useState<EpicWithProgress | null>(null);

  /** "No epic" keeps the board's view / grouping. */
  const openNoEpic = () => {
    const { view, groupBy } = recallBoardSearch(groupId);
    navigate({ to: '/$groupId/tasks', params: { groupId }, search: { view, groupBy, epic: 'none' } });
  };

  /**
   * Show what the row counted: the whole epic → status board with every column (cancelled has its own column, and
   * isn't in the row's total); one count ("2 in progress") → the list view filtered to that category.
   */
  const openEpic = (epic: EpicWithProgress, category?: TaskStatusCategory | 'open') => {
    navigate({
      to: '/$groupId/tasks',
      params: { groupId },
      search: category
        ? { view: 'list', epic: epic._id, category }
        : { view: 'board', groupBy: 'status', allStatuses: true, epic: epic._id },
    });
  };

  const handleBack = () => {
    navigate({ to: '/$groupId/tasks', params: { groupId }, search: recallBoardSearch(groupId) });
  };

  const handleSave = async (values: EpicFormValues): Promise<string | null> => {
    try {
      if (sheet && sheet !== 'new') {
        await updateEpic.mutateAsync({
          epicId: sheet._id,
          input: { title: values.title, description: values.description || null, color: values.color },
        });
        toast.success('Epic saved');
      } else {
        const epic = await createEpic.mutateAsync({
          title: values.title,
          description: values.description || undefined,
          color: values.color,
        });
        toast.success(`Created epic “${epic.title}”`);
      }
      setSheet(null);
      return null;
    } catch (err) {
      haptic('error');
      return getErrorMessage(err, "Couldn't save the epic.");
    }
  };

  const setStatus = async (epic: EpicWithProgress, status: EpicStatus, withUndo = true) => {
    try {
      await updateEpic.mutateAsync({ epicId: epic._id, input: { status } });
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't update the epic."));
      return;
    }
    if (!withUndo) return;
    const previous = epic.status;
    toast.success(status === EpicStatus.DONE ? `Marked “${epic.title}” done` : `Reopened “${epic.title}”`, {
      key: `epic-status:${epic._id}`,
      action: { label: 'Undo', onClick: () => void setStatus(epic, previous, false) },
    });
  };

  const askToggleDone = (epic: EpicWithProgress) => {
    if (epic.status === EpicStatus.DONE) {
      void setStatus(epic, EpicStatus.OPEN);
      return;
    }
    if (formatEpicProgress(epic).open > 0) setToConfirmDone(epic);
    else void setStatus(epic, EpicStatus.DONE);
  };

  /** Undo of a delete: same name / color / description / status, and its tasks back (those still without an epic). */
  const restoreEpic = async (epic: EpicWithProgress, taskIds: string[]) => {
    try {
      const restored = await createEpic.mutateAsync({
        title: epic.title,
        description: epic.description || undefined,
        color: epic.color,
        status: epic.status,
        // Always sent (even empty): it marks this as a restore, which the server doesn't announce in the group.
        taskIds,
      });
      const back = restored.progress ? restored.progress.total + (restored.progress.cancelled ?? 0) : taskIds.length;
      toast.success(
        back < taskIds.length
          ? `Restored “${epic.title}” · ${back} of ${taskIds.length} tasks back (the rest moved to other epics)`
          : `Restored “${epic.title}”`,
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Couldn't restore the epic."));
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    const epic = toDelete;
    setDeleteError(null);
    try {
      const { tasksUnlinked, taskIds } = await deleteEpic.mutateAsync(epic._id);
      toast.success(
        tasksUnlinked > 0
          ? `Deleted “${epic.title}” · ${tasksUnlinked} task${tasksUnlinked === 1 ? '' : 's'} kept`
          : `Deleted epic “${epic.title}”`,
        {
          key: `epic-delete:${epic._id}`,
          duration: 8000,
          action: { label: 'Undo', onClick: () => void restoreEpic(epic, taskIds) },
        },
      );
      setToDelete(null);
    } catch (err) {
      haptic('error');
      setDeleteError(getErrorMessage(err, "Couldn't delete the epic."));
    }
  };

  const groupStatus = getErrorStatus(group.isError ? group.error : null);

  return (
    <EpicsContent
      groupName={group.data?.groupName}
      accessError={groupStatus === 403 || groupStatus === 404 ? getErrorMessage(group.error) : null}
      epics={epics.data ?? []}
      isLoading={epics.isLoading}
      error={epics.isError ? getErrorMessage(epics.error) : null}
      isRetrying={epics.isFetching}
      onRetry={() => epics.refetch()}
      onBack={handleBack}
      onOpenEpic={openEpic}
      onOpenNoEpic={openNoEpic}
      sheet={sheet}
      onOpenSheet={setSheet}
      onSave={handleSave}
      isSaving={createEpic.isPending || (updateEpic.isPending && sheet !== null)}
      onToggleDone={askToggleDone}
      toConfirmDone={toConfirmDone}
      onCancelDone={() => setToConfirmDone(null)}
      onConfirmDone={() => {
        if (toConfirmDone) void setStatus(toConfirmDone, EpicStatus.DONE);
        setToConfirmDone(null);
      }}
      onShowOpenOf={(epic) => {
        setToConfirmDone(null);
        openEpic(epic, 'open');
      }}
      toDelete={toDelete}
      onAskDelete={(epic) => {
        setDeleteError(null);
        setToDelete(epic);
      }}
      onCancelDelete={() => setToDelete(null)}
      onConfirmDelete={handleDelete}
      isDeleting={deleteEpic.isPending}
      deleteError={deleteError}
    />
  );
}
