import type { AdminSystemStatus } from '@tbot/shared';

import { RelativeTime } from '@/components/ui/values';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { CHANNEL_LABELS } from '@/lib/labels';

import { botActivity, CHANNEL_ORDER } from '../lib/bot-activity';
import { StatusCard } from './status-card';

const latency = (ms: number | null) => (ms == null ? 'No answer' : `${formatNumber(ms)} ms`);

/** Database, cache and "are people reaching the bot?" side by side. */
export function HealthCards({ data: d, telegramStalled }: { data: AdminSystemStatus; telegramStalled: boolean }) {
  const activity = botActivity(d);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatusCard
        title="Database (MongoDB)"
        badge={{ tone: d.mongo.ok ? 'good' : 'danger', text: d.mongo.ok ? 'OK' : 'Down' }}
        value={latency(d.mongo.latencyMs)}
      >
        <p>Stores tasks, groups and people. Time to answer a ping — under ~50 ms is healthy.</p>
      </StatusCard>
      <StatusCard
        title="Cache (Redis)"
        badge={{ tone: d.redis.ok ? 'good' : 'danger', text: d.redis.ok ? 'OK' : 'Down' }}
        value={latency(d.redis.latencyMs)}
      >
        <p>Holds sessions, rate limits and the job queue. Time to answer a ping — under ~20 ms is healthy.</p>
      </StatusCard>
      <StatusCard
        title="People reaching the bot"
        badge={activity.badge}
        value={<RelativeTime value={d.lastEventAt} never="No activity yet" />}
      >
        <p>Last request from anyone. {activity.text}</p>
        {d.lastEventByChannel && (
          <ul className="space-y-0.5 border-t border-border pt-1.5">
            {CHANNEL_ORDER.map((c) => (
              <li key={c} className="flex justify-between gap-2">
                <span>{CHANNEL_LABELS[c]}</span>
                <span className={cn('text-text-2', c === 'telegram' && telegramStalled && 'font-medium text-warn')}>
                  <RelativeTime value={d.lastEventByChannel?.[c]} never="Not in 7 days" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </StatusCard>
    </div>
  );
}
