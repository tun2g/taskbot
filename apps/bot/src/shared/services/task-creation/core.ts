import { randomBytes } from 'crypto';
import { configService } from 'src/configs/configuration';
import { TaskActivityVia } from 'src/database/models/task-activity.model';
import { epicService } from 'src/database/services/epic.service';
import { groupMemberService } from 'src/database/services/group-member.service';
import { noteGroup } from 'src/shared/services/telemetry/request-context';
import { extractForRequest } from 'src/shared/services/task-creation/extract';
import { notifyAssignees, saveExtractedTasks, saveWarnings } from 'src/shared/services/task-creation/save';
import { CreateTasksCoreInput, CreateTasksResult } from 'src/shared/services/task-creation/types';
import { ExtractionInput } from 'src/shared/services/task-extraction.service';

/**
 * The channel-agnostic /task core: AI extraction (with fallback), server-side assignee resolution,
 * task creation (shared batchId), activity log and assignee DMs. Posts nothing to the group.
 */
export async function createTasks(input: CreateTasksCoreInput): Promise<CreateTasksResult> {
  const { messages, note, requester, group, origin } = input;
  const warnings = [...(input.warnings ?? [])];
  const chatId = input.chatId ?? group.telegramGroupId;
  noteGroup(group._id);

  const members = await groupMemberService.getMembers(group._id);
  if (!members.some((m) => m.telegramUserId === requester.telegramUserId)) members.push(requester);
  const openEpics = await epicService.listOpen(group._id);
  const extractionInput: ExtractionInput = {
    messages,
    note,
    members,
    timezone: group.timezone || configService.timezone || 'UTC',
    ...(openEpics.length ? { epics: openEpics.map((e) => ({ title: e.title, description: e.description })) } : {}),
  };

  const step = await extractForRequest(input, extractionInput, chatId, warnings);
  if (step.status !== 'extracted') return step;
  const { result } = step;

  const batchId = randomBytes(8).toString('hex');
  const via: TaskActivityVia = input.activityVia ?? (result.source === 'ai' ? 'ai' : origin === 'app' ? 'app' : 'bot');
  const saved = await saveExtractedTasks(
    {
      input,
      chatId,
      members,
      openEpics,
      batchId,
      via,
      mentions: messages.flatMap((m) => m.mentions ?? []),
      byId: new Map(messages.map((m) => [m.messageId, m])),
    },
    result.tasks,
  );
  const { created } = saved;
  if (created.length === 0) return { status: 'save_failed' };

  warnings.push(...saveWarnings(saved, origin));
  await notifyAssignees(created, requester);

  return { status: 'created', created, tasks: created.map((c) => c.task), warnings, batchId, source: result.source };
}
