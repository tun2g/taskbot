import type { AiChatResponse, ITask as SharedTask } from '@tbot/shared';
import { bot } from 'src/bot';
import { ITask } from 'src/database/models/task.model';
import { isConversationId, loadConversation, newConversationId, saveConversation } from 'src/mcp/conversation-store';
import { mcpChannel, McpToolError } from 'src/mcp/context';
import { requireGroup } from 'src/mcp/resolve/group';
import { taskLine, TaskSummary, taskSummary } from 'src/mcp/format/task';
import { resolveTask } from 'src/mcp/resolve/task';
import { defineTool, groupArg } from 'src/mcp/tools/types';
import { CardEditor } from 'src/shared/services/ai-command.service';
import { handleWebChat } from 'src/shared/services/ai-command/web-chat';
import { WEB_AI_STILL_WORKS } from 'src/shared/services/ai-command/web.renderer';
import { aiDisabledBy, aiDisabledText } from 'src/shared/services/ai-quota';
import { z } from 'zod';

export const ASK_MESSAGE_MAX = 2000;
const STRUCTURED_FALLBACK =
  'You can still do it with the structured tools: list_tasks, get_task, create_tasks, update_task, list_epics, create_epic, update_epic.';

const asTask = (task: SharedTask) => task as unknown as ITask;

/** Every task the answer is about (changed, created or listed), ObjectId-free. */
function tasksOf(data: AiChatResponse): TaskSummary[] {
  const seen = new Set<number>();
  const all = [...(data.changed?.map((c) => c.task) ?? []), ...(data.tasks ?? [])].map((t) => taskSummary(asTask(t)));
  return all.filter((t) => (seen.has(t.number) ? false : (seen.add(t.number), true)));
}

/** The assistant's text plus the facts the web app shows as chips (task lines, warnings, undo). */
/** An AI-proposed breakdown: agents can't tap "Add all" — they add the (possibly edited) list themselves. */
function previewText(preview: NonNullable<AiChatResponse['preview']>, warnings: string[] = []): string {
  const n = preview.parent.taskNumber;
  return [
    `TaskBot suggests these subtasks for #${n} ${preview.parent.title} (nothing was created yet):`,
    ...preview.items.map((item, i) => `${i + 1}. ${item.title}${item.assignee ? ` → ${item.assignee.name}` : ''}`),
    ...(warnings.length ? ['', ...warnings] : []),
    '',
    `To add them, call create_tasks with parent: ${n} on each task (edit, drop or reassign items first if needed).`,
  ].join('\n');
}

function replyText(data: AiChatResponse, tasks: TaskSummary[], conversationId: string): string {
  if (data.kind === 'preview' && data.preview) return previewText(data.preview, data.warnings);
  const lines = [data.text];
  if (tasks.length && data.kind !== 'clarify') {
    lines.push('', ...tasks.map((t) => `- ${taskLine(t)}`));
    if (data.totalMatches)
      lines.push(`…${data.totalMatches - tasks.length} more match — narrow it down or use list_tasks.`);
  } else if (tasks.length) {
    lines.push('', 'Candidates:', ...tasks.map((t) => `- ${taskLine(t)}`));
  }
  if (data.warnings?.length) lines.push('', ...data.warnings);
  if (data.batchId) lines.push('', `Undo within 10 minutes: undo_last with undoToken "${data.batchId}".`);
  if (data.kind === 'clarify') {
    lines.push(
      '',
      `TaskBot needs an answer: call ask_taskbot again with conversationId "${conversationId}" and the reply.`,
    );
  }
  return lines.join('\n');
}

