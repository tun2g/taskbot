import { GroupDecision, SETTINGS_CACHE_SECONDS } from '@tbot/db';
import type { AdminAiOverrideInput, AdminGroupRow } from '@tbot/shared';
import { GROUP_NOTICES, GROUP_STATUS_LABELS, GroupStatus } from '@tbot/shared';
import type { Request } from 'express';
import { Types } from 'mongoose';
import { config } from 'src/config/configuration';
import { LeanGroup, setGroupFields } from 'src/modules/groups/groups.repository';
import { findGroup } from 'src/modules/groups/groups.service';
import { BOT_IN_CHAT, wrongStateMessage } from 'src/modules/groups/helpers/group-status';
import {
  decideGroupStatus,
  markGroupLeft,
  reconsiderRejected,
} from 'src/modules/groups/repositories/actions.repository';
import { leaveChat, notify, updateApprovalCard } from 'src/modules/groups/services/notices.service';
import { groupRows } from 'src/modules/groups/services/rows.service';
import { aiOverrideSet, overrideSnapshot } from 'src/shared/ai-override';
import { writeAudit } from 'src/shared/audit';
import { HttpError } from 'src/shared/http';
import { boardButton, botDisplayName } from 'src/shared/telegram';

export interface ActionInput {
  reason?: string;
  notifyGroup?: boolean;
}

export interface ActionOutcome {
  group: LeanGroup;
  warnings: string[];
}

type ActionRow = AdminGroupRow & { warnings: string[] };

/** The group's list row after an action, plus the Telegram warnings. */
export async function actionResponse(outcome: ActionOutcome): Promise<ActionRow> {
  const [row] = await groupRows([outcome.group]);
  return { ...row, warnings: outcome.warnings };
}

/** approve / reject / suspend / unsuspend: atomic status change, then Telegram side effects (best effort). */
export async function applyDecision(
  req: Request,
  id: Types.ObjectId,
  decision: GroupDecision,
  input: ActionInput,
): Promise<ActionOutcome> {
  const reason = input.reason?.trim() || null;
  const result = await decideGroupStatus(id, decision, reason);
  if (!result.ok) {
    if (result.reason === 'not_found') throw new HttpError(404, "This group doesn't exist (it may have been deleted).");
    throw new HttpError(409, wrongStateMessage(decision, result.current));
  }
  const warnings: string[] = [];
  const g = await findGroup(id);
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
    if (decision === 'reject')
      notified = await notify(g, GROUP_NOTICES.rejected(reason, contact), warnings, 'rejection');
    if (decision === 'suspend') notified = await notify(g, GROUP_NOTICES.suspended(reason, contact), warnings, 'pause');
    if (decision === 'unsuspend') notified = await notify(g, GROUP_NOTICES.unsuspended, warnings, 'resume');
  }

  if (decision === 'approve' || decision === 'reject' || result.from === GroupStatus.PENDING) {
    await updateApprovalCard(g, g.status, reason, warnings);
  }

  let left = false;
  if (decision === 'reject') {
    left = await leaveChat(g.telegramGroupId, warnings);
    if (left) await setGroupFields(id, { botLeftAt: new Date() });
  }

  await writeAudit(req, {
    action: `group.${decision}`,
    targetType: 'group',
    targetId: String(id),
    targetLabel: g.groupName,
    reason,
    details: {
      from: result.from,
      to: g.status,
      notifiedGroup: notified,
      ...(decision === 'reject' ? { botLeft: left } : {}),
      ...(warnings.length ? { warnings } : {}),
    },
  });
  return { group: await findGroup(id), warnings };
}

/** Bot says goodbye (optional), leaves the chat, and the group is marked LEFT (approval kept for a re-add). */
export async function applyLeave(req: Request, id: Types.ObjectId, input: ActionInput): Promise<ActionOutcome> {
  const reason = input.reason?.trim() || null;
  const g = await findGroup(id);
  if (!BOT_IN_CHAT.includes(g.status)) throw new HttpError(409, wrongStateMessage('leave', g.status));
  const warnings: string[] = [];
  const notified =
    input.notifyGroup !== false ? await notify(g, GROUP_NOTICES.leaving(reason), warnings, 'goodbye') : false;
  const left = await leaveChat(g.telegramGroupId, warnings);
  // Unconditional on purpose: the bot's own "I was removed" handler may race us and write the same values.
  await markGroupLeft(id, g.status, reason, new Date());
  await writeAudit(req, {
    action: 'group.leave',
    targetType: 'group',
    targetId: String(id),
    targetLabel: g.groupName,
    reason,
    details: {
      from: g.status,
      to: GroupStatus.LEFT,
      notifiedGroup: notified,
      botLeft: left,
      ...(warnings.length ? { warnings } : {}),
    },
  });
  return { group: await findGroup(id), warnings };
}

/**
 * Clears a rejection. The bot already left the chat and can't rejoin by itself, so nothing happens in Telegram:
 * the group becomes "bot removed, never decided", and the next time someone adds the bot it waits for your approval
 * like a new group. Members stop seeing the rejection reason. Never auto-approves.
 */
export async function applyReconsider(req: Request, id: Types.ObjectId): Promise<ActionOutcome> {
  const g = await findGroup(id);
  // Conditional on the status, so a re-add racing us (rejected → pending) is never overwritten.
  const changed = await reconsiderRejected(id, new Date());
  if (!changed) {
    const current = g.status === GroupStatus.REJECTED ? (await findGroup(id)).status : g.status;
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
    details: {
      from: GroupStatus.REJECTED,
      to: GroupStatus.LEFT,
      clearedReason: g.statusReason ?? null,
      nextAdd: GroupStatus.PENDING,
    },
  });
  return { group: await findGroup(id), warnings: [] };
}

/** Sets the group's AI override and records the before/after in the audit log. */
export async function updateGroupAi(req: Request, id: Types.ObjectId, input: AdminAiOverrideInput) {
  const before = await findGroup(id);
  await setGroupFields(id, aiOverrideSet(input, before.ai));
  const after = await findGroup(id);
  const auditId = await writeAudit(req, {
    action: 'group.ai',
    targetType: 'group',
    targetId: String(id),
    targetLabel: before.groupName,
    reason: after.ai?.reason ?? null,
    details: { before: overrideSnapshot(before.ai), after: overrideSnapshot(after.ai) },
  });
  const [row] = await groupRows([after]);
  return { ...row, appliesWithinSeconds: SETTINGS_CACHE_SECONDS, auditId };
}
