import { backgroundJobInfo } from '@tbot/shared';

import { useRunJob } from '@/api/system';
import { ConfirmDialog } from '@/components/ui/dialog';

import type { JobRef } from '../lib/job-schedule';

/** "Run now": says exactly what the job will do before queueing one run. */
export function RunJobDialog({ job, onClose }: { job: JobRef | null; onClose: () => void }) {
  const run = useRunJob();
  const info = job ? backgroundJobInfo(job.name, job.cron) : null;
  return (
    <ConfirmDialog
      open={!!job}
      pending={run.isPending}
      onCancel={onClose}
      onConfirm={() => job && run.mutate(job, { onSuccess: onClose })}
      options={
        info && {
          title: `Run “${info.label}” now?`,
          body: (
            <>
              <p>{info.runNow ?? info.what}</p>
              <p className="text-[13px] text-text-3">
                The bot starts it within a few seconds; its scheduled runs carry on as usual. The result shows on this
                page, and this is recorded in the audit log.
              </p>
            </>
          ),
          confirmLabel: 'Run now',
        }
      }
    />
  );
}
