/** The owner's actions on a group: approve / reject / suspend / unsuspend / leave, reconsider, AI override, delete. */
import { GroupStatus } from '@tbot/shared';

import { findGroup, groupRow } from '../derive/group-row';
import { groups, type MockGroup, recordAudit } from '../fixtures';
import { HttpError, type Route } from '../http';

type Lifecycle = 'approve' | 'reject' | 'suspend' | 'unsuspend' | 'leave';

const ALLOWED_FROM: Record<Lifecycle, GroupStatus[]> = {
  approve: [GroupStatus.PENDING],
  reject: [GroupStatus.PENDING],
  suspend: [GroupStatus.ACTIVE],
  unsuspend: [GroupStatus.SUSPENDED],
  leave: [GroupStatus.ACTIVE, GroupStatus.SUSPENDED, GroupStatus.PENDING],
};

const NEXT_STATUS: Record<Lifecycle, GroupStatus> = {
  approve: GroupStatus.ACTIVE,
  reject: GroupStatus.REJECTED,
  suspend: GroupStatus.SUSPENDED,
  unsuspend: GroupStatus.ACTIVE,
  leave: GroupStatus.LEFT,
};

/** The API's 409 message when the action doesn't fit the group's status. */
function conflictMessage(action: Lifecycle, status: GroupStatus): string {
  const messages: Record<Lifecycle, string> = {
    approve: status === GroupStatus.ACTIVE ? 'This group is already active.' : 'Only groups waiting for approval can be approved.',
    reject: 'Only groups waiting for approval can be rejected.',
    suspend: status === GroupStatus.SUSPENDED ? 'This group is already suspended.' : 'Only active groups can be suspended.',
    unsuspend: 'This group is not suspended.',
    leave: 'The bot is not in this chat.',
  };
  return messages[action];
}

function summaryOf(action: Lifecycle, g: MockGroup): string {
  const verb = action === 'unsuspend' ? 'Unsuspended' : action === 'leave' ? 'Made the bot leave' : action[0]!.toUpperCase() + action.slice(1) + 'd';
  return `${verb} group “${g.name}”`;
}

function changeStatus(g: MockGroup, action: Lifecycle, body: Record<string, unknown>) {
  if (!ALLOWED_FROM[action].includes(g.status)) throw new HttpError(409, conflictMessage(action, g.status));
  if ((action === 'reject' || action === 'suspend') && !String(body.reason ?? '').trim()) {
    throw new HttpError(400, 'A reason is required.');
  }
  g.status = NEXT_STATUS[action];
  g.statusReason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
  g.statusChangedAt = new Date().toISOString();
  if (action === 'approve') g.approvedAt = g.statusChangedAt;
  if (action === 'leave' || action === 'reject') g.botLeftAt = g.statusChangedAt;
  recordAudit({ action: `group.${action}`, summary: summaryOf(action, g), targetType: 'group', targetId: g.id, targetLabel: g.name, reason: g.statusReason, details: null });
  // The bot can fail to post the notice (e.g. it lost permission to send messages).
  const warnings = g.name === 'Freelance Crew' && action === 'approve' ? ['The welcome message could not be posted: the bot is not allowed to send messages in this chat.'] : undefined;
  return { data: groupRow(g), warnings };
}

function reconsider(g: MockGroup) {
  if (g.status !== GroupStatus.REJECTED) throw new HttpError(409, 'Only rejected groups can be reconsidered.');
  g.status = GroupStatus.LEFT;
  g.seed.statusBeforeLeft = GroupStatus.PENDING;
  g.statusReason = null;
  g.statusChangedAt = new Date().toISOString();
  recordAudit({
    at: g.statusChangedAt,
    action: 'group.reconsider',
    summary: `Cleared the rejection of group “${g.name}”`,
    targetType: 'group',
    targetId: g.id,
    targetLabel: g.name,
    details: null,
    changes: ['If the bot is added again, the group waits for your approval like a new one'],
  });
  return { data: { id: g.id, name: g.name, status: g.status, warnings: [] } };
}

function setAi(g: MockGroup, body: Record<string, unknown>) {
  if (typeof body.disabled === 'boolean') g.aiDisabled = body.disabled;
  if ('dailyLimit' in body) g.aiDailyLimit = (body.dailyLimit as number | null) ?? null;
  // Like the API: the reason belongs to the override and is cleared when back to the defaults.
  if (!g.aiDisabled && g.aiDailyLimit == null) g.aiReason = null;
  else if (typeof body.reason === 'string') g.aiReason = body.reason.trim() || null;
  return { data: { ...groupRow(g), appliesWithinSeconds: 30, auditId: null } };
}

function remove(g: MockGroup, confirmName: unknown) {
  if (confirmName !== g.name) throw new HttpError(400, 'The name you typed does not match the group name.');
  groups.splice(groups.indexOf(g), 1);
  return { data: { deleted: true } };
}

export const groupActionRoutes: Route[] = [
  ['POST', /^\/groups\/([^/]+)\/(approve|reject|suspend|unsuspend|leave)$/, ({ params, body }) => changeStatus(findGroup(params[0]!), params[1] as Lifecycle, body)],
  ['POST', /^\/groups\/([^/]+)\/reconsider$/, ({ params }) => reconsider(findGroup(params[0]!))],
  ['PATCH', /^\/groups\/([^/]+)\/ai$/, ({ params, body }) => setAi(findGroup(params[0]!), body)],
  ['DELETE', /^\/groups\/([^/]+)$/, ({ params, body }) => remove(findGroup(params[0]!), body.confirmName)],
];
