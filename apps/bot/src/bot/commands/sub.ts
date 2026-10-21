import { replyGroupOnly } from 'src/bot/commands/private-chat-hint';
import { BotContext } from 'src/bot/interface/context';
import { parseSubArgs, SUBS_PER_COMMAND_MAX, SubItem } from 'src/bot/subtasks/parse-sub';
import { taggedUserId, tagTextMentions, TaggedText, untag } from 'src/bot/subtasks/sub-mentions';
import { rememberSubBatch, subBatchButtons } from 'src/bot/subtasks/sub-undo';
import { randomBytes } from 'crypto';
import { escapeMarkdown, mdName, truncate } from 'src/bot/task-card.renderer';
import { IGroup } from 'src/database/models/group.model';
import { ITask } from 'src/database/models/task.model';
import { IUser } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { groupService } from 'src/database/services/group.service';
import { taskService } from 'src/database/services/task.service';
import { userService } from 'src/database/services/user.service';
import logger from 'src/shared/logger/logger';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { resolveMember } from 'src/shared/services/task-extraction.service';
import { TaskMutationError, taskMutationService } from 'src/shared/services/task-mutation.service';
import { taskButton, taskNumberMarkdown } from 'src/shared/utils/app-links';

export const SUB_USAGE =
  '🧩 *Add subtasks*\n' +
  '`/sub 42 Write tests @an` — a subtask of #42\n' +
  'Reply `/sub Write tests` to a task card\n' +
  `One per line for several (max ${SUBS_PER_COMMAND_MAX})`;

const NOT_A_CARD =
  "❌ That message isn't a task card. Reply to a task card, or use `/sub 42 Write tests`.";

interface Created {
  task: ITask;
  assignee: IUser | null;
}

/** /sub — add subtasks to a task from the chat. One group message for the whole batch. */
export class SubCommand {
  private map = new Map<string, (ctx: BotContext) => void>();

  register() {
    this.map.set('sub', this.onSub.bind(this));
    this.map.set('subtask', this.onSub.bind(this));
    return this.map;
  }

