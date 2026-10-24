import { EpicStatus, isClosedStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { IEpic } from 'src/database/models/epic.model';
import { IUser } from 'src/database/models/user.model';
import { epicService } from 'src/database/services/epic.service';
import { taskService } from 'src/database/services/task.service';
import { AiRequestContext, toEpicRef } from 'src/shared/services/ai-command/context';
import { buildEpicMiss, openEpicsOf } from 'src/shared/services/ai-command/epics';
import { dayOf, epicLabel, isOverdue, labelWord, personName, shorten, statusText } from 'src/shared/services/ai-command/format';
import { QueryAction } from 'src/shared/services/ai-command/plan.schema';
import { queryBoardFilters } from 'src/shared/services/ai-command/query-filters';
import { resolvePerson } from 'src/shared/services/ai-command/resolve';
import { EpicOverviewRow, EpicRef, QueryOutcome } from 'src/shared/services/ai-command/result';

const TYPE_PLURAL: Record<string, string> = {
  bug: 'bugs',
  feature: 'features',
  improvement: 'improvements',
  task: 'tasks',
  chore: 'chores',
  research: 'research tasks',
  question: 'questions',
};

/** "có những epic nào?" — every epic with its progress, open ones first (oldest first within). */
async function epicOverview(c: AiRequestContext, only?: EpicRef): Promise<QueryOutcome> {
  const epics = await epicService.listWithProgress(c.group._id);
  const rows: EpicOverviewRow[] = epics
    .map((e) => ({
      ...toEpicRef(e as unknown as IEpic),
      status: String(e.status ?? EpicStatus.OPEN),
      total: e.progress.total,
      done: e.progress.done,
    }))
    .filter((row) => !only || row._id === only._id);
  const open = rows.filter((r) => r.status !== EpicStatus.DONE);
  const closed = rows.filter((r) => r.status === EpicStatus.DONE);
  return { kind: 'epics', epics: [...open, ...closed] };
}

export async function runQuery(c: AiRequestContext, q: QueryAction): Promise<QueryOutcome> {
  let epic: EpicRef | undefined;
  if (q.epic) {
    const found = await epicService.findByTitle(c.group._id, q.epic);
    if (!found) return { kind: 'unknown_epic', miss: buildEpicMiss(q.epic, await openEpicsOf(c)) };
    epic = toEpicRef(found);
  }
  if (q.kind === 'epics') return epicOverview(c, epic);

  let assignee: IUser | null = null;
  if (q.kind === 'mine') assignee = c.requester;
  else if (q.person) {
    assignee = resolvePerson(c, q.person);
    if (!assignee) return { kind: 'unknown_person', person: q.person };
  }
  const mine = !!assignee && assignee._id.toString() === c.requester._id.toString();
  const search = q.text ?? undefined;

  const { tasks } = await taskService.getTasksByGroup(c.group._id, {
    ...(q.status ? { status: q.status } : {}),
    ...(q.type ? { type: q.type } : {}),
    ...(assignee ? { assigneeId: assignee._id } : {}),
    ...(search ? { search } : {}),
    ...(epic ? { epicId: new mongoose.Types.ObjectId(epic._id) } : {}),
    limit: 500,
  });

  let list = q.status ? tasks : tasks.filter((t) => !isClosedStatus(t.status));
  if (q.kind === 'overdue') list = list.filter((t) => isOverdue(t.dueDate, t.status, c.today));
  list = [...list].sort((a, b) => {
    const da = a.dueDate ? dayOf(a.dueDate) : '9999-99-99';
    const db = b.dueDate ? dayOf(b.dueDate) : '9999-99-99';
    return da === db ? b.taskNumber - a.taskNumber : da < db ? -1 : 1;
  });

  // ── Title: "Your open tasks", "Overdue bugs for @an matching “login”" ──
  const noun = q.type ? (TYPE_PLURAL[q.type] ?? 'tasks') : 'tasks';
  const qualifier =
    q.kind === 'overdue' ? 'overdue' : q.status ? labelWord(statusText(q.status)).toLowerCase() : 'open';
  const icon = q.kind === 'overdue' ? '⚠️' : search ? '🔎' : '📋';
  let title: string;
  if (mine) title = `Your ${qualifier} ${noun}`;
  else {
    title = `${qualifier.charAt(0).toUpperCase()}${qualifier.slice(1)} ${noun}`;
    if (assignee) title += ` for ${personName(assignee)}`;
  }
  if (search) title += ` matching “${shorten(search, 30)}”`;
  if (epic) title += ` in ${epicLabel(epic)}`;

  return {
    kind: 'list',
    queryKind: q.kind,
    mine,
    title,
    icon,
    tasks: list,
    showStatus: !q.status,
    showAssignee: !assignee,
    emptyText: q.kind === 'overdue' || (!search && !q.status && !q.type) ? 'Nothing here. 🎉' : 'No matches.',
    ...(epic ? { epic } : {}),
    boardFilters: queryBoardFilters(q, assignee, epic),
  };
}
