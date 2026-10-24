import type { AiCallStatus } from '@tbot/shared';
import { GROUP_STATUS_HINTS, GROUP_STATUS_LABELS, GroupStatus } from '@tbot/shared';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { AI_STATUS_HINTS, AI_STATUS_LABELS } from '@/lib/labels';

import { Tooltip } from './tooltip';

export type Tone = 'good' | 'warn' | 'danger' | 'neutral' | 'accent';

const TONES: Record<Tone, string> = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-neutral-soft text-text-2',
  accent: 'bg-accent-soft text-accent-text',
};

const DOTS: Record<Tone, string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  danger: 'bg-danger',
  neutral: 'bg-text-3',
  accent: 'bg-brand',
};

export function Badge({ tone = 'neutral', children, title, dot = true, className }: {
  tone?: Tone;
  children: ReactNode;
  /** What the badge means; shown as a tooltip. */
  title?: string;
  dot?: boolean;
  className?: string;
}) {
  const badge = (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded px-2 py-1 text-[13px] leading-none font-bold whitespace-nowrap', TONES[tone], className)}
    >
      {dot && <span aria-hidden className={cn('size-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
  return title ? <Tooltip content={title}>{badge}</Tooltip> : badge;
}

export const GROUP_STATUS_TONES: Record<GroupStatus, Tone> = {
  [GroupStatus.PENDING]: 'warn',
  [GroupStatus.ACTIVE]: 'good',
  [GroupStatus.REJECTED]: 'danger',
  [GroupStatus.SUSPENDED]: 'danger',
  [GroupStatus.LEFT]: 'neutral',
  [GroupStatus.MIGRATED]: 'neutral',
};

/** Status label from GROUP_STATUS_LABELS; the hint is the hover text (and shown in full on detail pages). */
export function GroupStatusBadge({ status, className }: { status: GroupStatus; className?: string }) {
  return (
    <Badge tone={GROUP_STATUS_TONES[status]} title={GROUP_STATUS_HINTS[status]} className={className}>
      {GROUP_STATUS_LABELS[status]}
    </Badge>
  );
}

const AI_STATUS_TONES: Record<AiCallStatus, Tone> = { ok: 'good', failed: 'danger', invalid: 'warn', quota: 'neutral', disabled: 'neutral' };

export function AiStatusBadge({ status }: { status: AiCallStatus }) {
  return (
    <Badge tone={AI_STATUS_TONES[status]} title={AI_STATUS_HINTS[status]}>
      {AI_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * A person's or group's AI override, in words. `defaultLabel` says what applies without one ("Default (40/day)");
 * `reason` (what you gave when setting it) goes in the hover text.
 */
export function AiOverrideBadge({
  disabled,
  dailyLimit,
  defaultLabel = 'Default',
  reason,
}: {
  disabled: boolean;
  dailyLimit: number | null;
  defaultLabel?: string;
  reason?: string | null;
}) {
  const why = reason ? ` Reason: ${reason}` : '';
  if (disabled) return <Badge tone="danger" title={`AI features are turned off by you.${why}`}>AI off</Badge>;
  if (dailyLimit != null)
    return (
      <Badge tone="accent" title={`A custom daily AI call limit set by you.${why}`}>
        {dailyLimit}/day limit
      </Badge>
    );
  return (
    <Tooltip content="No override: the default limits from Settings apply.">
      <span className="text-[13px] whitespace-nowrap text-text-3">{defaultLabel}</span>
    </Tooltip>
  );
}
