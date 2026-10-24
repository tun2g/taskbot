import type { AdminGroupDetail, AdminRange } from '@tbot/shared';
import { UsageKind } from '@tbot/shared';
import { Fragment } from 'react';

import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { Table, Td, Th, THead, TotalRow, Tr } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { CHANNEL_HINTS, CHANNEL_LABELS, RANGE_LABELS, USAGE_KIND_LABELS } from '@/lib/labels';

import { groupUsageByChannel } from '../group-detail.utils';

const KIND_HINTS: Record<UsageKind, string> = {
  [UsageKind.COMMAND]: 'Slash commands like /task or /mytasks',
  [UsageKind.CALLBACK]: 'Taps on the bot’s inline buttons',
  [UsageKind.MENTION]: 'Messages that @mention the bot',
  [UsageKind.API]: 'Board loads and edits in the Mini App',
  [UsageKind.MCP_TOOL]: 'Tool calls from AI clients with an MCP token',
  [UsageKind.RATE_LIMITED]: 'Requests refused because someone sent too many too fast',
};

/** Requests by channel (with a subtotal each) and kind. Rate-limit refusals are listed apart — they did nothing. */
export function UsageByChannelCard({ usage, range }: { usage: AdminGroupDetail['usage']; range: AdminRange }) {
  const { channels, total, blocked } = groupUsageByChannel(usage);
  const rangeText = RANGE_LABELS[range].toLowerCase();

  return (
    <Card>
      <CardHeader title="Usage by channel and kind" subtitle={`What people did with the bot in this group, ${rangeText}.`} />
      {channels.length === 0 && blocked === 0 ? (
        <EmptyState compact title="Nobody used the bot here in this period." body="Try a longer date range." />
      ) : (
        <Table>
          <THead>
            <Th>Channel and kind</Th>
            <Th align="right">Requests</Th>
          </THead>
          <tbody>
            {channels.map((c) => (
              <Fragment key={c.channel}>
                <Tr className="bg-surface-2/40">
                  <Td>
                    <span className="block font-medium text-text">{CHANNEL_LABELS[c.channel]}</span>
                    <span className="block text-[13px] text-text-3">{CHANNEL_HINTS[c.channel]}</span>
                  </Td>
                  <Td align="right" className="font-medium">
                    {formatNumber(c.subtotal)}
                  </Td>
                </Tr>
                {c.kinds.map((k) => (
                  <Tr key={k.kind}>
                    <Td className="pl-10!">
                      <span className="block text-text">{USAGE_KIND_LABELS[k.kind]}</span>
                      <span className="block text-[13px] text-text-3">{KIND_HINTS[k.kind]}</span>
                    </Td>
                    <Td align="right">{formatNumber(k.count)}</Td>
                  </Tr>
                ))}
              </Fragment>
            ))}
            <TotalRow>
              <Td>Total requests</Td>
              <Td align="right">{formatNumber(total)}</Td>
            </TotalRow>
          </tbody>
        </Table>
      )}
      {blocked > 0 && (
        <p className="border-t border-border px-5 py-3 text-sm text-text-2">
          Also <span className="font-medium text-text tabular">{formatNumber(blocked)}</span>{' '}
          {blocked === 1 ? 'request was' : 'requests were'} blocked by the rate limit (someone sent too many too fast).
          They did nothing, so they aren’t in the total.
        </p>
      )}
    </Card>
  );
}
