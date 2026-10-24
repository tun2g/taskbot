import { isClosedStatus } from '@tbot/shared';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { taskService } from 'src/database/services/task.service';
import type { AiRequestContext } from 'src/shared/services/ai-command/context';
import { TaskRef } from 'src/shared/services/ai-command/plan.schema';
import { TargetMiss } from 'src/shared/services/ai-command/result';
import { resolveMember } from 'src/shared/services/task-extraction.service';

const SELF_WORDS = new Set(['me', 'myself', 'i', 'tôi', 'toi', 'mình', 'minh', 'em', 'tao', 'tớ']);

export type Target = { task: ITask } | { miss: TargetMiss };

/**
 * Never guesses: the replied card (web: the open task), a number the user wrote, the single task of
 * the previous answer (web chat), or a search with exactly one match.
 */
export async function resolveTarget(c: AiRequestContext, ref: TaskRef): Promise<Target> {
  if (ref === 'reply') {
    return c.replyTask ? { task: c.replyTask } : { miss: { reason: 'which' } };
  }

  const previousNumbers = c.previousNumbers ?? [];
  if (ref === 'previous') {
    if (c.previousTask && previousNumbers.length === 1) return { task: c.previousTask };
    if (previousNumbers.length > 1) return { miss: { reason: 'previous_ambiguous', numbers: previousNumbers } };
    return { miss: { reason: 'which' } };
  }

  if (typeof ref === 'number') {
    if (c.replyTask?.taskNumber === ref) return { task: c.replyTask };
    if (!c.referencedNumbers.includes(ref)) {
      // A number the user didn't write is only accepted when it is THE one task of the previous answer.
      if (c.previousTask?.taskNumber === ref && previousNumbers.length === 1) return { task: c.previousTask };
      return { miss: { reason: 'which' } };
    }
    const task =
      c.referencedTasks.find((t) => t.taskNumber === ref) ?? (await taskService.getTaskByNumber(c.group._id, ref));
    return task ? { task } : { miss: { reason: 'missing', number: ref } };
  }

  const { tasks } = await taskService.getTasksByGroup(c.group._id, { search: ref.search, limit: 20 });
  const open = tasks.filter((t) => !isClosedStatus(t.status));
  const candidates = open.length ? open : tasks;
  if (candidates.length === 1) return { task: candidates[0] };
  if (candidates.length === 0) return { miss: { reason: 'no_match', search: ref.search } };
  return { miss: { reason: 'ambiguous', candidates } };
}

/** Resolves "@an", "Hùng" or "me" to a group member; null when unknown (never guesses). */
export function resolvePerson(c: AiRequestContext, name: string): IUser | null {
  if (SELF_WORDS.has(name.trim().toLowerCase())) return c.requester;
  return resolveMember(name, c.members, c.mentions);
}

/** "Couldn't find @x in this group — they need to send a message here first." (plain). */
export function unknownPersonText(name: string, channel: AiRequestContext['channel'] = 'telegram'): string {
  const where = channel === 'web' ? 'in the group' : 'here';
  return `Couldn't find ${name} in this group — they need to send a message ${where} first.`;
}
