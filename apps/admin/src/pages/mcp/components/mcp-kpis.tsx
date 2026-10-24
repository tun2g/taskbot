import type { AdminMcpOverview } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/kpi';
import { formatNumber, formatPercent, plural } from '@/lib/format';
import { scrollToSection } from '@/lib/use-scroll-to-hash';

export function McpKpis({ data, tool, scope, rangeLabel }: { data: AdminMcpOverview; tool?: string; scope: string; rangeLabel: string }) {
  const failRate = data.calls > 0 ? data.failed / data.calls : 0;
  const refusedRate = data.calls + data.rateLimited > 0 ? data.rateLimited / (data.calls + data.rateLimited) : 0;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Active tokens"
        value={formatNumber(data.activeTokens)}
        hint="Not revoked and not expired, right now. Each lets an AI client act as that person."
        footer={
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
            <button type="button" onClick={() => scrollToSection('tokens')} className="cursor-pointer text-accent-text hover:underline">
              See the tokens ↓
            </button>
            <TextLink to="/users" search={{ hasTokens: true }}>
              Held by {plural(data.tokenOwners, 'person', 'people')} →
            </TextLink>
          </p>
        }
      />
      <KpiCard
        label="MCP calls"
        value={formatNumber(data.calls, { compact: true })}
        hint={`Tool calls from AI clients · ${rangeLabel}${scope ? ` · only ${scope}` : ''}. Broken down by tool, client, person and group below.`}
      />
      <KpiCard
        label="Failed"
        value={
          <span className={failRate >= 0.1 ? 'text-danger' : undefined}>
            {formatNumber(data.failed)} <span className="text-base font-medium text-text-3">({formatPercent(failRate, 1)})</span>
          </span>
        }
        hint="The tool returned an error: a task that doesn’t exist, no permission, bad input, or a bug. A few % is normal; see “By tool” for where."
      />
      <KpiCard
        label="Refused (limit)"
        value={
          <>
            {formatNumber(data.rateLimited)}
            {!tool && <span className="text-base font-medium text-text-3"> ({formatPercent(refusedRate, 1)})</span>}
          </>
        }
        hint={
          tool
            ? 'Refused requests aren’t tied to a tool, so this counts every tool.'
            : 'Requests refused because a token sent too many too quickly (not counted in MCP calls). Many from one person usually means a looping client — see who below.'
        }
      />
    </div>
  );
}
