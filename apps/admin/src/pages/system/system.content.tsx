import type { AdminSystemStatus, UsageChannel } from '@tbot/shared';
import { backgroundJobInfo } from '@tbot/shared';
import type { ReactNode } from 'react';

import { Badge, type Tone } from '@/components/ui/badge';
import { Card, CardHeader, PageHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, Notice, PageSkeleton } from '@/components/ui/states';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { RelativeTime } from '@/components/ui/values';
import { cn } from '@/lib/cn';
import { formatNumber, formatRelative, plural } from '@/lib/format';
import { CHANNEL_LABELS } from '@/lib/labels';

import { describeCron } from './cron';

const HOUR = 3_600_000;
/** Fewer requests than this per hour is too little to call silence unusual. */
const BUSY_HOUR = 5;
/** A waiting job older than this means nothing is processing the queue. */
const STUCK_SECONDS = 10 * 60;

function StatusCard({ title, badge, value, children }: { title: string; badge: { tone: Tone; text: string }; value: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-text-2">{title}</span>
        <Badge tone={badge.tone}>{badge.text}</Badge>
      </div>
      <div className="mt-1.5 text-xl font-semibold text-text tabular">{value}</div>
      <div className="mt-2 space-y-1.5 text-[13px] leading-relaxed text-text-3">{children}</div>
    </div>
  );
}

const latency = (ms: number | null) => (ms == null ? 'No answer' : `${formatNumber(ms)} ms`);

/** Is the bot alive? Compares the last hour with what's usual at this hour, and channels with each other. */
function botActivity(d: AdminSystemStatus) {
  const since = d.lastEventAt ? Date.now() - new Date(d.lastEventAt).getTime() : null;
  const a = d.activity;
  if (a) {
    if (a.lastHour > 0)
      return {
        badge: { tone: 'good' as Tone, text: 'Active' },
        text: `${plural(a.lastHour, 'request')} in the last hour (usually about ${formatNumber(Math.round(a.usualThisHour))} at this time of day).`,
      };
    if (a.usualThisHour >= BUSY_HOUR)
      return {
        badge: { tone: 'danger' as Tone, text: 'Unusually quiet' },
        text: `No requests in the last hour, but there are usually about ${formatNumber(Math.round(a.usualThisHour))} at this time of day. Check that the bot is running and Telegram can reach it.`,
      };
    return {
      badge: { tone: 'neutral' as Tone, text: 'Quiet' },
      text: `No requests in the last hour — normal for this time of day (usually ${a.usualThisHour < 1 ? 'almost none' : `about ${formatNumber(Math.round(a.usualThisHour))}`}).`,
    };
  }
  const quiet = since == null || since > HOUR;
  return {
    badge: { tone: (quiet ? 'warn' : 'good') as Tone, text: quiet ? 'Quiet' : 'Active' },
    text: quiet
      ? 'Nothing recorded for over an hour. That can be normal at night — if not, check the bot is running.'
      : 'The last time anyone used the bot in any group.',
  };
}

const CHANNEL_ORDER: UsageChannel[] = ['telegram', 'app', 'mcp'];

/** Telegram silent while the Mini App / MCP are busy = Telegram updates aren't reaching the bot (webhook). */
function telegramStalled(byChannel: Partial<Record<UsageChannel, string>> | undefined): boolean {
  if (!byChannel) return false;
  const age = (c: UsageChannel) => (byChannel[c] ? Date.now() - new Date(byChannel[c]!).getTime() : Infinity);
  return age('telegram') > 6 * HOUR && Math.min(age('app'), age('mcp')) < HOUR;
}

type QueueKey = 'waiting' | 'active' | 'delayed' | 'failed';

