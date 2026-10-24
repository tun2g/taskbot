import type { AdminMcpOverview } from '@tbot/shared';
import { mcpToolInfo } from '@tbot/shared';

import { Card, CardHeader } from '@/components/ui/card';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';

import { Failures } from './failures';

export function ByToolCard({ rows, tool, onTool }: { rows: AdminMcpOverview['byTool']; tool?: string; onTool: (tool: string | undefined) => void }) {
  return (
    <Card>
      <CardHeader title="By tool" subtitle="What AI clients asked the bot to do. Click a tool to see who used it and in which groups." />
      <Table>
        <THead>
          <Th>Tool</Th>
          <Th align="right">Calls</Th>
          <Th align="right" hint="share of its calls">
            Failed
          </Th>
        </THead>
        <tbody>
          {rows.map((t) => {
            const info = mcpToolInfo(t.tool);
            const active = tool === t.tool;
            return (
              <Tr key={t.tool} onOpen={() => onTool(active ? undefined : t.tool)} className={active ? 'bg-accent-soft/60' : undefined}>
                <Td className="max-w-xs">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-text">{info.label}</span>
                    <span className={cn('text-xs', info.writes ? 'text-warn' : 'text-text-3')}>{info.writes ? 'changes tasks' : 'read-only'}</span>
                  </div>
                  <div className="text-[13px] text-text-3">{info.what}</div>
                </Td>
                <Td align="right">{formatNumber(t.calls)}</Td>
                <Td align="right">
                  <Failures failed={t.failed} calls={t.calls} />
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}
