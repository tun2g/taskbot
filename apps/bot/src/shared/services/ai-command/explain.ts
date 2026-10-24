import { AiFeature, isClosedStatus } from '@tbot/shared';
import { populatedUser } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { subtaskService } from 'src/database/services/subtask.service';
import { taskActivityService } from 'src/database/services/task-activity.service';
import logger from 'src/shared/logger/logger';
import type { AiRequestContext } from 'src/shared/services/ai-command/context';
import {
  EXPLAIN_TASK_SYSTEM_PROMPT,
  buildExplainPrompt,
  explanationSchema,
  tidyExplanation,
} from 'src/shared/services/ai-command/explain.prompt';
import {
  dayOf,
  detectLang,
  epicOf,
  labelWord,
  personName,
  priorityText,
  statusText,
  typeText,
} from 'src/shared/services/ai-command/format';
import { withRequestAiScope } from 'src/shared/services/ai-command/limits';
import { ExplainOutcome } from 'src/shared/services/ai-command/result';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';

/**
 * "giải thích #5": a second AI call that writes a short plain-text explanation from the full task —
 * fields, the chat messages it was created from and its activity log. Read-only. When the AI is
 * unavailable the outcome has `text: null` and the renderers fall back to the task's own details.
 */
export async function explainTask(c: AiRequestContext, task: ITask): Promise<ExplainOutcome> {
  const assigneeUser = populatedUser(task.assigneeId);
  const assignee = assigneeUser ? personName(assigneeUser) : null;
  const creatorUser = populatedUser(task.createdBy);
  const [activity, children] = await Promise.all([
    taskActivityService.getForTask(task._id),
    task.parentTaskId ? Promise.resolve([] as ITask[]) : subtaskService.list(task._id),
  ]);
  const subtaskRows = children.map((t) => ({
    title: t.title,
    state: t.status === 'done' ? ('done' as const) : t.status === 'cancelled' ? ('cancelled' as const) : ('open' as const),
  }));
  const cancelled = children.filter((t) => t.status === 'cancelled').length;
  const subtasks = children.length
    ? { total: children.length - cancelled, done: children.filter((t) => t.status === 'done').length, cancelled }
    : null;
  const parentRef = task.parentTaskId as unknown as { taskNumber?: number; title?: string } | null;

  const sources = (task.sourceMessages?.length ? task.sourceMessages : task.sourceMessage ? [task.sourceMessage] : [])
    .filter((m) => m?.text?.trim())
    .map((m) => ({ from: m.fromName || 'someone', text: m.text }));

  const due = task.dueDate ? dayOf(task.dueDate) : null;
  // The replied card (web: the task open in the app) is already on screen: no state lines, no Open button.
  const fromReply = !!c.replyTask && c.replyTask._id.toString() === task._id.toString();

  // Who could answer open questions, best first: whoever wrote the source messages, the creator, the
  // assignee — never the person asking. Names without "@" so the explanation pings nobody.
  const requesterId = c.requester._id.toString();
  const sourceList = task.sourceMessages?.length ? task.sourceMessages : task.sourceMessage ? [task.sourceMessage] : [];
  const whoToAsk: string[] = [];
  const addPerson = (name: string | null | undefined) => {
    const plain = name?.replace(/^@/, '').trim();
    if (plain && plain !== 'someone' && !whoToAsk.includes(plain)) whoToAsk.push(plain);
  };
  for (const m of sourceList) if (m?.fromUserId !== c.requester.telegramUserId) addPerson(m?.fromName);
  if (creatorUser && creatorUser._id.toString() !== requesterId) addPerson(personName(creatorUser));
  if (assigneeUser && assigneeUser._id.toString() !== requesterId) addPerson(personName(assigneeUser));

  const user = buildExplainPrompt({
    request: c.request,
    lang: detectLang(c.request),
    today: c.today,
    timezone: c.timezone,
    task: {
      taskNumber: task.taskNumber,
      title: task.title,
      description: task.description || null,
      type: labelWord(typeText(task.type)),
      status: labelWord(statusText(task.status)),
      priority: labelWord(priorityText(task.priority)),
      assignee,
      creator: creatorUser ? personName(creatorUser) : null,
      createdAt: task.createdAt ? dayOf(task.createdAt) : null,
      dueDate: due,
      closed: isClosedStatus(task.status),
      epic: epicOf(task.epicId)?.title ?? null,
      parent: parentRef?.taskNumber ? `#${parentRef.taskNumber} ${parentRef.title ?? ''}`.trim() : null,
    },
    subtasks: subtaskRows,
    askedBy: personName(c.requester).replace(/^@/, ''),
    whoToAsk: whoToAsk.slice(0, 3),
    sources,
    activity: activity.map((a) => {
      const actor = populatedUser(a.actor);
      const change = a.from || a.to ? ` ${a.from ?? '—'} → ${a.to ?? '—'}` : '';
      const when = a.createdAt ? `${dayOf(a.createdAt)} ` : '';
      return `${when}${actor ? personName(actor) : 'someone'}: ${a.action.replace(/_/g, ' ')}${change}`;
    }),
  });

  try {
    const { text } = await withRequestAiScope(AiFeature.EXPLAIN, c, () =>
      aiService.generateJson({ system: EXPLAIN_TASK_SYSTEM_PROMPT, user, temperature: 0.3 }, explanationSchema, {
        retries: 1,
      }),
    );
    return { task, text: tidyExplanation(text, task.taskNumber) || null, assignee, fromReply, subtasks };
  } catch (error) {
    if (!(error instanceof AIUnavailableError)) throw error;
    logger.warn(`AI explanation of #${task.taskNumber} failed (${error.reason}): ${error.message}`);
    return { task, text: null, assignee, fromReply, subtasks };
  }
}
