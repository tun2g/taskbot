import type { AdminAiCallRow } from '@tbot/shared';

import { AiStatusBadge, Badge } from '@/components/ui/badge';
import { TextLink } from '@/components/ui/button';
import { Td } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { RelativeTime } from '@/components/ui/values';
import { formatDuration, formatMoney, formatNumber, personName } from '@/lib/format';
import { CHANNEL_LABELS, featureLabel } from '@/lib/labels';

const CHANNEL_SHORT = { telegram: 'Telegram', app: 'Mini App', mcp: 'MCP' } as const;

/** Just the name (no avatar — this table is wide), linking to the person. */
function PersonName({ person }: { person: AdminAiCallRow['person'] }) {
  if (!person?.id) return <span className="text-text-3">{personName(person)}</span>;
  return (
    <TextLink to="/users/$userId" params={{ userId: person.id }} className="block max-w-36 truncate">
      {personName(person)}
    </TextLink>
  );
}

function GroupCell({ call }: { call: AdminAiCallRow }) {
  if (call.group?.deleted)
    return (
      <Tooltip content="This group was deleted after the call. Its cost still counts in the totals.">
        <span className="text-text-3">Deleted group</span>
      </Tooltip>
    );
  if (call.group)
    return (
      <TextLink to="/groups/$groupId" params={{ groupId: call.group.id }} className="block max-w-40 truncate">
        {call.group.name}
      </TextLink>
    );
  return (
    <Tooltip content="Made outside a group — in a private chat with the bot, the Mini App home or MCP.">
      <span className="whitespace-nowrap text-text-3">No group</span>
    </Tooltip>
  );
}

/** Model, tokens and time in one cell: "gemini-2.5-flash" over "1,240 → 380 · 2.1 s". */
function Details({ call }: { call: AdminAiCallRow }) {
  const tokens = `${formatNumber(call.inputTokens)} tokens sent → ${formatNumber(call.outputTokens)} written back${call.cachedTokens > 0 ? ` (${formatNumber(call.cachedTokens)} of the sent ones cached, billed cheaper)` : ''}`;
  return (
    <span className="block text-[13px] leading-snug whitespace-nowrap text-text-2 tabular">
      <span className="block font-mono text-text-2">{call.model}</span>
      <Tooltip content={tokens}>
        <span className="text-text-3">
          {call.status === 'quota' || call.status === 'disabled' ? (
            'not sent to the model'
          ) : (
            <>
              {formatNumber(call.inputTokens)}
              {call.cachedTokens > 0 && '*'} → {formatNumber(call.outputTokens)}
              {call.latencyMs > 0 && ` · ${formatDuration(call.latencyMs)}`}
            </>
          )}
        </span>
      </Tooltip>
    </span>
  );
}

/** One AI call (the error, when any, goes on its own line below — see CallsTable). */
export function CallCells({ call }: { call: AdminAiCallRow }) {
  return (
    <>
      <Td>
        <RelativeTime value={call.at} />
      </Td>
      <Td>
        <span className="flex max-w-60 flex-wrap items-center gap-x-2 gap-y-1">
          <span>{featureLabel(call.feature)}</span>
          {call.channel && (
            <Badge tone="neutral" dot={false} title={`Asked via ${CHANNEL_LABELS[call.channel]}`} className="px-2 py-0.5 text-xs">
              {CHANNEL_SHORT[call.channel]}
            </Badge>
          )}
        </span>
      </Td>
      <Td>
        <GroupCell call={call} />
      </Td>
      <Td>
        <PersonName person={call.person} />
      </Td>
      <Td>
        <span className="flex flex-col items-start gap-1">
          <AiStatusBadge status={call.status} />
          {call.attempt > 1 && (
            <Tooltip content="The bot retried after the first attempt failed.">
              <span className="text-[13px] text-text-3">retry #{call.attempt}</span>
            </Tooltip>
          )}
        </span>
      </Td>
      <Td>
        <Details call={call} />
      </Td>
      <Td align="right" className="font-medium">
        {call.priced ? (
          formatMoney(call.costUsd)
        ) : (
          <Badge
            tone="warn"
            dot={false}
            title={`“${call.model}” has no price in your price table, so this call counts as $0. Adding a price in Settings prices new calls only.`}
          >
            unpriced
          </Badge>
        )}
      </Td>
    </>
  );
}
