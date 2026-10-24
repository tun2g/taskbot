import { AdminAuditLog } from '@tbot/db';
import type { AdminAuditEntry } from '@tbot/shared';
import type { Request } from 'express';
import logger from 'src/shared/logger';

export interface AuditInput {
  action: string;
  targetType: AdminAuditEntry['targetType'];
  targetId?: string | null;
  /** Snapshot of the target's name now (groups get renamed or deleted). */
  targetLabel?: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
}

/** Records an owner action and returns its id (null when it couldn't be saved). Never fails the request: the change already happened. */
export async function writeAudit(req: Request | null, input: AuditInput): Promise<string | null> {
  try {
    const doc = await AdminAuditLog.create({
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel ?? null,
      reason: input.reason?.trim() ? input.reason.trim().slice(0, 500) : null,
      details: input.details ?? null,
      ip: req?.ip ?? null,
    });
    const id = (doc as { _id?: unknown } | null)?._id;
    return id ? String(id) : null;
  } catch (err) {
    logger.error(`Failed to write audit log (${input.action}): ${err}`);
    return null;
  }
}

const quoted = (label: string | null | undefined) => (label ? `“${label}”` : '');

/** A plain sentence for the audit list, e.g. "Suspended group “Acme Mobile Team”". */
export function auditSummary(action: string, targetLabel: string | null | undefined): string {
  const q = quoted(targetLabel);
  const withTarget = (verb: string, noun: string) => `${verb} ${noun}${q ? ` ${q}` : ''}`;
  switch (action) {
    case 'auth.login':
      return 'Signed in to the admin app';
    case 'auth.logout_all':
      return 'Signed out of all admin sessions';
    case 'group.approve':
      return withTarget('Approved', 'group');
    case 'group.reject':
      return withTarget('Rejected', 'group');
    case 'group.suspend':
      return withTarget('Suspended', 'group');
    case 'group.unsuspend':
      return withTarget('Unsuspended', 'group');
    case 'group.leave':
      return withTarget('Removed the bot from', 'group');
    case 'group.delete':
      return withTarget('Deleted', 'group');
    case 'group.ai':
      return withTarget('Changed AI limits for', 'group');
    case 'user.ai':
      return withTarget('Changed AI limits for', 'user');
    case 'user.revoke_tokens':
      return `Revoked all MCP tokens of ${targetLabel ?? 'a user'}`;
    case 'token.revoke':
      return `Revoked one MCP token of ${targetLabel ?? 'a user'}`;
    case 'settings.ai.update':
      return 'Changed AI settings';
    default:
      return `${action}${q ? ` ${q}` : ''}`;
  }
}

// ── Plain-language "what changed" lines for the audit list ─────────────────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const count = (v: unknown, one: string, many = `${one}s`) => {
  const x = num(v) ?? 0;
  return `${x.toLocaleString('en-US')} ${x === 1 ? one : many}`;
};
const limitText = (v: unknown, none: string) => (num(v) === null ? none : num(v)!.toLocaleString('en-US'));
const usdText = (v: unknown, none: string) => (num(v) === null ? none : `$${num(v)!.toFixed(2)}`);

function aiOverrideChanges(details: Obj): string[] {
  const before = isObj(details.before) ? details.before : {};
  const after = isObj(details.after) ? details.after : {};
  const out: string[] = [];
  if (!!before.disabled !== !!after.disabled) out.push(after.disabled ? 'AI turned off' : 'AI turned back on');
  if ((before.dailyLimit ?? null) !== (after.dailyLimit ?? null)) {
    out.push(`Daily AI limit: ${limitText(before.dailyLimit, 'default')} → ${limitText(after.dailyLimit, 'default')}`);
  }
  if ((before.reason ?? null) !== (after.reason ?? null) && out.length === 0) {
    out.push(after.reason ? `Reason changed to “${String(after.reason)}”` : 'Reason removed');
  }
  return out.length ? out : ['Nothing changed'];
}

const SETTING_FIELDS: { key: string; label: string; fmt: (v: unknown) => string }[] = [
  { key: 'dailyBudgetUsd', label: 'Daily budget', fmt: (v) => usdText(v, 'none') },
  { key: 'alertAtPercent', label: 'Alert at', fmt: (v) => (num(v) === null ? '—' : `${num(v)}%`) },
  { key: 'dailyCallLimit', label: 'Daily call limit', fmt: (v) => limitText(v, 'server default') },
  { key: 'userDailyLimit', label: 'Per-person daily limit', fmt: (v) => limitText(v, 'server default') },
];

function settingsChanges(details: Obj): string[] {
  const before = isObj(details.before) ? details.before : {};
  const after = isObj(details.after) ? details.after : {};
  const out: string[] = [];
  for (const f of SETTING_FIELDS) {
    const b = before[f.key] ?? null;
    const a = after[f.key] ?? null;
    if (b !== a) out.push(`${f.label}: ${f.fmt(b)} → ${f.fmt(a)}`);
  }
  const pb = isObj(before.pricing) ? before.pricing : {};
  const pa = isObj(after.pricing) ? after.pricing : {};
  for (const model of new Set([...Object.keys(pb), ...Object.keys(pa)])) {
    if (!(model in pb)) out.push(`Price added for ${model}`);
    else if (!(model in pa)) out.push(`Price removed for ${model}`);
    else if (JSON.stringify(pb[model]) !== JSON.stringify(pa[model])) out.push(`Price changed for ${model}`);
  }
  return out.length ? out : ['Nothing changed'];
}

/** Lines such as "Daily call limit: 500 → 200" or "Removed 12 tasks…" built from an entry's details. */
export function auditChanges(action: string, details: Obj | null | undefined): string[] {
  if (!isObj(details)) return [];
  const out: string[] = [];
  switch (action) {
    case 'group.ai':
    case 'user.ai':
      out.push(...aiOverrideChanges(details));
      break;
    case 'settings.ai.update':
      out.push(...settingsChanges(details));
      break;
    case 'group.delete':
      out.push(
        `Removed ${count(details.tasks, 'task')}, ${count(details.epics, 'epic')}, ${count(details.members, 'member link')} and ${count(details.activities, 'activity entry', 'activity entries')}; revoked ${count(details.tokens, 'MCP token')}`,
      );
      break;
    case 'user.revoke_tokens':
      out.push(`${count(details.revoked, 'token')} revoked`);
      break;
    case 'token.revoke': {
      const name = typeof details.name === 'string' ? `“${details.name}”` : 'A token';
      const prefix = typeof details.prefix === 'string' ? ` (${details.prefix}…)` : '';
      const where = typeof details.groupName === 'string' ? `worked in ${details.groupName}` : 'worked in all their groups';
      out.push(`${name}${prefix} revoked — it ${where}; their other tokens keep working`);
      break;
    }
  }
  if (details.via === 'telegram') out.push('Decided from the approval message in your Telegram DM');
  if (details.notifiedGroup === false) out.push('The group was not told in Telegram');
  if (details.botLeft === false) out.push('The bot could not leave the chat');
  if (Array.isArray(details.warnings)) for (const w of details.warnings) if (typeof w === 'string') out.push(w);
  return out;
}
