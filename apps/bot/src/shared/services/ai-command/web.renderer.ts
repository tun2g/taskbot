import type { AiChatResponse, AiTaskChange, ITask as SharedTask } from '@tbot/shared';
import { ITask } from 'src/database/models/task.model';
import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import { createEpicCommand, detectLang, epicLabel, epicOf, shorten } from 'src/shared/services/ai-command/format';
import { MAX_AI_MUTATIONS } from 'src/shared/services/ai-command/plan.schema';
import { AiResult, changedUpdates, EpicMiss, QueryOutcome } from 'src/shared/services/ai-command/result';
import { webSubtasksResponse } from 'src/shared/services/ai-command/subtasks.render';
import { missText, sectionText, WHICH_TASK_TEXT } from 'src/shared/services/ai-command/web.sections';
import { PHRASES, pick, taskFollowUps } from 'src/shared/services/ai-command/web.suggestions';
import type { CreatedTask } from 'src/shared/services/task-creation.service';

// Web "Ask AI" replies: PLAIN text only (no HTML/Markdown) in short lines; the web app renders
// `tasks` / `changed` as rich chips.

export const WEB_AI_STILL_WORKS = 'You can still edit tasks on the board.';
export const WEB_AI_UNAVAILABLE_TEXT = 'AI is unavailable right now — you can still edit tasks on the board.';
export const WEB_SAVE_FAILED_TEXT = "❌ I couldn't save the task. Please try again in a moment.";
/** Most tasks a query returns to the web (the rest is counted in totalMatches). */
export const WEB_QUERY_LIMIT = 20;

/** API tasks are the shared shape (refs populated); the DB model type differs only in ref typing. */
const asShared = (task: ITask) => task as unknown as SharedTask;

export { detectLang };

/** Renders a core result (anything but `create`) as the web chat response. */
export function renderWeb(c: AiRequestContext, result: Exclude<AiResult, { kind: 'create' }>): AiChatResponse {
  const lang = detectLang(c.request);
  const p = PHRASES[lang];

  switch (result.kind) {
    case 'clarify':
      return { kind: 'clarify', text: `🤔 ${result.question}`, suggestions: [] };
    case 'which_task': {
      const response: AiChatResponse = { kind: 'clarify', text: missText(result.miss), suggestions: [] };
      if (result.miss.reason === 'ambiguous') response.tasks = result.miss.candidates.slice(0, 5).map(asShared);
      return response;
    }
    case 'refused': {
      const text =
        result.reason === 'delete'
          ? '🗑 I don’t delete tasks from chat. Open the task and delete it there.'
          : result.reason === 'bulk'
            ? `✋ I can change at most ${MAX_AI_MUTATIONS} tasks per request.\nFor bulk changes, use the board.`
            : '✋ One thing at a time: send the new task and the other change as two separate messages.';
      return { kind: 'refused', text, suggestions: pick([p.mine, p.overdue]) };
    }
  }

  const { sections } = result;
  if (sections.length === 0) return { kind: 'clarify', text: WHICH_TASK_TEXT, suggestions: [] };
  // "Chia #42 thành subtask" stands alone (the planner refuses mixing it with other changes).
  const subtasks = sections.find((s) => s.type === 'subtasks');
  if (subtasks?.type === 'subtasks') return webSubtasksResponse(subtasks.subtasks, c.request, c.today);

  const text = sections.map((s) => sectionText(s, c.today)).join('\n\n');
  const changed = changedUpdates(sections);
  const list = sections.find(
    (s): s is { type: 'query'; query: Extract<QueryOutcome, { kind: 'list' }> } =>
      s.type === 'query' && s.query.kind === 'list',
  )?.query;

  const response: AiChatResponse = { kind: 'answer', text };
  if (list) {
    response.tasks = list.tasks.slice(0, WEB_QUERY_LIMIT).map(asShared);
    if (list.tasks.length > WEB_QUERY_LIMIT) response.totalMatches = list.tasks.length;
    response.boardFilters = list.boardFilters;
  }

  const explained = sections.flatMap((s) => (s.type === 'explain' ? [s.explain.task] : []));
  const epicMiss = sections
    .map((s) => (s.type === 'update' ? s.update.epicMiss : s.type === 'query' && s.query.kind === 'unknown_epic' ? s.query.miss : undefined))
    .find((m): m is EpicMiss => !!m);
  const epicRows = sections.flatMap((s) => (s.type === 'query' && s.query.kind === 'epics' ? [s.query.epics] : []))[0];
  const createdEpic = sections.some((s) => s.type === 'epic_created');

  if (changed.length) {
    response.kind = 'updated';
    response.changed = changed.map((u): AiTaskChange => ({ task: asShared(u.task), changes: u.changes }));
    const single = changed.length === 1 ? taskFollowUps(changed[0].task, c, lang, false) : [];
    response.suggestions = pick([...single, p.mine, p.overdue]);
  } else if (list) {
    response.kind = 'query';
    const first = list.tasks[0];
    response.suggestions = pick([
      ...(first ? taskFollowUps(first, c, lang).slice(0, 1) : []),
      list.queryKind !== 'overdue' && p.overdue,
      !list.mine && p.mine,
      list.mine && p.open,
    ]);
  } else if (epicMiss) {
    response.suggestions = pick([createEpicCommand(epicMiss.title, 'web'), p.epics]);
  } else if (epicRows) {
    const firstOpen = epicRows.find((e) => e.total > e.done);
    response.suggestions = pick([firstOpen && p.epicLeft(shorten(firstOpen.title, 30)), p.mine, p.overdue]);
  } else if (createdEpic) {
    response.suggestions = pick([p.epics, p.mine]);
  } else if (explained.length) {
    // The explained task as a chip (tap to open) + what people usually do next with it.
    // The open task (fromReply) is already on screen — no chip for it.
    const chips = sections.flatMap((s) => (s.type === 'explain' && !s.explain.fromReply ? [s.explain.task] : []));
    if (chips.length) response.tasks = chips.map(asShared);
    response.suggestions = pick([...(explained.length === 1 ? taskFollowUps(explained[0], c, lang) : []), p.mine]);
  } else {
    response.suggestions = pick([p.mine, p.overdue]);
  }
  return response;
}

/** Tasks created from the web chat (the group already got its "(via app)" post). */
export function renderWebCreated(
  c: AiRequestContext,
  created: CreatedTask[],
  warnings: string[],
  batchId: string,
  undoUntil: Date,
): AiChatResponse {
  const tasks = created.map((x) => x.task);
  const single = tasks.length === 1 ? epicOf(tasks[0].epicId) : null;
  const text =
    tasks.length === 1
      ? `✅ Created #${tasks[0].taskNumber} ${shorten(tasks[0].title)}${single ? `\nEpic: ${epicLabel(single)}` : ''}`
      : `🤖 Created ${tasks.length} tasks: ${tasks.map((t) => `#${t.taskNumber}`).join(', ')}`;
  const lang = detectLang(c.request);
  const p = PHRASES[lang];
  const first = tasks[0];
  return {
    kind: 'created',
    text,
    tasks: tasks.map(asShared),
    batchId,
    undoUntil: undoUntil.toISOString(),
    ...(warnings.length ? { warnings } : {}),
    suggestions: pick([
      !first.dueDate && p.due(first.taskNumber),
      !first.assigneeId && p.assignMe(first.taskNumber),
      p.mine,
    ]),
  };
}
