import { BotContext } from 'src/bot/interface/context';
import { cardSubtaskProgress } from 'src/bot/subtasks/card-progress';
import { subtaskListText } from 'src/bot/subtasks/subtask-lines';
import { displayName, populatedUser, STATUS_EMOJI, storeTaskCallbackData } from 'src/bot/task-card.renderer';
import { ITask } from 'src/database/models/task.model';
import { subtaskService } from 'src/database/services/subtask.service';
import { InlineKeyboardButton } from 'telegraf/types';

// Card ⋯ More → 🧩 Subtasks: the card is edited in place to list its subtasks under the card text, with « Back.

type RenderCard = (rows: InlineKeyboardButton[][], extraText: string) => Promise<void>;

export async function handleShowSubtasks(ctx: BotContext, task: ITask, render: RenderCard): Promise<void> {
  const [subtasks, progress] = await Promise.all([subtaskService.list(task._id), cardSubtaskProgress(task)]);
  const rows = subtasks.map((sub) => {
    const assignee = populatedUser(sub.assigneeId);
    return {
      taskNumber: sub.taskNumber,
      title: sub.title,
      statusEmoji: STATUS_EMOJI[sub.status] ?? '•',
      assignee: assignee ? displayName(assignee) : null,
    };
  });
  const back = { text: '« Back', callback_data: await storeTaskCallbackData(String(task._id), 'more') };
  await render([[back]], subtaskListText(rows, progress));
  await ctx.answerCbQuery(subtasks.length ? `${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}` : 'No subtasks yet');
}
