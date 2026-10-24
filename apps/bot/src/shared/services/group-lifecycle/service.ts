import { GROUP_NOTICES, GroupStatus } from '@tbot/shared';
import { configService } from 'src/configs/configuration';
import { Group, IGroup } from 'src/database/models/group.model';
import logger from 'src/shared/logger/logger';
import type { Telegram } from 'telegraf';
import type { User as TelegramUser } from 'telegraf/types';
import {
  ApprovalChat,
  approvalHistory,
  approvalRequired,
  NEW_SUPERGROUP_ANNOUNCE_DELAY_MS,
  statusOnAdd,
} from './approval';
import { claim, memberCount, personName, post, REQUEST_CLAIM_SECONDS } from './helpers';
import { migrateChat } from './migrate';
import { closeOwnerCard, sendOwnerCard } from './owner-card';

export class GroupLifecycleService {
  /**
   * The bot was added to a chat (my_chat_member), or a chat it never saw sent an update (the add was missed).
   * Creates/updates the group, applies the re-add rules and — for a fresh request — posts the pending note once
   * and DMs the owner an Approve / Reject card. `addedBy` is who added the bot, when known.
   */
  async onBotAdded(telegram: Telegram, chat: ApprovalChat, addedBy: TelegramUser | null, botName: string): Promise<IGroup | null> {
    const existing = await Group.findOne({ telegramGroupId: chat.id });
    if (existing?.status === GroupStatus.MIGRATED) return existing;

    const autoApprove = !approvalRequired();
    const target = statusOnAdd(existing, autoApprove);
    const changed = existing?.status !== target;
    const history = approvalHistory(existing);
    const now = new Date();
    // Never-announced supergroup (see NEW_SUPERGROUP_ANNOUNCE_DELAY_MS): addedAt stays empty until the announcement
    // goes out, which also keeps the group gate quiet meanwhile and lets a missed announcement be retried.
    const deferAnnounce =
      chat.type === 'supergroup' &&
      target === GroupStatus.PENDING &&
      (!existing || (existing.status === GroupStatus.PENDING && !existing.addedAt));

    const set: Record<string, unknown> = {
      groupName: chat.title || existing?.groupName || 'Group',
      isForum: Boolean(chat.is_forum),
      status: target,
      ...(deferAnnounce ? {} : { addedAt: now }),
      botLeftAt: null,
      statusBeforeLeft: null,
      memberCount: (await memberCount(telegram, chat.id)) ?? existing?.memberCount ?? null,
    };
    if (addedBy && !addedBy.is_bot) {
      set.addedBy = { telegramUserId: addedBy.id, name: personName(addedBy), username: addedBy.username ?? null };
    }
    if (changed) {
      set.statusChangedAt = now;
      // The old reason belongs to the old decision; a restored suspension keeps its reason.
      if (target !== GroupStatus.SUSPENDED) set.statusReason = null;
      if (target === GroupStatus.ACTIVE && existing?.status !== GroupStatus.LEFT) set.approvedAt = now;
    }

    const group = await Group.findOneAndUpdate(
      { telegramGroupId: chat.id },
      { $set: set, $setOnInsert: { telegramGroupId: chat.id, timezone: configService.timezone || 'UTC' } },
      { upsert: true, new: true, runValidators: true },
    );
    if (!group) return null;

    const restoredFrom = existing?.status === GroupStatus.LEFT && changed ? existing.statusBeforeLeft : null;
    logger.info(`[GroupLifecycle] Bot added to ${chat.id} "${group.groupName}": ${existing?.status ?? 'new'} → ${target}`);

    if (deferAnnounce) {
      // One timer per chat, however many updates arrive in the meantime.
      if (await claim(`group:request-deferred:${chat.id}`, REQUEST_CLAIM_SECONDS)) {
        this.schedule(
          () => this.announceDeferred(telegram, chat, botName, history),
          NEW_SUPERGROUP_ANNOUNCE_DELAY_MS,
        );
      }
    } else if (target === GroupStatus.PENDING) {
      // A PENDING group seen again (duplicate add event) is only re-announced if it was never announced.
      const fresh = changed || !existing?.addedAt;
      if (fresh && (await claim(`group:request:${chat.id}`, REQUEST_CLAIM_SECONDS))) {
        await post(telegram, chat.id, GROUP_NOTICES.pending(botName));
        await this.sendOwnerCard(telegram, group, { history, username: chat.username });
      }
    } else if (restoredFrom === GroupStatus.ACTIVE) {
      await post(telegram, group, GROUP_NOTICES.unsuspended);
    } else if (restoredFrom === GroupStatus.SUSPENDED) {
      await post(telegram, group, GROUP_NOTICES.suspended(group.statusReason, configService.ownerContact || null));
    }
    return group;
  }