export const askTaskbotTool = defineTool({
  name: 'ask_taskbot',
  title: 'Ask TaskBot (natural language)',
  description:
    "Talk to TaskBot's own AI assistant in plain words (Vietnamese or English) — the same one as /ai in Telegram. " +
    'It creates tasks from a description (splitting it into clean work items), updates them ("#12 done, giao cho @an, hạn thứ 6"), ' +
    'explains a task, answers questions ("what is overdue?", "how are the epics going?") and manages epics; ' +
    'it resolves people, epics and relative dates itself. It may ask a clarifying question: answer by calling ask_taskbot again ' +
    'with the returned conversationId. It never deletes tasks and changes at most 5 tasks per request.',
  inputSchema: {
    group: groupArg,
    message: z
      .string()
      .trim()
      .min(1, 'The message is empty.')
      .max(ASK_MESSAGE_MAX, `Messages can be at most ${ASK_MESSAGE_MAX} characters.`)
      .describe('What you want, in plain words. Refer to tasks as #12.'),
    conversationId: z
      .string()
      .optional()
      .describe(
        'Continue an earlier ask_taskbot conversation (follow-ups like "assign it to @an", or answering its question).',
      ),
    taskNumber: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional: the task the message is about ("mark this done") — like replying to its card.'),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async ({ group: groupRef, message, conversationId, taskNumber }, ctx) => {
    const group = await requireGroup(ctx, groupRef);
    const userId = String(ctx.user._id);
    // Turned off by the owner is not "unavailable right now": say retrying won't help.
    const disabledBy = aiDisabledBy(group, ctx.user);
    if (disabledBy) {
      throw new McpToolError(
        `${aiDisabledText(disabledBy)} Retrying won't help — only the bot owner can turn it back on; tell the user. ${STRUCTURED_FALLBACK}`,
      );
    }

    let id = conversationId?.trim() || '';
    let restarted = false;
    let conversation = id ? await loadConversation(userId, id) : null;
    if (conversation && conversation.groupId !== String(group._id)) {
      throw new McpToolError(
        'That conversationId belongs to another group. Omit conversationId to start a new conversation in this group.',
      );
    }
    if (!conversation) {
      restarted = !!id;
      if (!id || !isConversationId(id)) id = newConversationId();
      conversation = { groupId: String(group._id), history: [] };
    }

    const task = taskNumber ? await resolveTask(group, taskNumber) : null;
    const outcome = await handleWebChat({
      group,
      requester: ctx.user,
      message,
      ...(task ? { taskId: String(task._id) } : {}),
      history: conversation.history,
      editor: bot.telegram as unknown as CardEditor,
      channel: mcpChannel(ctx),
    });

    if (outcome.status === 'rate_limited') throw new McpToolError(`${outcome.message} ${STRUCTURED_FALLBACK}`);
    if (outcome.status === 'task_not_found') throw new McpToolError(`There is no task #${taskNumber} in this group.`);

    const data = outcome.data;
    if (data.kind === 'unavailable')
      throw new McpToolError(`TaskBot's AI can't answer right now: ${data.text.replace(WEB_AI_STILL_WORKS, '').trim()} ${STRUCTURED_FALLBACK}`);

    await saveConversation(userId, id, conversation, { user: message, assistant: data.text });

    const tasks = tasksOf(data);
    const text = [
      ...(restarted ? ['(That conversation had expired — started a new one.)', ''] : []),
      replyText(data, tasks, id),
    ].join('\n');
    return {
      text,
      data: {
        conversationId: id,
        kind: data.kind,
        reply: data.text,
        tasks,
        ...(data.changed
          ? { changes: data.changed.map((c) => ({ number: c.task.taskNumber, changes: c.changes })) }
          : {}),
        ...(data.totalMatches ? { totalMatches: data.totalMatches } : {}),
        ...(data.batchId ? { undoToken: data.batchId, undoUntil: data.undoUntil } : {}),
        ...(data.warnings?.length ? { warnings: data.warnings } : {}),
        ...(data.suggestions?.length ? { suggestions: data.suggestions } : {}),
        ...(data.preview ? { suggestedSubtasks: { parent: data.preview.parent.taskNumber, items: data.preview.items } } : {}),
      },
    };
  },
});
