import { PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { formatRelative } from '@/lib/format';

/** Page title with "Check now" (the page also refreshes on its own every 30 seconds). */
export function SystemHeader({
  updatedAt,
  checking,
  onCheck,
}: {
  updatedAt: number;
  checking: boolean;
  onCheck: () => void;
}) {
  return (
    <PageHeader
      title="System"
      subtitle="Is the bot healthy? Database, cache, background jobs and whether people are reaching the bot right now."
      actions={
        <Tooltip
          content={`Refreshes on its own every 30 seconds.${updatedAt > 0 ? ` Last checked ${formatRelative(new Date(updatedAt))}.` : ''}`}
        >
          <Button onClick={onCheck} loading={checking}>
            Check now
          </Button>
        </Tooltip>
      }
    />
  );
}
