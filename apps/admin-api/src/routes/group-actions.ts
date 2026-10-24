import { decideGroup, Group, GroupDecision, GROUP_TRANSITIONS } from '@tbot/db';
import { GROUP_NOTICES, GROUP_STATUS_LABELS, GroupStatus, ownerApprovalText } from '@tbot/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { GROUP_FIELDS, LeanGroup, normalizeGroup } from 'src/routes/group-rows';
import { writeAudit } from 'src/shared/audit';
import { HttpError } from 'src/shared/http';
import { config } from 'src/config/configuration';
import { boardButton, botDisplayName, InlineKeyboard, telegram } from 'src/shared/telegram';

export interface ActionInput {
  reason?: string;
  notifyGroup?: boolean;
}

export interface ActionOutcome {
  group: LeanGroup;
  warnings: string[];
}

const ALREADY: Record<GroupDecision, string> = {
  approve: 'This group is already active.',
  reject: 'This group was already rejected.',
  suspend: 'This group is already suspended.',
  unsuspend: 'This group is not suspended.',
};

const VERB: Record<GroupDecision | 'leave', string> = {
  approve: 'approve',
  reject: 'reject',
  suspend: 'suspend',
  unsuspend: 'unsuspend',
  leave: 'remove the bot from',
};

/** 409 message when a decision doesn't apply to the group's current status. */
export function wrongStateMessage(action: GroupDecision | 'leave', current: GroupStatus): string {
  if (action !== 'leave' && GROUP_TRANSITIONS[action].to === current) return ALREADY[action];
  if (action === 'unsuspend' && current !== GroupStatus.SUSPENDED) return ALREADY.unsuspend;
  if (action === 'leave') return `The bot is not in this group (status: “${GROUP_STATUS_LABELS[current]}”).`;
  return `You can't ${VERB[action]} this group while its status is “${GROUP_STATUS_LABELS[current]}”.`;
}

/** Statuses in which the bot is still a member of the chat. */
export const BOT_IN_CHAT = [GroupStatus.PENDING, GroupStatus.ACTIVE, GroupStatus.SUSPENDED];

async function loadGroup(id: Types.ObjectId): Promise<LeanGroup> {
  const g = await Group.findById(id).select(GROUP_FIELDS).lean<LeanGroup>();
  if (!g) throw new HttpError(404, "This group doesn't exist (it may have been deleted).");
  return normalizeGroup(g);
}

/**
 * Posts a group-wide notice where everyone sees it: the main chat (General in a forum — the bot's own approval /
 * pause notices go there too; the "Task events" topic is for task updates). If General is closed to the bot,
 * falls back to the group's events topic when it has one.
 */
async function notify(g: LeanGroup, text: string, warnings: string[], what: string, replyMarkup?: InlineKeyboard) {
  let r = await telegram.sendMessage(g.telegramGroupId, text, replyMarkup);
  if (!r.ok && g.isForum && g.eventsTopicId && /TOPIC_CLOSED/i.test(r.error)) {
    r = await telegram.sendMessage(g.telegramGroupId, text, replyMarkup, g.eventsTopicId);
  }
  if (!r.ok) warnings.push(`Couldn't post the ${what} message in the group (${r.error}).`);
  return r.ok;
}

async function leaveChat(chatId: number, warnings: string[]): Promise<boolean> {
  const r = await telegram.leaveChat(chatId);
  if (!r.ok) warnings.push(`Couldn't make the bot leave the chat (${r.error}). Remove it from the group in Telegram if it is still there.`);
  return r.ok;
}

/** Rewrites the owner's DM approval card with the outcome and removes its buttons. */
async function updateApprovalCard(g: LeanGroup, status: GroupStatus, reason: string | null, warnings: string[]) {
  if (!g.approvalMessage) return;
  const chat = await telegram.getChat(g.telegramGroupId);
  const link = chat.ok && chat.result.username ? `https://t.me/${chat.result.username}` : null;
  const addedBy = g.addedBy ? (g.addedBy.username ? `@${g.addedBy.username}` : g.addedBy.name) : null;
  const text = ownerApprovalText(
    { groupName: g.groupName, addedBy, memberCount: g.memberCount ?? null, isForum: !!g.isForum, link },
    { status, by: 'admin', reason },
  );
  const r = await telegram.editMessageText(g.approvalMessage.chatId, g.approvalMessage.messageId, text);
  if (!r.ok && !/not modified/i.test(r.error)) warnings.push(`Couldn't update the approval message in your Telegram DM (${r.error}).`);
}