export function SystemContent(props: {
  data: AdminSystemStatus | undefined;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  retrying: boolean;
  updatedAt: number;
}) {
  const header = (
    <PageHeader
      title="System"
      subtitle="Is the bot healthy? Database, cache, background jobs and whether people are reaching the bot right now."
      actions={
        props.updatedAt > 0 && (
          <span className="text-[13px] text-text-3">
            Refreshes every 30 seconds · checked {formatRelative(new Date(props.updatedAt))}
          </span>
        )
      }
    />
  );
  if (props.isLoading)
    return (
      <>
        {header}
        <PageSkeleton />
      </>
    );
  if (props.error || !props.data)
    return (
      <>
        {header}
        <ErrorState
          title="Couldn’t check the system."
          message={`${props.error ?? 'No data.'} The admin API itself may be down — the bot can still be running.`}
          onRetry={props.onRetry}
          retrying={props.retrying}
        />
      </>
    );

  const d = props.data;
  const activity = botActivity(d);
  const stalled = telegramStalled(d.lastEventByChannel);
  const q = d.queue;
  const failed24h = q ? (q.failedLast24h ?? q.failed) : 0;
  const stuck = !!q && (q.oldestWaitingSeconds ?? 0) > STUCK_SECONDS;
  const failingJobs = d.jobs.filter((j) => j.lastError);

  const queueCells: { key: QueueKey; label: string; value: number; bad: boolean; hint: string }[] = q
    ? [
        {
          key: 'waiting',
          label: 'Waiting',
          value: q.waiting,
          bad: stuck,
          hint: stuck
            ? `The oldest has waited ${formatRelative(new Date(Date.now() - (q.oldestWaitingSeconds ?? 0) * 1000)).replace(' ago', '')} — nothing is processing jobs. Restart the bot.`
            : 'Due now, about to start. Normally 0, or a few for a moment on the hour.',
        },
        { key: 'active', label: 'Running', value: q.active, bad: false, hint: 'Being processed right now. Normally 0–3.' },
        {
          key: 'delayed',
          label: 'Scheduled',
          value: q.delayed,
          bad: false,
          hint: `The next run of each scheduled job (${formatNumber(d.jobs.length)} below), plus retries. This is normal.`,
        },
        {
          key: 'failed',
          label: q.failedLast24h != null ? 'Failed (last 24 h)' : 'Failed (kept)',
          value: failed24h,
          bad: failed24h > 0,
          hint:
            failed24h > 0
              ? 'See which job and why in the table below.'
              : q.failedLast24h != null && q.failed > 0
                ? `None recently. ${formatNumber(q.failed)} older failures are kept in the history.`
                : 'Normally 0.',
        },
      ]
    : [];

  return (
    <>
      {header}
      <div className="space-y-4">
        {(!d.mongo.ok || !d.redis.ok) && (
          <Notice tone="warn">
            {!d.mongo.ok ? 'The database is not responding — the bot can’t read or save tasks. ' : ''}
            {!d.redis.ok ? 'The cache is not responding — sessions, rate limits and scheduled jobs (reminders, digests) are affected.' : ''}
          </Notice>
        )}
        {stalled && (
          <Notice tone="warn">
            Nothing has come in from Telegram chats for over 6 hours, while the Mini App and MCP are in use. Telegram
            messages may not be reaching the bot — check the bot’s webhook and logs.
          </Notice>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatusCard title="Database (MongoDB)" badge={{ tone: d.mongo.ok ? 'good' : 'danger', text: d.mongo.ok ? 'OK' : 'Down' }} value={latency(d.mongo.latencyMs)}>
            <p>Stores tasks, groups and people. Time to answer a ping — under ~50 ms is healthy.</p>
          </StatusCard>
          <StatusCard title="Cache (Redis)" badge={{ tone: d.redis.ok ? 'good' : 'danger', text: d.redis.ok ? 'OK' : 'Down' }} value={latency(d.redis.latencyMs)}>
            <p>Holds sessions, rate limits and the job queue. Time to answer a ping — under ~20 ms is healthy.</p>
          </StatusCard>
          <StatusCard title="People reaching the bot" badge={activity.badge} value={<RelativeTime value={d.lastEventAt} never="No activity yet" />}>
            <p>Last request from anyone. {activity.text}</p>
            {d.lastEventByChannel && (
              <ul className="space-y-0.5 border-t border-border pt-1.5">
                {CHANNEL_ORDER.map((c) => (
                  <li key={c} className="flex justify-between gap-2">
                    <span>{CHANNEL_LABELS[c]}</span>
                    <span className={cn('text-text-2', c === 'telegram' && stalled && 'font-medium text-warn')}>
                      <RelativeTime value={d.lastEventByChannel?.[c]} never="Not in 7 days" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </StatusCard>
        </div>

        <Card>
          <CardHeader
            title="Job queue"
            subtitle="Background work (reminders, digests, dashboard numbers) waits here until the bot runs it."
            action={q && <Badge tone={stuck || failed24h > 0 ? 'danger' : 'good'}>{stuck ? 'Stuck' : failed24h > 0 ? 'Failures' : 'Healthy'}</Badge>}
          />
          {q ? (
            <div className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-4">
              {queueCells.map((c) => (
                <div key={c.key} className="bg-surface px-5 py-3">
                  <div className="text-[13px] font-medium text-text-2">{c.label}</div>
                  <div className={cn('mt-0.5 text-lg font-semibold tabular', c.bad ? 'text-danger' : 'text-text')}>{formatNumber(c.value)}</div>
                  <div className="mt-0.5 text-[13px] text-text-3">{c.hint}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="The job queue can’t be reached."
              body="Reminders, digests and your Telegram alerts won’t run until the cache (Redis) is back."
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Scheduled jobs"
            subtitle={
              failingJobs.length
                ? `${plural(failingJobs.length, 'job')} failed on the last run. Each retries at its next scheduled time; if it keeps failing, check the bot’s logs for the error shown.`
                : 'Recurring work the bot runs on its own. Times are UTC.'
            }
          />
          {d.jobs.length === 0 ? (
            <EmptyState
              compact
              title={q ? 'No scheduled jobs are registered.' : 'Scheduled jobs can’t be read while the queue is unreachable.'}
              body={q ? 'The bot registers them when it starts — if this stays empty, the bot may not be running.' : undefined}
            />
          ) : (
            <Table>
              <THead>
                <Th>Job</Th>
                <Th hint="UTC">Runs</Th>
                <Th>Last run</Th>
                <Th hint="kept for the last ~200 runs">Last success</Th>
                <Th align="right" hint="last 24 h">
                  Failures
                </Th>
              </THead>
              <tbody>
                {d.jobs.map((j) => {
                  const info = backgroundJobInfo(j.name, j.cron);
                  const words = j.cron ? describeCron(j.cron) : null;
                  return (
                    <Tr key={j.key ?? `${j.name}|${j.cron}`}>
                      <Td className="max-w-sm">
                        <div className="font-medium text-text">{info.label}</div>
                        <div className="text-[13px] text-text-3">{info.what}</div>
                        {j.lastError && (
                          <div className="mt-1.5 rounded-md bg-danger-soft px-2 py-1.5 text-[13px] text-danger">
                            <span className="font-medium">Last run failed:</span> {j.lastError}
                            <div className="mt-0.5 text-text-2">{info.ifFailing}</div>
                          </div>
                        )}
                      </Td>
                      <Td>
                        {!j.cron ? (
                          <span className="text-text-3">On demand</span>
                        ) : words ? (
                          <span title={`cron: ${j.cron} (UTC)`}>{words}</span>
                        ) : (
                          <span>
                            <code className="font-mono text-[13px]">{j.cron}</code> <span className="text-[13px] text-text-3">(cron, UTC)</span>
                          </span>
                        )}
                        {j.nextRunAt && (
                          <div className="text-[13px] text-text-3">
                            Next: <RelativeTime value={j.nextRunAt} />
                          </div>
                        )}
                      </Td>
                      <Td>
                        <RelativeTime value={j.lastRunAt} never="Not run yet" />
                        <div className="text-[13px]">
                          {j.lastError ? (
                            <span className="font-medium text-danger">Failed</span>
                          ) : j.lastRunAt ? (
                            <span className="text-good">Succeeded</span>
                          ) : (
                            <span className="text-text-3">Waiting for its first run</span>
                          )}
                        </div>
                      </Td>
                      <Td>{j.lastSuccessAt !== undefined ? <RelativeTime value={j.lastSuccessAt} never="None kept" /> : <span className="text-text-3">—</span>}</Td>
                      <Td align="right">
                        {j.failuresLast24h == null ? (
                          <span className="text-text-3">—</span>
                        ) : j.failuresLast24h > 0 ? (
                          <span className="font-medium text-danger">{formatNumber(j.failuresLast24h)}</span>
                        ) : (
                          <span className="text-text-3">0</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <p className="text-[13px] text-text-3">Admin API version {d.versions.adminApi}</p>
      </div>
    </>
  );
}
