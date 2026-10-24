import { ITask } from 'src/database/models/task.model';
import type { AiRequestContext } from 'src/shared/services/ai-command/context';
import { createEpic } from 'src/shared/services/ai-command/epics';
import { explainTask } from 'src/shared/services/ai-command/explain';
import { explainNoteLines } from 'src/shared/services/ai-command/explain-direct';
import {
  AiAction,
  AiPlan,
  CreateEpicAction,
  CreateSubtasksAction,
  MAX_AI_EXPLAINS,
  MAX_AI_MUTATIONS,
  UpdateChanges,
} from 'src/shared/services/ai-command/plan.schema';
import { runQuery } from 'src/shared/services/ai-command/query';
import { resolvePerson, resolveTarget, unknownPersonText } from 'src/shared/services/ai-command/resolve';
import { AiResult, AiSection, CardEditor, TargetMiss } from 'src/shared/services/ai-command/result';
import { addSubtasks } from 'src/shared/services/ai-command/subtasks';
import { applyUpdate } from 'src/shared/services/ai-command/update';

/**
 * The channel-agnostic core: validates the plan against the safety rules (never guess a target,
 * no delete, at most MAX_AI_MUTATIONS changes, unknown people are never assigned) and runs it.
 */
export async function runPlan(c: AiRequestContext, plan: AiPlan, editor: CardEditor): Promise<AiResult> {
  const actions = plan.actions;

  const clarify = actions.find((a) => a.action === 'clarify');
  if (clarify && clarify.action === 'clarify') return { kind: 'clarify', question: clarify.question };

  if (actions.some((a) => a.action === 'delete_task')) return { kind: 'refused', reason: 'delete' };

  const updates = actions.filter((a): a is Extract<AiAction, { action: 'update_task' }> => a.action === 'update_task');
  const epicCreates = actions.filter((a): a is CreateEpicAction => a.action === 'create_epic');
  if (actions.some((a) => a.action === 'bulk') || updates.length + epicCreates.length > MAX_AI_MUTATIONS) {
    return { kind: 'refused', reason: 'bulk' };
  }

  const creates = actions.filter((a) => a.action === 'create_tasks');
  if (creates.length) {
    if (actions.some((a) => a.action !== 'create_tasks' && a.action !== 'answer')) {
      return { kind: 'refused', reason: 'mixed_create' };
    }
    return { kind: 'create', useReply: creates.some((a) => a.action === 'create_tasks' && !!a.useReply) };
  }

  // "chia #42 thành subtask …": one parent per request, on its own (like create_tasks).
  const subtaskAsk = actions.find((a): a is CreateSubtasksAction => a.action === 'create_subtasks');
  if (subtaskAsk) {
    if (actions.some((a) => a.action !== 'create_subtasks' && a.action !== 'answer')) {
      return { kind: 'refused', reason: 'mixed_create' };
    }
    const target = await resolveTarget(c, subtaskAsk.taskRef);
    if ('miss' in target) return { kind: 'which_task', miss: target.miss };
    const subtasks = await addSubtasks(c, target.task, subtaskAsk, {
      resolvePerson: (name) => resolvePerson(c, name),
      unknownPersonText: (name) => unknownPersonText(name, c.channel),
    });
    return { kind: 'sections', sections: [{ type: 'subtasks', subtasks }] };
  }

  // Resolve every target BEFORE changing anything: an unclear target aborts the whole request.
  const resolved: { task: ITask; changes: UpdateChanges; newEpic: boolean }[] = [];
  for (const update of updates) {
    const target = await resolveTarget(c, update.taskRef);
    if ('miss' in target) return { kind: 'which_task', miss: target.miss };
    const existing = resolved.find((r) => r.task._id.toString() === target.task._id.toString());
    if (existing) {
      existing.changes = { ...existing.changes, ...update.changes };
      existing.newEpic ||= !!update.newEpic;
    } else resolved.push({ task: target.task, changes: update.changes, newEpic: !!update.newEpic });
  }
  // Explanations are read-only (no mutation cap) but each is a second AI call: at most MAX_AI_EXPLAINS tasks.
  // One unclear target doesn't sink the others: the found ones are explained, the rest get a short note.
  const toExplain: ITask[] = [];
  const explainMisses: TargetMiss[] = [];
  for (const explain of actions.filter((a) => a.action === 'explain_task')) {
    const target = await resolveTarget(c, explain.taskRef);
    if ('miss' in target) explainMisses.push(target.miss);
    else if (!toExplain.some((t) => t._id.toString() === target.task._id.toString())) toExplain.push(target.task);
  }
  const otherWork = resolved.length || epicCreates.length || actions.some((a) => a.action === 'query');
  if (explainMisses.length && !toExplain.length && !otherWork) return { kind: 'which_task', miss: explainMisses[0] };

  // Changes first, so an explanation in the same request describes the task as it is now.
  // New epics before the updates, so "tạo epic Login rồi thêm #5 vào" finds it.
  const sections: AiSection[] = [];
  for (const action of epicCreates) sections.push({ type: 'epic_created', epic: await createEpic(c, action) });
  const current = new Map<string, ITask>();
  for (const { task, changes, newEpic } of resolved) {
    const update = await applyUpdate(c, task, changes, editor, { newEpic });
    current.set(task._id.toString(), update.task);
    sections.push({ type: 'update', update });
  }
  for (const task of toExplain.slice(0, MAX_AI_EXPLAINS)) {
    sections.push({ type: 'explain', explain: await explainTask(c, current.get(task._id.toString()) ?? task) });
  }
  const explainNotes = explainNoteLines(explainMisses, toExplain);
  if (explainNotes.length) sections.push({ type: 'note', lines: explainNotes });
  for (const action of actions) {
    if (action.action === 'query') sections.push({ type: 'query', query: await runQuery(c, action) });
    // The explanation IS the answer — a planner "answer" next to it would only repeat it.
    else if (action.action === 'answer' && !toExplain.length) sections.push({ type: 'answer', text: action.text });
  }
  return { kind: 'sections', sections };
}
