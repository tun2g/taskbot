import { EPIC_COLOR_EMOJI, EpicColor, EpicStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { IGroup } from 'src/database/models/group.model';
import { IUser } from 'src/database/models/user.model';
import { epicService } from 'src/database/services/epic.service';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { EventSource, groupMessengerService } from 'src/shared/services/group-messenger.service';
import { escapeHtml, shortTitle, userDisplayName } from 'src/shared/services/task-event-lines';
import { boardButton } from 'src/shared/utils/app-links';
import type { Telegram } from 'telegraf';

// Group announcements for epic LIFECYCLE events (created / done / reopened / deleted), one message each, posted
// like task change lines: forums → the "Task events" topic, else the group. Renames, recolors and description
// edits are never announced (the task cards refresh instead). Every call is fire-and-forget: it never throws.

const DESCRIPTION_MAX = 80;

/** What the lines need from an epic (a doc or a plain object). */
export interface EpicEventTarget {
  _id: unknown;
  groupId: unknown;
  title: string;
  color: string;
  description?: string | null;
}

export interface EpicTaskCounts {
  /** Tasks in the epic, cancelled ones excluded. */
  total: number;
  done: number;
}

type Actor = Pick<IUser, 'username' | 'firstName' | 'lastName'> | null | undefined;

export interface EpicEventOptions {
  /** The epic's group when the caller already has it (saves a lookup). */
  group?: IGroup | null;
  /** Reply to this message (e.g. the /ai command), across topics when possible. */
  source?: EventSource;
  /** Topic to use when the group has no events topic. */
  fallbackThreadId?: number;
  telegram?: Telegram;
}

/** "🟦 <b>Login</b>" */
function epicLabel(epic: Pick<EpicEventTarget, 'title' | 'color'>): string {
  const dot = EPIC_COLOR_EMOJI[epic.color as EpicColor] ?? EPIC_COLOR_EMOJI[EpicColor.GRAY];
  return `${dot} <b>${escapeHtml(shortTitle(epic.title))}</b>`;
}

const viaText = (via: string) => `(via ${escapeHtml(via)})`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** `🗂 @an created epic 🟦 Login (via Claude Code)` + the description (≤ 80 chars, italic) on a second line. */
export function buildEpicCreatedText(actor: Actor, epic: EpicEventTarget, via: string): string {
  const line = `🗂 ${escapeHtml(userDisplayName(actor as IUser))} created epic ${epicLabel(epic)} ${viaText(via)}`;
  const description = epic.description?.trim();
  return description ? `${line}\n<i>${escapeHtml(shortTitle(description, DESCRIPTION_MAX))}</i>` : line;
}

/** `🎉 Epic 🟦 Login done — 7/7 tasks (via app)` / `… — 5/7 tasks, 2 still open (via app)`. */
export function buildEpicDoneText(epic: EpicEventTarget, counts: EpicTaskCounts | null, via: string): string {
  const total = counts?.total ?? 0;
  let progress = '';
  if (total > 0) {
    const done = Math.min(counts?.done ?? 0, total);
    const open = total - done;
    progress = ` — ${done}/${total} ${plural(total, 'task', 'tasks')}${open > 0 ? `, ${open} still open` : ''}`;
  }
  return `🎉 Epic ${epicLabel(epic)} done${progress} ${viaText(via)}`;
}

/** `↩️ @an reopened epic 🟦 Login (via app)` */
export function buildEpicReopenedText(actor: Actor, epic: EpicEventTarget, via: string): string {
  return `↩️ ${escapeHtml(userDisplayName(actor as IUser))} reopened epic ${epicLabel(epic)} ${viaText(via)}`;
}

/** `🗑 @an deleted epic 🟦 Login — its 3 tasks were kept (via app)` */
export function buildEpicDeletedText(actor: Actor, epic: EpicEventTarget, taskCount: number, via: string): string {
  const kept = taskCount > 0 ? ` — its ${taskCount} ${plural(taskCount, 'task was', 'tasks were')} kept` : '';
  return `🗑 ${escapeHtml(userDisplayName(actor as IUser))} deleted epic ${epicLabel(epic)}${kept} ${viaText(via)}`;
}

export class EpicEventsService {
  /** A new epic (never call it for the undo of a delete — that restore stays quiet). */
  async created(epic: EpicEventTarget, actor: Actor, via: string, options: EpicEventOptions = {}): Promise<void> {
    await this.post(epic, () => buildEpicCreatedText(actor, epic, via), options);
  }

  /** open → done: "🎉 … done — 5/7 tasks"; done → open: "↩️ … reopened". Anything else: nothing. */
  async statusChanged(
    from: string | null | undefined,
    epic: EpicEventTarget & { status?: string },
    actor: Actor,
    via: string,
    options: EpicEventOptions = {},
  ): Promise<void> {
    const to = epic.status ?? EpicStatus.OPEN;
    const previous = from ?? EpicStatus.OPEN;
    if (previous === to) return;
    if (to === EpicStatus.DONE) {
      await this.post(epic, async () => buildEpicDoneText(epic, await this.counts(epic), via), options);
    } else if (to === EpicStatus.OPEN) {
      await this.post(epic, () => buildEpicReopenedText(actor, epic, via), options);
    }
  }

  async deleted(
    epic: EpicEventTarget,
    actor: Actor,
    taskCount: number,
    via: string,
    options: EpicEventOptions = {},
  ): Promise<void> {
    await this.post(epic, () => buildEpicDeletedText(actor, epic, taskCount, via), options);
  }

  private async counts(epic: EpicEventTarget): Promise<EpicTaskCounts | null> {
    const progress = await epicService.getProgress(epic.groupId as mongoose.Types.ObjectId, [
      epic._id as mongoose.Types.ObjectId,
    ]);
    return progress.get(String(epic._id)) ?? null;
  }

  private async post(
    epic: EpicEventTarget,
    build: () => string | Promise<string>,
    options: EpicEventOptions,
  ): Promise<void> {
    try {
      const group = options.group ?? (await groupService.findGroupById(epic.groupId as mongoose.Types.ObjectId));
      if (!group?.telegramGroupId) return;
      const text = await build();
      // There's no Mini App link that opens the board filtered by one epic (start_param = group[_task]): board.
      const board = boardButton(group._id as mongoose.Types.ObjectId);
      const telegram = options.telegram ?? (await import('src/bot')).bot.telegram;
      await groupMessengerService.sendEvent(telegram, group, text, {
        extra: {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(board ? { reply_markup: { inline_keyboard: [[board]] } } : {}),
        },
        ...(options.source ? { source: options.source } : {}),
        ...(options.fallbackThreadId !== undefined ? { fallbackThreadId: options.fallbackThreadId } : {}),
      });
    } catch (error) {
      logger.error(`Could not announce epic event for epic ${String(epic._id)}: ${error}`);
    }
  }
}

export const epicEventsService = new EpicEventsService();
