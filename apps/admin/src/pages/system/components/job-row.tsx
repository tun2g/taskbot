import { backgroundJobInfo } from '@tbot/shared';

import { Button } from '@/components/ui/button';
import { StackLabel } from '@/components/ui/stack-label';
import { STACK_PAIR } from '@/components/ui/table-stack';
import { Td, Tr } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { RelativeTime } from '@/components/ui/values';
import { formatNumber } from '@/lib/format';

import { type JobRow as Job, nextRunSentence, scheduleText } from '../lib/job-schedule';

function FailuresCell({ count, onOpen }: { count: number | undefined; onOpen: () => void }) {
  if (count == null) return <span className="text-text-3">—</span>;
  if (count === 0) return <span className="text-text-3">0</span>;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="cursor-pointer font-medium text-danger underline-offset-2 hover:underline"
    >
      {formatNumber(count)} — see why
    </button>
  );
}

/** One scheduled job: what it does, when it checks, how its runs went, and "Run now". */
export function JobRow({ job: j, onOpenFailures, onRun }: { job: Job; onOpenFailures: () => void; onRun: () => void }) {
  const info = backgroundJobInfo(j.name, j.cron);
  const schedule = scheduleText(j);
  const retry = j.lastError ? nextRunSentence(j.nextRunAt) : null;
  return (
    <Tr>
      <Td className="max-w-sm">
        <div className="font-medium text-text">{info.label}</div>
        <div className="text-[13px] text-text-3">{info.what}</div>
        {j.lastError && (
          <div className="mt-1.5 rounded-md bg-danger-soft px-2 py-1.5 text-[13px] text-danger">
            <span className="font-medium">Last run failed:</span> {j.lastError}
            <div className="mt-0.5 text-text-2">
              {info.ifFailing} {retry ?? ''}
            </div>
          </div>
        )}
      </Td>
      <Td className={STACK_PAIR}>
        <StackLabel>Checks</StackLabel>
        <div className="max-sm:text-right">
          {schedule.cron ? (
            <Tooltip content={`Schedule (cron, UTC): ${schedule.cron}`}>
              <span>{schedule.text}</span>
            </Tooltip>
          ) : (
            <span className="text-text-3">{schedule.text}</span>
          )}
          {j.nextRunAt && (
            <div className="text-[13px] text-text-3">
              Next: <RelativeTime value={j.nextRunAt} />
            </div>
          )}
        </div>
      </Td>
      <Td className={STACK_PAIR}>
        <StackLabel>Last run</StackLabel>
        <div className="max-sm:text-right">
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
        </div>
      </Td>
      <Td className={STACK_PAIR}>
        <StackLabel>Last success</StackLabel>
        {j.lastSuccessAt !== undefined ? (
          <RelativeTime value={j.lastSuccessAt} never="None remembered" />
        ) : (
          <span className="text-text-3">—</span>
        )}
      </Td>
      <Td align="right" className={STACK_PAIR}>
        <StackLabel>Failures (24 h)</StackLabel>
        <FailuresCell count={j.failuresLast24h} onOpen={onOpenFailures} />
      </Td>
      <Td align="right">
        <Button size="sm" onClick={onRun} className="max-sm:w-full">
          Run now
        </Button>
      </Td>
    </Tr>
  );
}
