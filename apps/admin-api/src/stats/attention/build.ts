/** Pure rules: turns the loaded numbers into the overview's "Needs attention" items, most severe first. */
import type { AdminAttentionItem } from '@tbot/shared';
import { backgroundJobInfo } from '@tbot/shared';

import { AttentionInput, BASELINE_DAYS, FAILURE_RATE_DANGER, RATE_LIMITED_MIN, unusualRate } from './rules';

const pct = (r: number) => `${Math.round(r * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const waited = (hours: number) => (hours < 48 ? `${Math.floor(hours)} hours` : `${Math.floor(hours / 24)} days`);

/** Background jobs: a failing job means reminders / digests / alerts silently stop. */
function jobsItem(jobs: AttentionInput['jobs']): AdminAttentionItem | null {
  if (jobs === null) {
    return {
      kind: 'failed_jobs',
      severity: 'danger',
      title: 'Background jobs can’t be checked',
      detail: 'The job queue (Redis) isn’t answering, so reminders, digests and your alerts may not be running.',
      link: '/system',
      linkLabel: 'Open System',
    };
  }
  const failing = jobs.filter((j) => j.lastError);
  if (!failing.length) return null;
  const names = failing.map((j) => backgroundJobInfo(j.name, j.cron).label);
  const first = failing[0]!;
  return {
    kind: 'failed_jobs',
    severity: 'danger',
    title: failing.length === 1 ? `“${names[0]}” failed on its last run` : `${failing.length} background jobs failed on their last run`,
    detail: `${failing.length === 1 ? backgroundJobInfo(first.name, first.cron).ifFailing : names.join(', ') + '.'} Error: ${first.lastError}`,
    link: '/system',
    linkLabel: 'See the job errors',
  };
}

/** Where the "refused" item links when no AI request was refused: MCP, or the group that hit the rate limit most. */
function rateLimitedLink(r: AttentionInput['rateLimited']): string {
  if (r.mcp * 2 > r.total) return '/mcp?range=7d';
  return r.topGroup && !r.topGroup.group.deleted ? `/groups/${r.topGroup.group.id}` : '/mcp?range=7d';
}

/** Requests refused by limits today; AI stopped for everyone when the global daily call limit is used up. */
function refusedItem(input: AttentionInput): AdminAttentionItem | null {
  const limitReached = input.callLimit != null && input.ai.providerCalls >= input.callLimit;
  const refusedAi = input.ai.quota;
  if (!limitReached && refusedAi === 0 && input.rateLimited.total < RATE_LIMITED_MIN) return null;
  const parts: string[] = [];
  if (refusedAi > 0) parts.push(`${plural(refusedAi, 'AI request')} refused by a daily AI limit`);
  if (input.rateLimited.total > 0) {
    const where = input.rateLimited.topGroup ? ` (most in “${input.rateLimited.topGroup.group.name}”)` : '';
    parts.push(`${plural(input.rateLimited.total, 'request')} blocked for coming too fast${where}`);
  }
  const link = refusedAi > 0 ? '/ai?range=7d&status=quota' : rateLimitedLink(input.rateLimited);
  return {
    kind: 'refused',
    severity: limitReached ? 'danger' : 'warn',
    title: limitReached
      ? `AI is stopped for everyone until midnight UTC — the daily limit of ${input.callLimit!.toLocaleString('en-US')} calls is used up`
      : 'Requests were refused by limits today',
    detail: `${parts.join('; ') || 'No requests refused yet'}. Raise the limit in Settings if this is expected use.`,
    link: limitReached && refusedAi === 0 ? '/settings' : link,
    linkLabel: refusedAi > 0 ? 'See the refused requests' : link.startsWith('/groups/') ? 'Open the group' : limitReached ? 'Open Settings' : 'See MCP',
  };
}

function aiFailuresItem(input: AttentionInput): AdminAttentionItem | null {
  const ai = unusualRate(input.ai.providerCalls, input.ai.failed + input.ai.invalid, input.aiNorm);
  if (!ai) return null;
  return {
    kind: 'ai_failures',
    severity: ai.rate >= FAILURE_RATE_DANGER ? 'danger' : 'warn',
    title: `${pct(ai.rate)} of AI calls didn’t work today`,
    detail:
      `${plural(input.ai.failed, 'provider error')} and ${plural(input.ai.invalid, 'unusable reply', 'unusable replies')} out of ${plural(input.ai.providerCalls, 'call')}` +
      (ai.normRate != null ? ` — usually ${pct(ai.normRate)} over the last ${BASELINE_DAYS} days.` : '.') +
      ' People get an error instead of an AI answer.',
    link: `/ai?range=7d&status=${input.ai.failed >= input.ai.invalid ? 'failed' : 'invalid'}`,
    linkLabel: 'See the failed calls',
  };
}

function spikeItems(spikes: AttentionInput['spikes']): AdminAttentionItem[] {
  return spikes.slice(0, 3).map((s) => {
    const usual = s.average < 1 ? 'usually almost none' : `usually about ${Math.round(s.average)} a day`;
    return {
      kind: 'ai_spike',
      severity: 'warn',
      title: `Unusual AI use in “${s.group.name}”`,
      detail: `${plural(s.calls, 'AI call')} today — ${usual} over the last ${BASELINE_DAYS} days. You can set a daily AI limit for this group.`,
      link: s.group.deleted ? '/ai?range=7d&groupBy=group' : `/ai?range=7d&groupId=${s.group.id}`,
      linkLabel: 'See its AI calls',
    };
  });
}

function mcpErrorsItem(input: AttentionInput): AdminAttentionItem | null {
  const mcp = unusualRate(input.mcp.calls, input.mcp.failed, input.mcpNorm);
  if (!mcp) return null;
  return {
    kind: 'mcp_errors',
    severity: mcp.rate >= FAILURE_RATE_DANGER ? 'danger' : 'warn',
    title: `${pct(mcp.rate)} of MCP tool calls failed today`,
    detail:
      `${plural(input.mcp.failed, 'failed call')} out of ${plural(input.mcp.calls, 'call')}` +
      (mcp.normRate != null ? ` — usually ${pct(mcp.normRate)}.` : '.') +
      ' AI clients (Claude, Cursor…) get errors back.',
    link: '/mcp?range=7d',
    linkLabel: 'See which tools fail',
  };
}

function pendingItem(pending: AttentionInput['pending']): AdminAttentionItem | null {
  if (pending.count <= 0 || !pending.oldest) return null;
  return {
    kind: 'pending_groups',
    severity: 'warn',
    title:
      pending.count === 1
        ? `“${pending.oldest.name}” has waited ${waited(pending.oldest.hours)} for your approval`
        : `${pending.count} groups have waited over a day for your approval`,
    detail: 'They were told it usually takes less than a day, and can’t use the bot until you decide.',
    link: '/groups?status=pending',
    linkLabel: 'Review them',
  };
}

export function buildAttention(input: AttentionInput): AdminAttentionItem[] {
  const out = [
    jobsItem(input.jobs),
    refusedItem(input),
    aiFailuresItem(input),
    ...spikeItems(input.spikes),
    mcpErrorsItem(input),
    pendingItem(input.pending),
  ].filter((x): x is AdminAttentionItem => x != null);
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : 1));
}
