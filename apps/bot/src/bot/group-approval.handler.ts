import { GROUP_NOTICES, GROUP_REJECT_REASONS, GROUP_STATUS_LABELS, GroupRejectReasonKey, GroupStatus, ownerApprovalText } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { configService } from 'src/configs/configuration';
import { decideGroup } from 'src/database/group-status';
import { IGroup } from 'src/database/models/group.model';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import {
  APPROVE_DATA,
  approvalInfo,
  approvalKeyboard,
  BACK_DATA,
  REJECT_DATA,
  REJECT_WITH_REASON_DATA,
  rejectReasonKeyboard,
} from 'src/shared/services/group-lifecycle.service';
import { sendGroupNotice } from 'src/shared/services/group-messenger.service';
import { boardButton } from 'src/shared/utils/app-links';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import mongoose from 'mongoose';
import { AdminAuditLog } from 'src/database/models/admin-audit-log.model';

export const ONLY_OWNER_TEXT = 'Only the bot owner can do this.';

async function answer(ctx: BotContext, text: string): Promise<void> {
  try {
    await ctx.answerCbQuery(text);
  } catch {
    // already answered or expired
  }
}

/** The audit action that put a group in its current status (approve → active, reject → rejected). */
const DECISION_ACTION: Partial<Record<GroupStatus, string>> = {
  [GroupStatus.ACTIVE]: 'group.approve',
  [GroupStatus.REJECTED]: 'group.reject',
};

/**
 * Where the group's current approve / reject decision was made, from the latest audit entry for it: Telegram
 * decisions are logged with `details.via = 'telegram'`, the admin app's without. Null when unknown.
 */
export async function decidedVia(group: IGroup): Promise<'telegram' | 'admin' | null> {
  const action = DECISION_ACTION[group.status];
  if (!action) return null;
  try {
    const last = await AdminAuditLog.findOne({ targetType: 'group', targetId: String(group._id), action })
      .sort({ createdAt: -1 })
      .select('details')
      .lean<{ details?: { via?: string } | null }>();
    if (!last) return null;
    return last.details?.via === 'telegram' ? 'telegram' : 'admin';
  } catch (error) {
    logger.warn(`[GroupApproval] Could not read the audit log: ${error}`);
    return null;
  }
}

/** Replaces the card with its final state; no buttons, so it can't be tapped again. */
async function showDecided(ctx: BotContext, group: IGroup, by: 'telegram' | 'admin' | null): Promise<void> {
  try {
    await ctx.editMessageText(ownerApprovalText(approvalInfo(group), { status: group.status, by, reason: group.statusReason }), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    if (!String(error).includes('message is not modified')) logger.warn(`[GroupApproval] Could not edit the card: ${error}`);
  }
}

/** Posts in the group; never fails the decision (the bot may already be gone). */
async function tellGroup(ctx: BotContext, group: IGroup, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
  try {
    await sendGroupNotice(ctx.telegram, group, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
  } catch (error) {
    logger.warn(`[GroupApproval] Could not post in group ${group.telegramGroupId}: ${error}`);
  }
}

/** Swaps the card's buttons (Approve / Reject ↔ the reject reasons); the text stays. */
async function setButtons(ctx: BotContext, markup: InlineKeyboardMarkup): Promise<void> {
  try {
    await ctx.editMessageReplyMarkup(markup);
  } catch (error) {
    if (!String(error).includes('message is not modified')) logger.warn(`[GroupApproval] Could not change the card's buttons: ${error}`);
  }
}

/**
 * The owner tapped a button on a new-group card in their DM:
 * - `gapp:ok:<id>` ✅ Approve — decides right away;
 * - `gapp:no:<id>` 🚫 Reject — asks why first (the group is told the reason before the bot leaves);
 * - `gapp:nr:<id>:<key>` a reason (or `-` for none) — rejects; `gapp:bk:<id>` back to Approve / Reject.
 * The decision is atomic, so a double tap or the admin app deciding first just refreshes the card.
 */
export async function handleGroupApprovalCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : '';
  const approve = data.startsWith(APPROVE_DATA);
  const askReason = data.startsWith(REJECT_DATA);
  const withReason = data.startsWith(REJECT_WITH_REASON_DATA);
  const back = data.startsWith(BACK_DATA);
  if (!approve && !askReason && !withReason && !back) return;

  const ownerId = configService.botOwnerTelegramId;
  if (!ownerId || ctx.from?.id !== ownerId) {
    await answer(ctx, ONLY_OWNER_TEXT);
    return;
  }

  const prefix = approve ? APPROVE_DATA : askReason ? REJECT_DATA : withReason ? REJECT_WITH_REASON_DATA : BACK_DATA;
  const [groupId, reasonKey] = data.slice(prefix.length).split(':');
  if (askReason || back) {
    await answer(ctx, askReason ? 'Why? The group sees the reason you pick.' : '');
    await setButtons(ctx, askReason ? rejectReasonKeyboard(groupId) : approvalKeyboard(groupId));
    return;
  }
  const reason = withReason ? (GROUP_REJECT_REASONS[reasonKey as GroupRejectReasonKey] ?? null) : null;

  try {
    const result = mongoose.Types.ObjectId.isValid(groupId)
      ? await (approve ? decideGroup(groupId, 'approve') : decideGroup(groupId, 'reject', reason))
      : ({ ok: false, reason: 'not_found' } as const);

    if (!result.ok) {
      if (result.reason === 'not_found') {
        await answer(ctx, 'This group no longer exists.');
        await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
        return;
      }
      await answer(ctx, `Already decided — now: ${GROUP_STATUS_LABELS[result.current]}.`);
      const current = await groupService.findGroupById(new mongoose.Types.ObjectId(groupId));
      // A double tap here reads "Approved here"; a decision made in the admin app "… in the admin app".
      if (current) await showDecided(ctx, current, await decidedVia(current));
      return;
    }

    const group = result.group;
    // Logged first (before the Telegram calls), so a quick second tap already sees where this was decided.
    void AdminAuditLog.create({
      action: approve ? 'group.approve' : 'group.reject',
      targetType: 'group',
      targetId: String(group._id),
      targetLabel: group.groupName,
      reason: group.statusReason ?? null,
      details: { via: 'telegram' },
    }).catch((error) => logger.warn(`[GroupApproval] Could not write the audit log: ${error}`));
    await answer(ctx, approve ? '✅ Approved' : '🚫 Rejected — the bot is leaving the group');
    await showDecided(ctx, group, 'telegram');
    if (group.status === GroupStatus.ACTIVE) {
      const board = boardButton(String(group._id));
      const text = GROUP_NOTICES.approved(ctx.botInfo?.first_name || 'TaskBot', { forum: Boolean(group.isForum) });
      await tellGroup(ctx, group, text, board ? { inline_keyboard: [[board]] } : undefined);
    } else {
      await tellGroup(ctx, group, GROUP_NOTICES.rejected(group.statusReason, configService.ownerContact || null));
      await ctx.telegram.leaveChat(group.telegramGroupId).catch((error) => {
        logger.warn(`[GroupApproval] Could not leave group ${group.telegramGroupId}: ${error}`);
      });
    }
    logger.info(`[GroupApproval] Owner ${approve ? 'approved' : 'rejected'} "${group.groupName}" (${group.telegramGroupId})`);
  } catch (error) {
    logger.error(`[GroupApproval] ${error}`);
    await answer(ctx, 'Something went wrong. Please try again.');
  }
}
