/** The overview's "needs attention" list — same rules as apps/admin-api/src/stats/attention.ts, applied to the fixtures. */
import type { AdminAttentionItem } from '@tbot/shared';
import { backgroundJobInfo, GroupStatus } from '@tbot/shared';

import { aiCalls, dayStr, groups, HOUR, now } from '../fixtures';

import { systemStatus } from './system';

function failedJobs(): AdminAttentionItem | null {
  const failing = systemStatus().jobs.filter((j) => j.lastError);
  if (!failing.length) return null;
  const info = backgroundJobInfo(failing[0]!.name, failing[0]!.cron);
  return {
    kind: 'failed_jobs',
    severity: 'danger',
    title: `“${info.label}” failed on its last run`,
    detail: `${info.ifFailing} Error: ${failing[0]!.lastError}`,
    link: '/system',
    linkLabel: 'See the job errors',
  };
}

function refusedToday(): AdminAttentionItem | null {
  const quota = aiCalls.filter((c) => c.at.startsWith(dayStr(0)) && c.status === 'quota').length;
  const rateLimited = 24;
  if (quota === 0 && rateLimited < 20) return null;
  const parts = [
    quota > 0 ? `${quota} AI request${quota === 1 ? '' : 's'} refused by a daily AI limit` : null,
    `${rateLimited} requests blocked for coming too fast (most in “Saigon Devs”)`,
  ].filter(Boolean);
  return {
    kind: 'refused',
    severity: 'warn',
    title: 'Requests were refused by limits today',
    detail: `${parts.join('; ')}. Raise the limit in Settings if this is expected use.`,
    link: quota > 0 ? '/ai?range=7d&status=quota' : `/groups/${groups[1]!.id}`,
    linkLabel: quota > 0 ? 'See the refused requests' : 'Open the group',
  };
}

function pendingTooLong(): AdminAttentionItem | null {
  const waiting = groups.filter((g) => g.status === GroupStatus.PENDING && g.addedAt && now - Date.parse(g.addedAt) > 24 * HOUR);
  if (!waiting.length) return null;
  const oldest = [...waiting].sort((a, b) => (a.addedAt ?? '').localeCompare(b.addedAt ?? ''))[0]!;
  const hours = (now - Date.parse(oldest.addedAt!)) / HOUR;
  return {
    kind: 'pending_groups',
    severity: 'warn',
    title:
      waiting.length === 1
        ? `“${oldest.name}” has waited ${hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`} for your approval`
        : `${waiting.length} groups have waited over a day for your approval`,
    detail: 'They were told it usually takes less than a day, and can’t use the bot until you decide.',
    link: '/groups?status=pending',
    linkLabel: 'Review them',
  };
}

export function attention(): AdminAttentionItem[] {
  const items = [failedJobs(), refusedToday(), pendingTooLong()].filter((x): x is AdminAttentionItem => x != null);
  return items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : 1));
}
