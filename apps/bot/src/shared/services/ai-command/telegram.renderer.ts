import type { AiRequestContext } from 'src/shared/services/ai-command.service';
import { escapeHtml } from 'src/shared/services/ai-command/format';
import { MAX_AI_MUTATIONS } from 'src/shared/services/ai-command/plan.schema';
import { AiResult, changedUpdates } from 'src/shared/services/ai-command/result';
import { telegramSubtasksButtons } from 'src/shared/services/ai-command/subtasks.render';
import {
  AiOutcome,
  CLARIFY_HINT,
  DELETE_REFUSAL_MESSAGE,
  NOT_UNDERSTOOD_MESSAGE,
} from 'src/shared/services/ai-command/telegram.messages';
import { sectionText, telegramMissText } from 'src/shared/services/ai-command/telegram.sections';
import { boardButton, taskButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

// Telegram /ai replies: HTML parse mode; every plain string from the core goes through escapeHtml.

export type { AiOutcome, AiReply } from 'src/shared/services/ai-command/telegram.messages';
export {
  AI_STILL_WORKS,
  AI_UNAVAILABLE_MESSAGE,
  CLARIFY_HINT,
  DELETE_REFUSAL_MESSAGE,
  EXPLAIN_UNAVAILABLE_NOTE,
  NOT_UNDERSTOOD_MESSAGE,
  WHICH_TASK_MESSAGE,
} from 'src/shared/services/ai-command/telegram.messages';
export { addToEpicCommand, epicMissLines, telegramMissText } from 'src/shared/services/ai-command/telegram.sections';

/** Exactly today's /ai HTML replies and buttons. */
export function renderTelegram(c: AiRequestContext, result: AiResult): AiOutcome {
  const groupId = c.group._id;
  const board = boardButton(groupId);
  const boardButtons = board ? [[board]] : undefined;
  const reply = (text: string, buttons?: InlineKeyboardButton[][]): AiOutcome => ({ kind: 'reply', reply: { text, buttons } });

  switch (result.kind) {
    case 'clarify':
      return reply(`🤔 ${escapeHtml(result.question)}\n\n<i>${CLARIFY_HINT}</i>`);
    case 'which_task': {
      // A wrong number / search: the board is where to look it up.
      const lookUp = result.miss.reason === 'missing' || result.miss.reason === 'no_match';
      return reply(telegramMissText(result.miss, groupId), lookUp ? boardButtons : undefined);
    }
    case 'create':
      return { kind: 'create', useReply: result.useReply };
    case 'refused':
      if (result.reason === 'delete') return reply(DELETE_REFUSAL_MESSAGE);
      if (result.reason === 'bulk') {
        return reply(
          `✋ I can change at most ${MAX_AI_MUTATIONS} tasks per /ai request. For bulk changes, use the board.`,
          boardButtons,
        );
      }
      return reply('✋ One thing at a time: send the new task and the other change as two separate /ai messages.');
  }

  const { sections } = result;
  if (sections.length === 0) return reply(NOT_UNDERSTOOD_MESSAGE);

  let buttons: InlineKeyboardButton[][] | undefined;
  const updates = sections.flatMap((s) => (s.type === 'update' ? [s.update] : []));
  const failed = updates.filter((u) => u.failed);
  const updatedTasks = updates.filter((u) => !u.failed && u.changes.length).map((u) => u.task);
  const explainSections = sections.flatMap((s) => (s.type === 'explain' ? [s.explain] : []));
  // The replied card needs no "Open" button — the user is looking at it.
  const explained = explainSections.filter((e) => !e.fromReply).map((e) => e.task);
  const subtasks = sections.find((s) => s.type === 'subtasks');
  if (subtasks?.type === 'subtasks') {
    buttons = telegramSubtasksButtons(subtasks.subtasks);
  } else if (sections.some((s) => s.type === 'query')) {
    buttons = boardButtons;
  } else if (sections.some((s) => s.type === 'epic_created')) {
    // The new epic lives on the board; tasks changed in the same request get their own button.
    const row = [...updatedTasks.slice(0, 2).map((t) => taskButton(t)), board].filter(
      (b): b is InlineKeyboardButton => !!b,
    );
    if (row.length) buttons = [row];
  } else if (explainSections.length && failed.length === 0) {
    // "📱 Open #N" for each task on screen (explained or changed) — one row, at most 3.
    const shown = [...updatedTasks, ...explained].filter(
      (t, i, all) => all.findIndex((x) => x._id.toString() === t._id.toString()) === i,
    );
    const row = shown
      .slice(0, 3)
      .map((t) => taskButton(t))
      .filter((b): b is InlineKeyboardButton => !!b);
    if (row.length) buttons = [row];
  } else if (failed.length === 1 && updatedTasks.length === 0) {
    // "use the buttons on its card" → one tap to that task.
    const open = taskButton(failed[0].original);
    if (open) buttons = [[open]];
  } else if (updatedTasks.length === 1 && failed.length === 0) {
    const open = taskButton(updatedTasks[0]);
    if (open) buttons = [[open]];
  }
  const outcome = reply(sections.map((s) => sectionText(s, c.today, groupId)).join('\n\n'), buttons);
  const changed = changedUpdates(sections).filter((u) => !u.failed);
  return changed.length && outcome.kind === 'reply' ? { ...outcome, updates: changed } : outcome;
}