  async onSub(ctx: BotContext) {
    try {
      const chat = ctx.chat;
      if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
        await replyGroupOnly(ctx, 'sub');
        return;
      }
      const message = ctx.message;
      if (!message) return;
      const rawText = 'text' in message ? message.text || '' : '';
      const tagged = tagTextMentions(rawText, 'entities' in message ? message.entities : undefined);
      const args = tagged.text.replace(/^\/(sub|subtask)(@\w+)?/i, '');

      const user = await userService.findOrCreateUser(ctx);
      if (!user) return;
      const group = await groupService.findOrCreateGroup(chat.id, 'title' in chat ? chat.title : 'Group');
      if (!group) {
        await ctx.reply('❌ Could not find this group.');
        return;
      }

      const reply = 'reply_to_message' in message ? message.reply_to_message : undefined;
      const replyIsTopicStart = !!reply && 'forum_topic_created' in reply;
      const cardTask =
        reply && !replyIsTopicStart ? await taskService.getTaskByCardMessage(chat.id, reply.message_id) : null;

      const parsed = parseSubArgs(args, !!cardTask);
      if (parsed.items.length === 0) {
        await ctx.reply(SUB_USAGE, { parse_mode: 'Markdown' });
        return;
      }

      let parent = cardTask;
      if (!parent && parsed.parentNumber) {
        parent = await taskService.getTaskByNumber(group._id, parsed.parentNumber);
        if (!parent) {
          await ctx.reply(`❌ Task #${parsed.parentNumber} not found in this group. Use /list to see the open ones.`);
          return;
        }
      }
      if (!parent) {
        await ctx.reply(reply && !replyIsTopicStart ? NOT_A_CARD : SUB_USAGE, { parse_mode: 'Markdown' });
        return;
      }

      await this.addSubtasks(ctx, group, user, parent, parsed.items, parsed.dropped, tagged);
    } catch (error) {
      logger.error(`Error in /sub command: ${error instanceof Error ? error.stack : error}`);
      await ctx.reply('❌ Something went wrong and no subtask was added. Please try again.').catch(() => undefined);
    }
  }

  private async addSubtasks(
    ctx: BotContext,
    group: IGroup,
    user: IUser,
    parent: ITask,
    items: SubItem[],
    dropped: number,
    tagged: TaggedText,
  ) {
    const members = await groupMemberService.getMembers(group._id);
    const created: Created[] = [];
    const notes: string[] = [];
    // One batch → one ↩️ Undo for everything this /sub added.
    const batchId = randomBytes(8).toString('hex');

    for (const item of items) {
      const member = item.assignee ? findMember(item.assignee, members, tagged.taggedIds) : null;
      try {
        const result = await taskMutationService.createTask(
          group,
          user,
          {
            title: untag(item.title, tagged.names),
            parentTaskId: String(parent._id),
            ...(member ? { assigneeId: String(member._id) } : {}),
          },
          { channel: { activity: 'bot' }, announce: 'none', batchId },
        );
        created.push(result);
        if (item.assignee && !member) {
          const who = escapeMarkdown(untag(item.assignee, tagged.names));
          notes.push(
            `ℹ️ I don't know ${who} here yet, so #${result.task.taskNumber} is unassigned. They can tap ✋ on /members.`,
          );
        }
      } catch (error) {
        // A rule broke (parent is a subtask, too many subtasks…): the rest would fail the same way.
        if (error instanceof TaskMutationError) {
          if (created.length === 0) {
            await ctx.reply(`❌ ${error.message}`, { link_preview_options: { is_disabled: true } });
            return;
          }
          notes.push(`⚠️ Stopped after ${created.length}: ${escapeMarkdown(error.message)}`);
          break;
        }
        throw error;
      }
    }
    if (dropped > 0) notes.push(`ℹ️ Only the first ${SUBS_PER_COMMAND_MAX} lines were added.`);

    const undoKey = await rememberSubBatch(group, user, batchId, created.length);
    const buttons = subBatchButtons(undoKey, taskButton(parent));
    await groupMessengerService.sendCommandEvent(ctx, group, buildSubtasksAddedText(user, parent, created, notes), {
      extra: {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
        ...(buttons.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
      },
    });
  }
}

type Member = Awaited<ReturnType<typeof groupMemberService.getMembers>>[number];

/** "@an" / "@Bình" / a tap-mention token → a group member, or null. */
function findMember(assignee: string, members: Member[], taggedIds: number[]): Member | null {
  const telegramId = taggedUserId(assignee, taggedIds);
  if (telegramId !== null) return members.find((m) => m.telegramUserId === telegramId) ?? null;
  // "@Bình" is a name typed with @ (no such username) — also try it as a name.
  return resolveMember(assignee, members) ?? resolveMember(assignee.replace(/^@/, ''), members);
}

/**
 * 🧩 @me added 2 subtasks to #42 · Fix login
 * • #45 Write tests — @an
 * • #46 Update docs
 */
export function buildSubtasksAddedText(user: IUser, parent: ITask, created: Created[], notes: string[] = []): string {
  const what = created.length === 1 ? 'a subtask' : `${created.length} subtasks`;
  const lines = [
    `🧩 ${mdName(user)} added ${what} to *#${parent.taskNumber}* · ${escapeMarkdown(truncate(parent.title, 50))}`,
    ...created.map(({ task, assignee }) => {
      const num = taskNumberMarkdown(task.taskNumber, task.groupId, task._id);
      const who = assignee ? ` — ${mdName(assignee)}` : '';
      return `• ${num} ${escapeMarkdown(truncate(task.title, 60))}${who}`;
    }),
  ];
  if (notes.length) lines.push('', ...notes);
  return lines.join('\n');
}

export const subCommand = new SubCommand();
