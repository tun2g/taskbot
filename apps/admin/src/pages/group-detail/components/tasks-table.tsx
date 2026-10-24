import type { AdminGroupTaskRow, AdminTaskVia } from '@tbot/shared';
import { TASK_STATUS_LABELS, TaskStatus } from '@tbot/shared';

import { Badge, type Tone } from '@/components/ui/badge';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { PersonCell, RelativeTime } from '@/components/ui/values';
import { formatDate, formatDateTime } from '@/lib/format';

const VIA_LABELS: Record<AdminTaskVia, string> = {
  bot: 'Telegram chat',
  app: 'Mini App',
  ai: 'AI assistant',
  mcp: 'MCP (AI client)',
};

const STATUS_TONES: Partial<Record<string, Tone>> = {
  [TaskStatus.IN_PROGRESS]: 'accent',
  [TaskStatus.IN_REVIEW]: 'accent',
  [TaskStatus.DONE]: 'good',
};

/** "To do" from "📝 To do" (the bot's labels carry an emoji). */
function statusLabel(status: string): string {
  const label = TASK_STATUS_LABELS[status as TaskStatus];
  return label ? label.replace(/^\S+\s+/, '') : status;
}

/** One page of a group's tasks — read-only (titles only; changes happen in Telegram or the Mini App). */
export function TasksTable({ rows }: { rows: AdminGroupTaskRow[] }) {
  return (
    <Table>
      <THead>
        <Th>Task</Th>
        <Th>Status</Th>
        <Th>Assignee</Th>
        <Th>Due</Th>
        <Th hint="since created">Age</Th>
        <Th>Created via</Th>
      </THead>
      <tbody>
        {rows.map((t) => (
          <Tr key={t.id}>
            <Td className="max-w-96 min-w-64">
              <span className="block text-text">
                <span className="text-text-3 tabular">#{t.number}</span> {t.title}
              </span>
              {(t.parentNumber != null || t.epic) && (
                <span className="mt-0.5 block text-[13px] text-text-3">
                  {t.parentNumber != null && <>Subtask of #{t.parentNumber}</>}
                  {t.parentNumber != null && t.epic && ' · '}
                  {t.epic && <>Epic: {t.epic.title}</>}
                </span>
              )}
            </Td>
            <Td>
              <Badge tone={STATUS_TONES[t.status] ?? 'neutral'}>{statusLabel(t.status)}</Badge>
            </Td>
            <Td className="max-w-48">{t.assignee ? <PersonCell person={t.assignee} /> : <span className="text-text-3">Nobody</span>}</Td>
            <Td>
              {t.dueDate ? (
                <Tooltip content={formatDateTime(t.dueDate)}>
                  <span className={t.overdue ? 'font-medium whitespace-nowrap text-danger' : 'whitespace-nowrap'}>
                    {formatDate(t.dueDate)}
                    {t.overdue && ' · overdue'}
                  </span>
                </Tooltip>
              ) : (
                <span className="text-text-3">No due date</span>
              )}
            </Td>
            <Td>
              <RelativeTime value={t.createdAt} />
            </Td>
            <Td>{t.createdVia ? VIA_LABELS[t.createdVia] : <span className="text-text-3">Not recorded</span>}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