  /** Runs `fn` after `ms` (replaced in tests). Errors are logged, never thrown. */
  schedule = (fn: () => Promise<void>, ms: number): void => {
    setTimeout(() => {
      fn().catch((error) => logger.error(`[GroupLifecycle] Deferred announcement failed: ${error}`));
    }, ms).unref?.();
  };

  /**
   * The deferred "waiting for approval" note + owner card of a new supergroup. Skipped when, meanwhile, the chat
   * turned out to be an upgraded group (its doc was merged away), was decided, or was announced by another path.
   */
  async announceDeferred(telegram: Telegram, chat: ApprovalChat, botName: string, history: string | null): Promise<void> {
    const group = await Group.findOneAndUpdate(
      { telegramGroupId: chat.id, status: GroupStatus.PENDING, addedAt: null },
      { $set: { addedAt: new Date() } },
      { new: true },
    );
    if (!group) {
      logger.info(`[GroupLifecycle] ${chat.id}: no announcement needed any more (migrated, decided or announced)`);
      return;
    }
    if (!(await claim(`group:request:${chat.id}`, REQUEST_CLAIM_SECONDS))) return;
    await post(telegram, group, GROUP_NOTICES.pending(botName));
    await this.sendOwnerCard(telegram, group, { history, username: chat.username });
  }

  /** DMs the owner the Approve / Reject card and remembers it so it can be edited after the decision. */
  async sendOwnerCard(telegram: Telegram, group: IGroup, extra: { history?: string | null; username?: string } = {}): Promise<void> {
    return sendOwnerCard(telegram, group, extra);
  }

  /** Edits the owner's card to its final state (no buttons). Best effort: the card may be gone. */
  async closeOwnerCard(telegram: Telegram, group: IGroup, by: 'telegram' | 'admin'): Promise<void> {
    return closeOwnerCard(telegram, group, by);
  }

  /**
   * The bot left or was removed. Active / pending / suspended groups become LEFT (remembering the status, so adding
   * the bot back restores it). Rejected / migrated groups keep their status — that decision stays visible.
   */
  async onBotRemoved(telegram: Telegram, chatId: number): Promise<void> {
    const group = await Group.findOne({ telegramGroupId: chatId });
    if (!group) return;
    const now = new Date();
    const leavable = [GroupStatus.ACTIVE, GroupStatus.PENDING, GroupStatus.SUSPENDED].includes(group.status);
    const updated = await Group.findOneAndUpdate(
      { _id: group._id },
      {
        $set: leavable
          ? { status: GroupStatus.LEFT, statusBeforeLeft: group.status, statusChangedAt: now, botLeftAt: now }
          : { botLeftAt: now },
      },
      { new: true },
    );
    logger.info(`[GroupLifecycle] Bot removed from ${chatId} "${group.groupName}" (was ${group.status})`);
    // A request nobody answered yet: show the owner it's moot instead of leaving live buttons.
    if (updated && group.status === GroupStatus.PENDING) await this.closeOwnerCard(telegram, updated, 'telegram');
  }

  /** Telegram upgraded a basic group to a supergroup: see `migrateChat` in ./migrate. */
  async migrateChat(telegram: Telegram, oldChatId: number, newChatId: number, isForum = false): Promise<void> {
    return migrateChat(telegram, oldChatId, newChatId, isForum);
  }
}

export const groupLifecycleService = new GroupLifecycleService();
