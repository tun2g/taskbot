import { groupTimezone, populatedUser, refId, todayIn } from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskService } from 'src/database/services/task.service';
import type { AiRequestContext } from 'src/shared/services/ai-command/context';
import { explainTask } from 'src/shared/services/ai-command/explain';
import { personName, shorten } from 'src/shared/services/ai-command/format';
import { MAX_AI_EXPLAINS } from 'src/shared/services/ai-command/plan.schema';
import { ExplainOutcome, TargetMiss } from 'src/shared/services/ai-command/result';
import { AiOutcome, type AiReply, renderTelegram } from 'src/shared/services/ai-command/telegram.renderer';

/**
 * "giải thích #5", "task này làm gì?", "what is #5" — wording that asks what a task is about. Used to still
 * answer from the task's own details when the planner is down (no AI needed to know what was asked).
 */
export const EXPLAIN_WORDING = /giải thích|giai thich|là gì|la gi\b|làm gì|lam gi\b|tóm tắt|tom tat|explain|what is|what's/i;

/**
 * "💡 Explain" buttons (card ⋯ More, DM notifications): explains ONE task directly — no planner call.
 * `onCard`: the answer is threaded under the task card, so it skips the state lines and Open button
 * (the card is right above). Null when the task is gone or belongs to another group.
 * The caller checks membership and the /ai rate limits first.
 */
export async function explainTaskById(
  taskId: string,
  requester: IUser,
  group: IGroup,
  options: { onCard?: boolean } = {},
): Promise<AiReply | null> {
  const task = await taskService.getTaskById(taskId);
  if (!task || refId(task.groupId) !== group._id.toString()) return null;
  const timezone = groupTimezone(group);
  const c: AiRequestContext = {
    // Vietnamese wording: the explanation is written in the language of the request.
    request: `Giải thích task #${task.taskNumber}`,
    requester,
    group,
    members: [],
    replyTask: options.onCard ? task : null,
    replyMessage: null,
    referencedTasks: [task],
    referencedNumbers: [task.taskNumber],
    mentions: [],
    timezone,
    today: todayIn(timezone),
    channel: 'telegram',
  };
  const explain = await explainTask(c, task);
  return replyOf(renderTelegram(c, { kind: 'sections', sections: [{ type: 'explain', explain }] }));
}

/**
 * The AI is down but the request clearly asks what ONE task is about ("giải thích #5", or "task này làm
 * gì?" on its card): answer from the task's own details (description / source message + state) instead
 * of a bare "AI is unavailable". Null when the request isn't that.
 */
export function explainWithoutAi(c: AiRequestContext): AiReply | null {
  if (!EXPLAIN_WORDING.test(c.request)) return null;
  let task: ITask | null = null;
  if (c.referencedNumbers.length === 1) {
    const n = c.referencedNumbers[0];
    task = c.replyTask?.taskNumber === n ? c.replyTask : (c.referencedTasks.find((t) => t.taskNumber === n) ?? null);
  } else if (c.referencedNumbers.length === 0) {
    task = c.replyTask;
  }
  if (!task) return null;
  const assigneeUser = populatedUser(task.assigneeId);
  const fromReply = !!c.replyTask && c.replyTask._id.toString() === task._id.toString();
  const explain: ExplainOutcome = { task, text: null, assignee: assigneeUser ? personName(assigneeUser) : null, fromReply };
  return replyOf(renderTelegram(c, { kind: 'sections', sections: [{ type: 'explain', explain }] }));
}

/**
 * Notes under the explanations of a multi-task request: "❌ No task #55." for numbers that don't exist,
 * "🤔 …" for unclear ones, and "ℹ️ Explained 3 of 4 — ask about #4 separately." over the cap. Plain.
 */
export function explainNoteLines(misses: TargetMiss[], toExplain: ITask[]): string[] {
  const lines: string[] = [];
  for (const miss of misses) {
    if (miss.reason === 'missing') lines.push(`❌ No task #${miss.number}.`);
    else if (miss.reason === 'no_match') lines.push(`🤔 No task matches “${shorten(miss.search, 30)}”.`);
    else lines.push('🤔 One task was unclear — ask again with its #number.');
  }
  const skipped = toExplain.slice(MAX_AI_EXPLAINS);
  if (skipped.length) {
    const asked = toExplain.length;
    const refs = skipped.map((t) => `#${t.taskNumber}`).join(', ');
    lines.push(`ℹ️ Explained ${MAX_AI_EXPLAINS} of ${asked} — ask about ${refs} separately.`);
  }
  return Array.from(new Set(lines));
}

function replyOf(outcome: AiOutcome): AiReply | null {
  return outcome.kind === 'reply' ? outcome.reply : null;
}