/** approve / reject / suspend / unsuspend: atomic status change, then Telegram side effects (best effort). */
export async function applyDecision(req: Request, id: Types.ObjectId, decision: GroupDecision, input: ActionInput): Promise<ActionOutcome> {
  const reason = input.reason?.trim() || null;
  const result = await decideGroup(id, decision, reason);
  if (!result.ok) {
    if (result.reason === 'not_found') throw new HttpError(404, "This group doesn't exist (it may have been deleted).");
    throw new HttpError(409, wrongStateMessage(decision, result.current));
  }
  const warnings: string[] = [];
  const g = await loadGroup(id);
  const notifyGroup = input.notifyGroup !== false;
  let notified = false;

  if (notifyGroup) {
    const contact = config.ownerContact || null;
    if (decision === 'approve') {
      // Same message and button as approving from the owner's Telegram DM.
      const board = await boardButton(String(g._id));
      const text = GROUP_NOTICES.approved(await botDisplayName(), { forum: !!g.isForum });
      notified = await notify(g, text, warnings, 'approval', board ? { inline_keyboard: [[board]] } : undefined);
    }
    if (decision === 'reject') notified = await notify(g, GROUP_NOTICES.rejected(reason, contact), warnings, 'rejection');
    if (decision === 'suspend') notified = await notify(g, GROUP_NOTICES.suspended(reason, contact), warnings, 'pause');
    if (decision === 'unsuspend') notified = await notify(g, GROUP_NOTICES.unsuspended, warnings, 'resume');
  }

  if (decision === 'approve' || decision === 'reject' || result.from === GroupStatus.PENDING) {
    await updateApprovalCard(g, g.status, reason, warnings);
  }

  let left = false;
  if (decision === 'reject') {
    left = await leaveChat(g.telegramGroupId, warnings);
    if (left) await Group.updateOne({ _id: id }, { $set: { botLeftAt: new Date() } });
  }

  await writeAudit(req, {
    action: `group.${decision}`,
    targetType: 'group',
    targetId: String(id),
    targetLabel: g.groupName,
    reason,
    details: { from: result.from, to: g.status, notifiedGroup: notified, ...(decision === 'reject' ? { botLeft: left } : {}), ...(warnings.length ? { warnings } : {}) },
  });
  return { group: await loadGroup(id), warnings };
}

/** Bot says goodbye (optional), leaves the chat, and the group is marked LEFT (approval kept for a re-add). */
export async function applyLeave(req: Request, id: Types.ObjectId, input: ActionInput): Promise<ActionOutcome> {
  const reason = input.reason?.trim() || null;
  const g = await loadGroup(id);
  if (!BOT_IN_CHAT.includes(g.status)) throw new HttpError(409, wrongStateMessage('leave', g.status));
  const warnings: string[] = [];
  const notified = input.notifyGroup !== false ? await notify(g, GROUP_NOTICES.leaving(reason), warnings, 'goodbye') : false;
  const left = await leaveChat(g.telegramGroupId, warnings);
  const now = new Date();
  // Unconditional on purpose: the bot's own "I was removed" handler may race us and write the same values.
  await Group.updateOne(
    { _id: id },
    { $set: { status: GroupStatus.LEFT, statusBeforeLeft: g.status, botLeftAt: now, statusChangedAt: now, statusReason: reason } },
  );
  await writeAudit(req, {
    action: 'group.leave',
    targetType: 'group',
    targetId: String(id),
    targetLabel: g.groupName,
    reason,
    details: { from: g.status, to: GroupStatus.LEFT, notifiedGroup: notified, botLeft: left, ...(warnings.length ? { warnings } : {}) },
  });
  return { group: await loadGroup(id), warnings };
}

/**
 * Clears a rejection. The bot already left the chat and can't rejoin by itself, so nothing happens in Telegram:
 * the group becomes "bot removed, never decided", and the next time someone adds the bot it waits for your approval
 * like a new group. Members stop seeing the rejection reason. Never auto-approves.
 */
export async function applyReconsider(req: Request, id: Types.ObjectId): Promise<ActionOutcome> {
  const g = await loadGroup(id);
  const now = new Date();
  // Conditional on the status, so a re-add racing us (rejected → pending) is never overwritten.
  const res = await Group.updateOne(
    { _id: id, status: GroupStatus.REJECTED },
    { $set: { status: GroupStatus.LEFT, statusBeforeLeft: GroupStatus.PENDING, statusChangedAt: now, statusReason: null } },
  );
  if (!res.modifiedCount) {
    const current = g.status === GroupStatus.REJECTED ? (await loadGroup(id)).status : g.status;
    throw new HttpError(
      409,
      current === GroupStatus.REJECTED
        ? 'This group could not be changed. Please try again.'
        : `Only rejected groups can be reconsidered (this one is “${GROUP_STATUS_LABELS[current]}”).`,
    );
  }
  await writeAudit(req, {
    action: 'group.reconsider',
    targetType: 'group',
    targetId: String(id),
    targetLabel: g.groupName,
    reason: null,
    details: { from: GroupStatus.REJECTED, to: GroupStatus.LEFT, clearedReason: g.statusReason ?? null, nextAdd: GroupStatus.PENDING },
  });
  return { group: await loadGroup(id), warnings: [] };
}
